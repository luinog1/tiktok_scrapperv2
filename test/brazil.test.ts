import { describe, expect, it } from 'vitest';

import { brazilSignalScore, filterBrazilianPosts, looksBrazilian, looksForeign } from '../src/pipeline/brazil.js';
import { post } from './helpers.js';

describe('filtro Brasil estrito', () => {
  it('mantém sinais PT-BR e descarta texto global', () => {
    const items = [post({ caption: 'Não acredito que isso deu certo, gente!' }), post({ id: '2', caption: 'daily vlog in Brazil' })];
    const result = filterBrazilianPosts(items);
    expect(result.kept).toHaveLength(1);
    expect(result.removed).toBe(1);
  });

  it('não trata fonte Gumloop como proxy localizada', () => {
    const neutral = post({ caption: '🔥 achadinho' });
    expect(looksBrazilian(neutral, false)).toBe(false);
    expect(looksBrazilian(neutral, true)).toBe(true);
  });

  it('detecta escrita estrangeira e limita palavras ambíguas', () => {
    expect(looksForeign(post({ caption: 'ราคาถูกมาก shopee' }))).toBe(true);
    expect(brazilSignalScore(post({ caption: 'para aqui como quando casa vida amor dia' }))).toBe(2);
  });
});
