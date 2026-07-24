# TikTok Multi-provider BFF

BFF + interface Next.js para pesquisar sinais públicos do TikTok, normalizar os
resultados, aplicar filtro PT-BR, classificar tiers, ranquear e exportar CSV sem
acoplar a UI a um fornecedor de scraping.

Implementação do desenho em
[`plano-tiktok-multi-provider.md`](./plano-tiktok-multi-provider.md).

O motor é selecionado em runtime por `SCRAPE_PROVIDER`:

| Modo | Valor | Token de scraping pago | Uso |
| --- | --- | --- | --- |
| Self-hosted (default) | `self` | Não | dev, baixo custo e instalações próprias |
| scrape.do | `scrapedo` | `SCRAPE_DO_TOKEN` | produção com fetch renderizado/geo BR |
| Apify rollback | `apify` | `APIFY_API_TOKEN` | compatibilidade operacional |
| Mock local | `mock` | Não | UI e testes sem rede |

Gumloop não faz parte do caminho final. O adapter antigo continua no código
somente para compatibilidade durante a migração e não é necessário para
instalar, iniciar ou operar os três modos acima.

O download de MP4 é independente do motor de busca: `MEDIA_PROVIDER=douk`
resolve `post.url` sob demanda através do DouK; `MEDIA_PROVIDER=off` mantém
apenas o link original.

## Arquitetura

```text
Browser -> Next.js /api/* -> BFF /run -> ScrapeProvider
                                      -> pipeline único
                                         map -> BR -> minViews -> tiers -> rank

Browser -> Next.js /api/download-media -> BFF -> MediaProvider -> DouK
```

Os tokens ficam somente no processo server-side. O contrato `RunRequest` /
`RunResponse` e a UI não mudam quando o provider é trocado.

## Requisitos

- Node.js 20+ (Docker usa Node 22)
- Para `self`: acesso ao TikTok e, idealmente, cookie/proxy operacional; DouK é
  necessário quando mídia está ligada
- Para `scrapedo`: `SCRAPE_DO_TOKEN`
- Para `apify`: `APIFY_API_TOKEN`

```bash
cp .env.example .env
npm install
npm run dev
```

Para um smoke sem rede:

```bash
SCRAPE_PROVIDER=mock MEDIA_PROVIDER=off npm run dev
```

## Configuração de scrape

### Self-hosted (default)

```bash
SCRAPE_PROVIDER=self
SELF_SCRAPE_MODE=auto
SCRAPE_SERVICE_URL=http://tiktok-dl:5555
SCRAPE_API_TOKEN=
TIKTOK_COOKIE=
```

`SELF_SCRAPE_MODE` aceita:

| Valor | Comportamento |
| --- | --- |
| `auto` | tenta os endpoints self-hosted configurados e, se não existirem, usa fetch direto das páginas TikTok |
| `service` | exige `SCRAPE_SEARCH_ENDPOINT` / `SCRAPE_HASHTAG_ENDPOINT` no serviço local |
| `direct` | busca diretamente `tiktok.com/search` e `tiktok.com/tag` |

Importante: o DouK upstream verificado atualmente documenta
`/tiktok/detail`, `/tiktok/account`, `/tiktok/mix` e `/tiktok/live`, mas não uma
rota oficial de busca TikTok. Por isso os endpoints abaixo são configuráveis e
o default `auto` não finge que uma imagem DouK stock oferece search:

```bash
SCRAPE_SEARCH_ENDPOINT=/tiktok/search/video
SCRAPE_HASHTAG_ENDPOINT=/tiktok/search/hashtag
```

Use `service` somente com uma imagem/fork cuja API real exponha essas rotas.
No modo direto, `TIKTOK_COOKIE` é opcional no contrato, mas pode ser necessário
na prática por região/bloqueios. Nunca o envie ao browser nem aos logs.

### scrape.do opcional

```bash
SCRAPE_PROVIDER=scrapedo
SCRAPE_DO_TOKEN=...
SCRAPE_DO_SUPER=true
SCRAPE_DO_RENDER=true
SCRAPE_DO_GEO_CODE=br
SCRAPE_DO_DEVICE=mobile
```

O adapter chama `https://api.scrape.do/?token=...&url=...`, interpreta JSON
embutido/HTML do TikTok e expõe custo/páginas em `scrapeMeta` quando o header
upstream estiver disponível. O token nunca aparece na resposta.

### Apify rollback

```bash
SCRAPE_PROVIDER=apify
APIFY_API_TOKEN=...
APIFY_ACTOR_ID=clockworks/tiktok-scraper
```

O rollback usa a API REST da Apify sem tornar `apify-client` uma dependência do
modo self/scrape.do. Para reduzir custo, o actor sempre recebe
`shouldDownloadVideos: false`; mídia continua no DouK.

### Override administrativo opcional

Por padrão, somente a env escolhe o provider. Para testes administrativos:

```bash
ALLOW_PROVIDER_OVERRIDE=true
```

Então `/run` aceita `x-scrape-provider: self|scrapedo|apify`. Sem a flag, o
header é rejeitado. Tokens nunca são aceitos por header ou query string.

Fallback automático também fica desligado por padrão:

```bash
FALLBACK_SCRAPE_PROVIDER=self
```

Quando usado, a resposta inclui um warning; não há troca silenciosa de motor.

## API

### `POST /run`

```bash
curl -X POST http://localhost:3000/run \
  -H 'Content-Type: application/json' \
  -d '{
    "keyword": "receita fitness",
    "max": 20,
    "sort": "playCount",
    "minViews": 1000,
    "onlyBrazil": true,
    "format": "json"
  }'
```

