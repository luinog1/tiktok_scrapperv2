# Gumloop (adapter legado)

Gumloop está fora do caminho final multi-provider. Nenhuma variável
`GUMLOOP_*` é necessária para `self`, `scrapedo` ou `apify`, e a UI não depende
de agente, polling ou credenciais Gumloop.

Os módulos em `src/gumloop/` e o nome `SCRAPE_PROVIDER=gumloop` permanecem
temporariamente para não quebrar integrações/testes anteriores durante a
migração. Novos deployments não devem configurá-los.

Use o smoke genérico para o provider definido na env:

```bash
SMOKE_KEYWORD='receita fitness' SMOKE_MAX=5 npm run smoke
```

O adapter legado pode ser removido numa release major depois de confirmar que
nenhum consumidor ainda seleciona `gumloop`.
