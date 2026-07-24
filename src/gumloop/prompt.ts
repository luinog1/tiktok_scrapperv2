import type { RunRequest } from '../types.js';
import { fetchLimitForRequest, sourceForRequest } from '../schemas.js';

/** Builds a deterministic, injection-resistant message for start_agent. */
export function buildExtractPrompt(request: RunRequest, options: { fetchLimitOverride?: number } = {}): string {
  const { source, terms } = sourceForRequest(request);
  const fetchLimit = options.fetchLimitOverride ?? fetchLimitForRequest(request);
  const input = {
    keyword: request.keyword ?? null,
    hashtags: (request.hashtags ?? []).slice(0, 100),
    max: request.max,
    fetchMax: fetchLimit,
    sort: request.sort,
    minViews: request.minViews,
    onlyBrazil: request.onlyBrazil,
    brUseSearch: request.brUseSearch,
    includeMediaLinks: request.includeMediaLinks,
    source,
    terms,
    format: request.format,
  };

  return [
    'You are the TikTok Trend Extractor agent.',
    'Process the JSON job below deterministically.',
    `Use only the native TikTok tools tiktok__search_videos and tiktok__get_hashtag_videos. The selected source is ${source}.`,
    `Request up to ${fetchLimit} raw results (oversampling is required only when onlyBrazil=true).`,
    'Normalize each item to the RunResponse/TikTokPost contract; do not invent missing metrics.',
    'When onlyBrazil=true, apply a strict Portuguese/Brazil heuristic without claiming account geo data.',
    'Apply minViews, classify VIRAL/HOT/RISING/NORMAL, rank by sort, and return at most max items.',
    request.includeMediaLinks
      ? 'Ask TikTok tools for video and cover links when available; links are best-effort.'
      : 'Do not request or return media links.',
    'If a tool times out, retry once with a lower result limit.',
    'Reply with ONLY a single JSON object. No Markdown fences, prose, or explanatory text.',
    'On failure reply {"ok":false,"error":"..."}.',
    '',
    'JOB_JSON:',
    JSON.stringify(input),
  ].join('\n');
}
