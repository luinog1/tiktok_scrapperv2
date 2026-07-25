import 'dotenv/config';

import type { SortField, TrendTier } from './types.js';
import type { AnyScrapeProviderName } from './providers/types.js';

/**
 * `self`, `scrapedo` and `apify` are the supported final providers. `mock` and
 * `gumloop` remain accepted as compatibility adapters for existing clients and
 * fixtures; neither is the default or required by the final deployment.
 */
export type ScrapeProvider = AnyScrapeProviderName | 'invalid';
export type MediaProvider = 'douk' | 'off' | 'cdn';
export type SelfScrapeMode = 'auto' | 'service' | 'direct';

export interface TierConfig {
  playCount: number;
  engagementRate: number;
}

export interface AppConfig {
  port: number;
  serviceApiKey: string;
  corsOrigins: string[];
  maxConcurrentRuns: number;
  scrapeProvider: ScrapeProvider;

  // Self-hosted scrape adapter (normally the local DouK Web API).
  scrapeServiceUrl: string;
  scrapeApiToken: string;
  scrapeSearchEndpoint: string;
  scrapeHashtagEndpoint: string;
  scrapeHealthEndpoint: string;
  scrapeTimeoutMs: number;
  selfScrapeMode: SelfScrapeMode;
  tiktokBaseUrl: string;
  tiktokCookie: string;

  // scrape.do adapter.
  scrapeDoToken: string;
  scrapeDoBaseUrl: string;
  scrapeDoSuper: boolean;
  scrapeDoRender: boolean;
  scrapeDoGeoCode: string;
  scrapeDoDevice: string;
  scrapeDoTimeoutMs: number;
  scrapeDoMaxPages: number;
  scrapeDoCustomWaitMs: number;
  scrapeDoWaitSelector: string;
  scrapeDoWaitUntil: string;
  scrapeDoBlockResources: boolean;
  scrapeDoReturnJson: boolean;
  scrapeDoStickySession: boolean;

  // Apify rollback adapter.
  apifyApiToken: string;
  apifyBaseUrl: string;
  apifyActorId: string;
  apifyTimeoutMs: number;
  apifyPollMs: number;

  // Optional operational controls.
  allowProviderOverride: boolean;
  fallbackScrapeProvider?: Exclude<ScrapeProvider, 'invalid'>;

  // Legacy Gumloop adapter configuration.
  gumloopApiKey: string;
  gumloopAgentId: string;
  gumloopUserId: string;
  gumloopProjectId?: string;
  gumloopBaseUrl: string;
  gumloopTimeoutMs: number;
  gumloopPollMs: number;
  gumloopFetchTimeoutMs: number;

  defaultMaxResults: number;
  defaultSortBy: SortField;
  tiers: Record<Exclude<TrendTier, 'NORMAL'>, TierConfig>;

  mediaProvider: MediaProvider;
  mediaServiceUrl: string;
  mediaApiToken: string;
  mediaDownloadEndpoint: string;
  mediaTimeoutMs: number;
  mediaMaxBytes: number;
}

function numberEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function positiveEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  return Math.max(1, numberEnv(env, key, fallback));
}

function booleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = env[key];
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function providerFromEnv(value: string | undefined): ScrapeProvider {
  const normalized = value?.trim().toLowerCase() || 'self';
  const allowed: readonly ScrapeProvider[] = ['self', 'scrapedo', 'apify', 'mock', 'gumloop'];
  return allowed.includes(normalized as ScrapeProvider) ? (normalized as ScrapeProvider) : 'invalid';
}

