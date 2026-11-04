import Link from 'next/link';
import { useState, useEffect } from 'react';
import type { Bid, Lot } from './types';
import { brl, formatRemaining, when, whenFull } from './formatters';

export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    live: 'Ao vivo',
    scheduled: 'Agendado',
    closed: 'Encerrado',
    cancelled: 'Cancelado'
  };
  return (
    <span className={`status status-${value}`}>
      <i />
      {labels[value] ?? value}
    </span>
  );
}

export function Money({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={muted ? 'money muted' : 'money'}>{children}</span>;
}

export function Artwork({
  src,
  title,
  className = ''
}: {
  src?: string | null;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`artwork ${className}`}>
      {src && !failed ? (
        <img src={src} alt={title} onError={() => setFailed(true)} />
      ) : (
        <div className="artwork-placeholder">
          <span>LA</span>
          <small>{src ? 'Imagem indisponível' : 'Obra catalogada'}</small>
        </div>
      )}
      <span className="artwork-shade" />
    </div>
  );
}

export function LiveBidStream({ bids }: { bids: Bid[] }) {
  const newestBid = bids[0];

  return (
    <div className="live-stream-container">
      {newestBid && (
        <div className="live-incoming-banner">
          <span className="activity-dot" aria-hidden="true" />
          <small>
            Lance mais recente registrado: <b>{newestBid.bidder}</b> ofertou{' '}
            <strong>{brl(newestBid.amount)}</strong>
          </small>
        </div>
      )}
      <div className="bid-list">
        {bids.slice(0, 8).map((bid, index) => (
          <div
            className={`bid-row ${index === 0 ? 'bid-row-leader bid-row-highlight' : ''}`}
            key={`${bid.createdAt}-${index}`}
          >
            <span className="avatar tiny-avatar">{index === 0 ? '★' : `#${bids.length - index}`}</span>
            <div className="bid-row-info">
              <b>
                {bid.bidder}
                {index === 0 && <ins className="leader-chip">Líder atual</ins>}
              </b>
              <small>{whenFull(bid.createdAt)}</small>
            </div>
            <strong>{brl(bid.amount)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LotCard({ lot, nowMs }: { lot: Lot; nowMs: number }) {
  const artist = lot.artwork?.artist ?? lot.artwork?.artist_title ?? 'Acervo LanceArte';
  const year = lot.artwork?.date ?? lot.artwork?.date_display ?? '';
  const remaining =
    lot.status === 'live'
      ? formatRemaining(lot.endsAt, nowMs)
      : lot.status === 'scheduled'
        ? formatRemaining(lot.startsAt, nowMs)
        : null;
  const bidCount = lot.bidCount ?? 0;

  return (
    <Link className={`lot-card lot-card-${lot.status}`} href={`/lots/${lot.id}`}>
      <div className="lot-card-media">
        <Artwork src={lot.imageUrl} title={lot.title} />
        <div className="lot-card-badges">
          <Status value={lot.status} />
          <span className="lot-code-pill">Lote #{lot.id.slice(0, 5).toUpperCase()}</span>
        </div>
        {lot.status === 'live' && remaining && (
          <div className={`lot-card-timer ${remaining.urgent ? 'timer-urgent' : ''}`}>
            <span>⏱ Encerra em</span>
            <strong>{remaining.text}</strong>
          </div>
        )}
        {lot.status === 'scheduled' && (
          <div className="lot-card-timer timer-scheduled">
            <span>Abre em {when(lot.startsAt)}</span>
          </div>
        )}
      </div>

      <div className="lot-card-body">
        <div className="lot-card-artist">
          <span>{artist}</span>
          {year && <small>· {year}</small>}
        </div>
        <h3>{lot.title}</h3>

        <div className="lot-card-pricing">
          <div className="lot-card-price-main">
            <span>
              {lot.status === 'live'
                ? lot.currentBid !== null
                  ? 'Lance atual'
                  : 'Lance inicial'
                : lot.status === 'closed'
                  ? lot.currentBid === null
                    ? 'Sem arremate'
                    : 'Arrematado por'
                  : 'Lance inicial'}
            </span>
            <Money muted={lot.status === 'closed' && lot.currentBid === null}>
              {lot.currentBid === null && lot.status === 'closed'
                ? '—'
                : brl(lot.currentBid ?? lot.openingBid)}
            </Money>
          </div>
          <div className="lot-card-bid-meta">
            <span className="bid-count-pill">
              {bidCount === 0
                ? 'Sem lances'
                : `${bidCount} ${bidCount === 1 ? 'lance' : 'lances'}`}
            </span>
            <small>Inc. {brl(lot.increment)}</small>
          </div>
        </div>

        <div className="lot-card-footer">
          <span className="lot-card-submeta">
            {lot.leader
              ? `${lot.status === 'closed' ? 'Vencedor' : 'Líder'}: ${lot.leader}`
              : `Leiloeiro: ${lot.sellerName || 'Acervo'}`}
          </span>
          <b className="lot-card-cta">
            {lot.status === 'live'
              ? 'Dar lance'
              : lot.status === 'scheduled'
                ? 'Ver lote'
                : 'Ver resultado'}{' '}
            <span aria-hidden="true">→</span>
          </b>
        </div>
      </div>
    </Link>
  );
}
