import type { AppConfig } from '../../config.js';
import { AppError, isAbortError } from '../../errors.js';
import { extractRawItems } from '../../pipeline/mapper.js';
import { parseScrapeDoPage } from '../scrapedo/parsePage.js';

export interface SelfHostedClientOptions {
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasPostShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['id', 'video_id', 'aweme_id', 'webVideoUrl', 'url', 'desc', 'text'].some((key) => value[key] !== undefined);
}

function itemsFromPayload(payload: unknown): unknown[] {
  const items = extractRawItems(payload);
  if (items.length) return items;
  if (hasPostShape(payload)) return [payload];
  if (isRecord(payload) && hasPostShape(payload.data)) return [payload.data];
  return [];
}

function responsePreview(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function serviceUrl(base: string, endpoint: string): string {
  return /^https?:\/\//iu.test(endpoint) ? endpoint : `${base}${endpoint}`;
}

export class SelfHostedClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AppConfig, options: SelfHostedClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(queries: string[], opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal }): Promise<unknown[]> {
    if (this.config.selfScrapeMode === 'direct') return this.requestDirect(queries, opts, 'search');
    try {
      const items = await this.requestMany(this.config.scrapeSearchEndpoint, queries, opts, 'search');
      if (items.length || this.config.selfScrapeMode === 'service') return items;
    } catch (error) {
      if (this.config.selfScrapeMode === 'service' || !(error instanceof AppError) || error.code !== 'self_scrape_endpoint_missing') throw error;
    }
    return this.requestDirect(queries, opts, 'search');
  }

  async hashtags(tags: string[], opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal }): Promise<unknown[]> {
    if (this.config.selfScrapeMode === 'direct') return this.requestDirect(tags, opts, 'hashtag');
    try {
      const items = await this.requestMany(this.config.scrapeHashtagEndpoint, tags, opts, 'hashtag');
      if (items.length || this.config.selfScrapeMode === 'service') return items;
    } catch (error) {
      if (this.config.selfScrapeMode === 'service' || !(error instanceof AppError) || error.code !== 'self_scrape_endpoint_missing') throw error;
    }
    return this.requestDirect(tags, opts, 'hashtag');
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (this.config.selfScrapeMode === 'direct') return { ok: true, detail: 'direct_fetch_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.scrapeTimeoutMs, 5_000));
    try {
      const response = await this.fetchImpl(serviceUrl(this.config.scrapeServiceUrl, this.config.scrapeHealthEndpoint), {
        method: 'GET',
        signal: controller.signal,
        headers: this.headers(),
      });
      await response.body?.cancel();
      if (response.status === 404 && this.config.selfScrapeMode === 'auto') {
        return { ok: true, detail: `service HTTP ${response.status}; direct_fallback_configured` };
      }
      return response.ok
        ? { ok: true, detail: `HTTP ${response.status}` }
        : { ok: false, detail: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestDirect(
    terms: string[],
    opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal },
    source: 'search' | 'hashtag',
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const path = source === 'search'
        ? `/search?q=${encodeURIComponent(term.trim())}`
        : `/tag/${encodeURIComponent(term.replace(/^#/, '').trim())}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.scrapeTimeoutMs);
      const abortParent = () => controller.abort();
      opts.signal?.addEventListener('abort', abortParent, { once: true });
      try {
        const response = await this.fetchImpl(`${this.config.tiktokBaseUrl}${path}`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': opts.onlyBrazil ? 'pt-BR,pt;q=0.9,en;q=0.7' : 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            Referer: 'https://www.tiktok.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
            ...(this.config.tiktokCookie ? { Cookie: this.config.tiktokCookie } : {}),
          },
        });
        const body = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new AppError('self_scrape_access_denied', 'TikTok rejeitou o fetch self-hosted; renove o cookie ou configure um proxy.', 502, { retryable: true });
        }
        if (!response.ok) {
          throw new AppError('scrape_upstream_unavailable', `TikTok respondeu HTTP ${response.status}.`, 502, { retryable: response.status >= 500 || response.status === 429 });
        }
        for (const item of parseScrapeDoPage(body)) {
          const key = this.identity(item);
          if (key && seen.has(key)) continue;
          if (key) seen.add(key);
          items.push(item);
          if (items.length >= opts.max) return items;
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (isAbortError(error)) {
          throw new AppError('self_scrape_timeout', 'Timeout no fetch direto do TikTok.', 504, { retryable: true });
        }
        throw new AppError('scrape_upstream_unavailable', error instanceof Error ? error.message : String(error), 502, { retryable: true });
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abortParent);
      }
    }
    return items;
  }

  private async requestMany(
    endpoint: string,
    terms: string[],
    opts: { max: number; onlyBrazil?: boolean; geoCode?: string; render?: boolean; superProxy?: boolean; device?: string; signal?: AbortSignal },
    source: 'search' | 'hashtag',
  ): Promise<unknown[]> {
    const all: unknown[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const providerOptions = {
        ...(opts.geoCode ? { geoCode: opts.geoCode } : {}),
        ...(opts.render === undefined ? {} : { render: opts.render }),
        ...(opts.superProxy === undefined ? {} : { superProxy: opts.superProxy }),
        ...(opts.device ? { device: opts.device } : {}),
      };
      const payload = source === 'search'
        ? { keyword: term, query: term, search_keyword: term, max: opts.max, count: opts.max, limit: opts.max, onlyBrazil: Boolean(opts.onlyBrazil), ...providerOptions }
        : { hashtag: term.replace(/^#/, ''), tag: term.replace(/^#/, ''), keyword: term.replace(/^#/, ''), max: opts.max, count: opts.max, limit: opts.max, onlyBrazil: Boolean(opts.onlyBrazil), ...providerOptions };
      const response = await this.request(endpoint, payload, opts.signal);
      for (const item of itemsFromPayload(response)) {
        const key = this.identity(item);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        all.push(item);
        if (all.length >= opts.max) return all;
      }
    }
    return all;
  }

  private async request(endpoint: string, body: Record<string, unknown>, parentSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.scrapeTimeoutMs);
    const abortParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortParent, { once: true });
    try {
      const response = await this.fetchImpl(serviceUrl(this.config.scrapeServiceUrl, endpoint), {
        method: 'POST',
        signal: controller.signal,
        headers: { ...this.headers(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      let parsed: unknown = {};
      if (raw.trim()) {
        try { parsed = JSON.parse(raw) as unknown; } catch { parsed = raw; }
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError('self_scrape_auth_failed', 'O serviço self-hosted rejeitou o token.', 502, { retryable: false });
      }
      if (response.status === 404) {
        throw new AppError('self_scrape_endpoint_missing', `Endpoint self-hosted não encontrado (${endpoint}).`, 502);
      }
      if (!response.ok) {
        throw new AppError('scrape_upstream_unavailable', `Serviço self-hosted respondeu HTTP ${response.status}.`, 502, {
          details: { preview: typeof parsed === 'string' ? responsePreview(parsed) : parsed },
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      return parsed;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortError(error)) {
        throw new AppError('self_scrape_timeout', 'Timeout ao consultar o serviço self-hosted.', 504, { retryable: true });
      }
      throw new AppError('scrape_upstream_unavailable', error instanceof Error ? error.message : String(error), 502, { retryable: true });
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortParent);
    }
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      ...(this.config.scrapeApiToken ? { token: this.config.scrapeApiToken, Authorization: `Bearer ${this.config.scrapeApiToken}` } : {}),
      'User-Agent': 'tiktok-multiprovider-bff/1.0',
    };
  }

  private identity(value: unknown): string {
    if (!isRecord(value)) return '';
    for (const key of ['id', 'video_id', 'videoId', 'aweme_id', 'awemeId', 'webVideoUrl', 'url']) {
      const candidate = value[key];
      if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
    }
    return '';
  }
}
