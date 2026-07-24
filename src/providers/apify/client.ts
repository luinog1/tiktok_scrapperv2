import type { AppConfig } from '../../config.js';
import { AppError, isAbortError } from '../../errors.js';
import { extractRawItems } from '../../pipeline/mapper.js';

export interface ApifyClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export interface ApifyRunResult {
  items: unknown[];
  pagesFetched: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function statusOf(value: unknown): string {
  const root = record(value);
  const data = record(root.data);
  return text(data.status || data.state || root.status || root.state).toUpperCase();
}

function idOf(value: unknown, ...keys: string[]): string {
  const root = record(value);
  const data = record(root.data);
  for (const key of keys) {
    const candidate = root[key] ?? data[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate);
  }
  return '';
}

export class ApifyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly config: AppConfig, options: ApifyClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => Date.now());
  }

  async run(input: Record<string, unknown>): Promise<ApifyRunResult> {
    if (!this.config.apifyApiToken) {
      throw new AppError('apify_token_missing', 'SCRAPE_PROVIDER=apify requer APIFY_API_TOKEN.', 500);
    }
    const actorReference = this.config.apifyActorId.replace('/', '~');
    const actorPath = `/v2/acts/${encodeURIComponent(actorReference)}/runs`;
    const start = await this.request(actorPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    // Apify run envelopes also contain `data.id`; do not mistake that run
    // metadata for a TikTok post when deciding whether a dataset fetch is
    // still required.
    const startIsRunEnvelope = Boolean(statusOf(start) || idOf(start, 'defaultDatasetId', 'default_dataset_id', 'datasetId', 'dataset_id'));
    const directItems = startIsRunEnvelope ? [] : extractRawItems(start);
    if (directItems.length) return { items: directItems, pagesFetched: 1 };

    const runId = idOf(start, 'id', 'runId', 'run_id');
    const datasetId = idOf(start, 'defaultDatasetId', 'default_dataset_id', 'datasetId', 'dataset_id');
    if (!runId && !datasetId) {
      throw new AppError('apify_start_invalid', 'Apify não devolveu run ou dataset identificável.', 502, { retryable: true });
    }
    let resolvedDataset = datasetId;
    const startStatus = statusOf(start);
    let completed = ['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE'].includes(startStatus);
    if (runId && !completed) {
      const deadline = this.now() + this.config.apifyTimeoutMs;
      while (this.now() < deadline) {
        await this.sleep(Math.min(this.config.apifyPollMs, Math.max(0, deadline - this.now())));
        if (this.now() >= deadline) break;
        const statusPayload = await this.request(`/v2/actor-runs/${encodeURIComponent(runId)}`);
        const state = statusOf(statusPayload);
        if (['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE'].includes(state)) {
          resolvedDataset = idOf(statusPayload, 'defaultDatasetId', 'default_dataset_id', 'datasetId', 'dataset_id');
          completed = true;
          break;
        }
        if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMED_OUT'].includes(state)) {
          throw new AppError('apify_run_failed', `Apify terminou em estado ${state}.`, 502, { retryable: true });
        }
      }
      if (!completed) throw new AppError('apify_timeout', 'Apify excedeu o timeout configurado.', 504, { retryable: true });
    }
    if (!resolvedDataset) throw new AppError('apify_dataset_missing', 'Apify terminou sem dataset.', 502, { retryable: true });
    const itemsPayload = await this.request(`/v2/datasets/${encodeURIComponent(resolvedDataset)}/items?format=json&clean=true`);
    return { items: extractRawItems(itemsPayload), pagesFetched: 1 };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this.config.apifyApiToken ? { ok: true, detail: 'token_configured' } : { ok: false, detail: 'APIFY_API_TOKEN ausente' };
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.config.apifyBaseUrl}${path}${separator}token=${encodeURIComponent(this.config.apifyApiToken)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.apifyTimeoutMs, 60_000));
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const raw = await response.text();
      let body: unknown = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw) as unknown;
        } catch {
          const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
          const records: unknown[] = [];
          for (const line of lines) {
            try { records.push(JSON.parse(line) as unknown); } catch { /* leave preview below */ }
          }
          body = records.length ? records : { rawPreview: raw.slice(0, 500) };
        }
      }
      if (response.status === 401 || response.status === 403) {
        throw new AppError('apify_auth_failed', 'Apify rejeitou APIFY_API_TOKEN.', 502);
      }
      if (!response.ok) {
        throw new AppError('apify_upstream_error', `Apify respondeu HTTP ${response.status}.`, 502, {
          details: body,
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortError(error)) {
        throw new AppError('apify_timeout', 'Timeout ao comunicar com Apify.', 504, { retryable: true });
      }
      throw new AppError('apify_network_error', error instanceof Error ? error.message : String(error), 502, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }
}
