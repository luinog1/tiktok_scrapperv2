import type { AppConfig } from '../config.js';
import { AppError, isAbortError } from '../errors.js';

const MEDIA_HOST_SUFFIXES = [
  '.tiktokcdn.com', '.tiktokcdn-us.com', '.tiktokcdn-eu.com', '.tiktokv.com', '.tiktokv.us',
  '.ibytedtos.com', '.ibyteimg.com', '.byteoversea.com', '.bytecdn.cn', '.muscdn.com',
];

export interface MediaDownload {
  /** DouK returns a Web stream; adapters may also hand back a Node stream. */
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  filename: string;
  status: number;
}

export interface DoukClientOptions {
  fetchImpl?: typeof fetch;
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return MEDIA_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

export function isTikTokUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

export function extractTikTokVideoId(value: string): string | undefined {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/(?:video|v|photo)\/(\d{8,})/i);
    return match?.[1] || url.searchParams.get('item_id') || undefined;
  } catch {
    return undefined;
  }
}

export function safeFilename(value: string | undefined): string {
  const normalized = (value || 'tiktok-video.mp4').replace(/[\u0000-\u001f"\\/<>:|?*]+/g, '_').trim();
  const truncated = normalized.slice(0, 180) || 'tiktok-video.mp4';
  return /\.[a-z0-9]{2,5}$/i.test(truncated) ? truncated : `${truncated}.mp4`;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port && hostAllowed(url.hostname);
  } catch {
    return false;
  }
}

function findMediaUrl(value: unknown, seen = new Set<unknown>()): string | undefined {
  if (value === null || value === undefined || seen.has(value)) return undefined;
  if (typeof value === 'string') return isHttpUrl(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  seen.add(value);
  const object = value as Record<string, unknown>;
  const preferredKeys = [
    'videoUrl', 'video_url', 'downloadAddr', 'download_addr', 'playAddr', 'play_addr',
    'playAddress', 'play_address', 'mediaUrl', 'media_url', 'fileUrl', 'file_url', 'url', 'src',
  ];
  for (const key of preferredKeys) {
    const candidate = object[key];
    const found = findMediaUrl(candidate, seen);
    if (found) return found;
  }
  for (const candidate of Object.values(object)) {
    const found = findMediaUrl(candidate, seen);
    if (found) return found;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const found = findMediaUrl(candidate, seen);
      if (found) return found;
    }
  }
  return undefined;
}

function upstreamMessage(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || value === undefined || seen.has(value)) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  seen.add(value);
  const object = value as Record<string, unknown>;
  const preferred = ['message', 'error', 'detail', 'msg', 'status_msg'];
  for (const key of preferred) {
    const candidate = upstreamMessage(object[key], seen);
    if (candidate) return candidate;
  }
  return '';
}

