import { describe, expect, it } from 'vitest';

import { fetchLimitForRequest, parseRunRequest, sourceForRequest } from '../src/schemas.js';

describe('RunRequest', () => {
  it('preserva o contrato, normaliza hashtags e limita top a 50', () => {
    const result = parseRunRequest({
      hashtags: ['#achadinhos', ' achadinhos ', 'brasil'],
      max: 200,
      minViews: '1000',
      onlyBrazil: 'true',
      downloadVideos: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.hashtags).toEqual(['achadinhos', 'brasil']);
    expect(result.data.max).toBe(50);
    expect(result.data.minViews).toBe(1000);
    expect(result.data.onlyBrazil).toBe(true);
    expect(result.data.includeMediaLinks).toBe(false);
  });

  it('exige keyword ou hashtags', () => {
    expect(parseRunRequest({}).success).toBe(false);
  });

  it('usa search para hashtag BR e calcula oversample', () => {
    const result = parseRunRequest({ hashtags: ['receita'], max: 20, onlyBrazil: true });
    if (!result.success) throw result.error;
    expect(sourceForRequest(result.data)).toEqual({ source: 'search', terms: ['receita'] });
    expect(fetchLimitForRequest(result.data)).toBe(60);
  });
});
