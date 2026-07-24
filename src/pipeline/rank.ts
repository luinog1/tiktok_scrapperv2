import type { AppConfig } from '../config.js';
import type { SortField, TikTokPost, TrendTier } from '../types.js';

export function classifyTier(playCount: number, engagementRate: number, config: AppConfig): TrendTier {
  if (playCount >= config.tiers.VIRAL.playCount && engagementRate >= config.tiers.VIRAL.engagementRate) return 'VIRAL';
  if (playCount >= config.tiers.HOT.playCount && engagementRate >= config.tiers.HOT.engagementRate) return 'HOT';
  if (playCount >= config.tiers.RISING.playCount && engagementRate >= config.tiers.RISING.engagementRate) return 'RISING';
  return 'NORMAL';
}

export function rankPosts(posts: TikTokPost[], sortBy: SortField): TikTokPost[] {
  return [...posts].sort((left, right) => {
    if (sortBy === 'createTime') {
      return Date.parse(right.createTime || '') - Date.parse(left.createTime || '') || right.id.localeCompare(left.id);
    }
    const difference = (right.metrics[sortBy] ?? 0) - (left.metrics[sortBy] ?? 0);
    return difference || right.id.localeCompare(left.id);
  });
}
