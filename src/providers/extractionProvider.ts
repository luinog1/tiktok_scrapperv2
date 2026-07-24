import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { GumloopClient } from '../gumloop/agentClient.js';
import { processScrapePayload } from '../pipeline/process.js';
import { fetchLimitForRequest, sourceForRequest } from '../schemas.js';
import type { RunRequest, RunResponse } from '../types.js';
import { getScrapeProvider, MockScrapeProvider } from './factory.js';
import type { AnyScrapeProviderName, ProviderHealth, ScrapeProvider } from './types.js';

export interface ExtractionProvider {
  readonly name?: AnyScrapeProviderName;
  run(request: RunRequest): Promise<RunResponse>;
  health?(): Promise<ProviderHealth>;
}

function proxyLocalized(provider: ScrapeProvider, config: AppConfig, request: RunRequest, source: 'search' | 'hashtag'): boolean {
  if (!request.onlyBrazil) return false;
  if (provider.name === 'scrapedo') return source === 'search' && config.scrapeDoGeoCode.toLowerCase() === 'br';
  // Apify's rollback contract always selects the BR proxy for a localized
  // search; do not let the scrape.do geo env accidentally change that signal.
  if (provider.name === 'apify') return source === 'search';
  return false;
}

/** Runs one of the final raw scrape adapters through the common domain pipeline. */
export class ScrapeExtractionProvider implements ExtractionProvider {
  readonly name: AnyScrapeProviderName;

  constructor(
    private readonly config: AppConfig,
    private readonly scrapeProvider: ScrapeProvider,
  ) {
    this.name = scrapeProvider.name;
  }

  async run(request: RunRequest): Promise<RunResponse> {
    try {
      return await this.runWith(this.scrapeProvider, request);
    } catch (error) {
      const fallbackName = this.config.fallbackScrapeProvider;
      if (!fallbackName || fallbackName === this.scrapeProvider.name || fallbackName === 'gumloop') throw error;
      const fallback = getScrapeProvider(this.config, fallbackName);
      return this.runWith(fallback, request, [`scrape_fallback_${this.scrapeProvider.name}_to_${fallback.name}`]);
    }
  }

  async health(): Promise<ProviderHealth> {
    return this.scrapeProvider.health?.() ?? { ok: true, detail: 'health_not_implemented' };
  }

  private async runWith(provider: ScrapeProvider, request: RunRequest, warnings: string[] = []): Promise<RunResponse> {
    const { source, terms } = sourceForRequest(request);
    const fetchMax = fetchLimitForRequest(request);
    const opts = {
      max: fetchMax,
      onlyBrazil: request.onlyBrazil,
      downloadVideos: false,
      geoCode: request.onlyBrazil
        ? provider.name === 'apify' ? 'br' : this.config.scrapeDoGeoCode
        : undefined,
      render: this.config.scrapeDoRender,
      superProxy: this.config.scrapeDoSuper,
      device: this.config.scrapeDoDevice,
    };
    const raw = source === 'search'
      ? await provider.search(terms, opts)
      : await provider.hashtags(terms, opts);
    return processScrapePayload(raw, request, this.config, {
      provider: provider.name,
      source,
      proxyLocalized: proxyLocalized(provider, this.config, request, source),
      scrapeMeta: provider.lastMeta,
      warnings,
    });
  }
}

/** Legacy adapter retained only for backwards compatibility. */
export class GumloopExtractionProvider implements ExtractionProvider {
  readonly name = 'gumloop' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly client = new GumloopClient(config),
  ) {}

  async run(request: RunRequest): Promise<RunResponse> {
    let retried = false;
    let result;
    try {
      result = await this.client.run(request);
    } catch (error) {
      if (!(error instanceof AppError) || !error.retryable) throw error;
      retried = true;
      const lowerLimit = Math.max(1, Math.ceil(fetchLimitForRequest(request) / 2));
      result = await this.client.run(request, { fetchLimitOverride: lowerLimit });
    }

    const response = processScrapePayload(result.payload, request, this.config, {
      provider: 'gumloop',
      warnings: retried ? ['gumloop_retry_with_lower_limit'] : [],
    });
    response.interactionId = result.interactionId;
    return response;
  }

  async health(): Promise<ProviderHealth> {
    return { ok: Boolean(this.config.gumloopApiKey && this.config.gumloopAgentId && this.config.gumloopUserId), detail: 'legacy' };
  }
}

/** Explicit local-only provider for API/UI development without external calls. */
export class MockExtractionProvider extends ScrapeExtractionProvider {
  constructor(config: AppConfig) {
    super(config, new MockScrapeProvider());
  }
}

export function createExtractionProvider(config: AppConfig, requestedProvider?: string): ExtractionProvider {
  const name = (requestedProvider ?? config.scrapeProvider).trim().toLowerCase();
  if (name === 'gumloop') return new GumloopExtractionProvider(config);
  if (name === 'mock') return new MockExtractionProvider(config);
  return new ScrapeExtractionProvider(config, getScrapeProvider(config, name));
}
