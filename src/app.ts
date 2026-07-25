import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import express from 'express';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';

import type { AppConfig } from './config.js';
import { mediaConfigured, scrapeConfigured } from './config.js';
import { AppError, errorResponse } from './errors.js';
import { DoukClient } from './media/doukClient.js';
import type { MediaDownload } from './media/doukClient.js';
import { safeFilename } from './media/doukClient.js';
import { getMediaProvider } from './media/factory.js';
import { createExtractionProvider } from './providers/extractionProvider.js';
import type { ExtractionProvider } from './providers/extractionProvider.js';
import type { MediaProvider } from './providers/types.js';
import { mediaRequestSchema, parseRunRequest } from './schemas.js';

export interface AppDependencies {
  provider?: ExtractionProvider;
  providerFactory?: (name?: string) => ExtractionProvider;
  mediaProvider?: MediaProvider;
  doukClient?: DoukClient;
}

function cors(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    const origin = req.header('origin') ?? '';
    const allowAny = config.corsOrigins.length === 0;
    if (origin && (allowAny || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
      if (!allowAny) res.setHeader('Vary', 'Origin');
    } else if (allowAny) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-request-id, x-scrape-provider');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range, x-request-id');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

function requestContext(): RequestHandler {
  return (req, res, next) => {
    const requestId = req.header('x-request-id')?.slice(0, 100) || randomUUID();
    res.setHeader('x-request-id', requestId);
    res.locals.requestId = requestId;
    next();
  };
}

function auth(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    if (!config.serviceApiKey) return next();
    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
    const provided = req.header('x-api-key') || bearer;
    if (provided !== config.serviceApiKey) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    next();
  };
}

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const entry = JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

