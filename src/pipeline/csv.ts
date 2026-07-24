import type { TikTokPost } from '../types.js';

function csvCell(value: unknown): string {
  const stringValue = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

export function postsToCsv(posts: TikTokPost[]): string {
  const headers = [
    'id', 'url', 'caption', 'hashtags', 'author_username', 'author_nickname', 'author_followers',
    'author_verified', 'author_region', 'play_count', 'digg_count', 'share_count', 'comment_count',
    'bookmark_count', 'engagement_rate', 'trend_tier', 'duration', 'create_time', 'cover_url',
  ];
  const rows = posts.map((post) => [
    post.id,
    post.url,
    post.caption,
    post.hashtags.join(' '),
    post.author.username,
    post.author.nickname,
    post.author.followers,
    post.author.verified,
    post.author.region ?? '',
    post.metrics.playCount,
    post.metrics.diggCount,
    post.metrics.shareCount,
    post.metrics.commentCount,
    post.metrics.bookmarkCount ?? '',
    post.engagementRate,
    post.trendTier,
    post.duration,
    post.createTime,
    post.coverUrl ?? '',
  ].map(csvCell).join(','));
  return [headers.join(','), ...rows].join('\n');
}
