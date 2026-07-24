# Operação dos providers

## Matriz rápida

| Provider | Configuração mínima | Health | Geo BR |
| --- | --- | --- | --- |
| `self` | `SCRAPE_SERVICE_URL` ou fetch direto | probe local/direto configurado | heurística local |
| `scrapedo` | `SCRAPE_DO_TOKEN` | valida configuração, sem gastar crédito | `geoCode=br` + filtro |
| `apify` | `APIFY_API_TOKEN` | valida configuração | proxy BR + filtro |

## Self-hosted

O provider self aceita três estratégias:

1. `SELF_SCRAPE_MODE=service`: chama por POST os endpoints configurados com um
   body tolerante (`keyword/query`, `hashtag/tag`, `max/count/limit`).
2. `SELF_SCRAPE_MODE=direct`: lê as páginas públicas de search/tag e interpreta
   os estados JSON embutidos.
3. `SELF_SCRAPE_MODE=auto`: tenta service e usa direct se a rota não existe ou
   devolve uma lista vazia.

O DouK stock atual não documenta search TikTok. Use `service` apenas depois de
validar o OpenAPI do fork/imagem instalada. Em direct, configure cookie/proxy
conforme necessário e monitore `scrape_upstream_unavailable`.

## scrape.do

Parâmetros enviados:

- `token`
- `url`
- `super=true` quando configurado
- `render=true` quando configurado
- `geoCode=br` por default
- `device=mobile` por default

O parser reconhece respostas JSON, `SIGI_STATE`,
`__UNIVERSAL_DATA_FOR_REHYDRATION__`, `__NEXT_DATA__`, JSON-LD e links
canônicos de vídeo. Atualize as fixtures antes de alterar o parser.

## Apify

O rollback envia o schema do actor `clockworks/tiktok-scraper`:

- keyword: `searchQueries`, `searchSection: ""`, `resultsPerPage`
- hashtag: `hashtags`, `resultsPerPage`
- BR: `proxyCountryCode: "BR"`, `scrapeAdditionalAuthorMeta: true`
- mídia: `shouldDownloadVideos: false`

O client usa REST diretamente e busca o dataset depois do run. Isso evita uma
dependência obrigatória de `apify-client` nos demais modos.

## Fallback

`FALLBACK_SCRAPE_PROVIDER` é opt-in. Quando o provider primário falha, a
resposta inclui `scrape_fallback_<origem>_to_<destino>` em `warnings`. Nunca
ative fallback sem aceitar explicitamente a diferença de qualidade/geo.

## Checklist de cutover

- Execute busca keyword e hashtag com 10 termos representativos.
- Confirme `top[]`, métricas, `provider` e `scrapeMeta`.
- Valide `onlyBrazil=true` antes e depois de `minViews`.
- Confirme que logs/respostas não contêm token ou cookie.
- Teste mídia separadamente com dez URLs autorizadas.
- Fixe a imagem DouK por digest somente depois do teste do OpenAPI real.
