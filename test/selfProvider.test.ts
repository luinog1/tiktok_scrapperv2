import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { SelfHostedClient } from '../src/providers/self/client.js';

const DIRECT_HTML = `<script type="application/json">{"items":[{"id":"8123456789012345678","desc":"Receita de hoje","author":{"uniqueId":"ana"},"stats":{"playCount":1000}}]}</script>`;

describe('SelfHostedClient', () => {
  it('consulta um serviço self-hosted compatível', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: '1', url: 'https://www.tiktok.com/@a/video/12345678901' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const config = loadConfig({ SCRAPE_PROVIDER: 'self', SELF_SCRAPE_MODE: 'service', SCRAPE_API_TOKEN: 'internal', MEDIA_PROVIDER: 'off' });
    const client = new SelfHostedClient(config, { fetchImpl: fetchImpl as typeof fetch });
    const items = await client.search(['receita'], { max: 5 });
    expect(items).toHaveLength(1);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ token: 'internal' });
    expect(JSON.parse(String(init.body))).toMatchObject({ keyword: 'receita', count: 5 });
  });

  it('em auto usa fetch direto quando o serviço não expõe search', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(DIRECT_HTML, { status: 200, headers: { 'content-type': 'text/html' } }));
    const config = loadConfig({ SCRAPE_PROVIDER: 'self', SELF_SCRAPE_MODE: 'auto', TIKTOK_COOKIE: 'session=abc', MEDIA_PROVIDER: 'off' });
    const client = new SelfHostedClient(config, { fetchImpl: fetchImpl as typeof fetch });
    const items = await client.search(['receita'], { max: 5, onlyBrazil: true });
    expect(items).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('tiktok.com/search');
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Cookie: 'session=abc' });
  });
});
