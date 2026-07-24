import type { TikTokPost } from '../types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function path(value: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    return (current as UnknownRecord)[key];
  }, value);
}

function first(value: unknown, paths: string[]): unknown {
  for (const candidate of paths) {
    const result = path(value, candidate);
    if (result !== undefined && result !== null && result !== '') return result;
  }
  return undefined;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function urlValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = urlValue(item);
      if (candidate) return candidate;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    return text(first(value, ['url', 'Url', 'urlList.0', 'url_list.0', 'uri', 'src']));
  }
  return '';
}

/** Handles locale-aware values such as 1,234, 1.234,5 mil and "2.4M". */
export function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== 'string') return 0;
  const normalized = value.trim().toLowerCase().replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ');
  if (!normalized) return 0;

  const suffix = normalized.match(/(?:^|[\d.,\s])(mil(?:h(?:ão|ao|ões|oes))?|mi(?:lh(?:ão|ao|ões|oes))?|k|m|b)(?:$|\s)/iu)?.[1]?.toLowerCase();
  const multiplier = suffix?.startsWith('mil')
    ? 1_000
    : suffix?.startsWith('mi') || suffix === 'm'
      ? 1_000_000
      : suffix === 'b'
        ? 1_000_000_000
        : suffix === 'k'
          ? 1_000
          : 1;
  const numericMatch = normalized.match(/-?\d[\d.,]*/u);
  if (!numericMatch) return 0;
  let numeric = numericMatch[0];
  const comma = numeric.lastIndexOf(',');
  const dot = numeric.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    numeric = comma > dot ? numeric.replace(/\./gu, '').replace(',', '.') : numeric.replace(/,/gu, '');
  } else if (comma >= 0) {
    numeric = multiplier !== 1 || !/,\d{3}$/u.test(numeric) ? numeric.replace(',', '.') : numeric.replace(/,/gu, '');
  } else if (dot >= 0 && multiplier === 1 && /\.\d{3}$/u.test(numeric)) {
    numeric = numeric.replace(/\./gu, '');
  }
  const base = Number(numeric);
  return Number.isFinite(base) ? Math.max(0, base * multiplier) : 0;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return false;
}

function isoTime(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const numeric = numberValue(value);
  if (numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function arrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const object = value as UnknownRecord;
    for (const key of ['items', 'data', 'results', 'list', 'videos', 'imagesList', 'images']) {
      if (Array.isArray(object[key])) return object[key] as unknown[];
    }
  }
  return [];
}

