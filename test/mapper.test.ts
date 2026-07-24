import { describe, expect, it } from 'vitest';

import { mapRawToTikTokPost, numberValue } from '../src/pipeline/mapper.js';

describe('mapRawToTikTokPost', () => {
  it('mapeia aliases Gumloop e calcula engagement', () => {
    const mapped = mapRawToTikTokPost({
      video_id: '7123456789012345678',
      caption: 'Não acredito #receita',
      author: { unique_id: 'maria', nickname: 'Maria', follower_count: '12.5k' },
      statistics: { view_count: '1.2M', like_count: 120_000, share_count: 1000, comment_count: 500 },
      create_time: 1_720_000_000,
    });
    expect(mapped.url).toContain('/@maria/video/7123456789012345678');
    expect(mapped.metrics.playCount).toBe(1_200_000);
    expect(mapped.author.followers).toBe(12_500);
    expect(mapped.hashtags).toContain('receita');
    expect(mapped.engagementRate).toBeCloseTo(10.125);
  });

  it('normaliza métricas abreviadas', () => {
    expect(numberValue('2.5k')).toBe(2500);
    expect(numberValue('1,234')).toBe(1234);
    expect(numberValue('1,2M views')).toBe(1_200_000);
    expect(numberValue('1,2 mil visualizações')).toBe(1200);
    expect(numberValue('1.234,5')).toBe(1234.5);
  });

  it('deriva id e autor de links mobile quando o payload não traz aliases', () => {
    const mapped = mapRawToTikTokPost({
      url: 'https://m.tiktok.com/v/8123456789012345678',
      desc: 'Vídeo mobile',
    });
    expect(mapped.id).toBe('8123456789012345678');
    expect(mapped.url).toBe('https://m.tiktok.com/v/8123456789012345678');
  });
});
