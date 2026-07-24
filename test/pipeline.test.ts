import { describe, expect, it } from 'vitest';

import { processAgentPayload } from '../src/pipeline/process.js';
import { parseRunRequest } from '../src/schemas.js';
import { testConfig } from './helpers.js';

describe('processAgentPayload', () => {
  it('filtra, classifica, ordena e corta depois do filtro', () => {
    const parsed = parseRunRequest({ keyword: 'receita', max: 1, onlyBrazil: true, minViews: 100 });
    if (!parsed.success) throw parsed.error;
    const result = processAgentPayload({
      ok: true,
      top: [
        { id: '1', url: 'https://www.tiktok.com/@global/video/12345678901', text: 'world cup Brazil', author: { uniqueId: 'global' }, playCount: 9_000_000 },
        { id: '2', url: 'https://www.tiktok.com/@br/video/22345678901', text: 'Não acredito, gente!', author: { uniqueId: 'br' }, playCount: 200_000, diggCount: 20_000, shareCount: 1000, commentCount: 500 },
      ],
    }, parsed.data, testConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brRemoved).toBe(1);
    expect(result.top).toHaveLength(1);
    expect(result.top[0].id).toBe('2');
    expect(result.top[0].trendTier).toBe('RISING');
  });
});
