import Link from 'next/link';
import { type Socket, io } from 'socket.io-client';
import { useState, useCallback, useEffect } from 'react';
import type { Bid, Lot, User, WalletData } from '../types';
import { apiFetch, SOCKET } from '../api-client';
import { brl, formatRemaining, when, whenFull } from '../formatters';
import { Artwork, LiveBidStream, Status } from '../auction-primitives';

export function LotView({
  id,
  user,
  onLogin,
  notify,
  onWalletChange
}: {
  id: string;
  user: User | null;
  onLogin: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
  onWalletChange: () => void;
}) {
  const [lot, setLot] = useState<Lot | null>(null);
  const [lotError, setLotError] = useState('');
  const [bids, setBids] = useState<Bid[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [socketConnected, setSocketConnected] = useState(false);

  const load = useCallback(async () => {
    setLotError('');
    const [lotResponse, bidResponse] = await Promise.all([
      apiFetch(`/lots/${id}`),
      apiFetch(`/lots/${id}/bids`)
    ]);
    const lotData = await lotResponse.json();
    if (!lotResponse.ok) {
      setLot(null);
      setLotError(lotData.error ?? 'Não foi possível encontrar este lote.');
      setBids([]);
      return;
    }
    setLot(lotData);
    if (bidResponse.ok) setBids(await bidResponse.json());
  }, [id]);

  const loadBidderWallet = useCallback(async () => {
    if (user?.role !== 'bidder') {
      setWallet(null);
      return;
    }
    const r = await apiFetch('/wallet/me');
    if (r.ok) setWallet(await r.json());
  }, [user]);

  useEffect(() => {
    load().catch(() => notify('error', 'Não foi possível carregar este lote.'));
  }, [load, notify]);

  useEffect(() => {
    loadBidderWallet();
  }, [loadBidderWallet]);

  useEffect(() => {
    const channel: Socket = io(SOCKET, { withCredentials: true });
    const handleConnect = () => {
      setSocketConnected(true);
      channel.emit('lot:join', id);
      void load().catch(() => undefined);
    };
    const handleDisconnect = () => setSocketConnected(false);
    const handleConnectError = () => setSocketConnected(false);

    channel.on('connect', handleConnect);
    channel.on('disconnect', handleDisconnect);
    channel.on('connect_error', handleConnectError);
    channel.on('lot:bid', () => {
      void load().catch(() => undefined);
      void loadBidderWallet().catch(() => undefined);
      onWalletChange();
    });
    channel.on('lot:live', () => {
      void load().catch(() => undefined);
    });
    channel.on('lot:closed', () => {
      void load().catch(() => undefined);
      void loadBidderWallet().catch(() => undefined);
      onWalletChange();
    });
    return () => {
      setSocketConnected(false);
      channel.disconnect();
    };
  }, [id, load, loadBidderWallet, onWalletChange]);

  useEffect(() => {
    if (!lot || lot.status !== 'live' || socketConnected) return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
      void loadBidderWallet().catch(() => undefined);
      onWalletChange();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lot?.status, socketConnected, load, loadBidderWallet, onWalletChange]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!lot || lot.status !== 'live') return;
    const timeout = window.setTimeout(
      () => load(),
      Math.max(0, new Date(lot.endsAt).getTime() - Date.now() + 350)
    );
    return () => window.clearTimeout(timeout);
  }, [lot?.status, lot?.endsAt, load]);

  const minimum = lot ? (lot.currentBid ?? lot.openingBid - lot.increment) + lot.increment : 0;

  const submitBidAmount = async (bidValue: number) => {
    if (!user) return onLogin();
    if (user.role === 'auctioneer') {
      return notify('error', 'Perfis de leiloeiro não podem ofertar lances.');
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/lots/${id}/bids`, {
        method: 'POST',
        body: JSON.stringify({ amount: bidValue })
      });
      const data = await response.json();
      if (!response.ok) return notify('error', data.error);
      setAmount('');
      notify(
        'success',
        data.extended
          ? `Lance de ${brl(bidValue)} confirmado! Como faltavam menos de 2 minutos, o horário foi prorrogado.`
          : `Lance de ${brl(bidValue)} confirmado! Você assumiu a liderança do lote.`
      );
      await Promise.all([load(), loadBidderWallet()]);
      onWalletChange();
    } finally {
      setBusy(false);
    }
  };

  const handleCancelLot = async () => {
    if (!lot) return;
    setCancelling(true);
    try {
      const response = await apiFetch(`/lots/${lot.id}/cancel`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        notify('error', data.error ?? 'Não foi possível cancelar o lote.');
      } else {
        notify('success', 'Lote cancelado com sucesso.');
        window.location.href = '/console';
      }
    } finally {
      setCancelling(false);
    }
  };

  if (!lot) {
    if (lotError) {
      return (
        <section className="public-page">
          <div className="empty-state">
            <span className="empty-icon">◇</span>
            <b>{lotError}</b>
            <Link className="button button-outline" href="/">
              Voltar à vitrine de leilões
            </Link>
          </div>
        </section>
      );
    }
    return (
      <div className="page-loader">
        <span className="loader" />
        <span>Abrindo sala de leilão…</span>
      </div>
    );
  }

  const remaining =
    lot.status === 'live'
      ? formatRemaining(lot.endsAt, clock)
      : lot.status === 'scheduled'
        ? formatRemaining(lot.startsAt, clock)
        : null;

  const quickAmounts = [minimum, minimum + lot.increment, minimum + lot.increment * 2];
  const artist = lot.artwork?.artist ?? lot.artwork?.artist_title ?? 'Autoria desconhecida';
  const year = lot.artwork?.date ?? lot.artwork?.date_display ?? 'Data não informada';
  const sourceName =
    lot.artwork?.source ??
    (lot.artwork?.sourceUrl?.includes('portinari')
      ? 'Projeto Portinari'
      : lot.artwork?.sourceUrl?.includes('lacma')
        ? 'Los Angeles County Museum of Art'
        : 'Art Institute of Chicago');

  return (
    <section className="detail-page">
      <div className="detail-topbar">
        <nav className="breadcrumb" aria-label="Navegação estrutural">
          <Link href="/">← Voltar à Vitrine</Link>
          <span>/</span>
          <span>Lote #{lot.id.slice(0, 6).toUpperCase()}</span>
          <span>/</span>
          <b>{lot.title}</b>
        </nav>
        <div className="detail-top-actions">
          <Link className="top-action-pill" href={`/audit/${lot.id}`}>
            ✓ Histórico verificado do lote
          </Link>
          {lot.receiptToken && (
            <Link className="top-action-pill highlight" href={`/receipt/${lot.receiptToken}`}>
              ◇ Comprovante de Arremate ↗
            </Link>
          )}
        </div>
      </div>

      <div className="detail-grid">
        {/* LEFT COLUMN: ARTWORK SHOWCASE & PROVENANCE */}
        <div className="detail-left">
          <div className="detail-art-frame">
            <Artwork src={lot.imageUrl} title={lot.title} className="detail-art" />
          </div>

          <div className="catalog-sheet">
            <div className="sheet-header">
              <div>
                <span className="eyebrow">FICHA CATALOGRÁFICA DA OBRA</span>
                <h2>Especificações &amp; Proveniência</h2>
              </div>
            </div>

            <div className="specs-grid">
              <div className="spec-item">
                <span>Artista / Autoria</span>
                <strong>{artist}</strong>
              </div>
              <div className="spec-item">
                <span>Período / Data</span>
                <strong>{year}</strong>
              </div>
              <div className="spec-item">
                <span>Acervo de Origem</span>
                <strong>{sourceName}</strong>
              </div>
              <div className="spec-item">
                <span>Classificação</span>
                <strong>
                  {lot.artwork?.publicDomain ? 'Domínio Público' : 'Acervo Institucional'}
                </strong>
              </div>
              <div className="spec-item">
                <span>Leiloeiro Responsável</span>
                <strong>{lot.sellerName}</strong>
              </div>
              <div className="spec-item">
                <span>Identificador do Lote</span>
                <strong>#{lot.id.slice(0, 8).toUpperCase()}</strong>
              </div>
            </div>

            <div className="audit-assurance-card">
              <div className="assurance-icon">✓</div>
              <div className="assurance-copy">
                <b>Transparência e Histórico Público de Lances</b>
                <p>
                  Todos os lances deste lote são registrados em ordem cronológica e não podem ser
                  alterados. Qualquer visitante pode auditar o histórico completo mesmo sem login.
                </p>
              </div>
              <Link href={`/audit/${lot.id}`} className="button button-outline compact">
                Consultar histórico →
              </Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: STICKY LIVE AUCTION CONSOLE */}
        <div className="detail-right">
          <div className="bidding-console">
            <div className="console-status-bar">
              <div className="detail-overline">
                <Status value={lot.status} />
                <span className="lot-number-tag">LOTE #{lot.id.slice(0, 6).toUpperCase()}</span>
              </div>

              {lot.status === 'live' && remaining && (
                <div className={`live-countdown-pill ${remaining.urgent ? 'urgent' : ''}`}>
                  <span>ENCERRA EM</span>
                  <strong className="countdown">{remaining.text}</strong>
                </div>
              )}
            </div>

            <div className="console-Lot-header">
              <h1>{lot.title}</h1>
              <p className="detail-artist">
                <b>{artist}</b> · {year}
              </p>
            </div>

            {/* VALUATION BOX */}
            <div className="detail-pricebox">
              <div className="pricebox-main">
                <span>
                  {lot.status === 'live'
                    ? lot.currentBid !== null
                      ? 'LANCE ATUAL'
                      : 'LANCE INICIAL'
                    : lot.status === 'closed'
                      ? lot.currentBid === null
                        ? 'ENCERRADO SEM LANCES'
                        : 'ARREMATADO POR'
                      : 'LANCE INICIAL'}
                </span>
                <strong>
                  {lot.status === 'closed' && lot.currentBid === null
                    ? '—'
                    : brl(lot.currentBid ?? lot.openingBid)}
                </strong>
                <small>
                  Lance inicial: {brl(lot.openingBid)} · Incremento mínimo: {brl(lot.increment)}
                </small>
              </div>

              <div className="leader-tag">
                {lot.leader ? (
                  <>
                    <span>{lot.status === 'closed' ? 'VENCEDOR DO LOTE' : 'NA LIDERANÇA'}</span>
                    <b className="leader-badge">{lot.leader}</b>
                    <small>
                      {bids.length} {bids.length === 1 ? 'lance registrado' : 'lances registrados'}
                    </small>
                  </>
                ) : (
                  <>
                    <span>DISPUTA</span>
                    <b>{lot.status === 'closed' ? 'Sem arremate' : 'Aguardando 1º lance'}</b>
                    <small>Mínimo {brl(lot.openingBid)}</small>
                  </>
                )}
              </div>
            </div>

            {/* TIMING METADATA */}
            <div className="detail-timing">
              <div>
                <span>INÍCIO DO PREGÃO</span>
                <b>{when(lot.startsAt)}</b>
              </div>
              <div>
                <span>{lot.status === 'closed' ? 'ENCERRADO EM' : 'FECHAMENTO PREVISTO'}</span>
                <b>{when(lot.endsAt)}</b>
              </div>
            </div>

            {/* ROLE-SPECIFIC INTERACTION AREA */}
            {lot.status === 'live' ? (
              user?.role === 'auctioneer' ? (
                <div className="role-restriction-box">
                  <div className="restriction-header">
                    <span className="role-pill-badge">MODO LEILOEIRO (VENDEDOR)</span>
                    <b>Você está visualizando como Leiloeiro</b>
                  </div>
                  <p>
                    Conforme as regras da Casa de Leilões, o perfil de <b>Leiloeiro</b> cria e
                    gerencia lotes, mas <b>não pode dar lances</b>. Para disputar este lote, entre
                    com uma conta de <b>Licitante</b>.
                  </p>
                  <div className="restriction-actions">
                    <Link href="/console" className="button button-outline compact">
                      Painel do Leiloeiro →
                    </Link>
                    {bids.length === 0 && (
                      <button
                        type="button"
                        className="button button-danger compact"
                        disabled={cancelling}
                        onClick={handleCancelLot}
                      >
                        {cancelling ? 'Cancelando…' : 'Cancelar este lote'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bid-panel">
                  {user?.role === 'bidder' && (
                    <>
                      {lot.isCurrentUserLeader ? (
                        <div className="lead-status lead-winning">
                          <span>✓</span>
                          <div>
                            <b>Você está na liderança deste lote!</b>
                            <small>
                              O valor do seu lance está reservado na sua carteira até o desfecho do
                              pregão.
                            </small>
                          </div>
                        </div>
                      ) : (
                        <div className="lead-status lead-outbid">
                          <span>⚡</span>
                          <div>
                            <b>Pregão em disputa ao vivo</b>
                            <small>
                              Oferte pelo menos {brl(minimum)} para assumir a liderança agora.
                            </small>
                          </div>
                        </div>
                      )}

                      {wallet && (
                        <div className="bidder-wallet-strip">
                          <div>
                            <span>Seu saldo disponível:</span>
                            <strong
                              className={wallet.available < minimum ? 'balance-low' : ''}
                            >
                              {brl(wallet.available)}
                            </strong>
                            {wallet.committed > 0 && (
                              <small>(Comprometido: {brl(wallet.committed)})</small>
                            )}
                          </div>
                          <Link href="/wallet" className="wallet-topup-link">
                            + Depositar saldo
                          </Link>
                        </div>
                      )}
                    </>
                  )}

                  <div className="quick-bids-group">
                    <span className="quick-bids-label">
                      Lance rápido (clique para ofertar imediatamente):
                    </span>
                    <div className="quick-bids-row">
                      {quickAmounts.map((qAmount, idx) => (
                        <button
                          key={qAmount}
                          type="button"
                          className={`quick-bid-btn ${idx === 0 ? 'recommended' : ''}`}
                          disabled={busy || Boolean(user && lot.isCurrentUserLeader)}
                          onClick={() => submitBidAmount(qAmount)}
                        >
                          <small>{idx === 0 ? 'Lance mínimo' : `+${idx + 1}x inc.`}</small>
                          <strong>{brl(qAmount)}</strong>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label htmlFor="bid-amount" className="custom-bid-label">
                    Ou digite um valor personalizado (mínimo {brl(minimum)}):
                  </label>
                  <div className="bid-entry">
                    <span>R$</span>
                    <input
                      id="bid-amount"
                      type="number"
                      min={minimum}
                      step={lot.increment}
                      placeholder={minimum.toFixed(2)}
                      value={amount}
                      onChange={event => setAmount(event.target.value)}
                    />
                    <button
                      className="button button-primary"
                      onClick={() => submitBidAmount(Number(amount || minimum))}
                      disabled={busy || Boolean(user && lot.isCurrentUserLeader)}
                    >
                      {busy
                        ? 'Enviando…'
                        : user
                          ? 'Confirmar Lance ↗'
                          : 'Entrar e Dar Lance ↗'}
                    </button>
                  </div>

                  <div className="bid-rules-note">
                    <span>⏱ Prorrogação automática:</span> lances realizados nos 2 minutos finais
                    estendem o pregão em +2 minutos.
                  </div>

                  {!user && (
                    <button className="login-prompt-banner" type="button" onClick={onLogin}>
                      <span>Ainda não entrou na sua conta?</span>
                      <b>Clique aqui para entrar como Licitante →</b>
                    </button>
                  )}
                </div>
              )
            ) : lot.status === 'scheduled' ? (
              <div className="notice-box scheduled-notice">
                <b>⏳ Este lote está agendado</b>
                <p>
                  A sala de lances abrirá automaticamente em <b>{when(lot.startsAt)}</b> com lance
                  inicial de <b>{brl(lot.openingBid)}</b> e incremento mínimo de{' '}
                  <b>{brl(lot.increment)}</b>.
                </p>
                {user?.role === 'auctioneer' && bids.length === 0 && (
                  <button
                    type="button"
                    className="button button-danger compact"
                    disabled={cancelling}
                    onClick={handleCancelLot}
                  >
                    {cancelling ? 'Cancelando…' : 'Cancelar lote agendado'}
                  </button>
                )}
              </div>
            ) : (
              <div className="notice-box closed-notice">
                <b>✓ Pregão encerrado</b>
                <p>
                  {lot.leader && lot.currentBid !== null
                    ? `Obra arrematada por ${lot.leader} pelo lance vencedor de ${brl(lot.currentBid)}.`
                    : 'Este pregão foi encerrado no horário previsto sem receber lances.'}
                </p>
                <div className="closed-notice-actions">
                  {lot.receiptToken && (
                    <Link
                      className="button button-primary compact"
                      href={`/receipt/${lot.receiptToken}`}
                    >
                      Abrir Comprovante de Arremate ↗
                    </Link>
                  )}
                  <Link className="button button-outline compact" href={`/audit/${lot.id}`}>
                    Ver histórico auditado →
                  </Link>
                </div>
              </div>
            )}

            {/* LIVE OR CLOSED BID HISTORY */}
            <div className="bid-history">
              <div className="history-heading">
                <div className="history-title-group">
                  <h3>Histórico de lances</h3>
                  <span className="live-feed-pill">
                    <i />
                    {lot.status === 'live'
                      ? socketConnected
                        ? `Ao vivo (${bids.length})`
                        : `Atualização automática (${bids.length})`
                      : `${bids.length} ${bids.length === 1 ? 'lance registrado' : 'lances registrados'}`}
                  </span>
                </div>
                <Link href={`/audit/${lot.id}`}>Auditar histórico →</Link>
              </div>

              {lot.status === 'live' && bids.length > 0 ? (
                <LiveBidStream bids={bids} />
              ) : bids.length > 0 ? (
                <div className="bid-list">
                  {bids.slice(0, 12).map((bid, index) => (
                    <div
                      className={`bid-row ${index === 0 ? 'bid-row-leader' : ''}`}
                      key={`${bid.createdAt}-${index}`}
                    >
                      <span className="avatar tiny-avatar">
                        {index === 0 ? '★' : `#${bids.length - index}`}
                      </span>
                      <div className="bid-row-info">
                        <b>
                          {bid.bidder}
                          {index === 0 && (
                            <ins className="leader-chip">
                              {lot.status === 'closed' ? 'Lance vencedor' : 'Líder'}
                            </ins>
                          )}
                        </b>
                        <small>{whenFull(bid.createdAt)}</small>
                      </div>
                      <strong>{brl(bid.amount)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="history-empty">
                  <span>◇</span>
                  <p>
                    {lot.status === 'closed'
                      ? 'Este lote foi encerrado sem lances registrados.'
                      : lot.status === 'scheduled'
                        ? 'Os lances começarão assim que este pregão agendado for aberto.'
                        : 'Aguardando o primeiro lance neste pregão ao vivo.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
