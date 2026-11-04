import Link from 'next/link';
import { useState, useCallback, useEffect } from 'react';
import type { Item, Lot, User } from '../types';
import { apiFetch, errorMessage } from '../api-client';
import { brl, formatRemaining, toLocalInputValue, when } from '../formatters';
import { Artwork, Status } from '../auction-primitives';
import { AccessNotice } from './access-notice';

export function ConsoleView({
  user,
  onLogin,
  notify
}: {
  user: User | null;
  onLogin: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotFilter, setLotFilter] = useState<'all' | 'live' | 'scheduled' | 'closed'>('all');
  const [opening, setOpening] = useState('800');
  const [increment, setIncrement] = useState('50');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const applySchedulePreset = useCallback((startOffsetMinutes: number, durationMinutes: number) => {
    const now = new Date();
    const startDate = new Date(now.getTime() + startOffsetMinutes * 60 * 1000);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    setStarts(toLocalInputValue(startDate));
    setEnds(toLocalInputValue(endDate));
  }, []);

  useEffect(() => {
    applySchedulePreset(2, 120);
  }, [applySchedulePreset]);

  const loadLots = useCallback(
    () =>
      apiFetch('/auctioneer/lots')
        .then(r => r.json())
        .then(data => setLots(Array.isArray(data) ? data : [])),
    []
  );

  useEffect(() => {
    if (user?.role === 'auctioneer') loadLots();
  }, [user, loadLots]);

  const runSearch = async (termToSearch?: string) => {
    const targetQuery = (termToSearch ?? query).trim();
    if (!targetQuery) return;
    if (termToSearch) setQuery(termToSearch);
    setLoading(true);
    try {
      const response = await apiFetch(`/items?q=${encodeURIComponent(targetQuery)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data.items);
      if (!data.items.length) notify('error', 'Nenhuma obra encontrada. Tente outro termo.');
    } catch (error) {
      notify('error', errorMessage(error, 'Não foi possível pesquisar obras.'));
    } finally {
      setLoading(false);
    }
  };

  const createLot = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return notify('error', 'Escolha uma obra na busca para montar o lote.');
    setSubmitting(true);
    try {
      const response = await apiFetch('/lots', {
        method: 'POST',
        body: JSON.stringify({
          sourceId: selected.id,
          openingBid: Number(opening),
          increment: Number(increment),
          startsAt: new Date(starts).toISOString(),
          endsAt: new Date(ends).toISOString()
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      notify('success', `Lote "${selected.title}" publicado com sucesso na vitrine!`);
      setSelected(null);
      setItems([]);
      setQuery('');
      await loadLots();
    } catch (error) {
      notify('error', errorMessage(error, 'Não foi possível criar o lote.'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelLot = async (lotId: string) => {
    const response = await apiFetch(`/lots/${lotId}/cancel`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) notify('error', data.error);
    else {
      notify('success', 'Lote cancelado.');
      await loadLots();
    }
  };

  if (!user) {
    return (
      <AccessNotice
        title="Painel do Leiloeiro (Vendedor)"
        message="Entre com uma conta de Leiloeiro para selecionar obras do acervo, configurar lances iniciais e gerenciar seus lotes."
        onLogin={onLogin}
      />
    );
  }
  if (user.role !== 'auctioneer') {
    return (
      <AccessNotice
        title="Acesso exclusivo para Leiloeiros"
        message="Você está conectado como Licitante (Cliente). Para publicar e gerenciar lotes, entre com o perfil de Leiloeiro."
        onLogin={onLogin}
      />
    );
  }

  const activeLots = lots.filter(l => l.status !== 'cancelled');
  const liveLotsCount = lots.filter(l => l.status === 'live').length;
  const scheduledLotsCount = lots.filter(l => l.status === 'scheduled').length;
  const closedLotsCount = lots.filter(l => l.status === 'closed').length;
  const filteredLots = lots.filter(l => (lotFilter === 'all' ? true : l.status === lotFilter));

  const quickArtistTerms = ['Van Gogh', 'Monet', 'Portinari', 'Rembrandt', 'Cézanne', 'Hokusai'];

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">PAINEL DO LEILOEIRO · VENDEDOR</span>
          <h1>Curadoria &amp; Gestão de Pregões</h1>
          <p>
            Olá, <b>{user.name}</b>. Pesquise obras nos acervos internacionais, defina os valores
            de disputa e acompanhe seus lotes publicados.
          </p>
        </div>

        <div className="dashboard-kpis">
          <div className="kpi-box">
            <span>PUBLICADOS</span>
            <strong>{activeLots.length}</strong>
          </div>
          <div className="kpi-box kpi-live">
            <span>AO VIVO</span>
            <strong>{liveLotsCount}</strong>
          </div>
          <div className="kpi-box">
            <span>AGENDADOS</span>
            <strong>{scheduledLotsCount}</strong>
          </div>
          <div className="kpi-box">
            <span>ENCERRADOS</span>
            <strong>{closedLotsCount}</strong>
          </div>
        </div>
      </div>

      <div className="console-grid">
        {/* STEP 1 & 2: SEARCH CATALOG & CREATE LOT */}
        <div className="panel create-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">01 · CATÁLOGO DE OBRAS</span>
              <h2>Selecionar obra para novo lote</h2>
            </div>
            <span className="panel-icon">⌕</span>
          </div>
          <p>
            Busque obras nos catálogos do <b>Art Institute of Chicago</b> e do{' '}
            <b>Projeto Portinari</b>.
          </p>

          <div className="search-input">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && runSearch()}
              placeholder="Digite artista, obra ou tema (ex.: Monet, Café, Hokusai)…"
            />
            <button type="button" onClick={() => runSearch()} disabled={loading}>
              {loading ? 'Buscando…' : 'Buscar obra'}
            </button>
          </div>

          <div className="quick-search-chips">
            <span>Sugestões rápidas:</span>
            {quickArtistTerms.map(term => (
              <button key={term} type="button" onClick={() => runSearch(term)}>
                {term}
              </button>
            ))}
          </div>

          {items.length > 0 && (
            <div className="item-results">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`item-result ${selected?.id === item.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(item);
                    if (!starts || !ends) applySchedulePreset(0, 120);
                  }}
                >
                  <Artwork src={item.imageUrl} title={item.title} />
                  <div className="item-result-copy">
                    <b>{item.title}</b>
                    <small>
                      {item.artist} · {item.date}
                    </small>
                    <ins>{item.publicDomain ? 'Domínio Público' : 'Acervo Catalogado'}</ins>
                  </div>
                  <span className="select-check">
                    {selected?.id === item.id ? '✓ Selecionada' : 'Selecionar +'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selected ? (
            <form className="lot-form" onSubmit={createLot}>
              <div className="selected-art-card">
                <Artwork src={selected.imageUrl} title={selected.title} />
                <div className="selected-art-info">
                  <span>02 · OBRA SELECIONADA PARA O LOTE</span>
                  <b>{selected.title}</b>
                  <small>
                    {selected.artist} · {selected.date}
                  </small>
                </div>
                <button
                  type="button"
                  className="clear-selected"
                  onClick={() => setSelected(null)}
                  title="Trocar obra"
                >
                  ×
                </button>
              </div>

              <div className="form-row">
                <label>
                  Lance inicial (R$)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={opening}
                    onChange={event => setOpening(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Incremento mínimo (R$)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={increment}
                    onChange={event => setIncrement(event.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="schedule-presets">
                <span>Janela do pregão (preenchimento rápido):</span>
                <div className="preset-buttons">
                  <button type="button" onClick={() => applySchedulePreset(0, 3)}>
                    ⚡ Ao vivo agora · 3 min (teste rápido)
                  </button>
                  <button type="button" onClick={() => applySchedulePreset(0, 120)}>
                    ● Ao vivo agora · 2 horas
                  </button>
                  <button type="button" onClick={() => applySchedulePreset(0, 1440)}>
                    ● Ao vivo agora · 24 horas
                  </button>
                  <button type="button" onClick={() => applySchedulePreset(60, 180)}>
                    ⏳ Agendar +1h
                  </button>
                </div>
              </div>

              <div className="form-row">
                <label>
                  Horário de início
                  <input
                    type="datetime-local"
                    value={starts}
                    onChange={event => setStarts(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Horário de encerramento
                  <input
                    type="datetime-local"
                    value={ends}
                    onChange={event => setEnds(event.target.value)}
                    required
                  />
                </label>
              </div>

              <button className="button button-primary full-button" disabled={submitting}>
                {submitting ? 'Publicando lote na vitrine…' : 'Publicar Lote no Pregão ↗'}
              </button>
            </form>
          ) : (
            <div className="lot-form-placeholder">
              <span>◇</span>
              <p>
                Busque e selecione uma obra acima para definir o lance inicial, incremento mínimo e
                horário do pregão.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT PANEL: MANAGE LOTS */}
        <div className="panel dashboard-lots">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">GESTÃO DO ACERVO</span>
              <h2>Meus lotes publicados</h2>
            </div>
            <span className="count-badge">{lots.length}</span>
          </div>

          <div className="managed-filters">
            {(
              [
                ['all', 'Todos'],
                ['live', 'Ao vivo'],
                ['scheduled', 'Agendados'],
                ['closed', 'Encerrados']
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={lotFilter === val ? 'active' : ''}
                onClick={() => setLotFilter(val)}
              >
                {label}
              </button>
            ))}
          </div>

          {filteredLots.length ? (
            <div className="managed-lot-list">
              {filteredLots.map(lot => {
                const canCancel =
                  (lot.status === 'scheduled' || lot.status === 'live') &&
                  (lot.bidCount ?? 0) === 0;
                return (
                  <div className="managed-lot" key={lot.id}>
                    <Artwork src={lot.imageUrl} title={lot.title} />
                    <div className="managed-lot-copy">
                      <div className="managed-lot-top">
                        <Status value={lot.status} />
                        <small>#{lot.id.slice(0, 6).toUpperCase()}</small>
                      </div>
                      <b>{lot.title}</b>
                      <span>
                        {lot.currentBid !== null
                          ? `Atual: ${brl(lot.currentBid)}`
                          : `Inicial: ${brl(lot.openingBid)}`}{' '}
                        · {lot.bidCount ?? 0} {(lot.bidCount ?? 0) === 1 ? 'lance' : 'lances'}
                      </span>
                      <small className="managed-dates">
                        {when(lot.startsAt)} até {when(lot.endsAt)}
                      </small>
                    </div>
                    <div className="managed-actions">
                      <Link href={`/lots/${lot.id}`} className="action-btn" title="Abrir sala do lote">
                        Sala ↗
                      </Link>
                      <Link
                        href={`/audit/${lot.id}`}
                        className="action-btn"
                        title="Ver histórico do lote"
                      >
                        Histórico
                      </Link>
                      {lot.receiptToken && (
                        <Link
                          href={`/receipt/${lot.receiptToken}`}
                          className="action-btn highlight"
                          title="Comprovante de arremate"
                        >
                          Recibo
                        </Link>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          className="action-btn danger"
                          onClick={() => cancelLot(lot.id)}
                          title="Cancelar lote sem lances"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="small-empty">
              Nenhum lote encontrado neste filtro. Use o painel ao lado para buscar uma obra e
              publicar um novo lote.
            </div>
          )}

          <div className="seller-note">
            <span>✦</span>
            <p>
              <b>Regra de cancelamento:</b> Lotes agendados ou ao vivo que ainda não receberam
              lances podem ser cancelados pelo leiloeiro. Após o primeiro lance, o lote segue até o
              encerramento.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