function fallbackProviderFromEnv(value: string | undefined): Exclude<ScrapeProvider, 'invalid'> | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  const allowed: readonly Exclude<ScrapeProvider, 'invalid'>[] = ['self', 'scrapedo', 'apify', 'mock', 'gumloop'];
  return allowed.includes(normalized as Exclude<ScrapeProvider, 'invalid'>)
    ? (normalized as Exclude<ScrapeProvider, 'invalid'>)
    : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function endpoint(value: string | undefined, fallback: string): string {
  const result = (value?.trim() || fallback).trim();
  if (/^https?:\/\//iu.test(result)) return result.replace(/\/+$/u, '');
  return result.startsWith('/') ? result : `/${result}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const defaultMaxResults = Math.min(50, positiveEnv(env, 'DEFAULT_MAX_RESULTS', 50));
  const defaultSortBy = oneOf<SortField>(
    env.DEFAULT_SORT_BY,
    ['playCount', 'diggCount', 'shareCount', 'commentCount', 'createTime'],
    'playCount',
  );
  const pollMs = Math.max(1000, positiveEnv(env, 'GUMLOOP_POLL_MS', 3000));
  const scrapePollMs = Math.max(250, positiveEnv(env, 'APIFY_POLL_MS', 2000));
  const mediaServiceUrl = normalizeBaseUrl(env.MEDIA_SERVICE_URL?.trim() || 'http://127.0.0.1:5555');
  const scrapeServiceUrl = normalizeBaseUrl(env.SCRAPE_SERVICE_URL?.trim() || mediaServiceUrl);

  return {
    port: positiveEnv(env, 'PORT', 3000),
    serviceApiKey: env.SERVICE_API_KEY?.trim() ?? '',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxConcurrentRuns: positiveEnv(env, 'MAX_CONCURRENT_RUNS', 2),
    scrapeProvider: providerFromEnv(env.SCRAPE_PROVIDER),

    scrapeServiceUrl,
    scrapeApiToken: env.SCRAPE_API_TOKEN?.trim() ?? '',
    scrapeSearchEndpoint: endpoint(env.SCRAPE_SEARCH_ENDPOINT, '/tiktok/search/video'),
    scrapeHashtagEndpoint: endpoint(env.SCRAPE_HASHTAG_ENDPOINT, '/tiktok/search/hashtag'),
    scrapeHealthEndpoint: endpoint(env.SCRAPE_HEALTH_ENDPOINT, '/health'),
    scrapeTimeoutMs: positiveEnv(env, 'SCRAPE_TIMEOUT_MS', 120_000),
    selfScrapeMode: oneOf<SelfScrapeMode>(env.SELF_SCRAPE_MODE, ['auto', 'service', 'direct'], 'auto'),
    tiktokBaseUrl: normalizeBaseUrl(env.TIKTOK_BASE_URL?.trim() || 'https://www.tiktok.com'),
    tiktokCookie: env.TIKTOK_COOKIE?.trim() ?? '',

    scrapeDoToken: env.SCRAPE_DO_TOKEN?.trim() ?? '',
    scrapeDoBaseUrl: normalizeBaseUrl(env.SCRAPE_DO_BASE_URL?.trim() || 'https://api.scrape.do'),
    scrapeDoSuper: booleanEnv(env, 'SCRAPE_DO_SUPER', true),
    scrapeDoRender: booleanEnv(env, 'SCRAPE_DO_RENDER', true),
    scrapeDoGeoCode: env.SCRAPE_DO_GEO_CODE?.trim().toLowerCase() || 'br',
    scrapeDoDevice: env.SCRAPE_DO_DEVICE?.trim() || 'mobile',
    scrapeDoTimeoutMs: positiveEnv(env, 'SCRAPE_DO_TIMEOUT_MS', 60_000),
    scrapeDoMaxPages: Math.min(20, positiveEnv(env, 'SCRAPE_DO_MAX_PAGES', 5)),
    // TikTok hydrates search/tag results after the initial DOM; without a wait
    // the rendered snapshot is the explore shell with no videos.
    scrapeDoCustomWaitMs: Math.min(35_000, Math.max(0, numberEnv(env, 'SCRAPE_DO_CUSTOM_WAIT_MS', 8_000))),
    scrapeDoWaitSelector: env.SCRAPE_DO_WAIT_SELECTOR?.trim() ?? '',
    scrapeDoWaitUntil: oneOf(env.SCRAPE_DO_WAIT_UNTIL?.trim().toLowerCase(), ['domcontentloaded', 'networkidle0', 'networkidle2', 'load', ''] as const, ''),
    scrapeDoBlockResources: booleanEnv(env, 'SCRAPE_DO_BLOCK_RESOURCES', false),
    // Tag/search metrics only travel in the page's XHR calls; returnJSON makes
    // scrape.do capture those responses alongside the rendered HTML.
    scrapeDoReturnJson: booleanEnv(env, 'SCRAPE_DO_RETURN_JSON', true),
    // Sticky sessions pin the proxy exit that passed TikTok's risk checks;
    // the client rotates manually whenever a page comes back without videos.
    scrapeDoStickySession: booleanEnv(env, 'SCRAPE_DO_STICKY_SESSION', true),

    apifyApiToken: env.APIFY_API_TOKEN?.trim() ?? '',
    apifyBaseUrl: normalizeBaseUrl(env.APIFY_BASE_URL?.trim() || 'https://api.apify.com'),
    apifyActorId: env.APIFY_ACTOR_ID?.trim() || 'clockworks/tiktok-scraper',
    apifyTimeoutMs: positiveEnv(env, 'APIFY_TIMEOUT_MS', 600_000),
    apifyPollMs: scrapePollMs,

    allowProviderOverride: booleanEnv(env, 'ALLOW_PROVIDER_OVERRIDE', false),
    fallbackScrapeProvider: fallbackProviderFromEnv(env.FALLBACK_SCRAPE_PROVIDER),

    gumloopApiKey: env.GUMLOOP_API_KEY?.trim() ?? '',
    gumloopAgentId: env.GUMLOOP_AGENT_ID?.trim() ?? '',
    gumloopUserId: env.GUMLOOP_USER_ID?.trim() ?? '',
    gumloopProjectId: env.GUMLOOP_PROJECT_ID?.trim() || undefined,
    gumloopBaseUrl: normalizeBaseUrl(env.GUMLOOP_BASE_URL?.trim() || 'https://api.gumloop.com/api/v1'),
    gumloopTimeoutMs: positiveEnv(env, 'GUMLOOP_TIMEOUT_MS', 600_000),
    gumloopPollMs: pollMs,
    gumloopFetchTimeoutMs: positiveEnv(env, 'GUMLOOP_FETCH_TIMEOUT_MS', 30_000),

    defaultMaxResults,
    defaultSortBy,
    tiers: {
      VIRAL: {
        playCount: positiveEnv(env, 'TIER_VIRAL_VIEWS', 5_000_000),
        engagementRate: Math.max(0, numberEnv(env, 'TIER_VIRAL_ENGAGEMENT', 5)),
      },
      HOT: {
        playCount: positiveEnv(env, 'TIER_HOT_VIEWS', 1_000_000),
        engagementRate: Math.max(0, numberEnv(env, 'TIER_HOT_ENGAGEMENT', 3)),
      },
      RISING: {
        playCount: positiveEnv(env, 'TIER_RISING_VIEWS', 100_000),
        engagementRate: Math.max(0, numberEnv(env, 'TIER_RISING_ENGAGEMENT', 1.5)),
      },
    },

    mediaProvider: oneOf<MediaProvider>(env.MEDIA_PROVIDER, ['douk', 'off', 'cdn'], 'douk'),
    mediaServiceUrl,
    mediaApiToken: env.MEDIA_API_TOKEN?.trim() ?? '',
    mediaDownloadEndpoint: endpoint(env.MEDIA_DOWNLOAD_ENDPOINT, '/tiktok/detail'),
    mediaTimeoutMs: positiveEnv(env, 'MEDIA_TIMEOUT_MS', 120_000),
    mediaMaxBytes: positiveEnv(env, 'MEDIA_MAX_BYTES', 100 * 1024 * 1024),
  };
}

export const CONFIG = loadConfig();

export function gumloopConfigured(config: AppConfig): boolean {
  return Boolean(config.gumloopApiKey && config.gumloopAgentId && config.gumloopUserId);
}

export function scrapeConfigured(config: AppConfig): boolean {
  switch (config.scrapeProvider) {
    case 'self':
      return Boolean(config.scrapeServiceUrl);
    case 'scrapedo':
      return Boolean(config.scrapeDoToken);
    case 'apify':
      return Boolean(config.apifyApiToken);
    case 'mock':
      return true;
    case 'gumloop':
      return gumloopConfigured(config);
    default:
      return false;
  }
}

export function mediaConfigured(config: AppConfig): boolean {
  return config.mediaProvider === 'off' ||
    (config.mediaProvider === 'douk' && Boolean(config.mediaServiceUrl));
}
