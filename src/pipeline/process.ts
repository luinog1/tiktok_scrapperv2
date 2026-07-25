import type { AppConfig } from '../config.js';
import type { ScrapeMeta } from '../providers/types.js';
import type { RunRequest, RunResponse, TikTokPost } from '../types.js';
import { sourceForRequest } from '../schemas.js';
import { filterBrazilianPosts } from './brazil.js';
import { extractRawItems, mapRawToTikTokPost } from './mapper.js';
import { postsToCsv } from './csv.js';
import { classifyTier, rankPosts } from './rank.js';

export interface ProcessPayloadOptions {
  provider?: 'self' | 'scrapedo' | 'apify' | 'mock' | 'gumloop';
  proxyLocalized?: boolean;
  scrapeMeta?: ScrapeMeta;
  source?: 'search' | 'hashtag';
  warnings?: string[];
}

function validPost(post: TikTokPost): boolean {
  // A provider may omit author metadata; id + canonical URL are sufficient for
  // the stable UI contract. Embedded app-state junk (nav categories, locales)
  // carries string ids like "Travel", so require a real TikTok video identity.
  if (!post.id || !post.url) return false;
  return /^\d{8,}$/u.test(post.id) || /\/(?:video|v|photo)\/\d{8,}/iu.test(post.url);
}

function stripMediaIfDisabled(post: TikTokPost, includeMediaLinks: boolean): TikTokPost {
  if (includeMediaLinks) return post;
  const { videoUrl: _videoUrl, coverUrl: _coverUrl, images: _images, ...withoutMedia } = post;
  return withoutMedia as TikTokPost;
}

function hasMeta(meta: ScrapeMeta | undefined): boolean {
  return Boolean(meta && Object.values(meta).some((value) => value !== undefined));
}

/** Applies the common domain pipeline to any provider's raw response. */
export function processScrapePayload(
  payload: unknown,
  request: RunRequest,
  config: AppConfig,
  options: ProcessPayloadOptions = {},
): RunResponse {
  if (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
    const failure = payload as { error?: unknown; details?: unknown; retryable?: unknown; interactionId?: unknown };
    return {
      ok: false,
      error: typeof failure.error === 'string' ? failure.error : 'scrape_failed',
      ...(failure.details === undefined ? {} : { details: failure.details }),
      ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
      ...(typeof failure.interactionId === 'string' ? { interactionId: failure.interactionId } : {}),
    };
  }

  const envelope = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const rawItems = extractRawItems(payload);
  let posts = rawItems.map(mapRawToTikTokPost).filter(validPost);
  const source = options.source ?? sourceForRequest(request).source;

  let brRemoved = 0;
  if (request.onlyBrazil) {
    const filtered = filterBrazilianPosts(posts, { proxyLocalized: options.proxyLocalized ?? false });
    posts = filtered.kept;
    brRemoved = filtered.removed;
  }

  posts = posts
    .filter((post) => post.metrics.playCount >= request.minViews)
    .map((post) => ({
      ...post,
      engagementRate:
        post.metrics.playCount > 0
          ? ((post.metrics.diggCount + post.metrics.shareCount + post.metrics.commentCount) / post.metrics.playCount) * 100
          : 0,
    }))
    .map((post) => ({ ...post, trendTier: classifyTier(post.metrics.playCount, post.engagementRate, config) }));

  posts = rankPosts(posts, request.sort).map((post) => stripMediaIfDisabled(post, request.includeMediaLinks));
  const top = posts.slice(0, Math.min(request.max, 50));
  const responseFormat = request.format;
  const inheritedWarnings = [
    ...(Array.isArray(envelope.warnings) ? envelope.warnings.filter((warning): warning is string => typeof warning === 'string') : []),
    ...(options.warnings ?? []),
  ];
  const response: Extract<RunResponse, { ok: true }> = {
    ok: true,
    total: posts.length,
    top,
    format: responseFormat,
    source,
    ...(request.onlyBrazil ? { brRemoved } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(hasMeta(options.scrapeMeta) ? { scrapeMeta: options.scrapeMeta } : {}),
  };

  if (request.format === 'csv' || request.format === 'both') response.csv = postsToCsv(top);
  if (inheritedWarnings.length) response.warnings = [...new Set(inheritedWarnings)];
  return response;
}

/** Backwards-compatible name used by the original Gumloop adapter/tests. */
export const processAgentPayload = processScrapePayload;
