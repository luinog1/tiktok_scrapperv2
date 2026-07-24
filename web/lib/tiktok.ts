export type SortField = 'playCount' | 'diggCount' | 'shareCount' | 'commentCount' | 'createTime';
export type OutputFormat = 'json' | 'csv' | 'both';
export type TrendTier = 'VIRAL' | 'HOT' | 'RISING' | 'NORMAL';
export type ScrapeProvider = 'self' | 'scrapedo' | 'apify' | 'mock';

export interface RunRequest {
  keyword?: string;
  hashtags?: string[];
  max: number;
  sort: SortField;
  minViews: number;
  format: OutputFormat;
  onlyBrazil: boolean;
  brUseSearch: boolean;
  includeMediaLinks: boolean;
}

export interface TikTokPost {
  id: string;
  url: string;
  caption: string;
  hashtags: string[];
  author: {
    username: string;
    nickname: string;
    followers: number;
    verified: boolean;
    region?: string;
    signature?: string;
  };
  metrics: {
    playCount: number;
    diggCount: number;
    shareCount: number;
    commentCount: number;
    bookmarkCount?: number;
  };
  duration: number;
  createTime: string;
  music: {
    title: string;
    author: string;
    isOriginal: boolean;
  };
  engagementRate: number;
  trendTier: TrendTier;
  locationCreated?: string;
  videoUrl?: string;
  coverUrl?: string;
  images?: string[];
}

export interface RunSuccess {
  ok: true;
  total: number;
  top: TikTokPost[];
  format?: OutputFormat;
  source?: 'search' | 'hashtag';
  brRemoved?: number;
  csv?: string;
  interactionId?: string;
  provider?: ScrapeProvider;
  scrapeMeta?: { creditsUsed?: number; pagesFetched?: number; requests?: number; [key: string]: unknown };
  warnings?: string[];
}

export interface RunFailure {
  ok: false;
  error: string;
  details?: unknown;
  retryable?: boolean;
}

export type RunResponse = RunSuccess | RunFailure;

export interface HealthResponse {
  ok: boolean;
  ready?: boolean;
  service?: string;
  scrapeProvider?: string;
  mediaProvider?: string;
  scrape?: { provider?: string; configured?: boolean; ok?: boolean; detail?: string };
  media?: { provider?: string; configured?: boolean; ok?: boolean; detail?: string };
}

export const SORT_OPTIONS: Array<{ value: SortField; label: string; short: string }> = [
  { value: 'playCount', label: 'Visualizações', short: 'Views' },
  { value: 'diggCount', label: 'Curtidas', short: 'Likes' },
  { value: 'shareCount', label: 'Compartilhamentos', short: 'Shares' },
  { value: 'commentCount', label: 'Comentários', short: 'Comments' },
  { value: 'createTime', label: 'Mais recentes', short: 'Recentes' },
];

export const TIER_META: Record<TrendTier, { label: string; color: string; description: string }> = {
  VIRAL: { label: 'Viral', color: 'coral', description: 'Alcance e ritmo excepcionais' },
  HOT: { label: 'Hot', color: 'amber', description: 'Aceleração forte agora' },
  RISING: { label: 'Rising', color: 'lime', description: 'Sinal de crescimento' },
  NORMAL: { label: 'Normal', color: 'slate', description: 'Em observação' },
};

export function formatCompact(value: number | undefined): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

export function formatPercent(value: number | undefined): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data desconhecida';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function parseHashtags(value: string): string[] {
  return [...new Set(value
    .split(/[\s,]+/u)
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean))];
}

export function initials(post: TikTokPost): string {
  const value = post.author.nickname || post.author.username || 'TT';
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'TT';
}

export function csvFromPosts(posts: TikTokPost[]): string {
  const headers = ['rank', 'id', 'url', 'caption', 'author', 'views', 'likes', 'shares', 'comments', 'engagement_rate', 'tier', 'created_at'];
  const cell = (value: unknown) => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  const rows = posts.map((post, index) => [
    index + 1,
    post.id,
    post.url,
    post.caption,
    post.author.nickname || post.author.username,
    post.metrics.playCount,
    post.metrics.diggCount,
    post.metrics.shareCount,
    post.metrics.commentCount,
    post.engagementRate,
    post.trendTier,
    post.createTime,
  ].map(cell).join(','));
  return [headers.join(','), ...rows].join('\n');
}
