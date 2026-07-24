const TIKTOK_BASE_URL = 'https://www.tiktok.com';

function encode(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildSearchUrl(query: string): string {
  return `${TIKTOK_BASE_URL}/search?q=${encode(query)}`;
}

export function buildHashtagUrl(tag: string): string {
  return `${TIKTOK_BASE_URL}/tag/${encode(tag.replace(/^#/, ''))}`;
}

export function buildTikTokSearchUrl(query: string): string {
  return buildSearchUrl(query);
}

export function buildTikTokHashtagUrl(tag: string): string {
  return buildHashtagUrl(tag);
}
