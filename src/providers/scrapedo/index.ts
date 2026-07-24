import type { AppConfig } from '../../config.js';
import { ScrapeDoClient } from './client.js';
import type { ScrapeMeta, ScrapeOpts, ScrapeProvider, ProviderHealth } from '../types.js';

export interface ScrapeDoProviderOptions {
  client?: ScrapeDoClient;
  fetchImpl?: typeof fetch;
}

export class ScrapeDoProvider implements ScrapeProvider {
  readonly name = 'scrapedo' as const;
  private readonly client: ScrapeDoClient;
  private _lastMeta: ScrapeMeta = {};

  constructor(private readonly config: AppConfig, options: ScrapeDoProviderOptions = {}) {
    this.client = options.client ?? new ScrapeDoClient(config, { fetchImpl: options.fetchImpl });
  }

  get lastMeta(): ScrapeMeta {
    return this._lastMeta;
  }

  async search(queries: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const result = await this.client.search(queries, opts);
    this._lastMeta = result.meta;
    return result.items;
  }

  async hashtags(tags: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const result = await this.client.hashtags(tags, opts);
    this._lastMeta = result.meta;
    return result.items;
  }

  async health(): Promise<ProviderHealth> {
    return this.client.health();
  }
}

export { ScrapeDoClient } from './client.js';
export { parsePage, parseScrapeDoPage, extractItemsFromPage } from './parsePage.js';
export { buildHashtagUrl, buildSearchUrl, buildTikTokHashtagUrl, buildTikTokSearchUrl } from './urls.js';
