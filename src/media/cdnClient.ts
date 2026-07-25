import type { AppConfig } from '../config.js';
import { AppError, isAbortError } from '../errors.js';
import {
  contentLength,
  extractTikTokVideoId,
  isTikTokUrl,
  limitedBody,
  mediaHostIsAllowed,
  safeFilename,
} from './doukClient.js';
import type { MediaDownload } from './doukClient.js';

// Hosts beyond the shared TikTok CDN list that legitimately serve the video
// file in the cdn flow: the webapp play addresses (v16-webapp-prime.tiktok.com),
// the tikwm-compatible resolver proxy and its Akamai mirrors.
const CDN_EXTRA_HOST_SUFFIXES = ['.tiktok.com', '.tikwm.com', '.akamaized.net'];

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const UNIVERSAL_DATA_PATTERN =
  /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/u;

export interface CdnClientOptions {
  fetchImpl?: typeof fetch;
}

interface ResolverPayload {
  code?: number;
  msg?: string;
  data?: {
    id?: string;
    title?: string;
    play?: string;
    hdplay?: string;
    wmplay?: string;
  };
}

function cdnUrlAllowed(value: string): boolean {
  if (mediaHostIsAllowed(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    return CDN_EXTRA_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
  } catch {
    return false;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Resolves TikTok posts to a direct MP4 the way ssstik-style sites do, without
 * a DouK deployment: a tikwm-compatible resolver first (no-watermark file) and
 * the page's own __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON as fallback
 * (watermarked playAddr fetched with the page cookies).
 */
export class CdnClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AppConfig, options: CdnClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    // No probe: the resolver is rate limited and the direct path has no cheap
    // endpoint, mirroring how scrape.do health avoids spending credits.
    return { ok: true, detail: this.config.mediaCdnResolverUrl ? 'resolver+page' : 'page-only' };
  }

  async download(webUrl: string, filename?: string): Promise<MediaDownload> {
    if (!isTikTokUrl(webUrl)) {
      throw new AppError('invalid_tiktok_url', 'A URL deve ser HTTPS e pertencer ao TikTok.', 400);
    }
    const canonical = await this.expandShortLink(webUrl);
    const videoId = extractTikTokVideoId(canonical);
    const fallbackName = filename ?? `tiktok-${videoId ?? 'video'}.mp4`;
    const failures: string[] = [];

    if (this.config.mediaCdnResolverUrl) {
      try {
        return await this.viaResolver(canonical, fallbackName);
      } catch (error) {
        if (error instanceof AppError && ['media_not_found', 'media_too_large'].includes(error.code)) throw error;
        failures.push(`resolver: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      return await this.viaVideoPage(canonical, fallbackName);
    } catch (error) {
      if (error instanceof AppError && ['media_not_found', 'media_too_large'].includes(error.code)) throw error;
      failures.push(`page: ${error instanceof Error ? error.message : String(error)}`);
    }

    throw new AppError(
      'media_unresolvable',
      'Não foi possível resolver o vídeo agora. Tente novamente em instantes.',
      502,
      { retryable: true, details: { attempts: failures } },
    );
  }

  /** vm.tiktok.com / vt.tiktok.com / tiktok.com/t/ links redirect to the canonical post URL. */
  private async expandShortLink(webUrl: string): Promise<string> {
    let current = webUrl;
    for (let hop = 0; hop < 3 && !extractTikTokVideoId(current); hop += 1) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(current, {
          redirect: 'manual',
          headers: { 'User-Agent': BROWSER_UA },
        }, Math.min(this.config.mediaTimeoutMs, 15_000));
      } catch {
        return current;
      }
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) return current;
      const next = new URL(location, current).toString();
      if (!isTikTokUrl(next)) return current;
      current = next;
    }
    return current;
  }

  private async viaResolver(canonical: string, filename: string): Promise<MediaDownload> {
    const endpoint = `${this.config.mediaCdnResolverUrl}/api/?url=${encodeURIComponent(canonical)}&hd=1`;
    const response = await this.fetchWithTimeout(endpoint, {
      headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
    }, this.config.mediaTimeoutMs);
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('media_resolver_error', `Resolver respondeu HTTP ${response.status}.`, 502, { retryable: true });
    }
    let payload: ResolverPayload;
    try {
      payload = await response.json() as ResolverPayload;
    } catch {
      throw new AppError('media_resolver_error', 'Resolver devolveu uma resposta não reconhecida.', 502, { retryable: true });
    }
    if (payload.code !== 0 || !payload.data) {
      const message = payload.msg || `code ${payload.code}`;
      if (/not\s+found|removed|deleted|private/iu.test(message)) {
        throw new AppError('media_not_found', 'O vídeo não foi encontrado ou foi removido.', 410);
      }
      throw new AppError('media_resolver_error', `Resolver recusou a URL: ${message}.`, 502, { retryable: true });
    }
    const candidate = firstString(payload.data.hdplay, payload.data.play, payload.data.wmplay);
    if (!candidate) {
      throw new AppError('media_resolver_error', 'Resolver não devolveu URL de mídia.', 502, { retryable: true });
    }
    const mediaUrl = /^https?:\/\//iu.test(candidate)
      ? candidate
      : `${this.config.mediaCdnResolverUrl}${candidate.startsWith('/') ? candidate : `/${candidate}`}`;
    if (!cdnUrlAllowed(mediaUrl)) {
      throw new AppError('media_resolver_error', 'Resolver devolveu uma URL fora da allowlist.', 502);
    }
    return this.fetchMedia(mediaUrl, filename, { Referer: 'https://www.tiktok.com/' });
  }

  private async viaVideoPage(canonical: string, filename: string): Promise<MediaDownload> {
    const response = await this.fetchWithTimeout(canonical, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    }, this.config.mediaTimeoutMs);
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      throw new AppError('media_not_found', 'O vídeo não foi encontrado ou foi removido.', 410);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('media_page_error', `A página do vídeo respondeu HTTP ${response.status}.`, 502, { retryable: true });
    }
    const cookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .filter(Boolean)
      .join('; ');
    const html = await response.text();
    const script = html.match(UNIVERSAL_DATA_PATTERN)?.[1];
    if (!script) {
      throw new AppError('media_page_error', 'A página do vídeo veio sem os dados de hidratação (possível verify wall).', 502, {
        retryable: true,
      });
    }
    let mediaUrl: string | undefined;
    try {
      const data = JSON.parse(script) as {
        __DEFAULT_SCOPE__?: Record<string, {
          statusCode?: number;
          itemInfo?: { itemStruct?: { video?: { downloadAddr?: string; playAddr?: string; bitrateInfo?: Array<{ PlayAddr?: { UrlList?: string[] } }> } } };
        }>;
      };
      const detail = data.__DEFAULT_SCOPE__?.['webapp.video-detail'];
      if (detail?.statusCode !== undefined && detail.statusCode !== 0) {
        throw new AppError('media_not_found', 'O vídeo não está disponível (removido, privado ou restrito).', 410);
      }
      const video = detail?.itemInfo?.itemStruct?.video;
      mediaUrl = firstString(video?.downloadAddr, video?.playAddr, video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('media_page_error', 'Os dados de hidratação da página não puderam ser interpretados.', 502, {
        retryable: true,
      });
    }
    if (!mediaUrl || !cdnUrlAllowed(mediaUrl)) {
      throw new AppError('media_page_error', 'A página não expôs uma URL de vídeo utilizável.', 502, { retryable: true });
    }
    return this.fetchMedia(mediaUrl, filename, {
      Referer: 'https://www.tiktok.com/',
      ...(cookies ? { Cookie: cookies } : {}),
    });
  }

  private async fetchMedia(mediaUrl: string, filename: string, headers: Record<string, string>): Promise<MediaDownload> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(mediaUrl, {
        headers: {
          Accept: 'video/*, application/octet-stream, */*',
          'User-Agent': BROWSER_UA,
          ...headers,
        },
      }, this.config.mediaTimeoutMs);
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError('media_timeout', 'Timeout ao descarregar o ficheiro.', 504, { retryable: true });
      }
      throw new AppError('media_download_failed', error instanceof Error ? error.message : String(error), 502, {
        retryable: true,
      });
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
    const size = contentLength(response);
    if (size !== undefined && size > this.config.mediaMaxBytes) {
      void response.body.cancel();
      throw new AppError('media_too_large', 'O ficheiro excede o limite configurado.', 413);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (contentType.startsWith('text/') || contentType.includes('json')) {
      await response.body.cancel();
      throw new AppError('media_download_failed', `CDN devolveu ${contentType || 'conteúdo'} em vez de vídeo.`, 502, {
        retryable: true,
      });
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

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AppError('media_timeout', 'Timeout ao contactar o TikTok/resolver.', 504, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
