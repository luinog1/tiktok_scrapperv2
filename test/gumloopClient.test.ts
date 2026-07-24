import { describe, expect, it, vi } from 'vitest';

import { GumloopClient } from '../src/gumloop/agentClient.js';
import { GumloopExtractionProvider } from '../src/providers/extractionProvider.js';
import { parseRunRequest } from '../src/schemas.js';
import { testConfig } from './helpers.js';

describe('GumloopClient', () => {
  it('faz start + polling até COMPLETED', async () => {
    const replies = [
      { interaction_id: 'int-1', status: 'processing' },
      { state: 'ASYNC_PROCESSING' },
      { state: 'COMPLETED', response: '{"ok":true,"top":[]}' },
    ];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(replies.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    let now = 0;
    const config = testConfig({
      SCRAPE_PROVIDER: 'gumloop',
      GUMLOOP_API_KEY: 'secret',
      GUMLOOP_AGENT_ID: 'agent',
      GUMLOOP_USER_ID: 'user',
    });
    const client = new GumloopClient(config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    });
    const parsed = parseRunRequest({ keyword: 'receita' });
    if (!parsed.success) throw parsed.error;
    const result = await client.run(parsed.data);
    expect(result.interactionId).toBe('int-1');
    expect(result.payload).toEqual({ ok: true, top: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const startInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(startInit.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('repete uma falha retryable com fetchMax menor', async () => {
    const replies = [
      new Response(JSON.stringify({ error: 'temporary' }), { status: 500 }),
      new Response(JSON.stringify({ interaction_id: 'int-retry', status: 'processing' }), { status: 200 }),
      new Response(JSON.stringify({ state: 'COMPLETED', response: '{"ok":true,"top":[]}' }), { status: 200 }),
    ];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => replies.shift()!);
    let now = 0;
    const config = testConfig({
      SCRAPE_PROVIDER: 'gumloop',
      GUMLOOP_API_KEY: 'secret',
      GUMLOOP_AGENT_ID: 'agent',
      GUMLOOP_USER_ID: 'user',
    });
    const client = new GumloopClient(config, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    });
    const parsed = parseRunRequest({ keyword: 'receita', max: 20, onlyBrazil: true });
    if (!parsed.success) throw parsed.error;

    const response = await new GumloopExtractionProvider(config, client).run(parsed.data);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.warnings).toContain('gumloop_retry_with_lower_limit');
    const retryBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body)) as { message: string };
    expect(retryBody.message).toContain('"fetchMax":30');
  });
});
