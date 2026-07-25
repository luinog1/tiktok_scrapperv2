import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { mapRawToTikTokPost } from '../src/pipeline/mapper.js';
import { ScrapeDoClient } from '../src/providers/scrapedo/client.js';
import { ScrapeDoProvider, parseScrapeDoPage } from '../src/providers/scrapedo/index.js';

const HTML = `<!doctype html><html><body>
<script id="SIGI_STATE" type="application/json">
{"ItemModule":{"7123456789012345678":{"id":"7123456789012345678","desc":"Não acredito #receita","author":{"uniqueId":"maria","nickname":"Maria"},"stats":{"playCount":120000,"diggCount":12000,"shareCount":300,"commentCount":200},"video":{"duration":15,"cover":{"urlList":["https://p16.tiktokcdn.com/cover.jpeg"]}},"createTime":1720000000}}}
</script></body></html>`;

describe('ScrapeDoProvider', () => {
  it('interpreta estado JSON embutido do TikTok sem DOM externo', () => {
    const items = parseScrapeDoPage(HTML);
    expect(items).toHaveLength(1);
    const post = mapRawToTikTokPost(items[0]);
    expect(post.id).toBe('7123456789012345678');
    expect(post.author.username).toBe('maria');
    expect(post.coverUrl).toContain('tiktokcdn.com');
  });

  it('aceita a estrutura universal webapp.video-detail', () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          itemInfo: { itemStruct: { id: '8123456789012345678', desc: 'Oi', author: { uniqueId: 'ana' } } },
        },
      },
    })}</script>`;
    const items = parseScrapeDoPage(html);
    expect(items.some((item) => (item as { id?: string }).id === '8123456789012345678')).toBe(true);
  });

  it('reconhece JSON-LD VideoObject quando a página não expõe SIGI_STATE', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'VideoObject',
      url: 'https://www.tiktok.com/@ana/video/9123456789012345678',
      name: 'Receita rápida',
      description: 'Uma receita de hoje',
      contentUrl: 'https://v16.tiktokcdn.com/video.mp4',
    })}</script>`;
    const items = parseScrapeDoPage(html);
    expect(items).toHaveLength(1);
    expect(mapRawToTikTokPost(items[0]).id).toBe('9123456789012345678');
  });

  it('ignora categorias de navegação e locales do estado embutido (regressão CSV "Travel")', () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.app-context': {
          language: 'pt-BR',
          languageList: [
            { id: 'ind-ID', label: 'Bahasa Indonesia' },
            { id: 'pt-BR', label: 'Português (Brasil)' },
          ],
        },
        'webapp.explore-page': {
          categoryList: [
            { id: 'Travel', label: 'Travel' },
            { id: 'Sports', label: 'Sports' },
            { id: 'Gaming', label: 'Gaming' },
          ],
        },
        'webapp.search-page': {
          data: [
            {
              item: {
                id: '7300000000000000001',
                desc: 'Achadinho real #promo',
                author: { uniqueId: 'lojinha', nickname: 'Lojinha' },
                stats: { playCount: 50000, diggCount: 4000, shareCount: 100, commentCount: 90 },
              },
            },
          ],
        },
      },
    })}</script>`;
    const items = parseScrapeDoPage(html);
    const posts = items.map(mapRawToTikTokPost);
    expect(posts.some((post) => post.id === '7300000000000000001')).toBe(true);
    expect(posts.every((post) => /^\d{8,}$/u.test(post.id))).toBe(true);
  });

  it('extrai métricas das respostas XHR capturadas via returnJSON e mescla com âncoras', () => {
    const envelope = {
      content: `<html><body><a href="/@lojinha/video/7300000000000000002">12.5K</a></body></html>`,
      networkRequests: [
        { url: 'https://www.tiktok.com/api/challenge/item_list/?challengeID=1', method: 'GET', content: JSON.stringify({
          itemList: [{
            id: '7300000000000000002',
            desc: 'Achadinho com métricas #promo',
            author: { uniqueId: 'lojinha', nickname: 'Lojinha' },
            stats: { playCount: 12500, diggCount: 900, shareCount: 30, commentCount: 45 },
            video: { duration: 21 },
            createTime: 1721900000,
          }],
        }) },
      ],
    };
    const items = parseScrapeDoPage(envelope);
    const posts = items.map(mapRawToTikTokPost).filter((post) => post.id === '7300000000000000002');
    expect(posts).toHaveLength(1);
    expect(posts[0].metrics.playCount).toBe(12500);
    expect(posts[0].metrics.diggCount).toBe(900);
    expect(posts[0].caption).toContain('Achadinho');
    expect(posts[0].author.username).toBe('lojinha');
  });

  it('usa o badge numérico da âncora como views, não como legenda', () => {
    const html = `<html><body><a href="/@perfil/video/7300000000000000003"><span>12.5K</span></a></body></html>`;
    const items = parseScrapeDoPage(html);
    const post = mapRawToTikTokPost(items[0]);
    expect(post.id).toBe('7300000000000000003');
    expect(post.caption).toBe('');
    expect(post.metrics.playCount).toBe(12500);
  });

  it('envia parâmetros server-side e registra custo', async () => {
    const fetchImpl = vi.fn(async () => new Response(HTML, {
      status: 200,
      headers: { 'content-type': 'text/html', 'Scrape.do-Request-Cost': '25' },
    }));
    const config = loadConfig({
      SCRAPE_PROVIDER: 'scrapedo',
      SCRAPE_DO_TOKEN: 'server-secret',
      SCRAPE_DO_GEO_CODE: 'br',
      MEDIA_PROVIDER: 'off',
    });
    const client = new ScrapeDoClient(config, { fetchImpl: fetchImpl as typeof fetch });
    const provider = new ScrapeDoProvider(config, { client });
    const items = await provider.search(['receita fitness'], { max: 10, onlyBrazil: true });
    expect(items).toHaveLength(1);
    const calledUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(calledUrl.searchParams.get('token')).toBe('server-secret');
    expect(calledUrl.searchParams.get('geoCode')).toBe('br');
    expect(calledUrl.searchParams.get('render')).toBe('true');
    expect(calledUrl.searchParams.get('customWait')).toBe('5000');
    expect(calledUrl.searchParams.get('url')).toContain('tiktok.com/search');
    expect(provider.lastMeta.creditsUsed).toBe(25);
  });
});
