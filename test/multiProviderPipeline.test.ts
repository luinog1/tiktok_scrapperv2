import { describe, expect, it } from 'vitest';

import { ScrapeExtractionProvider } from '../src/providers/extractionProvider.js';
import type { ScrapeProvider } from '../src/providers/types.js';
import { parseRunRequest } from '../src/schemas.js';
import { testConfig } from './helpers.js';

function provider(name: 'self' | 'scrapedo'): ScrapeProvider {
  return {
    name,
    lastMeta: { creditsUsed: name === 'scrapedo' ? 25 : undefined, pagesFetched: 1 },
    async search() {
      return [{ id: '7123456789012345678', webVideoUrl: 'https://www.tiktok.com/@neutral/video/7123456789012345678', text: 'neutral trend', author: { uniqueId: 'neutral' }, stats: { playCount: 1000 } }];
    },
    async hashtags() { return []; },
  };
}

describe('pipeline por provider', () => {
  it('confia em busca scrape.do geo BR e expõe metadata', async () => {
    const config = testConfig({ SCRAPE_PROVIDER: 'scrapedo', SCRAPE_DO_TOKEN: 'token', SCRAPE_DO_GEO_CODE: 'br' });
    const parsed = parseRunRequest({ keyword: 'trend', onlyBrazil: true });
    if (!parsed.success) throw parsed.error;
    const response = await new ScrapeExtractionProvider(config, provider('scrapedo')).run(parsed.data);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.provider).toBe('scrapedo');
    expect(response.top).toHaveLength(1);
    expect(response.scrapeMeta?.creditsUsed).toBe(25);
  });

  it('mantém filtro linguístico estrito no modo self', async () => {
    const config = testConfig({ SCRAPE_PROVIDER: 'self' });
    const parsed = parseRunRequest({ keyword: 'trend', onlyBrazil: true });
    if (!parsed.success) throw parsed.error;
    const response = await new ScrapeExtractionProvider(config, provider('self')).run(parsed.data);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.top).toHaveLength(0);
    expect(response.brRemoved).toBe(1);
  });

  it('só faz fallback quando explicitamente configurado e sinaliza a troca', async () => {
    // Use o provider mock como destino para manter o teste determinístico e
    // provar o contrato de fallback sem abrir uma chamada real ao DouK/TikTok.
    const config = testConfig({ SCRAPE_PROVIDER: 'scrapedo', SCRAPE_DO_TOKEN: 'token', FALLBACK_SCRAPE_PROVIDER: 'mock' });
    const failing: ScrapeProvider = {
      name: 'scrapedo',
      async search() { throw new Error('temporary'); },
      async hashtags() { throw new Error('temporary'); },
    };
    const parsed = parseRunRequest({ keyword: 'trend' });
    if (!parsed.success) throw parsed.error;
    const response = await new ScrapeExtractionProvider(config, failing).run(parsed.data);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.provider).toBe('mock');
    expect(response.warnings).toContain('scrape_fallback_scrapedo_to_mock');
  });

  it('propaga a falha do provider quando fallback não está configurado', async () => {
    const config = testConfig({ SCRAPE_PROVIDER: 'scrapedo', SCRAPE_DO_TOKEN: 'token' });
    const failing: ScrapeProvider = {
      name: 'scrapedo',
      async search() { throw new Error('temporary'); },
      async hashtags() { throw new Error('temporary'); },
    };
    const parsed = parseRunRequest({ keyword: 'trend' });
    if (!parsed.success) throw parsed.error;
    await expect(new ScrapeExtractionProvider(config, failing).run(parsed.data))
      .rejects.toThrow('temporary');
  });
});
