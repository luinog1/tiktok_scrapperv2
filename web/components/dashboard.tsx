'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  csvFromPosts,
  formatCompact,
  formatPercent,
  parseHashtags,
  SORT_OPTIONS,
  type HealthResponse,
  type RunRequest,
  type RunResponse,
  type SortField,
  type TikTokPost,
} from '../lib/tiktok';
import { Icon } from './icon';
import { PostCard } from './post-card';

type SearchMode = 'keyword' | 'hashtags';
type HealthState = 'checking' | 'online' | 'degraded' | 'offline';

const QUICK_QUERIES = ['receitas rápidas', 'achadinhos', 'beleza acessível', 'treino em casa'];

const INITIAL_HEALTH: HealthResponse = {
  ok: false,
  ready: false,
  service: 'tiktok-multiprovider-bff',
};

function providerLabel(value: string | undefined): string {
  if (value === 'scrapedo') return 'scrape.do';
  if (value === 'self') return 'self-hosted';
  if (value === 'apify') return 'Apify';
  if (value === 'mock') return 'mock';
  return value || 'indefinido';
}

function isRunSuccess(response: RunResponse | null): response is Extract<RunResponse, { ok: true }> {
  return Boolean(response?.ok);
}

function friendlyError(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Não foi possível concluir a busca.';
  const record = value as Record<string, unknown>;
  const error = typeof record.error === 'string' ? record.error : '';
  const details = record.details;
  if (error === 'bff_unreachable') return 'O motor está indisponível no momento. Confira se o BFF está rodando.';
  if (error === 'unauthorized') return 'A conexão do servidor recusou a chave de acesso.';
  if (error === 'invalid_request') return 'Revise os termos e os filtros da busca.';
  if (error === 'media_disabled') return 'O download de mídia está desligado nesta instalação.';
  if (error === 'too_many_active_runs') return 'Já existe uma extração em andamento. Tente novamente em instantes.';
  if (error === 'self_scrape_upstream_unavailable' || error === 'scrape_upstream_unavailable') return 'O motor self-hosted não respondeu. Confira o serviço local e o cookie TikTok.';
  if (error === 'self_scrape_access_denied') return 'O TikTok recusou o acesso self-hosted. Renove o cookie ou confira o proxy.';
  if (error === 'self_scrape_timeout') return 'O motor self-hosted excedeu o tempo limite.';
  if (error === 'scrapedo_token_missing') return 'O modo scrape.do está ativo, mas o token não foi configurado no servidor.';
  if (error === 'scrapedo_auth_failed') return 'O scrape.do recusou o token configurado no servidor.';
  if (error === 'scrapedo_rate_limited') return 'O scrape.do atingiu o limite de requisições. Tente novamente em instantes.';
  if (error === 'scrapedo_network_error' || error === 'scrapedo_upstream_error') return 'O scrape.do está indisponível no momento.';
  if (error === 'apify_token_missing') return 'O rollback Apify está ativo, mas o token não foi configurado.';
  if (error === 'apify_run_failed' || error === 'apify_timeout') return 'A execução de rollback no Apify não terminou corretamente.';
  if (error === 'parse_failed') return 'A página do TikTok mudou de formato e não pôde ser interpretada.';
  if (error === 'media_cookie_expired' || error === 'media_access_denied') return 'A mídia ficou indisponível; renove o cookie do serviço DouK ou abra o link original.';
  if (error === 'media_auth_failed') return 'O serviço DouK recusou a credencial de mídia configurada.';
  if (error === 'provider_override_disabled') return 'A troca manual de provider está desativada nesta instalação.';
  if (error === 'invalid_agent_response') return 'O agente retornou um formato inesperado. Tente novamente.';
  if (details && Array.isArray(details)) {
    const first = details[0];
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).message === 'string') {
      return String((first as Record<string, unknown>).message);
    }
  }
  return error ? `A busca não terminou: ${error.replaceAll('_', ' ')}.` : 'Não foi possível concluir a busca.';
}