export function contentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length');
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function limitedBody(body: ReadableStream<Uint8Array>, maximumBytes: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        const bytes = chunk.value as Uint8Array;
        total += bytes.byteLength;
        if (total > maximumBytes) {
          await reader.cancel('media_max_bytes_exceeded');
          controller.error(new Error('media_max_bytes_exceeded'));
          return;
        }
        controller.enqueue(bytes);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function responseLooksBinary(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  return contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/octet-stream';
}

export class DoukClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AppConfig, options: DoukClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.mediaTimeoutMs, 5_000));
    try {
      const response = await this.fetchImpl(`${this.config.mediaServiceUrl}/docs`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: this.config.mediaApiToken ? { token: this.config.mediaApiToken } : undefined,
      });
      await response.body?.cancel();
      return response.ok || response.status === 405
        ? { ok: true, detail: `HTTP ${response.status}` }
        : { ok: false, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async download(webUrl: string, filename?: string): Promise<MediaDownload> {
    if (!isTikTokUrl(webUrl)) {
      throw new AppError('invalid_tiktok_url', 'A URL deve ser HTTPS e pertencer ao TikTok.', 400);
    }
    const endpoint = this.endpointFor(webUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mediaTimeoutMs);
    let lookup: Response;
    try {
      lookup = await this.fetchImpl(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, video/*, application/octet-stream',
          'Content-Type': 'application/json',
          ...(this.config.mediaApiToken ? { token: this.config.mediaApiToken } : {}),
        },
        body: JSON.stringify(this.requestBody(webUrl)),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError('media_timeout', 'Timeout ao contactar o serviço DouK.', 504, { retryable: true });
      }
      throw new AppError('media_service_unavailable', error instanceof Error ? error.message : String(error), 502, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (lookup.status === 401 || lookup.status === 403) {
      await lookup.body?.cancel();
      throw new AppError('media_auth_failed', 'DouK rejeitou o token MEDIA_API_TOKEN.', 503);
    }
    if (lookup.status === 404 || lookup.status === 410) {
      await lookup.body?.cancel();
      throw new AppError('media_not_found', 'O vídeo não foi encontrado ou foi removido.', 410);
    }
    if (!lookup.ok) {
      const preview = (await lookup.text()).slice(0, 500);
      throw new AppError('media_upstream_error', `DouK respondeu HTTP ${lookup.status}.`, 502, {
        details: { preview },
        retryable: lookup.status >= 500,
      });
    }

    if (responseLooksBinary(lookup) && lookup.body) {
      return this.asDownload(lookup, filename);
    }

    let data: unknown;
    try {
      data = await lookup.json();
    } catch {
      throw new AppError('media_invalid_response', 'DouK devolveu uma resposta não reconhecida.', 502);
    }
    const mediaUrl = findMediaUrl(data);
    if (!mediaUrl) {
      const message = upstreamMessage(data);
      if (/cookie|login|session|登录|登陆/iu.test(message) && /expir|invalid|missing|required|失效|过期|错误|失败/iu.test(message)) {
        throw new AppError('media_cookie_expired', 'O cookie TikTok do serviço de mídia precisa ser renovado.', 503);
      }
      throw new AppError(
        'media_url_missing',
        'DouK não devolveu uma URL de mídia. Confirme o endpoint da versão instalada em /docs.',
        502,
      );
    }
    return this.fetchResolvedMedia(mediaUrl, filename);
  }

  private endpointFor(webUrl: string): string {
    const id = extractTikTokVideoId(webUrl) ?? webUrl;
    const endpoint = this.config.mediaDownloadEndpoint.replace('{id}', encodeURIComponent(id));
    if (/^https?:\/\//iu.test(endpoint)) return endpoint;
    return `${this.config.mediaServiceUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  private requestBody(webUrl: string): Record<string, string> {
    const id = extractTikTokVideoId(webUrl);
    // DouK V5's documented detail endpoint accepts detail_id. Sending the
    // canonical URL as a fallback also supports custom builds exposing URL
    // based download routes; unknown extra fields are ignored by FastAPI.
    return { detail_id: id ?? webUrl, url: webUrl, web_video_url: webUrl };
  }

  private async fetchResolvedMedia(mediaUrl: string, filename?: string): Promise<MediaDownload> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mediaTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(mediaUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'video/*, application/octet-stream, */*',
          Referer: 'https://www.tiktok.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; tiktok-multiprovider-bff/1.0)',
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError('media_timeout', 'Timeout ao descarregar o ficheiro.', 504, { retryable: true });
      }
      throw new AppError('media_download_failed', error instanceof Error ? error.message : String(error), 502, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      throw new AppError('media_not_found', 'O ficheiro de vídeo não está disponível.', 410);
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new AppError('media_access_denied', 'O CDN do TikTok rejeitou a mídia.', 410);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new AppError('media_download_failed', `CDN respondeu HTTP ${response.status}.`, 502, { retryable: true });
    }
    return this.asDownload(response, filename);
  }

  private asDownload(response: Response, filename?: string): MediaDownload {
    const size = contentLength(response);
    if (size !== undefined && size > this.config.mediaMaxBytes) {
      void response.body?.cancel();
      throw new AppError('media_too_large', 'O ficheiro excede o limite configurado.', 413);
    }
    return {
      body: limitedBody(response.body as ReadableStream<Uint8Array>, this.config.mediaMaxBytes),
      contentType: response.headers.get('content-type') || 'video/mp4',
      ...(size === undefined ? {} : { contentLength: size }),
      ...(response.headers.get('content-range') ? { contentRange: response.headers.get('content-range')! } : {}),
      filename: safeFilename(filename),
      status: response.status,
    };
  }
}

export function mediaHostIsAllowed(value: string): boolean {
  try {
    return hostAllowed(new URL(value).hostname);
  } catch {
    return false;
  }
}
