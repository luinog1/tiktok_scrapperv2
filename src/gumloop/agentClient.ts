import type { AppConfig } from '../config.js';
import { gumloopConfigured } from '../config.js';
import { AppError, isAbortError } from '../errors.js';
import type { AgentStartResponse, AgentStatusResponse, RunRequest } from '../types.js';
import { buildExtractPrompt } from './prompt.js';
import { parseAgentPayload, payloadFromStatus } from './response.js';

export interface GumloopRunResult {
  payload: unknown;
  interactionId: string;
  elapsedMs: number;
}

export interface GumloopClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

function stateOf(status: AgentStatusResponse): string {
  return String(status.state ?? status.status ?? '').toLowerCase().replace(/[-\s]/g, '_');
}

function interactionIdOf(start: AgentStartResponse): string {
  const id = start.interaction_id ?? start.interactionId ?? start.id;
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) {
    throw new AppError('gumloop_start_invalid', 'Gumloop não devolveu interaction_id.', 502, { retryable: true });
  }
  return String(id);
}

function isCompleted(state: string, status: AgentStatusResponse): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(state) ||
    (state === '' && (status.response !== undefined || status.output !== undefined || status.result !== undefined));
}

function isFailed(state: string): boolean {
  return ['failed', 'failure', 'error', 'cancelled', 'canceled', 'aborted', 'timed_out', 'timeout'].includes(state);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export class GumloopClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly config: AppConfig, options: GumloopClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => Date.now());
  }

  async run(request: RunRequest, options: { fetchLimitOverride?: number } = {}): Promise<GumloopRunResult> {
    if (!gumloopConfigured(this.config)) {
      throw new AppError(
        'gumloop_not_configured',
        'Gumloop não configurado: defina GUMLOOP_API_KEY, GUMLOOP_AGENT_ID e GUMLOOP_USER_ID.',
        503,
      );
    }
    const startedAt = this.now();
    const start = await this.requestJson<AgentStartResponse>('/start_agent', {
      method: 'POST',
      body: JSON.stringify({
        gummie_id: this.config.gumloopAgentId,
        user_id: this.config.gumloopUserId,
        ...(this.config.gumloopProjectId ? { project_id: this.config.gumloopProjectId } : {}),
        message: buildExtractPrompt(request, options),
      }),
    });
    const interactionId = interactionIdOf(start);

    // Some deployments answer synchronously. Avoid an unnecessary status call.
    const startState = String(start.state ?? start.status ?? '').toLowerCase();
    if (start.response !== undefined && ['completed', 'complete', 'succeeded', 'success', 'done'].includes(startState)) {
      return { payload: parseAgentPayload(start.response), interactionId, elapsedMs: this.now() - startedAt };
    }

    const deadline = startedAt + this.config.gumloopTimeoutMs;
    let lastStatus: AgentStatusResponse | undefined;
    while (this.now() < deadline) {
      const remaining = deadline - this.now();
      await this.sleep(Math.min(this.config.gumloopPollMs, Math.max(0, remaining)));
      if (this.now() >= deadline) break;
      const query = new URLSearchParams({ user_id: this.config.gumloopUserId });
      if (this.config.gumloopProjectId) query.set('project_id', this.config.gumloopProjectId);
      lastStatus = await this.requestJson<AgentStatusResponse>(
        `/agent_status/${encodeURIComponent(interactionId)}?${query.toString()}`,
        { method: 'GET' },
      );
      const state = stateOf(lastStatus);
      if (isCompleted(state, lastStatus)) {
        return { payload: payloadFromStatus(lastStatus), interactionId, elapsedMs: this.now() - startedAt };
      }
      if (isFailed(state)) {
        throw new AppError(
          'agent_failed',
          lastStatus.error_message || lastStatus.error || 'O agente Gumloop falhou.',
          502,
          { details: { interactionId, state }, retryable: true },
        );
      }
    }
    throw new AppError('agent_timeout', 'O agente Gumloop excedeu o timeout configurado.', 504, {
      details: { interactionId, lastState: lastStatus ? stateOf(lastStatus) : undefined },
      retryable: true,
    });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.gumloopFetchTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.gumloopBaseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.gumloopApiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init.headers ?? {}),
        },
      });
      const raw = await response.text();
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { rawPreview: raw.slice(0, 500) };
      }
      if (!response.ok) {
        const statusCode = response.status === 429 ? 429 : response.status === 408 ? 504 : 502;
        throw new AppError(
          'gumloop_http_error',
          `Gumloop respondeu HTTP ${response.status}.`,
          statusCode,
          { details: body, retryable: isRetryableStatus(response.status) },
        );
      }
      return body as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortError(error)) {
        throw new AppError('gumloop_request_timeout', 'Timeout ao comunicar com a API Gumloop.', 504, { retryable: true });
      }
      throw new AppError('gumloop_network_error', error instanceof Error ? error.message : String(error), 502, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
