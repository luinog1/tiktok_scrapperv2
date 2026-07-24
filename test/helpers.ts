import { loadConfig } from '../src/config.js';
import type { TikTokPost } from '../src/types.js';

export function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    PORT: '3000',
    SCRAPE_PROVIDER: 'mock',
    MEDIA_PROVIDER: 'off',
    GUMLOOP_POLL_MS: '1000',
    GUMLOOP_TIMEOUT_MS: '10000',
    GUMLOOP_FETCH_TIMEOUT_MS: '5000',
    ...overrides,
  });
}

export function post(overrides: Partial<TikTokPost> & { author?: Partial<TikTokPost['author']> } = {}): TikTokPost {
  const { author: authorOverrides, ...postOverrides } = overrides;
  return {
    id: '1',
    url: 'https://www.tiktok.com/@user/video/12345678901',
    caption: '',
    hashtags: [],
    metrics: { playCount: 1000, diggCount: 10, shareCount: 1, commentCount: 1 },
    duration: 10,
    createTime: '2026-01-01T00:00:00.000Z',
    music: { title: '', author: '', isOriginal: false },
    engagementRate: 1.2,
    trendTier: 'NORMAL',
    ...postOverrides,
    author: {
      username: 'user',
      nickname: 'User',
      followers: 100,
      verified: false,
      ...(authorOverrides ?? {}),
    },
  };
}
