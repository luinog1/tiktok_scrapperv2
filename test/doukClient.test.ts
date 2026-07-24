import { describe, expect, it, vi } from 'vitest';

import { DoukClient, extractTikTokVideoId, isTikTokUrl, safeFilename } from '../src/media/doukClient.js';
import { testConfig } from './helpers.js';

describe('DoukClient', () => {
  it('resolve JSON do DouK e busca o MP4 em host permitido', async () => {
    const responses = [
      new Response(JSON.stringify({ data: { video_url: 'https://v16.tiktokcdn.com/file.mp4' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '3' },
      }),
    ];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => responses.shift()!);
    const client = new DoukClient(testConfig({ MEDIA_PROVIDER: 'douk', MEDIA_API_TOKEN: 'media-secret' }), {
      fetchImpl: fetchImpl as typeof fetch,
    });
    const result = await client.download('https://www.tiktok.com/@user/video/7123456789012345678', 'trend');
    expect(result.contentLength).toBe(3);
    expect(result.filename).toBe('trend.mp4');
    const firstInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(firstInit.headers).toMatchObject({ token: 'media-secret' });
  });

  it('rejeita URLs externas', async () => {
    expect(isTikTokUrl('https://evil.example/video/1')).toBe(false);
    const client = new DoukClient(testConfig({ MEDIA_PROVIDER: 'douk' }), { fetchImpl: vi.fn() as typeof fetch });
    await expect(client.download('https://evil.example/video/1')).rejects.toMatchObject({ code: 'invalid_tiktok_url' });
  });

  it('sanitiza nomes de ficheiro', () => {
    expect(safeFilename('../meu:video')).toBe('.._meu_video.mp4');
  });

  it('extrai IDs dos formatos mobile e query usados por links curtos resolvidos', () => {
    expect(extractTikTokVideoId('https://m.tiktok.com/v/7123456789012345678')).toBe('7123456789012345678');
    expect(extractTikTokVideoId('https://www.tiktok.com/?item_id=7123456789012345678')).toBe('7123456789012345678');
  });
});