function stringArray(value: unknown): string[] {
  return arrayFrom(value)
    .map((item) => {
      if (typeof item === 'string') return item.replace(/^#/, '').trim();
      if (item && typeof item === 'object') {
        return text(first(item, ['name', 'title', 'hashtagName', 'hashtag_name'])).replace(/^#/, '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function imageUrls(value: unknown): string[] {
  return arrayFrom(value)
    .map((item) => {
      if (typeof item === 'string') return item;
      return text(first(item, ['url', 'urlList.0', 'url_list.0', 'imageURL.urlList.0', 'image_url']));
    })
    .filter((url) => /^https?:\/\//i.test(url));
}

function captionHashtags(caption: string): string[] {
  return [...caption.matchAll(/#([^\s#]+)/gu)].map((match) => match[1].trim()).filter(Boolean);
}

function interactionCount(root: UnknownRecord, actions: string[]): number {
  const statistics = arrayFrom(first(root, ['interactionStatistic', 'interaction_statistics']));
  for (const statistic of statistics) {
    const action = text(first(statistic, ['interactionType.@type', 'interactionType', 'type', '@type'])).toLowerCase();
    if (actions.some((candidate) => action.includes(candidate.toLowerCase()))) {
      return numberValue(first(statistic, ['userInteractionCount', 'count', 'value']));
    }
  }
  return 0;
}

function safeUrl(value: unknown, username: string, id: string): string {
  const candidate = text(value);
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith('/')) return `https://www.tiktok.com${candidate}`;
  if (username && id) return `https://www.tiktok.com/@${encodeURIComponent(username.replace(/^@/, ''))}/video/${id}`;
  if (id) return `https://www.tiktok.com/video/${id}`;
  return '';
}

function idFromUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.pathname.match(/\/(?:video|v|photo)\/(\d{8,})/iu)?.[1] || url.searchParams.get('item_id') || '';
  } catch {
    return value.match(/\/(?:video|v|photo)\/(\d{8,})/iu)?.[1] || '';
  }
}

/**
 * Converts both Apify-shaped records and Gumloop TikTok tool records into the
 * stable contract consumed by the existing cards. Missing optional fields are
 * deliberately represented by safe defaults; metrics are never fabricated.
 */
export function mapRawToTikTokPost(raw: unknown): TikTokPost {
  const original = record(raw);
  const nested = first(original, ['itemStruct', 'item_struct', 'awemeInfo', 'aweme_info', 'item', 'videoData']);
  const root = nested && typeof nested === 'object'
    ? { ...original, ...record(nested) }
    : original;
  const author = first(root, ['authorMeta', 'author', 'user', 'author_info']);
  const authorRecord = record(author);
  const stats = first(root, ['stats', 'statistics', 'metrics', 'engagement']) ?? {};
  const statsRecord = record(stats);
  const video = first(root, ['videoMeta', 'video', 'video_info']) ?? {};
  const videoRecord = record(video);
  const music = first(root, ['musicMeta', 'music', 'music_info']) ?? {};
  const musicRecord = record(music);

  const rawWebUrl = first(root, ['webVideoUrl', 'web_video_url', 'url', 'shareUrl', 'share_url', 'canonicalUrl']);
  const webUrlText = text(rawWebUrl);
  const id = text(first(root, ['id', 'videoId', 'video_id', 'aweme_id', 'awemeId', 'item_id', 'itemId'])) ||
    idFromUrl(webUrlText);
  const username = (text(
    first(authorRecord, ['name', 'uniqueId', 'unique_id', 'username', 'handle']) ??
      first(root, ['authorName', 'author_username', 'username']),
  ) || webUrlText.match(/\/@([^/]+)/u)?.[1] || '').replace(/^@/, '');
  const nickname = text(first(authorRecord, ['nickName', 'nickname', 'nick_name', 'displayName']) ?? first(root, ['nickname', 'author_nickname']));
  const caption = text(first(root, ['text', 'desc', 'caption', 'description', 'name']));
  const hashtags = [
    ...stringArray(first(root, ['hashtags', 'hashTags', 'hashtag_list'])),
    ...captionHashtags(caption),
  ];
  const uniqueHashtags = [...new Set(hashtags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))];

  const playCount = numberValue(
    first(root, ['playCount', 'play_count', 'views', 'viewCount', 'view_count']) ??
      first(statsRecord, ['playCount', 'play_count', 'views', 'viewCount', 'view_count']),
  ) || interactionCount(root, ['WatchAction', 'ViewAction']);
  const diggCount = numberValue(
    first(root, ['diggCount', 'digg_count', 'likeCount', 'like_count', 'likes', 'hearts']) ??
      first(statsRecord, ['diggCount', 'digg_count', 'likeCount', 'like_count', 'likes', 'hearts']),
  ) || interactionCount(root, ['LikeAction']);
  const shareCount = numberValue(
    first(root, ['shareCount', 'share_count', 'shares']) ?? first(statsRecord, ['shareCount', 'share_count', 'shares']),
  ) || interactionCount(root, ['ShareAction']);
  const commentCount = numberValue(
    first(root, ['commentCount', 'comment_count', 'comments']) ?? first(statsRecord, ['commentCount', 'comment_count', 'comments']),
  ) || interactionCount(root, ['CommentAction']);
  const bookmarkCount = numberValue(
    first(root, ['collectCount', 'collect_count', 'bookmarkCount', 'bookmark_count', 'saves']) ??
      first(statsRecord, ['collectCount', 'collect_count', 'bookmarkCount', 'bookmark_count', 'saves']),
  );

  const directVideoUrl = urlValue(
    first(root, [
      'videoUrl',
      'video_url',
      'mediaUrls.0',
      'downloadAddr',
      'download_addr',
      'playAddr',
      'play_addr',
      'mediaUrl',
      'media_url',
      'contentUrl',
    ]) ?? first(videoRecord, ['downloadAddr', 'download_addr', 'playAddr', 'play_addr', 'playAddress.UrlList.0', 'play_address.url_list.0', 'bitrateInfo.0.PlayAddr.UrlList.0']),
  );
  const coverUrl = urlValue(
    first(root, ['coverUrl', 'cover_url', 'imageUrl', 'image_url', 'thumbnailUrl']) ??
      first(videoRecord, ['cover', 'coverUrl', 'cover_url', 'originCover', 'originCoverUrl', 'origin_cover', 'dynamicCover', 'dynamic_cover']),
  );

  const rawImages = first(root, ['images', 'imagePost', 'image_post', 'image_urls']) ?? first(videoRecord, ['images', 'imagePost']);
  const images = imageUrls(rawImages);
  const engagementRate = playCount > 0 ? ((diggCount + shareCount + commentCount) / playCount) * 100 : 0;

  return {
    id,
    url: safeUrl(rawWebUrl, username, id),
    caption,
    hashtags: uniqueHashtags,
    author: {
      username,
      nickname,
      followers: numberValue(first(authorRecord, ['fans', 'followers', 'followerCount', 'follower_count']) ?? first(root, ['followers', 'followerCount', 'authorStats.followerCount', 'author_stats.follower_count'])),
      verified: booleanValue(first(authorRecord, ['verified', 'isVerified', 'is_verified']) ?? first(root, ['verified', 'isVerified'])),
      region: text(first(authorRecord, ['region', 'country', 'countryCode', 'country_code']) ?? first(root, ['authorRegion', 'author_region'])) || undefined,
      signature: text(first(authorRecord, ['signature', 'bio', 'description'])) || undefined,
    },
    metrics: {
      playCount,
      diggCount,
      shareCount,
      commentCount,
      bookmarkCount: bookmarkCount || undefined,
    },
    duration: numberValue(first(root, ['duration', 'videoDuration', 'video_duration']) ?? first(videoRecord, ['duration'])),
    createTime: isoTime(first(root, ['createTimeISO', 'create_time_iso', 'createTime', 'create_time', 'timestamp', 'publishedAt', 'published_at', 'uploadDate', 'datePublished'])),
    music: {
      title: text(first(musicRecord, ['musicName', 'music_name', 'title', 'name'])),
      author: text(first(musicRecord, ['musicAuthor', 'music_author', 'authorName', 'author_name', 'author'])),
      isOriginal: booleanValue(first(musicRecord, ['musicOriginal', 'music_original', 'isOriginal', 'is_original'])),
    },
    engagementRate,
    trendTier: 'NORMAL',
    locationCreated: text(first(root, ['locationCreated', 'location_created', 'location'])) || undefined,
    videoUrl: /^https?:\/\//i.test(directVideoUrl) ? directVideoUrl : undefined,
    coverUrl: /^https?:\/\//i.test(coverUrl) ? coverUrl : undefined,
    images: images.length > 0 ? images : undefined,
  };
}

/** Extracts common list envelopes returned by Gumloop agents. */
export function extractRawItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const root = value as UnknownRecord;
  for (const key of [
    'items', 'posts', 'videos', 'results', 'data', 'top', 'aweme_list', 'awemeList',
    'itemList', 'item_list', 'search_item_list', 'searchItemList', 'video_list', 'videoList',
    'itemListElement', 'contents', 'list',
  ]) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = extractRawItems(candidate);
      if (nested.length) return nested;
    }
  }
  for (const key of ['itemStruct', 'item_struct', 'awemeInfo', 'aweme_info', 'item']) {
    const candidate = root[key];
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  if (['id', 'video_id', 'videoId', 'aweme_id', 'awemeId', 'url', 'webVideoUrl', 'desc', 'text'].some((key) => root[key] !== undefined)) {
    return [value];
  }
  return [];
}
