# Plano final — Multi-provider: self-hosted + scrape.do opcional

> **Status neste workspace (2026-07-24):** arquitetura aplicada. O texto
> abaixo é o plano de origem; README e `docs/providers.md` descrevem as
> decisões finais e a limitação verificada de search no DouK upstream.

**Repos:** [`luinog1/tiktok_scrapper_max`](https://github.com/luinog1/tiktok_scrapper_max) + [`luinog1/TIKTOK-EXTRACTOR`](https://github.com/luinog1/TIKTOK-EXTRACTOR)  
**Objetivo:** uma versão final da app que funciona **com ou sem** API de scraping paga:

| Modo | `SCRAPE_PROVIDER` | Precisa token externo? | Uso típico |
|------|-------------------|------------------------|------------|
| **Self-hosted** ★ default | `self` | **Não** (só DouK local + cookie) | Dev, low cost, air-gapped-ish |
| **scrape.do** opcional | `scrapedo` | **Sim** — `SCRAPE_DO_TOKEN` | Prod com geo BR + menos ops de encrypt |
| **Apify** rollback | `apify` | `APIFY_API_TOKEN` | Legado / emergência |

**Fora do path final (não obrigatório):** API Gumloop (`start_agent` / tools `tiktok__*`).  
**Download MP4:** sempre **DouK** on-demand por `post.url` (independente do scrape provider).  
**Escopo original:** plano de arquitetura e migração. A implementação deste
workspace já aplica as fases de abstração, self, scrape.do, Apify rollback,
media DouK, frontend e documentação operacional; spikes reais com credenciais
continuam sendo uma etapa de deploy/cutover.  
**Data:** 2026-07-22 (rev. 6 — multi-provider S + D)

---

## 1. Resposta direta

| Pergunta | Resposta |
|----------|----------|
| Dá para ter **ambos** self-hosted e scrape.do? | **Sim** |
| scrape.do como **opcional** na versão final? | **Sim** — flag/env, não hard dependency |
| Funciona **sem** Gumloop API? | **Sim** — Gumloop não entra no desenho final |
| Funciona **sem** scrape.do? | **Sim** — `SCRAPE_PROVIDER=self` |
| Funciona **sem** Apify? | **Sim** — default |
| Mesma UI / mesmo contrato? | **Sim** — só muda o provider por baixo do `/run` |

### Princípio

```
UI e pipeline de domínio (BR, tiers, rank, export) = SEMPRE iguais
Scrape = plug-in (self | scrapedo | apify)
Media  = plug-in (douk | off)  — default douk
```

Nenhum provider de scrape é compile-time obrigatório. Falta token scrape.do → modo `self` continua a arrancar.

---

## 2. Arquitetura final

```
┌──────────────────────────────────────────────────────────────┐
│  TIKTOK-EXTRACTOR (Next.js)                                  │
│  • UI única                                                  │
│  • POST /api/run  → BFF                                      │
│  • download-media → BFF (post.url)                           │
│  • SEM tokens Apify / scrape.do / Gumloop no browser         │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│  BFF  tiktok_scrapper_max (ou routes Next)                   │
│                                                              │
│  POST /run                                                   │
│    → factory.getScrapeProvider(env.SCRAPE_PROVIDER)          │
│    → raw[]                                                   │
│    → map → brazil → minViews → tiers → rank → top            │
│    → RunResponse                                             │
│                                                              │
│  download → MediaProvider (DouK)                             │
│  /health  → bff + provider configurado + media               │
└────────┬─────────────────────────────┬───────────────────────┘
         │                             │
    SCRAPE_PROVIDER               MEDIA_PROVIDER
         │                             │
    ┌────┴────┐                   ┌────┴────┐
    ▼         ▼                   ▼         ▼
  self     scrapedo              douk       off
  DouK     api.scrape.do         :5555    link web
  local    (token opcional)
    │
    └─ apify (opcional rollback)
```

### Interface (contrato interno estável)

```ts
// src/providers/types.ts
export type ScrapeProviderName = "self" | "scrapedo" | "apify"

export interface ScrapeOpts {
  max: number
  onlyBrazil?: boolean
  downloadVideos?: boolean // ignorado na maioria; media é DouK
  // overrides opcionais
  geoCode?: string
  render?: boolean
  superProxy?: boolean
}

export interface ScrapeProvider {
  readonly name: ScrapeProviderName
  search(queries: string[], opts: ScrapeOpts): Promise<unknown[]>
  hashtags(tags: string[], opts: ScrapeOpts): Promise<unknown[]>
  /** health barato — não gastar 25 créditos TikTok */
  health?(): Promise<{ ok: boolean; detail?: string }>
}

export interface MediaProvider {
  readonly name: "douk" | "off"
  download(webUrl: string): Promise<NodeJS.ReadableStream>
  health?(): Promise<{ ok: boolean }>
}
```

```ts
// src/providers/factory.ts
export function getScrapeProvider(): ScrapeProvider {
  switch (process.env.SCRAPE_PROVIDER ?? "self") {
    case "scrapedo":
      if (!process.env.SCRAPE_DO_TOKEN) {
        throw new Error("SCRAPE_PROVIDER=scrapedo requires SCRAPE_DO_TOKEN")
      }
      return new ScrapeDoProvider()
    case "apify":
      return new ApifyProvider()
    case "self":
    default:
      return new SelfHostedProvider()
  }
}
```

**Boot:** se `SCRAPE_PROVIDER=self`, **não** validar `SCRAPE_DO_TOKEN`.  
Se `scrapedo` sem token → fail fast no `/run` (ou no boot) com mensagem clara.

---

## 3. Comportamento por provider

| Aspeto | `self` | `scrapedo` | `apify` (legado) |
|--------|--------|------------|------------------|
| Deps runtime | DouK Docker + cookie | HTTPS api.scrape.do | apify-client + token |
| Search/hashtag | API Web DouK (validar spike) | URL TikTok + parse HTML/JSON | actor clockworks |
| Geo BR | heurística `brazil.ts` only | `geoCode=br` + `super` + filtro | `proxyCountryCode` |
| `proxyLocalized` no filtro | `false` | `true` se search+geo br (após spike) | `true` se search+proxy BR |
| Custo variável | VPS | créditos scrape.do | créditos Apify |
| Parse frágil | shape DouK | DOM/JSON página TikTok | baixo (dataset actor) |
| Quando usar | default, dev, zero API | prod geo+estabilidade fetch | rollback |

### Download (comum)

| `MEDIA_PROVIDER` | Comportamento |
|------------------|---------------|
| `douk` ★ | on-demand `post.url` → DouK |
| `off` | UI só link tiktok.com |

Scrape provider **não** baixa MP4 no `/run`.

---

## 4. Fluxo `/run` (único para todos)

```
1. Ler SCRAPE_PROVIDER (default self)
2. Validar keyword | hashtags
3. wantBrazil, fetchMax (oversample se BR)
4. provider = factory()
5. source:
     keyword            → provider.search
     BR + hashtags      → provider.search(terms)   // brUseSearch default true
     hashtags           → provider.hashtags
6. posts = raw.map(mapRawToTikTokPost)   // mapper tolerante multi-shape
7. if wantBrazil → filterBrazilianPosts(posts, { proxyLocalized })
8. minViews → classifyTier → rankPosts → slice top
9. return RunResponse + meta opcional:
     { provider: "self"|"scrapedo", creditsUsed?: number }
```

Campo extra opcional (non-breaking):

```ts
// RunResponse estendido (campos opcionais)
{
  ok: true,
  total, top, source, brRemoved?,
  provider?: "self" | "scrapedo" | "apify",
  scrapeMeta?: { creditsUsed?: number; pagesFetched?: number }
}
```

UI pode ignorar; útil para debug/admin.

---

## 5. Configuração e `.env`

### 5.1 Mínimo — só self (zero API scraping paga)

```bash
SCRAPE_PROVIDER=self
SCRAPE_SERVICE_URL=http://tiktok-dl:5555
# SCRAPE_API_TOKEN=...   # se DouK exigir token interno

MEDIA_PROVIDER=douk
MEDIA_SERVICE_URL=http://tiktok-dl:5555
MEDIA_API_TOKEN=...

SERVICE_API_KEY=...
CORS_ORIGINS=...
PORT=3000
```

### 5.2 Ativar scrape.do (opcional)

```bash
SCRAPE_PROVIDER=scrapedo
SCRAPE_DO_TOKEN=...
SCRAPE_DO_SUPER=true
SCRAPE_DO_RENDER=true
SCRAPE_DO_GEO_CODE=br
SCRAPE_DO_DEVICE=mobile
# media igual
MEDIA_PROVIDER=douk
MEDIA_SERVICE_URL=http://tiktok-dl:5555
MEDIA_API_TOKEN=...
```

### 5.3 Runtime switch (sem redeploy de código)

| Mecanismo | Uso |
|-----------|-----|
| Env `SCRAPE_PROVIDER` | default do deploy |
| Header opcional `x-scrape-provider: scrapedo\|self` | **só admin/dev**, se `ALLOW_PROVIDER_OVERRIDE=true` |
| Nunca | query string pública com token |

Recomendação prod: **só env**. Override header desligado por default.

### 5.4 O que NÃO é obrigatório na versão final

| Var | Obrigatória? |
|-----|----------------|
| `SCRAPE_DO_TOKEN` | Só se `scrapedo` |
| `APIFY_API_TOKEN` | Só se `apify` |
| `GUMLOOP_*` | **Não** — fora do desenho final |
| Cookie TikTok | Ops DouK (volume), para `self` scrape e/ou media |

### 5.5 Matriz “arranca se…”

| Config | BFF sobe? | `/run` funciona? |
|--------|-----------|------------------|
| self + DouK up + cookie | sim | sim (se DouK search OK no spike) |
| self + DouK down | sim | `/run` 502 scrape; download 502 |
| scrapedo + token + DouK media | sim | scrape via API; download DouK |
| scrapedo sem token | prefer fail boot ou `/run` 500 claro | não |
| só scrapedo, media=off | sim | scrape sim; sem MP4 |
| sem Gumloop | sim | sim |

---

## 6. Módulos no monorepo backend

```
src/
  providers/
    types.ts
    factory.ts
    self/
      client.ts          # HTTP → DouK Web API
      index.ts           # SelfHostedProvider
    scrapedo/
      client.ts          # GET api.scrape.do
      urls.ts            # search/tag URL builders
      parsePage.ts       # HTML → raw items ★
      index.ts           # ScrapeDoProvider
    apify/               # extrair do código atual
      client.ts
      index.ts
  media/
    doukClient.ts
    factory.ts
  mapper/postMapper.ts   # multi-shape (Apify + DouK + parse scrape.do)
  filter/brazil.ts
  ranker/
  server.ts
```

### Dependências npm

| Package | self | scrapedo | apify |
|---------|------|----------|-------|
| `apify-client` | optional peer / dynamic import | não | sim |
| fetch/axios nativo | sim | sim | sim |

Ideal: **não** carregar `apify-client` se provider ≠ apify (import dinâmico) para installs leves.

---

## 7. Frontend

| Item | Comportamento final |
|------|---------------------|
| Token Apify na UI | **Removido** |
| Token scrape.do na UI | **Nunca** |
| Escolha de provider | Opcional: badge read-only “motor: self/scrapedo” via `/health` |
| onlyBrazil | igual; backend aplica geo se scrapedo |
| Download | `post.url` → media; se media down, link web |
| Contrato | `RunRequest`/`RunResponse` estável |

`/api/health` agregado pode devolver:

```json
{
  "ok": true,
  "scrapeProvider": "self",
  "mediaProvider": "douk",
  "scrape": { "ok": true },
  "media": { "ok": true }
}
```

---

## 8. Docker Compose (suporta ambos)

```yaml
services:
  bff:
    build: ./tiktok_scrapper_max
    env_file: .env
    environment:
      SCRAPE_PROVIDER: ${SCRAPE_PROVIDER:-self}
      SCRAPE_SERVICE_URL: http://tiktok-dl:5555
      MEDIA_SERVICE_URL: http://tiktok-dl:5555
    depends_on: [tiktok-dl]
    ports: ["3000:3000"]

  tiktok-dl:
    image: joeanamier/tiktok-downloader@sha256:<PIN>
    volumes: [douk_data:/app/Volume]
    # sem publish público da 5555

volumes:
  douk_data:
```

- Modo **self**: precisa `tiktok-dl` saudável para scrape **e** media.  
- Modo **scrapedo**: `tiktok-dl` ainda recomendado para **media**; scrape não depende dele.  
  → Podem escalar: deploy “scrapedo-only + media off” sem DouK, se quiserem.

---

## 9. Spike e critérios Go/No-go por provider

### Fase 1a — `self` (obrigatório para default)

- [ ] DouK search keyword → items com métricas  
- [ ] DouK hashtag → items  
- [ ] DouK download 10 URLs  
- [ ] Se search DouK **falhar**: default pode passar a `scrapedo` **ou** S2 (scrape outro + DouK media only)

### Fase 1b — `scrapedo` (obrigatório para opcional prod)

- [ ] search + tag com `super+render+geoCode=br`  
- [ ] `parsePage` estável + fixtures CI  
- [ ] custo real `Scrape.do-Request-Cost`  
- [ ] items suficientes vs `max`

### Decisão de default pós-spike

| Resultado | Default `SCRAPE_PROVIDER` |
|-----------|---------------------------|
| DouK search OK | `self` |
| DouK search fraco, scrape.do OK | `scrapedo` em prod; `self` só media/dev |
| Ambos OK | `self` default; doc para ligar scrapedo |
| Ambos fracos search | manter apify temporário ou outro motor |

**Versão final desejada pelo pedido:** código suporta **os dois**; default preferencial `self` se spike OK, senão default prod `scrapedo` com self como fallback documentado.

---

## 10. Fases de implementação (multi-provider)

### Fase 0 — (0.5 d)

- [ ] Aceitar multi-provider como arquitetura final  
- [ ] Conta scrape.do opcional (free credits para spike)  
- [ ] Host Docker DouK  
- [ ] Sem Gumloop no critical path  

### Fase 1 — Spikes paralelos (1–2 d)

- [ ] 1a self + 1b scrapedo (secção 9)  
- [ ] Fixtures dos dois parsers/shapes  
- [ ] Escolher default env de prod  

### Fase 2 — Abstração + self (2 d)

- [ ] `ScrapeProvider` + `SelfHostedProvider`  
- [ ] Pipeline único `/run`  
- [ ] `MediaProvider` DouK  
- [ ] Testes unitários pipeline com mocks  

**Exit:** app completa em `self` **ou** media+pipeline com scrape mock.

### Fase 3 — scrape.do opcional (1–2 d)

- [ ] `ScrapeDoProvider` + `parsePage`  
- [ ] Env gates; factory  
- [ ] `scrapeMeta.creditsUsed`  
- [ ] Testes parse com fixtures (0 créditos CI)  
- [ ] Doc: “como ligar scrapedo”  

**Exit:** flip `SCRAPE_PROVIDER=scrapedo` sem mudar frontend.

### Fase 4 — Apify adapter legado (0.5–1 d, opcional)

- [ ] Envolver código atual em `ApifyProvider`  
- [ ] Import dinâmico  
- [ ] Flag rollback  

### Fase 5 — Frontend + polish (1 d)

- [ ] Remover tokens UI  
- [ ] Health badge provider  
- [ ] Copy BR  
- [ ] Download states  

### Fase 6 — Hardening + cutover (1–2 d)

- [ ] Cache por provider+query  
- [ ] Circuit breaker créditos scrapedo  
- [ ] Fallback opcional: se scrapedo falhar X vezes → log; **não** fallback auto para self sem config (`FALLBACK_SCRAPE_PROVIDER=self` explícito)  
- [ ] Canary  
- [ ] README multi-mode  

**Fallback automático (opcional, off by default):**

```bash
FALLBACK_SCRAPE_PROVIDER=self   # só se quiserem degradar scrapedo→self
```

Evitar fallback silencioso que muda qualidade BR sem o user saber.

---

## 11. Fallback e erros

| Situação | HTTP | Body |
|----------|------|------|
| self DouK down | 502 | `scrape_upstream_unavailable` |
| scrapedo 401 token | 500/502 | `scrapedo_auth_failed` |
| scrapedo parse vazio | 422/502 | `parse_failed` |
| provider desconhecido | 500 | `invalid_scrape_provider` |
| scrapedo sem token | 500 | `scrapedo_token_missing` |
| media cookie expired | 503 | `media_cookie_expired` |

---

## 12. Riscos multi-provider

| Risco | Mitigação |
|-------|-----------|
| Dois parsers para manter | fixtures CI; interface única; feature flags |
| Default self frágil em prod | spike; ou default scrapedo + self dev |
| Custos scrapedo esquecidos | `scrapeMeta`, budget, cache |
| Mapper diverge por provider | um `postMapper` + adapters finos no provider |
| Complexidade scope creep | Fase 2 self first, Fase 3 scrapedo |
| Fallback auto confuso | off by default; documentar |

---

## 13. Definition of Done (versão final multi)

- [ ] `SCRAPE_PROVIDER=self` completa busca+rank+export **sem** `SCRAPE_DO_TOKEN` e **sem** Apify e **sem** Gumloop  
- [ ] `SCRAPE_PROVIDER=scrapedo` completa o mesmo **com** token, sem mudar UI  
- [ ] Flip só por env (redeploy config)  
- [ ] Download DouK independente do scrape provider  
- [ ] CI: testes pipeline + parse fixtures scrapedo + mock self  
- [ ] README: tabela modos + env  
- [ ] `/health` expõe provider ativo  
- [ ] Tokens só server-side  

---

## 14. Estimativa

| Fase | Dias |
|------|------|
| 0 | 0.5 |
| 1 spikes | 1–2 |
| 2 self + pipeline + media | 2–3 |
| 3 scrapedo opcional | 1–2 |
| 4 apify wrap (opc.) | 0.5–1 |
| 5 frontend | 1 |
| 6 harden/cutover | 1–2 |
| **Total** | **~7–13 dias úteis** |

(Se self search falhar no spike, Fase 2 encolhe para “pipeline + media” e Fase 3 vira path principal — wall clock similar.)

---

## 15. Comparativo rápido

| | Self only | scrape.do only | **Multi (este plano)** ★ |
|--|-----------|----------------|---------------------------|
| Zero API scrape | sim | não | **sim (modo self)** |
| Geo BR proxy | não | sim | **sim (modo scrapedo)** |
| Uma codebase | sim | sim | **sim** |
| Ops | alta | média | média (DouK sempre se media on) |
| Flexibilidade | baixa | média | **alta** |

---

## 16. Gumloop

**Não** faz parte da versão final multi-provider.

| Uso Gumloop | Status |
|-------------|--------|
| Critical path `/run` | **Não** |
| Chat/ops interno | Opcional, fora deste plano |
| Anexo histórico A | só referência |

---

## 17. Próximos passos

1. Spike **self** e **scrapedo** em paralelo (Fase 1).  
2. Implementar **factory + self + DouK media** até app usável sem APIs pagas.  
3. Ligar **ScrapeDoProvider** atrás da mesma interface.  
4. Documentar flip de env; default conforme resultado do spike.  
5. (Opcional) encapsular Apify como terceiro provider.

---

## 18. Referências

| Item | Valor |
|------|--------|
| scrape.do docs | https://scrape.do/documentation/ |
| scrape.do costs | https://scrape.do/documentation/request-costs/ |
| DouK | https://github.com/JoeanAmier/TikTokDownloader |
| Backend | https://github.com/luinog1/tiktok_scrapper_max |
| Frontend | https://github.com/luinog1/TIKTOK-EXTRACTOR |
| Default alvo | `SCRAPE_PROVIDER=self` com `scrapedo` opcional |
| Media | `MEDIA_PROVIDER=douk` |
| Env chave opcional | `SCRAPE_DO_TOKEN` |

---

# Anexos (resumo)

| Anexo | Conteúdo |
|-------|----------|
| S | Self-hosted detalhe (rev. 4) — implementado como provider `self` |
| D | scrape.do detalhe (rev. 5) — provider `scrapedo` |
| A | Gumloop API — **fora** do final |
| C | Apify — provider `apify` rollback |

---

# Histórico

| Rev | Data | Nota |
|-----|------|------|
| 1–3 | 2026-07-21/22 | Gumloop A + DouK + API agentes |
| 4 | 2026-07-22 | Opção S self-hosted |
| 5 | 2026-07-22 | Opção D scrape.do |
| 6 | 2026-07-22 | **Multi-provider final: self + scrapedo opcional; sem Gumloop obrigatório** |

---

*Documento de análise original. A implementação correspondente neste workspace
está descrita no README e em `docs/providers.md`.*
