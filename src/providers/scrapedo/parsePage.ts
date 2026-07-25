type UnknownRecord = Record<string, unknown>;

const ID_KEYS = new Set(['id', 'aweme_id', 'awemeid', 'video_id', 'videoid', 'item_id', 'itemid']);
const URL_KEYS = new Set([
  'webvideourl', 'web_video_url', 'share_url', 'shareurl', 'url', 'canonicalurl', 'contenturl', 'embedurl',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function isVideoId(value: unknown): boolean {
  return /^\d{8,}$/u.test(text(value).trim());
}

function hasVideoUrlId(value: unknown): boolean {
  return /\/(?:video|v|photo)\/\d{8,}/iu.test(text(value));
}

/**
 * TikTok pages embed app-context state (explore categories, locale lists,
 * feature flags) whose records also carry an `id` key. A real post must carry
 * a numeric video id, a canonical /video/<id> URL, or be a JSON-LD VideoObject.
 */
function likelyPost(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (ID_KEYS.has(lower) && isVideoId(child)) return true;
    if (URL_KEYS.has(lower) && hasVideoUrlId(child)) return true;
  }
  const isVideoObject = text(value['@type']).toLowerCase().includes('video');
  if (!isVideoObject) return false;
  const keys = Object.keys(value).map((key) => key.toLowerCase());
  return keys.some((key) => ['desc', 'caption', 'text', 'description', 'name', 'author', 'contenturl'].includes(key));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&#34;/gu, '"')
    .replace(/&#x22;/giu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>');
}

function cleanJsonCandidate(value: string): string {
  let result = decodeHtml(value).trim();
  result = result.replace(/^\s*(?:window\.[A-Z0-9_$.]+\s*=|self\.[A-Z0-9_$.]+\s*=)\s*/iu, '');
  result = result.replace(/;\s*$/u, '').trim();
  return result;
}

function tryParseJson(value: string): unknown | undefined {
  const cleaned = cleanJsonCandidate(value);
  if (!cleaned) return undefined;
  try { return JSON.parse(cleaned) as unknown; } catch { /* continue with a balanced fragment */ }
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const open = cleaned[start];
    const close = open === '{' ? '}' : ']';
    const end = cleaned.lastIndexOf(close);
    if (end <= start) continue;
    try { return JSON.parse(cleaned.slice(start, end + 1)) as unknown; } catch { /* try next */ }
  }
  return undefined;
}

function collect(value: unknown, result: unknown[], seen: Set<unknown>): void {
  if (value === null || value === undefined || seen.has(value)) return;
  if (typeof value === 'string') {
    // returnJSON envelopes embed the rendered HTML as a string property.
    if (/<script|<a[\s>]/iu.test(value)) {
      for (const payload of scriptPayloads(value)) collect(payload, result, seen);
      for (const anchor of anchorFallback(value)) result.push(anchor);
      return;
    }
    const parsed = tryParseJson(value);
    if (parsed !== undefined) collect(parsed, result, seen);
    return;
  }
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) {
      if (likelyPost(item)) result.push(item);
      else collect(item, result, seen);
    }
    return;
  }
  if (!isRecord(value)) return;
  seen.add(value);
  if (likelyPost(value)) result.push(value);
  for (const child of Object.values(value)) {
    collect(child, result, seen);
  }
}

function scriptPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];
  const scriptPattern = /<script(?:[^>]*?)>([\s\S]*?)<\/script>/giu;
  for (const match of html.matchAll(scriptPattern)) {
    const body = match[1]?.trim();
    if (!body) continue;
    const type = match[0].match(/<script[^>]*type=["']([^"']+)["']/iu)?.[1]?.toLowerCase() || '';
    if (type.includes('json') || /(?:SIGI_STATE|UNIVERSAL_DATA|NEXT_DATA|__INITIAL_STATE__)/iu.test(body)) {
      const parsed = tryParseJson(body);
      if (parsed !== undefined) payloads.push(parsed);
    }
  }
  return payloads;
}

function anchorFallback(html: string): UnknownRecord[] {
  const result: UnknownRecord[] = [];
  const seen = new Set<string>();
  const pattern = /<a[^>]+href=["']([^"']*\/[@A-Za-z0-9_.-]+\/video\/\d{8,}[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(pattern)) {
    const href = decodeHtml(match[1]);
    const absolute = href.startsWith('http') ? href : `https://www.tiktok.com${href.startsWith('/') ? '' : '/'}${href}`;
    const id = absolute.match(/\/video\/(\d{8,})/iu)?.[1] || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const inner = decodeHtml((match[2] || '').replace(/<[^>]+>/gu, ' ')).replace(/\s+/gu, ' ').trim();
    // On grid pages the anchor's only text is the view-count badge (e.g.
    // "12.5K"); that is a metric, not a caption.
    const isBareMetric = /^[\d.,]+\s*[kmb]?$/iu.test(inner);
    result.push({
      id,
      webVideoUrl: absolute,
      text: isBareMetric ? '' : inner,
      ...(isBareMetric ? { views: inner } : {}),
    });
  }
  return result;
}

function richness(value: unknown, depth = 0): number {
  if (!isRecord(value) || depth > 2) return 0;
  let score = Object.keys(value).length;
  for (const key of ['stats', 'statistics', 'author', 'authorMeta', 'video', 'music', 'item', 'itemStruct']) {
    score += richness(value[key], depth + 1);
  }
  return score;
}

function dedupe(items: unknown[]): unknown[] {
  const byKey = new Map<string, unknown>();
  const keyless: unknown[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const identity = (value: unknown, depth = 0): string => {
      if (!isRecord(value) || depth > 3) return '';
      const id = text(value.id ?? value.video_id ?? value.videoId ?? value.aweme_id ?? value.awemeId);
      const url = text(value.webVideoUrl ?? value.web_video_url ?? value.url ?? value.share_url ?? value.contentUrl);
      if (id || url) return id || url;
      for (const key of ['item', 'itemStruct', 'item_struct', 'video', 'videoObject']) {
        const nested = identity(value[key], depth + 1);
        if (nested) return nested;
      }
      return '';
    };
    const key = identity(item);
    if (!key) {
      keyless.push(item);
      continue;
    }
    const existing = byKey.get(key);
    // The same video can surface both as a bare grid anchor and as a full
    // XHR/state record; keep whichever carries more metadata.
    if (existing === undefined || richness(item) > richness(existing)) byKey.set(key, item);
  }
  return [...byKey.values(), ...keyless];
}

/**
 * Parses scrape.do's HTML/JSON response without a heavyweight DOM dependency.
 * TikTok has changed its embedded state names over time, so this intentionally
 * walks common state envelopes and falls back to video anchors.
 */
export function parseScrapeDoPage(value: unknown): unknown[] {
  if (value && typeof value === 'object') {
    const items: unknown[] = [];
    collect(value, items, new Set());
    return dedupe(items);
  }
  if (typeof value !== 'string') return [];
  const parsed = tryParseJson(value);
  const items: unknown[] = [];
  if (parsed !== undefined) collect(parsed, items, new Set());
  for (const payload of scriptPayloads(value)) collect(payload, items, new Set());
  items.push(...anchorFallback(value));
  return dedupe(items);
}

export const parsePage = parseScrapeDoPage;
export const extractItemsFromPage = parseScrapeDoPage;
