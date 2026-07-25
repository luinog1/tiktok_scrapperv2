import { describe, expect, it, vi } from 'vitest';

import { CdnClient } from '../src/media/cdnClient.js';
import { CdnMediaProvider, getMediaProvider } from '../src/media/factory.js';
import { mediaConfigured } from '../src/config.js';
import { testConfig } from './helpers.js';

const VIDEO_URL = 'https://www.tiktok.com/@user/video/7123456789012345678';

function config(overrides: NodeJS.ProcessEnv = {}) {
  return testConfig({ MEDIA_PROVIDER: 'cdn', ...overrides });
}

function resolverJson(data: Record<string, unknown>, code = 0): Response {
  return new Response(JSON.stringify({ code, msg: code === 0 ? 'success' : 'error', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mp4Response(bytes = 3): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(bytes) },
  });
}

function pageResponse(scope: Record<string, unknown>, cookies: string[] = []): Response {
  const html = `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${
    JSON.stringify({ __DEFAULT_SCOPE__: scope })
  }</script></body></html>`;
  const response = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
}

function clientWith(routes: Array<[match: (url: string) => boolean, respond: () => Response]>, overrides: NodeJS.ProcessEnv = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = routes.find(([match]) => match(url));
    if (!route) throw new Error(`sem rota de teste para ${url}`);
    return route[1]();
  });
  return { client: new CdnClient(config(overrides), { fetchImpl: fetchImpl as typeof fetch }), fetchImpl };
}

describe('CdnClient', () => {
  it('resolve via tikwm e baixa o MP4 sem marca d’água', async () => {
    const { client, fetchImpl } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({
        id: '7123456789012345678',
        hdplay: 'https://v16m.tiktokcdn-us.com/abc/video.mp4',
        play: 'https://v16m.tiktokcdn-us.com/abc/video-sd.mp4',
      })],
      [(url) => url.includes('tiktokcdn-us.com'), () => mp4Response()],
    ]);
    const download = await client.download(VIDEO_URL);
    expect(download.contentType).toBe('video/mp4');
    expect(download.filename).toBe('tiktok-7123456789012345678.mp4');
    const resolverCall = String(fetchImpl.mock.calls[0][0]);
    expect(resolverCall).toContain(encodeURIComponent(VIDEO_URL));
    const mediaCall = String(fetchImpl.mock.calls[1][0]);
    expect(mediaCall).toBe('https://v16m.tiktokcdn-us.com/abc/video.mp4');
  });

  it('prefixa caminhos relativos do resolver com a base configurada', async () => {
    const { client, fetchImpl } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({ play: '/video/media/play/7123.mp4' })],
      [(url) => url.startsWith('https://www.tikwm.com/video/'), () => mp4Response()],
    ]);
    await client.download(VIDEO_URL, 'meu-video.mp4');
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://www.tikwm.com/video/media/play/7123.mp4');
  });

  it('cai para a página do vídeo quando o resolver falha e envia os cookies recebidos', async () => {
    const { client, fetchImpl } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({}, -1)],
      [(url) => url === VIDEO_URL, () => pageResponse({
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: { itemStruct: { video: { playAddr: 'https://v16-webapp-prime.tiktok.com/video/file.mp4' } } },
        },
      }, ['tt_chain_token=abc123; Path=/', 'ttwid=xyz; Path=/'])],
      [(url) => url.includes('v16-webapp-prime.tiktok.com'), () => mp4Response()],
    ]);
    const download = await client.download(VIDEO_URL);
    expect(download.filename).toBe('tiktok-7123456789012345678.mp4');
    const mediaInit = fetchImpl.mock.calls[2][1] as RequestInit;
    expect(mediaInit.headers).toMatchObject({ Cookie: 'tt_chain_token=abc123; ttwid=xyz' });
  });

  it('expande links curtos antes de resolver', async () => {
    const { client, fetchImpl } = clientWith([
      [(url) => url === 'https://vm.tiktok.com/ZM123abc/', () => new Response(null, {
        status: 301,
        headers: { location: VIDEO_URL },
      })],
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({ play: 'https://v16m.tiktokcdn-us.com/x.mp4' })],
      [(url) => url.includes('tiktokcdn-us.com'), () => mp4Response()],
    ]);
    await client.download('https://vm.tiktok.com/ZM123abc/');
    expect(String(fetchImpl.mock.calls[1][0])).toContain(encodeURIComponent(VIDEO_URL));
  });

  it('rejeita URLs fora do TikTok', async () => {
    const { client } = clientWith([]);
    await expect(client.download('https://evil.example/video/1')).rejects.toMatchObject({ code: 'invalid_tiktok_url' });
  });

  it('devolve media_not_found quando a página diz que o vídeo saiu do ar', async () => {
    const { client } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({}, -1)],
      [(url) => url === VIDEO_URL, () => pageResponse({ 'webapp.video-detail': { statusCode: 10204 } })],
    ]);
    await expect(client.download(VIDEO_URL)).rejects.toMatchObject({ code: 'media_not_found' });
  });

  it('recusa URL de mídia fora da allowlist devolvida pelo resolver', async () => {
    const { client } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({ play: 'https://evil.example/file.mp4' })],
      [(url) => url === VIDEO_URL, () => new Response('<html></html>', { status: 200 })],
    ]);
    await expect(client.download(VIDEO_URL)).rejects.toMatchObject({ code: 'media_unresolvable' });
  });

  it('aplica o limite de tamanho configurado', async () => {
    const { client } = clientWith([
      [(url) => url.startsWith('https://www.tikwm.com/api/'), () => resolverJson({ play: 'https://v16m.tiktokcdn-us.com/big.mp4' })],
      [(url) => url.includes('tiktokcdn-us.com'), () => new Response(new Uint8Array(10), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '999999999' },
      })],
    ]);
    await expect(client.download(VIDEO_URL)).rejects.toMatchObject({ code: 'media_too_large' });
  });
});

describe('media factory + config (cdn)', () => {
  it('MEDIA_PROVIDER=cdn cria o CdnMediaProvider e conta como configurado', () => {
    const cfg = config();
    expect(mediaConfigured(cfg)).toBe(true);
    expect(getMediaProvider(cfg)).toBeInstanceOf(CdnMediaProvider);
  });

  it('MEDIA_CDN_RESOLVER_URL=off desliga o resolver e mantém só a página', () => {
    expect(config({ MEDIA_CDN_RESOLVER_URL: 'off' }).mediaCdnResolverUrl).toBe('');
    expect(config().mediaCdnResolverUrl).toBe('https://www.tikwm.com');
  });
});
