# Runbook DouK

O DouK-Downloader roda como container separado e só é acessado pelo BFF. Ele é
o provider de mídia em todos os modos de scrape.

## Primeira configuração

1. Suba o serviço e abra `/docs` somente numa rede administrativa.
2. Confirme o endpoint TikTok da imagem pinada. O adapter usa
   `/tiktok/detail` por padrão; altere `MEDIA_DOWNLOAD_ENDPOINT` se necessário.
3. Configure o token da API em `MEDIA_API_TOKEN`.
4. Grave o Cookie TikTok no volume `douk_data` conforme a documentação da
   release instalada.
5. Teste dez URLs reais e só então fixe `DOUK_IMAGE` por digest.

O upstream atual não expõe uma rota oficial de busca TikTok. Não confunda
`/tiktok/detail` (detalhe/download por ID conhecido) com discovery por keyword.
Para scrape self, veja [`providers.md`](./providers.md).

## Falhas comuns

| Erro BFF | Ação |
| --- | --- |
| `media_auth_failed` | conferir `MEDIA_API_TOKEN` e configuração do DouK |
| `media_url_missing` | comparar o response real com `/docs`; ajustar endpoint/build |
| `media_access_denied` | renovar Cookie, refazer a busca ou verificar bloqueio regional |
| `media_timeout` | verificar saúde, proxy e limites do container |
| `media_too_large` | aumentar `MEDIA_MAX_BYTES` somente após avaliar o risco |

Mantenha concorrência baixa, faça limpeza de ficheiros temporários e configure
um canary diário com conteúdo autorizado. Em incidente, use
`MEDIA_PROVIDER=off`; a UI deve abrir o `post.url` como fallback.
