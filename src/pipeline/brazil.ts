import type { TikTokPost } from '../types.js';

export const KEEP_SCORE = 3;
export const FOREIGN_OVERRIDE_SCORE = 6;

const STRONG_PT_WORDS = [
  'não', 'nao', 'você', 'voce', 'vocês', 'voces', 'também', 'tambem', 'então', 'entao',
  'obrigado', 'obrigada', 'gente', 'muito', 'muita', 'foi', 'isso', 'hoje', 'receita',
  'coisa', 'cadê', 'cade', 'mano', 'caraca', 'véi', 'vei', 'deixa', 'olha', 'assim',
];
const AMBIGUOUS_PT_WORDS = ['para', 'aqui', 'brasil', 'como', 'quando', 'porque', 'casa', 'vida', 'amor', 'dia'];
const BR_HASHTAGS = [
  'tiktokbrasil', 'brasileirospelomundo', 'humorbrasil', 'viralbrasil', 'funkbrasil',
  'sertanejo', 'pagode', 'forro', 'forró', 'futebolbrasileiro', 'novela', 'bbb',
];
const BR_FLAG = '🇧🇷';
const FOREIGN_SCRIPT = /[Ѐ-ӿ؀-ۿऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/u;

function normalize(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase('pt-BR');
}

function hasWord(value: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, 'iu').test(value);
}

export function brazilSignalScore(post: TikTokPost): number {
  const caption = normalize(post.caption);
  const text = [caption, normalize(post.author?.nickname), normalize(post.author?.signature), normalize(post.music?.title)].join(' ');
  let score = 0;
  if (/[ãõ]/u.test(text)) score += 3;
  if (/ç/u.test(text)) score += 2;
  if (/(^|[^\p{L}])k{3,}([^\p{L}]|$)/iu.test(caption)) score += 3;
  if (text.includes(BR_FLAG)) score += 2;
  if (text.includes('som original')) score += 3;
  for (const word of STRONG_PT_WORDS) if (hasWord(text, word)) score += 2;
  let ambiguous = 0;
  for (const word of AMBIGUOUS_PT_WORDS) {
    if (ambiguous >= 2) break;
    if (hasWord(text, word)) ambiguous += 1;
  }
  score += ambiguous;
  if ((post.hashtags ?? []).some((tag) => BR_HASHTAGS.includes(normalize(tag)))) score += 2;
  return score;
}

export function looksForeign(post: TikTokPost): boolean {
  const text = [post.caption, post.author?.nickname, post.music?.title].filter(Boolean).join(' ');
  return FOREIGN_SCRIPT.test(text);
}

export function looksBrazilian(post: TikTokPost, proxyLocalized = false): boolean {
  const region = (post.author?.region ?? '').toUpperCase();
  const location = (post.locationCreated ?? '').toUpperCase();
  if (region === 'BR' || location === 'BR') return true;
  if (region && region !== 'BR') return brazilSignalScore(post) >= FOREIGN_OVERRIDE_SCORE;
  if (proxyLocalized) return !looksForeign(post);
  return brazilSignalScore(post) >= KEEP_SCORE;
}

export function filterBrazilianPosts(posts: TikTokPost[], options: { proxyLocalized?: boolean } = {}): {
  kept: TikTokPost[];
  removed: number;
} {
  const kept = posts.filter((post) => looksBrazilian(post, options.proxyLocalized ?? false));
  return { kept, removed: posts.length - kept.length };
}
