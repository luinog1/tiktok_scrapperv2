import { describe, expect, it } from 'vitest';

import { loadConfig, scrapeConfigured } from '../src/config.js';
import { getScrapeProvider } from '../src/providers/factory.js';

describe('configuração multi-provider', () => {
  it('usa self por default sem exigir token pago', () => {
    const config = loadConfig({ MEDIA_PROVIDER: 'off' });
    expect(config.scrapeProvider).toBe('self');
    expect(config.scrapeDoToken).toBe('');
    expect(scrapeConfigured(config)).toBe(true);
    expect(getScrapeProvider(config).name).toBe('self');
  });

  it('falha claramente quando scrapedo não tem token', () => {
    const config = loadConfig({ SCRAPE_PROVIDER: 'scrapedo', MEDIA_PROVIDER: 'off' });
    expect(scrapeConfigured(config)).toBe(false);
    expect(() => getScrapeProvider(config)).toThrowError(expect.objectContaining({ code: 'scrapedo_token_missing' }));
  });

  it('não converte provider desconhecido silenciosamente para self', () => {
    const config = loadConfig({ SCRAPE_PROVIDER: 'outro', MEDIA_PROVIDER: 'off' });
    expect(config.scrapeProvider).toBe('invalid');
    expect(() => getScrapeProvider(config)).toThrowError(expect.objectContaining({ code: 'invalid_scrape_provider' }));
  });
});
