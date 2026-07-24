import { formatCompact, formatDate, formatPercent, initials, TIER_META, type TikTokPost } from '../lib/tiktok';
import { Icon } from './icon';

interface PostCardProps {
  post: TikTokPost;
  rank: number;
  allowDownload: boolean;
  onCopy: (url: string) => void;
  onDownload: (post: TikTokPost) => void;
}

function safeNumber(value: number | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function PostCard({ post, rank, allowDownload, onCopy, onDownload }: PostCardProps) {
  const tier = TIER_META[post.trendTier] || TIER_META.NORMAL;
  const authorName = post.author?.nickname || post.author?.username || 'Criador sem nome';
  const username = post.author?.username ? `@${post.author.username.replace(/^@/u, '')}` : '@desconhecido';
  const cover = post.coverUrl || post.images?.[0];
  const views = safeNumber(post.metrics?.playCount);
  const likes = safeNumber(post.metrics?.diggCount);
  const shares = safeNumber(post.metrics?.shareCount);
  const comments = safeNumber(post.metrics?.commentCount);

  return (
    <article className="post-card">
      <div className="post-card__rank" aria-label={`Posição ${rank}`}>
        <span>#{String(rank).padStart(2, '0')}</span>
        {rank <= 3 ? <Icon name="sparkles" size={14} /> : null}
      </div>

      <div className="post-card__main">
        <div className="post-card__identity">
          <div className="avatar" aria-hidden="true">
            {cover ? <img src={cover} alt="" loading="lazy" /> : <span>{initials(post)}</span>}
          </div>
          <div className="identity-copy">
            <div className="identity-copy__name">
              <strong>{authorName}</strong>
              {post.author?.verified ? <span className="verified" title="Conta verificada"><Icon name="check" size={11} /></span> : null}
            </div>
            <span className="muted">{username} · {formatDate(post.createTime)}</span>
          </div>
          <span className={`tier-pill tier-pill--${tier.color}`}>
            <span className="tier-pill__dot" />
            {tier.label}
          </span>
        </div>

        <p className="post-card__caption">{post.caption || 'Sem legenda disponível.'}</p>
        {post.hashtags?.length ? (
          <div className="hashtag-row" aria-label="Hashtags">
            {post.hashtags.slice(0, 5).map((tag) => <span key={tag}>#{tag.replace(/^#/u, '')}</span>)}
            {post.hashtags.length > 5 ? <span>+{post.hashtags.length - 5}</span> : null}
          </div>
        ) : null}

        <div className="metric-grid">
          <div className="metric metric--primary"><span>Views</span><strong>{formatCompact(views)}</strong></div>
          <div className="metric"><span><Icon name="heart" size={13} /> Likes</span><strong>{formatCompact(likes)}</strong></div>
          <div className="metric"><span><Icon name="share" size={13} /> Shares</span><strong>{formatCompact(shares)}</strong></div>
          <div className="metric"><span><Icon name="send" size={13} /> Comments</span><strong>{formatCompact(comments)}</strong></div>
          <div className="metric metric--engagement"><span>Engagement</span><strong>{formatPercent(post.engagementRate)}</strong></div>
        </div>

        <div className="post-card__footer">
          <div className="music-line">
            <Icon name="play" size={12} />
            <span>{post.music?.title || 'Áudio original'}</span>
          </div>
          <div className="post-actions">
            <button type="button" className="icon-button" onClick={() => onCopy(post.url)} title="Copiar link" aria-label="Copiar link do vídeo">
              <Icon name="clipboard" size={16} />
            </button>
            {allowDownload ? (
              <button type="button" className="icon-button" onClick={() => onDownload(post)} title="Baixar vídeo" aria-label="Baixar vídeo">
                <Icon name="cloud-download" size={16} />
              </button>
            ) : null}
            <a className="icon-button" href={post.url} target="_blank" rel="noreferrer" title="Abrir no TikTok" aria-label="Abrir no TikTok">
              <Icon name="external" size={16} />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
