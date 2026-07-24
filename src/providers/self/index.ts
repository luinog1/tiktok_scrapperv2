import type { AppConfig } from '../../config.js';
import { SelfHostedClient } from './client.js';
import type { ScrapeOpts, ScrapeProvider, ScrapeMeta, ProviderHealth } from '../types.js';

export interface SelfHostedProviderOptions {
  client?: SelfHostedClient;
  fetchImpl?: typeof fetch;
}

/** Scrape provider backed by the local DouK/self-hosted Web API. */
export class SelfHostedProvider implements ScrapeProvider {
  readonly name = 'self' as const;
  private readonly client: SelfHostedClient;
  private _lastMeta: ScrapeMeta = {};

  constructor(private readonly config: AppConfig, options: SelfHostedProviderOptions = {}) {
    this.client = options.client ?? new SelfHostedClient(config, { fetchImpl: options.fetchImpl });
  }

  get lastMeta(): ScrapeMeta {
    return this._lastMeta;
  }

  async search(queries: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const items = await this.client.search(queries, opts);
    this._lastMeta = { pagesFetched: queries.length, requests: queries.length };
    return items;
  }

  async hashtags(tags: string[], opts: ScrapeOpts): Promise<unknown[]> {
    const items = await this.client.hashtags(tags, opts);
    this._lastMeta = { pagesFetched: tags.length, requests: tags.length };
    return items;
  }

  async health(): Promise<ProviderHealth> {
    return this.client.health();
  }
}

export { SelfHostedClient } from './client.js';
