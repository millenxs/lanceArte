import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import type { Lot, User } from '../types';
import { apiFetch } from '../api-client';
import { brl, formatRemaining, when } from '../formatters';
import { Artwork, LotCard, Status } from '../auction-primitives';

export function HomeView({ user, onLogin }: { user: User | null; onLogin: () => void }) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'closed'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    apiFetch('/lots')
      .then(r => {
        if (!r.ok) throw new Error('Indisponível');
        return r.json();
      })
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [loadAttempt]);

  const activeLots = useMemo(() => lots.filter(lot => lot.status !== 'cancelled'), [lots]);

  const shown = useMemo(() => {
    return activeLots.filter(lot => {
      const matchesStatus = filter === 'all' ? true : lot.status === filter;
      const searchableText =
        `${lot.title} ${lot.artwork?.artist ?? lot.artwork?.artist_title ?? ''} ${lot.artwork?.date ?? ''}`.toLocaleLowerCase(
          'pt-BR'
        );
      return matchesStatus && searchableText.includes(search.trim().toLocaleLowerCase('pt-BR'));
    });
  }, [activeLots, filter, search]);

  const liveCount = activeLots.filter(lot => lot.status === 'live').length;
  const scheduledCount = activeLots.filter(lot => lot.status === 'scheduled').length;
  const closedCount = activeLots.filter(lot => lot.status === 'closed').length;

  const featuredLot = useMemo(() => {
    const liveWithBids = activeLots.find(l => l.status === 'live' && (l.bidCount ?? 0) > 0);
    return (
      liveWithBids ??
      activeLots.find(l => l.status === 'live') ??
      activeLots.find(l => l.status === 'scheduled') ??
      activeLots[0]
    );
  }, [activeLots]);

  const featuredRemaining = featuredLot
    ? featuredLot.status === 'live'
      ? formatRemaining(featuredLot.endsAt, nowMs)
      : featuredLot.status === 'scheduled'
        ? formatRemaining(featuredLot.startsAt, nowMs)
        : null
    : null;

  const categories = [
    ['all', 'Todos os lotes', activeLots.length],
    ['live', 'Ao vivo agora', liveCount],
    ['scheduled', 'Próximos pregões', scheduledCount],
    ['closed', 'Encerrados', closedCount]
  ] as const;

  return (
    <>
      <nav className="auction-categories" aria-label="Categorias de leilões">
        <div className="categories-inner">
          <div className="category-tabs">
            {categories.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? 'selected' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'live' && <i className="tab-live-dot" />}
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="category-assurances">
            <span>✓ Acervos Internacionais</span>
            <span>✓ Reserva Automática de Saldo</span>
            <span>✓ Histórico Público Verificado</span>
          </div>
        </div>
      </nav>

      <div className="home-container">
        {featuredLot && (
          <section
            className="featured-auction"
            id="featured-auction"
            aria-label="Leilão em destaque"
          >
            <div className="featured-art">
              <Artwork src={featuredLot.imageUrl} title={featuredLot.title} />
              <div className="featured-art-overlays">
                <span className="featured-lot-badge">
                  LOTE EM DESTAQUE #{featuredLot.id.slice(0, 6).toUpperCase()}
                </span>
                <span className="featured-source-badge">
                  {featuredLot.artwork?.source ?? 'Art Institute of Chicago'}
                </span>
              </div>
            </div>

            <div className="featured-copy">
              <div className="featured-kicker">
                <Status value={featuredLot.status} />
                <span>
                  {featuredLot.status === 'live'
                    ? 'Pregão aberto para lances ao vivo'
                    : featuredLot.status === 'scheduled'
                      ? 'Lote agendado para abertura'
                      : 'Pregão finalizado'}
                </span>
              </div>

              <h2>{featuredLot.title}</h2>
              <p className="featured-artist">
                <strong>
                  {featuredLot.artwork?.artist ??
                    featuredLot.artwork?.artist_title ??
                    'Acervo LanceArte'}
                </strong>
                {(featuredLot.artwork?.date ?? featuredLot.artwork?.date_display)
                  ? ` · ${featuredLot.artwork?.date ?? featuredLot.artwork?.date_display}`
                  : ''}
                <span> · Leiloeiro: {featuredLot.sellerName}</span>
              </p>

              <div className="featured-bid-box">
                <div className="featured-price-col">
                  <span>
                    {featuredLot.status === 'live'
                      ? featuredLot.currentBid !== null
                        ? 'LANCE ATUAL'
                        : 'LANCE INICIAL'
                      : featuredLot.status === 'closed'
                        ? featuredLot.currentBid === null
                          ? 'SEM ARREMATE'
                          : 'ARREMATADO POR'
                        : 'LANCE INICIAL'}
                  </span>
                  <strong>
                    {featuredLot.currentBid === null && featuredLot.status === 'closed'
                      ? '—'
                      : brl(featuredLot.currentBid ?? featuredLot.openingBid)}
                  </strong>
                  <small>
                    {featuredLot.leader
                      ? `${featuredLot.status === 'closed' ? 'Vencedor' : 'Na liderança'}: ${featuredLot.leader}`
                      : `Lance mínimo inicial: ${brl(featuredLot.openingBid)}`}
                  </small>
                </div>

                <div className="featured-timer-col">
                  <span>
                    {featuredLot.status === 'live'
                      ? 'TEMPO RESTANTE'
                      : featuredLot.status === 'scheduled'
                        ? 'ABRE EM'
                        : 'ENCERRADO EM'}
                  </span>
                  <strong className={featuredRemaining?.urgent ? 'urgent-text' : ''}>
                    {featuredRemaining ? featuredRemaining.text : when(featuredLot.endsAt)}
                  </strong>
                  <small>
                    {featuredLot.bidCount ?? 0}{' '}
                    {(featuredLot.bidCount ?? 0) === 1 ? 'lance registrado' : 'lances registrados'}{' '}
                    · Inc. {brl(featuredLot.increment)}
                  </small>
                </div>
              </div>

              <div className="featured-facts">
                <div>
                  <span>
                    {featuredLot.status === 'live' ? 'Próximo lance sugerido' : 'Abertura do lote'}
                  </span>
                  <strong>
                    {featuredLot.status === 'live'
                      ? brl(
                          featuredLot.currentBid === null
                            ? featuredLot.openingBid
                            : featuredLot.currentBid + featuredLot.increment
                        )
                      : when(featuredLot.startsAt)}
                  </strong>
                </div>
                <div>
                  <span>
                    {featuredLot.status === 'live' ? 'Fechamento previsto' : 'Incremento mínimo'}
                  </span>
                  <strong>
                    {featuredLot.status === 'live'
                      ? when(featuredLot.endsAt)
                      : brl(featuredLot.increment)}
                  </strong>
                </div>
              </div>

              <div className="featured-actions">
                <Link className="button button-primary" href={`/lots/${featuredLot.id}`}>
                  {featuredLot.status === 'live'
                    ? 'Entrar na Sala de Lances'
                    : featuredLot.status === 'closed'
                      ? 'Ver Resultado e Histórico'
                      : 'Acompanhar Lote'}{' '}
                  <span aria-hidden="true">→</span>
                </Link>
                <Link className="button button-outline" href={`/audit/${featuredLot.id}`}>
                  Ver auditoria pública
                </Link>
              </div>
            </div>
          </section>
        )}

        <section className="auction-section" id="auctions">
          <div className="catalog-header">
            <div className="catalog-title-group">
              <span className="eyebrow">ACERVO LANCEARTE</span>
              <h1>Lotes em disputa &amp; próximos pregões</h1>
              <p>
                {shown.length} {shown.length === 1 ? 'obra disponível' : 'obras disponíveis'} ·
                Acompanhe os lances ao vivo
              </p>
            </div>

            <div className="catalog-controls">
              <label className="gallery-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label="Buscar obra ou artista"
                  placeholder="Buscar por obra, artista ou ano…"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => setSearch('')}
                    aria-label="Limpar busca"
                  >
                    ×
                  </button>
                )}
              </label>
            </div>
          </div>

          <div className="catalog-filter-pills" role="group" aria-label="Filtrar por status">
            {categories.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={`catalog-pill ${filter === value ? 'active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value === 'live' && <i className="tab-live-dot" />}
                <span>{label}</span>
                <b>{count}</b>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="empty-state">
              <span className="loader" />
              <b>Carregando os lotes da galeria…</b>
              <span>Sincronizando pregões e lances em tempo real.</span>
            </div>
          ) : error ? (
            <div className="empty-state">
              <span className="empty-icon">⌁</span>
              <b>Não foi possível carregar os leilões.</b>
              <span>Verifique a conexão e tente novamente em instantes.</span>
              <button
                className="button button-outline"
                onClick={() => setLoadAttempt(value => value + 1)}
              >
                Tentar novamente ↻
              </button>
            </div>
          ) : shown.length ? (
            <div className="lot-grid">
              {shown.map(lot => (
                <LotCard lot={lot} nowMs={nowMs} key={lot.id} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">◇</span>
              <b>Nenhum lote encontrado para este filtro.</b>
              <span>
                Experimente limpar o campo de busca ou alternar entre as abas de status acima.
              </span>
              <div className="empty-actions">
                <button
                  className="button button-outline"
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                >
                  Mostrar todos os lotes
                </button>
                {!user && (
                  <button className="button button-primary" onClick={onLogin}>
                    Entrar na plataforma
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="how-it-works" aria-label="Como funciona a casa de leilões">
          <div className="how-header">
            <div>
              <span className="eyebrow">COMO FUNCIONA</span>
              <h2>A experiência de leilão na LanceArte</h2>
            </div>
            {!user && (
              <button className="button button-outline" onClick={onLogin}>
                Experimentar com conta de teste →
              </button>
            )}
          </div>
          <div className="how-grid">
            <article className="how-card">
              <span className="how-step">01 · LEILOEIRO (VENDEDOR)</span>
              <h3>Curadoria de Obras</h3>
              <p>
                O leiloeiro seleciona obras de grandes acervos internacionais, definindo lance
                inicial, incremento mínimo e horários de início e encerramento. Leiloeiros
                gerenciam seus próprios lotes e não ofertam lances.
              </p>
            </article>
            <article className="how-card">
              <span className="how-step">02 · LICITANTE (CLIENTE)</span>
              <h3>Carteira &amp; Lances ao Vivo</h3>
              <p>
                O licitante adiciona saldo simulado na carteira e disputa cada lote em tempo real.
                O valor do lance líder fica reservado automaticamente e libera o saldo do licitante
                anterior. Lances nos 2 minutos finais prorrogam o pregão.
              </p>
            </article>
            <article className="how-card">
              <span className="how-step">03 · ARREMATE &amp; TRANSPARÊNCIA</span>
              <h3>Comprovante &amp; Auditoria Aberta</h3>
              <p>
                Ao vencer o leilão, o arrematante recebe um comprovante oficial compartilhável por
                link. Qualquer visitante, mesmo sem login, pode auditar o histórico completo de
                lances e verificar sua autenticidade.
              </p>
            </article>
          </div>
        </section>
      </div>
    </>
  );
}
