import type { AppConfig, ScrapeProvider as ConfigScrapeProvider } from '../config.js';
import { loadConfig } from '../config.js';
import { AppError } from '../errors.js';
import { ApifyProvider } from './apify/index.js';
import { ScrapeDoProvider } from './scrapedo/index.js';
import { SelfHostedProvider } from './self/index.js';
import type { AnyScrapeProviderName, ScrapeProvider } from './types.js';

/** Small deterministic provider used by local UI/tests without any network call. */
export class MockScrapeProvider implements ScrapeProvider {
  readonly name = 'mock' as const;
  readonly lastMeta = { pagesFetched: 1, requests: 0 };

  async search(queries: string[], opts: { max: number }): Promise<unknown[]> {
    return this.items(queries, opts.max);
  }

  async hashtags(tags: string[], opts: { max: number }): Promise<unknown[]> {
    return this.items(tags, opts.max);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'mock' };
  }

  private items(terms: string[], max: number): unknown[] {
    const seed = terms.join('-').replace(/\s+/gu, '-').toLowerCase() || 'trend';
    const now = Math.floor(Date.now() / 1000);
    return Array.from({ length: Math.max(3, max) }, (_, index) => ({
      id: `${now}${String(index).padStart(3, '0')}`,
      webVideoUrl: `https://www.tiktok.com/@demo_br/video/${now}${String(index).padStart(3, '0')}`,
      text: `${index % 2 === 0 ? 'Não acredito, gente!' : 'Receita de hoje'} #${seed}`,
      hashtags: [seed, 'tiktokbrasil'],
      author: { uniqueId: `demo_br_${index}`, nickname: `Demo Brasil ${index}` },
      stats: { playCount: 100_000 + index * 75_000, diggCount: 8_000 + index * 700, shareCount: 400 + index * 20, commentCount: 250 + index * 10 },
      createTime: now - index * 3600,
    }));
  }
}

function normalizedName(value: string | undefined): AnyScrapeProviderName | 'invalid' {
  const name = value?.trim().toLowerCase() || 'self';
  if (['self', 'scrapedo', 'apify', 'mock', 'gumloop'].includes(name)) return name as AnyScrapeProviderName;
  return 'invalid';
}

/**
 * Resolve the scrape adapter for a deployment. The provider is selected at
 * runtime, so the frontend never needs a scrape token or provider-specific API.
 */
export function getScrapeProvider(
  config: AppConfig = loadConfig(),
  requestedProvider?: string,
): ScrapeProvider {
  const name = normalizedName(requestedProvider ?? config.scrapeProvider);
  switch (name) {
    case 'self':
      return new SelfHostedProvider(config);
    case 'scrapedo':
      if (!config.scrapeDoToken) {
        throw new AppError('scrapedo_token_missing', 'SCRAPE_PROVIDER=scrapedo requer SCRAPE_DO_TOKEN.', 500);
      }
      return new ScrapeDoProvider(config);
    case 'apify':
      if (!config.apifyApiToken) {
        throw new AppError('apify_token_missing', 'SCRAPE_PROVIDER=apify requer APIFY_API_TOKEN.', 500);
      }
      return new ApifyProvider(config);
    case 'mock':
      return new MockScrapeProvider();
    case 'gumloop':
      // Gumloop is intentionally resolved by the legacy extraction adapter.
      throw new AppError('legacy_provider_requires_adapter', 'O provider Gumloop legado deve ser criado pelo adapter de compatibilidade.', 500);
    default:
      throw new AppError('invalid_scrape_provider', `SCRAPE_PROVIDER inválido: ${String(requestedProvider ?? config.scrapeProvider)}.`, 500);
  }
}

export const createScrapeProvider = getScrapeProvider;

export function isFinalScrapeProvider(value: string | undefined): value is 'self' | 'scrapedo' | 'apify' {
  return value === 'self' || value === 'scrapedo' || value === 'apify';
}

export type ConfiguredProviderName = ConfigScrapeProvider;
