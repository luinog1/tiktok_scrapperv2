export const SORT_FIELDS = [
  'playCount',
  'diggCount',
  'shareCount',
  'commentCount',
  'createTime',
] as const;

export type SortField = (typeof SORT_FIELDS)[number];
export type OutputFormat = 'json' | 'csv' | 'both';
export type TrendTier = 'VIRAL' | 'HOT' | 'RISING' | 'NORMAL';

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
  /** Active scrape engine; optional for backwards-compatible clients. */
  provider?: 'self' | 'scrapedo' | 'apify' | 'mock' | 'gumloop';
  scrapeMeta?: {
    creditsUsed?: number;
    pagesFetched?: number;
    requests?: number;
    [key: string]: unknown;
  };
  warnings?: string[];
}

export interface RunFailure {
  ok: false;
  error: string;
  details?: unknown;
  interactionId?: string;
  retryable?: boolean;
}

export type RunResponse = RunSuccess | RunFailure;

export interface AgentStartResponse {
  interaction_id?: string;
  interactionId?: string;
  id?: string;
  state?: string;
  status?: string;
  response?: unknown;
  output?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

export interface AgentStatusResponse {
  state?: string;
  status?: string;
  response?: unknown;
  output?: unknown;
  result?: unknown;
  messages?: unknown;
  error_message?: string;
  error?: string;
  interaction_id?: string;
  [key: string]: unknown;
}

export interface RawMediaResult {
  response: Response;
  filename?: string;
  contentType?: string;
}
