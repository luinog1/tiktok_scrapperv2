import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ApifyClient } from '../src/providers/apify/client.js';
import { ApifyProvider } from '../src/providers/apify/index.js';

describe('ApifyProvider rollback', () => {
  it('usa o schema atual do actor e lê o dataset via REST', async () => {
    const responses = [
      new Response(JSON.stringify({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1' } }), { status: 201 }),
      new Response(JSON.stringify([{ id: '1', webVideoUrl: 'https://www.tiktok.com/@a/video/12345678901' }]), { status: 200 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const config = loadConfig({ SCRAPE_PROVIDER: 'apify', APIFY_API_TOKEN: 'apify-secret', SCRAPE_DO_GEO_CODE: 'us', MEDIA_PROVIDER: 'off' });
    const client = new ApifyClient(config, { fetchImpl: fetchImpl as typeof fetch });
    const provider = new ApifyProvider(config, { client });
    const items = await provider.search(['receita'], { max: 20, onlyBrazil: true });
    expect(items).toHaveLength(1);
    const input = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(input).toMatchObject({
      searchQueries: ['receita'],
      searchSection: '',
      resultsPerPage: 20,
      proxyCountryCode: 'BR',
      shouldDownloadVideos: false,
    });
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/v2/datasets/dataset-1/items');
  });
});
