import type { AppConfig } from '../../config.js';
import { AppError, isAbortError } from '../../errors.js';
import type { ScrapeMeta } from '../types.js';
import { parseScrapeDoPage } from './parsePage.js';
import { buildHashtagUrl, buildSearchUrl } from './urls.js';

export interface ScrapeDoClientOptions {
  fetchImpl?: typeof fetch;
}

export interface ScrapeDoFetchResult {
  items: unknown[];
  meta: ScrapeMeta;
}

function header(response: Response, name: string): string | undefined {
  return response.headers.get(name) ?? undefined;
}

function numeric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function identity(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  for (const key of ['id', 'video_id', 'videoId', 'aweme_id', 'awemeId', 'webVideoUrl', 'web_video_url', 'url']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'number') return String(record[key]);
  }
  return '';
}

export class ScrapeDoClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AppConfig, options: ScrapeDoClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchTarget(targetUrl: string, opts: { onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal } = {}): Promise<ScrapeDoFetchResult> {
    if (!this.config.scrapeDoToken) {
      throw new AppError('scrapedo_token_missing', 'SCRAPE_PROVIDER=scrapedo requer SCRAPE_DO_TOKEN.', 500);
    }
    const query = new URLSearchParams({ token: this.config.scrapeDoToken, url: targetUrl });
    if (opts.superProxy ?? this.config.scrapeDoSuper) query.set('super', 'true');
    const render = opts.render ?? this.config.scrapeDoRender;
    if (render) {
      query.set('render', 'true');
      // scrape.do blocks CSS/images by default under render; TikTok's shell
      // then never hydrates the item list, so resources stay enabled.
      if (!this.config.scrapeDoBlockResources) query.set('blockResources', 'false');
      if (this.config.scrapeDoCustomWaitMs > 0) query.set('customWait', String(this.config.scrapeDoCustomWaitMs));
      if (this.config.scrapeDoWaitSelector) query.set('waitSelector', this.config.scrapeDoWaitSelector);
      if (this.config.scrapeDoWaitUntil) query.set('waitUntil', this.config.scrapeDoWaitUntil);
      if (this.config.scrapeDoReturnJson) query.set('returnJSON', 'true');
    }
    // Without a geo pin TikTok routes through arbitrary exit countries and
    // often serves a localized shell without results.
    const geoCode = opts.geoCode || this.config.scrapeDoGeoCode;
    if (geoCode) query.set('geoCode', geoCode);
    const device = opts.device || this.config.scrapeDoDevice;
    if (device) query.set('device', device);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.scrapeDoTimeoutMs);
    const abortParent = () => controller.abort();
    opts.signal?.addEventListener('abort', abortParent, { once: true });
    try {
      const endpoint = `${this.config.scrapeDoBaseUrl}/?${query.toString()}`;
      const response = await this.fetchImpl(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'text/html, application/json;q=0.9, */*', 'User-Agent': 'tiktok-multiprovider-bff/1.0' },
      });
      const body = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new AppError('scrapedo_auth_failed', 'scrape.do rejeitou o token.', 502);
      }
      if (response.status === 429) {
        throw new AppError('scrapedo_rate_limited', 'scrape.do atingiu o limite de requisições.', 429, { retryable: true });
      }
      if (!response.ok) {
        throw new AppError('scrapedo_upstream_error', `scrape.do respondeu HTTP ${response.status}.`, 502, {
          details: { preview: body.replace(/\s+/gu, ' ').slice(0, 500) },
          retryable: response.status >= 500,
        });
      }
      let payload: unknown = body;
      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      if (contentType.includes('json')) {
        try { payload = JSON.parse(body) as unknown; } catch { /* parser handles text */ }
      }
      const items = parseScrapeDoPage(payload);
      if (!items.length) {
        throw new AppError('parse_failed', 'Não foi possível encontrar vídeos na página devolvida pelo scrape.do.', 422, {
          details: { targetUrl },
        });
      }
      const credits = numeric(header(response, 'scrape.do-request-cost')) ??
        numeric(header(response, 'x-scrapedo-request-cost'));
      return {
        items,
        meta: {
          ...(credits === undefined ? {} : { creditsUsed: credits }),
          pagesFetched: 1,
          requests: 1,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortError(error)) {
        throw new AppError('scrapedo_timeout', 'Timeout ao consultar o scrape.do.', 504, { retryable: true });
      }
      throw new AppError('scrapedo_network_error', error instanceof Error ? error.message : String(error), 502, { retryable: true });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abortParent);
    }
  }

  async search(queries: string[], opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal }): Promise<ScrapeDoFetchResult> {
    return this.fetchMany(queries.map(buildSearchUrl), opts);
  }

  async hashtags(tags: string[], opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal }): Promise<ScrapeDoFetchResult> {
    return this.fetchMany(tags.map(buildHashtagUrl), opts);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this.config.scrapeDoToken
      ? { ok: true, detail: 'token_configured' }
      : { ok: false, detail: 'SCRAPE_DO_TOKEN ausente' };
  }

  private async fetchMany(urls: string[], opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal }): Promise<ScrapeDoFetchResult> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    let credits = 0;
    let pagesFetched = 0;
    let requests = 0;
    for (const url of urls.slice(0, this.config.scrapeDoMaxPages)) {
      const page = await this.fetchTarget(url, opts);
      pagesFetched += page.meta.pagesFetched ?? 1;
      requests += page.meta.requests ?? 1;
      credits += page.meta.creditsUsed ?? 0;
      for (const item of page.items) {
        const key = identity(item);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        items.push(item);
        if (items.length >= opts.max) return { items, meta: { creditsUsed: credits || undefined, pagesFetched, requests } };
      }
    }
    return { items, meta: { creditsUsed: credits || undefined, pagesFetched, requests } };
  }
}
