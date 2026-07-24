import type { AppConfig } from '../../config.js';
import { ApifyClient } from './client.js';
import type { ScrapeMeta, ScrapeOpts, ScrapeProvider, ProviderHealth } from '../types.js';

export interface ApifyProviderOptions {
  client?: ApifyClient;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

/** Optional rollback provider. It uses Apify's REST API and has no hard npm dependency. */
export class ApifyProvider implements ScrapeProvider {
  readonly name = 'apify' as const;
  private readonly client: ApifyClient;
  private _lastMeta: ScrapeMeta = {};

  constructor(private readonly config: AppConfig, options: ApifyProviderOptions = {}) {
    this.client = options.client ?? new ApifyClient(config, { fetchImpl: options.fetchImpl, sleep: options.sleep, now: options.now });
  }

  get lastMeta(): ScrapeMeta {
    return this._lastMeta;
  }

  async search(queries: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const result = await this.client.run({
      searchQueries: queries,
      searchSection: '',
      resultsPerPage: opts.max,
      proxyCountryCode: opts.geoCode?.toUpperCase() || (opts.onlyBrazil ? 'BR' : undefined),
      shouldDownloadVideos: false,
      scrapeAdditionalAuthorMeta: true,
    });
    this._lastMeta = { pagesFetched: result.pagesFetched, requests: 1 };
    return result.items;
  }

  async hashtags(tags: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const result = await this.client.run({
      hashtags: tags.map((tag) => tag.replace(/^#/, '')),
      resultsPerPage: opts.max,
      proxyCountryCode: opts.geoCode?.toUpperCase() || (opts.onlyBrazil ? 'BR' : undefined),
      shouldDownloadVideos: false,
      scrapeAdditionalAuthorMeta: true,
    });
    this._lastMeta = { pagesFetched: result.pagesFetched, requests: 1 };
    return result.items;
  }

  async health(): Promise<ProviderHealth> {
    return this.client.health();
  }
}

export { ApifyClient } from './client.js';