function streamDownload(res: Response, download: MediaDownload): void {
  res.status(download.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', download.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${download.filename}"`);
  if (download.contentLength !== undefined) res.setHeader('Content-Length', String(download.contentLength));
  if (download.contentRange) {
    res.setHeader('Content-Range', download.contentRange);
    res.setHeader('Accept-Ranges', 'bytes');
  }
  const stream = Readable.fromWeb(download.body as never);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

type DetailedMediaValue = {
  body: unknown;
  contentType?: unknown;
  contentLength?: unknown;
  contentRange?: unknown;
  filename?: unknown;
  status?: unknown;
};

function isDetailedMedia(value: unknown): value is DetailedMediaValue {
  return Boolean(value && typeof value === 'object' && 'body' in value);
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(value && typeof value === 'object' && typeof (value as { getReader?: unknown }).getReader === 'function');
}

function toWebReadableStream(value: unknown): ReadableStream<Uint8Array> {
  if (isWebReadableStream(value)) return value;
  if (value instanceof Readable) return Readable.toWeb(value) as ReadableStream<Uint8Array>;
  if (value && typeof value === 'object' && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
    return Readable.toWeb(Readable.from(value as AsyncIterable<Uint8Array>)) as ReadableStream<Uint8Array>;
  }
  throw new AppError('media_invalid_stream', 'Provider de mídia devolveu um stream inválido.', 502);
}

/** Normalizes provider output before handing it to Express' streaming layer. */
export function normalizeMediaDownload(value: unknown, filename?: string): MediaDownload {
  if (isDetailedMedia(value)) {
    const contentType = typeof value.contentType === 'string' && value.contentType.trim()
      ? value.contentType
      : 'video/mp4';
    const contentLength = typeof value.contentLength === 'number' && Number.isFinite(value.contentLength)
      ? value.contentLength
      : undefined;
    const contentRange = typeof value.contentRange === 'string' && value.contentRange.trim()
      ? value.contentRange
      : undefined;
    const status = typeof value.status === 'number' && Number.isFinite(value.status) ? value.status : 200;
    return {
      body: toWebReadableStream(value.body),
      contentType,
      ...(contentLength === undefined ? {} : { contentLength }),
      ...(contentRange === undefined ? {} : { contentRange }),
      filename: safeFilename(typeof value.filename === 'string' ? value.filename : filename),
      status,
    };
  }
  return {
    body: toWebReadableStream(value),
    contentType: 'video/mp4',
    filename: safeFilename(filename),
    status: 200,
  };
}

function requestedProvider(req: Request, config: AppConfig): string | undefined {
  const requested = req.header('x-scrape-provider')?.trim().toLowerCase();
  if (!requested) return undefined;
  if (!config.allowProviderOverride) {
    throw new AppError('provider_override_disabled', 'Override de provider está desativado.', 403);
  }
  if (!['self', 'scrapedo', 'apify'].includes(requested)) {
    throw new AppError('invalid_scrape_provider', 'x-scrape-provider deve ser self, scrapedo ou apify.', 400);
  }
  return requested;
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {}) {
  const app = express();
  const providerFactory = dependencies.providerFactory ?? ((name?: string) => createExtractionProvider(config, name));
  let defaultProvider = dependencies.provider;
  let providerInitError: unknown;
  if (!defaultProvider) {
    try { defaultProvider = providerFactory(); } catch (error) { providerInitError = error; }
  }

  const doukClient = dependencies.doukClient ?? new DoukClient(config);
  let media = dependencies.mediaProvider;
  let mediaInitError: unknown;
  if (!media) {
    try { media = getMediaProvider(config, doukClient); } catch (error) { mediaInitError = error; }
  }

  const requireAuth = auth(config);
  let activeRuns = 0;

  app.disable('x-powered-by');
  app.use(requestContext());
  app.use(cors(config));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    const scrapeIsConfigured = scrapeConfigured(config) && !providerInitError;
    const mediaIsConfigured = mediaConfigured(config) && !mediaInitError;
    const [scrapeHealth, mediaHealth] = await Promise.all([
      scrapeIsConfigured && defaultProvider?.health
        ? defaultProvider.health().catch((error) => ({ ok: false, detail: error instanceof Error ? error.message : String(error) }))
        : Promise.resolve({ ok: scrapeIsConfigured, detail: providerInitError instanceof Error ? providerInitError.message : undefined }),
      mediaIsConfigured && media?.health
        ? media.health().catch((error) => ({ ok: false, detail: error instanceof Error ? error.message : String(error) }))
        : Promise.resolve({ ok: mediaIsConfigured, detail: mediaInitError instanceof Error ? mediaInitError.message : undefined }),
    ]);
    const ready = scrapeIsConfigured && mediaIsConfigured && scrapeHealth.ok && mediaHealth.ok;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      ready,
      service: 'tiktok-multiprovider-bff',
      timestamp: new Date().toISOString(),
      activeRuns,
      scrapeProvider: config.scrapeProvider,
      mediaProvider: config.mediaProvider,
      scrape: {
        provider: config.scrapeProvider,
        configured: scrapeIsConfigured,
        ok: scrapeHealth.ok,
        ...(scrapeHealth.detail ? { detail: scrapeHealth.detail } : {}),
      },
      media: {
        provider: config.mediaProvider,
        configured: mediaIsConfigured,
        ok: mediaHealth.ok,
        ...(mediaHealth.detail ? { detail: mediaHealth.detail } : {}),
      },
    });
  });

  app.post('/run', requireAuth, async (req, res, next) => {
    const parsed = parseRunRequest(req.body, { max: config.defaultMaxResults, sort: config.defaultSortBy });
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'invalid_request',
        details: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
      return;
    }
    if (activeRuns >= config.maxConcurrentRuns) {
      res.status(429).json({ ok: false, error: 'too_many_active_runs', retryable: true });
      return;
    }

    const startedAt = Date.now();
    activeRuns += 1;
    try {
      const override = requestedProvider(req, config);
      const provider = override ? providerFactory(override) : defaultProvider;
      if (!provider) throw providerInitError ?? new AppError('scrape_provider_unavailable', 'Provider de scrape indisponível.', 500);
      const result = await provider.run(parsed.data);
      const status = result.ok ? 200 : result.retryable ? 502 : 422;
      log('info', 'run_finished', {
        requestId: res.locals.requestId,
        ok: result.ok,
        provider: result.ok ? result.provider : provider.name,
        source: result.ok ? result.source : undefined,
        total: result.ok ? result.total : undefined,
        latencyMs: Date.now() - startedAt,
        interactionId: result.interactionId,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(status).json(result);
    } catch (error) {
      next(error);
    } finally {
      activeRuns -= 1;
    }
  });

  const downloadHandler = async (req: Request, res: Response, next: NextFunction) => {
    const body = req.method === 'GET' ? { url: req.query.url, filename: req.query.filename } : req.body;
    const parsed = mediaRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'invalid_media_request', details: parsed.error.issues });
      return;
    }
    if (!media) {
      next(mediaInitError ?? new AppError('media_provider_unavailable', 'Provider de mídia indisponível.', 500));
      return;
    }
    if (media.name === 'off') {
      res.status(503).json({ ok: false, error: 'media_disabled', fallbackUrl: parsed.data.url });
      return;
    }
    const startedAt = Date.now();
    try {
      const download = normalizeMediaDownload(await media.download(parsed.data.url, parsed.data.filename), parsed.data.filename);
      log('info', 'media_ready', {
        requestId: res.locals.requestId,
        latencyMs: Date.now() - startedAt,
        contentType: download.contentType,
        contentLength: download.contentLength,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      streamDownload(res, download);
    } catch (error) {
      if (error instanceof AppError && !res.headersSent) {
        log('error', 'media_failed', {
          requestId: res.locals.requestId,
          latencyMs: Date.now() - startedAt,
          code: error.code,
          status: error.statusCode,
        });
        res.status(error.statusCode).json({ ...errorResponse(error), fallbackUrl: parsed.data.url });
        return;
      }
      next(error);
    }
  };

  app.post('/download-media', requireAuth, downloadHandler);
  app.post('/api/download-media', requireAuth, downloadHandler);
  app.get('/download', requireAuth, downloadHandler);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const isJsonSyntaxError = error instanceof SyntaxError && 'body' in (error as object);
    const status = isJsonSyntaxError ? 400 : error instanceof AppError ? error.statusCode : 500;
    log('error', 'request_failed', {
      requestId: res.locals.requestId,
      status,
      code: isJsonSyntaxError ? 'invalid_json' : error instanceof AppError ? error.code : 'internal_error',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof AppError && error.details !== undefined ? { details: error.details } : {}),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(isJsonSyntaxError ? { ok: false, error: 'invalid_json' } : errorResponse(error));
  };
  app.use(errorHandler);

  return app;
}