Hashtags:

```json
{
  "hashtags": ["achadinhos", "fyp"],
  "max": 20,
  "sort": "diggCount"
}
```

Resposta de sucesso (campos novos são opcionais e non-breaking):

```json
{
  "ok": true,
  "total": 20,
  "top": [],
  "source": "search",
  "brRemoved": 3,
  "provider": "scrapedo",
  "scrapeMeta": { "creditsUsed": 25, "pagesFetched": 1 }
}
```

Com `onlyBrazil=true`, hashtags usam search por padrão (`brUseSearch=true`), o
backend sobre-amostra antes de filtrar e só depois aplica `minViews`, tiers,
ranking e corte `max`. `proxyLocalized` é considerado apenas para busca
scrape.do geo BR e Apify proxy BR; self usa a heurística estrita.

Se `SERVICE_API_KEY` estiver definida, envie `x-api-key` ou
`Authorization: Bearer ...`.

### `POST /download-media`

Também disponível em `/api/download-media`:

```bash
curl -X POST http://localhost:3000/api/download-media \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.tiktok.com/@creator/video/7123456789012345678",
    "filename": "trend.mp4"
  }' -o trend.mp4
```

O BFF chama `POST /tiktok/detail` com `detail_id`, valida a URL CDN devolvida e
faz stream do arquivo. `MEDIA_PROVIDER=off` responde com `fallbackUrl`.

### `GET /health`

Expõe provider ativo e estados separados:

```json
{
  "ok": true,
  "ready": true,
  "scrapeProvider": "self",
  "mediaProvider": "douk",
  "scrape": { "provider": "self", "configured": true, "ok": true },
  "media": { "provider": "douk", "configured": true, "ok": true }
}
```

O health de scrape.do/Apify apenas verifica configuração para não consumir
créditos. Self/DouK fazem probes baratos.

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

- UI: `http://localhost:3001`
- BFF: `http://localhost:3000`
- DouK: somente rede interna em `:5555`, sem publish público

Defina `DOUK_IMAGE` com uma imagem validada e depois fixe por digest. Cookies e
configuração DouK vivem no volume `douk_data`; segredos do BFF ficam na env.

Em deploy `scrapedo + MEDIA_PROVIDER=off`, o serviço DouK pode ser removido do
Compose customizado. O arquivo padrão o mantém porque o modo recomendado é
`self + douk`.

## Deploy no Render (Docker)

Este repositório tem dois processos públicos: o BFF Express e a interface
Next.js. O `Dockerfile` da raiz inicia somente o BFF; ele não serve a página
da UI. Para criar os dois serviços no Render, use o Blueprint
[`render.yaml`](./render.yaml) em **New > Blueprint**.

Se preferir configurar pelo dashboard, crie dois Web Services Docker:

| Serviço | Root Directory | Dockerfile | Health check |
| --- | --- | --- | --- |
| BFF | (raiz do repositório) | `Dockerfile` | `/health` |
| UI | `web` | `Dockerfile` | `/` |

No serviço da UI, defina `BFF_URL` com a URL pública do serviço BFF e, se
`SERVICE_API_KEY` estiver configurada, use o mesmo valor em `BFF_API_KEY`.
O Render injeta `PORT` automaticamente; o `web/Dockerfile` usa esse valor e
mantém `3001` apenas como fallback local para o Docker Compose.

A URL do serviço BFF não é a página da aplicação: `GET /` retorna
`{"ok":false,"error":"not_found"}` por design. Abra a URL do serviço
`tiktok-scrapperv2-web` para acessar a interface.

## Frontend

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

O browser fala apenas com Route Handlers `/api/*`. `BFF_URL` e `BFF_API_KEY`
ficam no servidor Next.js. A UI mostra o motor ativo como badge read-only,
continua exportando CSV e sempre envia `post.url` para o download.

## Desenvolvimento e verificação

```bash
npm test
npm run build

cd web
npm run typecheck
npm run build
```

O parser scrape.do é testado com fixtures locais; CI não consome créditos. O
smoke do provider configurado pode ser executado com:

```bash
SMOKE_KEYWORD='receita fitness' SMOKE_MAX=5 npm run smoke
```

## Erros operacionais principais

| Código | Significado |
| --- | --- |
| `scrape_upstream_unavailable` | serviço local/TikTok indisponível |
| `self_scrape_endpoint_missing` | modo `service` aponta para rota ausente |
| `scrapedo_token_missing` | provider scrape.do sem token |
| `scrapedo_auth_failed` | token scrape.do recusado |
| `parse_failed` | página retornada sem itens reconhecíveis |
| `apify_token_missing` | rollback Apify sem token |
| `media_cookie_expired` / `media_access_denied` | renovar cookie de mídia |

Veja também [`docs/providers.md`](./docs/providers.md) e
[`docs/douk-runbook.md`](./docs/douk-runbook.md).

## Referências verificadas

- scrape.do: documentação oficial consultada via Context7 (API, `super`,
  `geoCode`, `device` e renderização)
- Express 5 e Next.js App Router: documentação atual via Context7
- `luinog1/tiktok_scrapper_max`: mapper, filtro BR e input do actor conferidos
  via GitHub MCP
- `JoeanAmier/TikTokDownloader`: rotas reais de `main_server.py` conferidas via
  GitHub MCP

Respeite os Termos do TikTok, direitos autorais, privacidade e licenças dos
serviços de terceiros. DouK é GPL-3.0 e permanece um processo separado.