async function parseResponse(response: Response): Promise<RunResponse> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: response.ok ? 'invalid_response' : `http_${response.status}`, retryable: response.status >= 500 };
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) return payload as RunResponse;
  return { ok: false, error: response.ok ? 'invalid_response' : `http_${response.status}`, details: payload, retryable: response.status >= 500 };
}

function extractFilename(header: string | null, fallback: string): string {
  if (header) {
    const utf = header.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
    if (utf) {
      try { return decodeURIComponent(utf); } catch { /* use plain filename below */ }
    }
    const plain = header.match(/filename="?([^";]+)"?/iu)?.[1];
    if (plain) return plain;
  }
  return fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function averageEngagement(posts: TikTokPost[]): number {
  if (!posts.length) return 0;
  return posts.reduce((sum, post) => sum + (Number(post.engagementRate) || 0), 0) / posts.length;
}

export function Dashboard() {
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [keyword, setKeyword] = useState('');
  const [hashtagsInput, setHashtagsInput] = useState('');
  const [max, setMax] = useState('20');
  const [sort, setSort] = useState<SortField>('playCount');
  const [minViews, setMinViews] = useState('0');
  const [onlyBrazil, setOnlyBrazil] = useState(true);
  const [includeMediaLinks, setIncludeMediaLinks] = useState(true);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [health, setHealth] = useState<HealthResponse>(INITIAL_HEALTH);
  const [healthState, setHealthState] = useState<HealthState>('checking');
  const [downloadingId, setDownloadingId] = useState('');
  const [copiedUrl, setCopiedUrl] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3_500);
  }, []);

  const refreshHealth = useCallback(async () => {
    setHealthState('checking');
    try {
      const result = await fetch('/api/health', { cache: 'no-store' });
      const payload = await result.json() as HealthResponse;
      setHealth(payload);
      setHealthState(result.ok && payload.ok ? (payload.ready ? 'online' : 'degraded') : 'offline');
    } catch {
      setHealth(INITIAL_HEALTH);
      setHealthState('offline');
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    return () => {
      abortRef.current?.abort();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [refreshHealth]);

  const posts = isRunSuccess(response) ? response.top : [];
  const avgRate = useMemo(() => averageEngagement(posts), [posts]);
  const totalViews = useMemo(() => posts.reduce((sum, post) => sum + (Number(post.metrics?.playCount) || 0), 0), [posts]);
  const hasQuery = mode === 'keyword' ? Boolean(keyword.trim()) : parseHashtags(hashtagsInput).length > 0;

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (loading) return;
    const tags = parseHashtags(hashtagsInput);
    if (mode === 'keyword' && !keyword.trim()) {
      setError('Digite uma keyword para começar.');
      return;
    }
    if (mode === 'hashtags' && !tags.length) {
      setError('Adicione pelo menos uma hashtag.');
      return;
    }

    const request: RunRequest = {
      ...(mode === 'keyword' ? { keyword: keyword.trim() } : { hashtags: tags }),
      max: Math.min(50, Math.max(1, Number(max) || 20)),
      sort,
      minViews: Math.max(0, Number(minViews) || 0),
      format: 'json',
      onlyBrazil,
      brUseSearch: true,
      includeMediaLinks,
    };

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setResponse(null);
    try {
      const result = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const payload = await parseResponse(result);
      if (!result.ok || !payload.ok) {
        setResponse(payload);
        setError(friendlyError(payload));
      } else {
        setResponse(payload);
        if (payload.warnings?.length) showToast('Busca concluída com um aviso de qualidade.');
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') {
        showToast('Extração cancelada.');
      } else {
        setError('Não foi possível falar com o motor. Tente novamente.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const useQuickQuery = (query: string) => {
    setMode('keyword');
    setKeyword(query);
    setError('');
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      showToast('Link copiado para a área de transferência.');
      window.setTimeout(() => setCopiedUrl((current) => current === url ? '' : current), 1_600);
    } catch {
      showToast('Não consegui copiar o link neste navegador.');
    }
  };

  const downloadPost = async (post: TikTokPost) => {
    if (!post.url || downloadingId) return;
    setDownloadingId(post.id);
    try {
      const result = await fetch('/api/download-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: post.url, filename: `tiktok-${post.id || 'video'}.mp4` }),
      });
      if (!result.ok) {
        const payload = await parseResponse(result);
        throw new Error(friendlyError(payload));
      }
      const blob = await result.blob();
      const fallback = `tiktok-${post.id || 'video'}.mp4`;
      downloadBlob(blob, extractFilename(result.headers.get('content-disposition'), fallback));
      showToast('Download iniciado.');
    } catch (downloadError) {
      showToast(downloadError instanceof Error ? downloadError.message : 'Download indisponível agora.');
    } finally {
      setDownloadingId('');
    }
  };

  const exportCsv = () => {
    if (!posts.length) return;
    const content = isRunSuccess(response) && response.csv ? response.csv : csvFromPosts(posts);
    const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `tiktok-signals-${stamp}.csv`);
    showToast('CSV exportado.');
  };

  const healthLabel = healthState === 'online'
    ? 'Motor pronto'
    : healthState === 'degraded'
      ? 'Motor parcial'
      : healthState === 'checking'
        ? 'Verificando'
        : 'Motor offline';
  const activeProvider = providerLabel(
    (isRunSuccess(response) ? response.provider : undefined) || health.scrapeProvider || health.scrape?.provider,
  );
  const mediaEnabled = (health.mediaProvider || health.media?.provider) !== 'off';

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pulseboard início">
          <span className="brand-mark"><Icon name="activity" size={20} /></span>
          <span className="brand-word">pulse<span>board</span></span>
        </a>
        <div className="topbar__meta">
          <button type="button" className={`health-status health-status--${healthState}`} onClick={() => void refreshHealth()} title="Atualizar estado do motor">
            <span className="health-status__dot" />
            <span>{healthLabel}</span>
            <Icon name={healthState === 'checking' ? 'loader' : 'refresh'} size={14} />
          </button>
          <span className="topbar__version">motor: {activeProvider} <span>·</span> v0.2</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="panel-intro">
            <span className="eyebrow">Explorar sinais</span>
            <h1>Encontre o que está começando a subir.</h1>
            <p>Extraia conversas, filtre ruído e veja os posts que merecem uma segunda olhada.</p>
          </div>

          <form className="search-form" onSubmit={submit}>
            <div className="mode-switch" role="tablist" aria-label="Tipo de busca">
              <button type="button" role="tab" aria-selected={mode === 'keyword'} className={mode === 'keyword' ? 'is-active' : ''} onClick={() => setMode('keyword')}>
                <Icon name="search" size={15} /> Keyword
              </button>
              <button type="button" role="tab" aria-selected={mode === 'hashtags'} className={mode === 'hashtags' ? 'is-active' : ''} onClick={() => setMode('hashtags')}>
                <Icon name="hash" size={15} /> Hashtags
              </button>
            </div>

            <label className="field-label" htmlFor="query">{mode === 'keyword' ? 'Termo ou assunto' : 'Hashtags para rastrear'}</label>
            {mode === 'keyword' ? (
              <div className="input-wrap input-wrap--large">
                <Icon name="search" size={18} />
                <input id="query" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="ex.: organização da casa" autoComplete="off" />
              </div>
            ) : (
              <div className="input-wrap input-wrap--large input-wrap--top">
                <Icon name="hash" size={18} />
                <input id="query" value={hashtagsInput} onChange={(event) => setHashtagsInput(event.target.value)} placeholder="ex.: skincare, achadinhos" autoComplete="off" />
              </div>
            )}
            <span className="field-hint">Separe hashtags por vírgula ou espaço.</span>

            <div className="quick-row">
              <span>Atalhos</span>
              <div className="quick-chips">
                {QUICK_QUERIES.map((query) => <button type="button" key={query} onClick={() => useQuickQuery(query)}>{query}</button>)}
              </div>
            </div>

            <div className="form-section-heading"><span>Leitura dos dados</span><Icon name="filter" size={15} /></div>
            <div className="two-fields">
              <label className="field-label" htmlFor="max">Resultados
                <div className="select-wrap"><select id="max" value={max} onChange={(event) => setMax(event.target.value)}><option value="10">10 posts</option><option value="20">20 posts</option><option value="30">30 posts</option><option value="50">50 posts</option></select><Icon name="chevron-down" size={14} /></div>
              </label>
              <label className="field-label" htmlFor="sort">Ordenar por
                <div className="select-wrap"><select id="sort" value={sort} onChange={(event) => setSort(event.target.value as SortField)}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="chevron-down" size={14} /></div>
              </label>
            </div>
            <label className="field-label" htmlFor="min-views">Mínimo de visualizações
              <div className="input-wrap"><Icon name="play" size={14} /><input id="min-views" inputMode="numeric" type="number" min="0" step="1000" value={minViews} onChange={(event) => setMinViews(event.target.value)} placeholder="0" /></div>
            </label>

            <div className="toggle-list">
              <label className="toggle-row"><span className="toggle-copy"><span className="toggle-title"><Icon name="map-pin" size={15} /> Sinais brasileiros</span><small>Filtro por idioma, hashtags e contexto PT-BR — não é geo de conta.</small></span><input type="checkbox" checked={onlyBrazil} onChange={(event) => setOnlyBrazil(event.target.checked)} /><span className="toggle-ui" /></label>
              <label className="toggle-row"><span className="toggle-copy"><span className="toggle-title"><Icon name="cloud-download" size={15} /> Links de mídia</span><small>Deixa o botão de download disponível nos cards.</small></span><input type="checkbox" checked={includeMediaLinks} onChange={(event) => setIncludeMediaLinks(event.target.checked)} /><span className="toggle-ui" /></label>
            </div>

            {error ? <div className="form-error" role="alert"><Icon name="x" size={15} /><span>{error}</span></div> : null}

            {loading ? (
              <button type="button" className="run-button run-button--cancel" onClick={cancel}><Icon name="x" size={17} /> Cancelar extração</button>
            ) : (
              <button type="submit" className="run-button" disabled={!hasQuery}><span>Rodar exploração</span><Icon name="arrow-up-right" size={17} /></button>
            )}
            <p className="privacy-note"><span className="privacy-dot" /> As credenciais ficam no servidor. A busca não espera o download do vídeo.</p>
          </form>
        </aside>

        <section className="results-area" aria-live="polite">
          {loading ? (
            <div className="loading-state">
              <div className="loading-orbit"><span /><span /><span /></div>
              <span className="eyebrow">Extração em andamento</span>
              <h2>Buscando sinais frescos<span>...</span></h2>
              <p>O motor está coletando posts e calculando os sinais de tração. Isso pode levar alguns segundos.</p>
              <div className="loading-steps"><span className="is-done"><Icon name="check" size={13} /> Consulta preparada</span><span className="is-active"><Icon name="loader" size={13} /> Coletando posts</span><span><Icon name="activity" size={13} /> Ranqueando</span></div>
            </div>
          ) : response && isRunSuccess(response) ? (
            <>
              <div className="results-heading">
                <div><span className="eyebrow">Mapa de sinais</span><h2>{response.total} {response.total === 1 ? 'post encontrado' : 'posts encontrados'}</h2><p>{response.source === 'hashtag' ? 'Busca por hashtags' : 'Busca contextual'} · motor {providerLabel(response.provider)}{response.brRemoved ? ` · ${response.brRemoved} removidos pelo filtro BR` : ''}</p></div>
                <div className="results-heading__actions"><button type="button" className="secondary-button" onClick={exportCsv}><Icon name="arrow-down" size={15} /> Exportar CSV</button><button type="button" className="secondary-button secondary-button--square" onClick={() => void refreshHealth()} title="Atualizar conexão"><Icon name="refresh" size={15} /></button></div>
              </div>
              <div className="summary-grid">
                <div className="summary-card summary-card--accent"><span className="summary-label">Alcance total</span><strong>{formatCompact(totalViews)}</strong><span className="summary-foot"><Icon name="trend-up" size={13} /> nos posts exibidos</span></div>
                <div className="summary-card"><span className="summary-label">Engagement médio</span><strong>{formatPercent(avgRate)}</strong><span className="summary-foot"><Icon name="activity" size={13} /> sinal de interação</span></div>
                <div className="summary-card"><span className="summary-label">Melhor sinal</span><strong>{posts[0] ? posts[0].trendTier : '—'}</strong><span className="summary-foot"><Icon name="sparkles" size={13} /> tier de tração</span></div>
                <div className="summary-card"><span className="summary-label">Fonte</span><strong>{response.source === 'hashtag' ? 'Hashtag' : 'Search'}</strong><span className="summary-foot"><Icon name="map-pin" size={13} /> {onlyBrazil ? 'contexto BR' : 'global'}</span></div>
              </div>
              {response.warnings?.length ? <div className="warning-banner"><Icon name="activity" size={16} /><span>A busca concluiu com fallback ou ajuste de estabilidade; confira o motor indicado acima.</span></div> : null}
              <div className="cards-heading"><div><h3>Posts em destaque</h3><span>Ordenados por {SORT_OPTIONS.find((option) => option.value === sort)?.label.toLowerCase()}</span></div><span className="result-count">{posts.length} exibidos</span></div>
              {posts.length ? <div className="post-list">{posts.map((post, index) => <PostCard key={`${post.id}-${index}`} post={post} rank={index + 1} allowDownload={includeMediaLinks && mediaEnabled} onCopy={copyUrl} onDownload={downloadPost} />)}</div> : <div className="empty-results"><Icon name="search" size={22} /><h3>Nenhum sinal com esse recorte</h3><p>Tente reduzir o mínimo de views ou trocar o termo da busca.</p></div>}
            </>
          ) : (
            <div className="welcome-state">
              <div className="welcome-graphic" aria-hidden="true"><div className="graphic-grid" /><span className="graphic-node graphic-node--one" /><span className="graphic-node graphic-node--two" /><span className="graphic-node graphic-node--three" /><span className="graphic-line graphic-line--one" /><span className="graphic-line graphic-line--two" /></div>
              <span className="eyebrow">Seu radar de tendências</span>
              <h2>Menos ruído.<br /><em>Mais sinal.</em></h2>
              <p>Escolha um assunto ao lado para transformar uma busca ampla em uma lista curta de posts com tração real.</p>
              <div className="welcome-points"><span><Icon name="check" size={14} /> Métricas normalizadas</span><span><Icon name="check" size={14} /> Ranking por tração</span><span><Icon name="check" size={14} /> Exportação pronta</span></div>
              <div className="welcome-tip"><Icon name="sparkles" size={16} /><span><strong>Comece pequeno.</strong> Uma keyword específica costuma revelar sinais melhores que “fyp”.</span></div>
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer"><span>Pulseboard · análise editorial de sinais públicos</span><span><span className="footer-status" /> Sem credenciais no navegador</span></footer>
      {downloadingId ? <div className="floating-progress"><Icon name="loader" size={16} /> Preparando mídia...</div> : null}
      {copiedUrl ? <span className="sr-only" role="status">Link copiado</span> : null}
      {toast ? <div className="toast" role="status"><Icon name="check" size={15} /> {toast}</div> : null}
    </div>
  );
}
