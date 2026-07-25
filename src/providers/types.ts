import type { MediaDownload } from '../media/doukClient.js';

/** Providers supported by the final multi-provider path. */
export type ScrapeProviderName = 'self' | 'scrapedo' | 'apify';

/** Temporary compatibility names retained for existing local integrations. */
export type LegacyScrapeProviderName = 'mock' | 'gumloop';
export type AnyScrapeProviderName = ScrapeProviderName | LegacyScrapeProviderName;

export interface ScrapeOpts {
  max: number;
  onlyBrazil?: boolean;
  /** Kept for compatibility; media is always handled by the media provider. */
  downloadVideos?: boolean;
  geoCode?: string;
  render?: boolean;
  superProxy?: boolean;
  device?: string;
  signal?: AbortSignal;
}

export interface ScrapeMeta {
  creditsUsed?: number;
  pagesFetched?: number;
  requests?: number;
  [key: string]: unknown;
}

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface ScrapeProvider {
  readonly name: AnyScrapeProviderName;
  search(queries: string[], opts: ScrapeOpts): Promise<unknown[]>;
  hashtags(tags: string[], opts: ScrapeOpts): Promise<unknown[]>;
  health?(): Promise<ProviderHealth>;
  /** Metadata for the most recent search/hashtag call, when available. */
  readonly lastMeta?: ScrapeMeta;
}

export interface MediaProvider {
  readonly name: 'douk' | 'off' | 'cdn';
  /** Providers may return detailed metadata or a plain Node/Web stream. */
  download(webUrl: string, filename?: string): Promise<MediaDownload | NodeJS.ReadableStream | ReadableStream<Uint8Array>>;
  health?(): Promise<ProviderHealth>;
}
