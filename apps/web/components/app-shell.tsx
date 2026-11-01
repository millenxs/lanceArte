'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const SOCKET = process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type User = { id: string; name: string; role: 'auctioneer' | 'bidder' };
type Lot = { id: string; title: string; imageUrl?: string; artwork: any; openingBid: number; increment: number; startsAt: string; endsAt: string; status: string; currentBid: number | null; leader: string | null; sellerName: string; receiptToken?: string | null; isCurrentUserLeader?: boolean };
type Bid = { bidder: string; amount: number; createdAt: string };
type Item = { id: string; title: string; artist: string; date: string; imageUrl?: string | null; publicDomain: boolean; sourceUrl: string };
type Flash = { kind: 'success' | 'error'; text: string } | null;

const brl = (value?: number | null) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
const when = (value?: string) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const apiFetch = (path: string, init?: RequestInit) => fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { live: 'Ao vivo', scheduled: 'Agendado', closed: 'Encerrado', cancelled: 'Cancelado' };
  return <span className={`status status-${value}`}><i />{labels[value] ?? value}</span>;
}
function Money({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={muted ? 'money muted' : 'money'}>{children}</span>;
}
function Artwork({ src, title, className = '' }: { src?: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div className={`artwork ${className}`}>
    {src && !failed ? <img src={src} alt={title} onError={() => setFailed(true)} /> : <div className="artwork-placeholder"><span>LA</span><small>{src ? 'Imagem indisponível · consulte o acervo' : 'Obra de arte'}</small></div>}
    <span className="artwork-shade" />
  </div>;
}
function LotCard({ lot }: { lot: Lot }) {
  return <Link className="lot-card" href={`/lots/${lot.id}`}>
    <Artwork src={lot.imageUrl} title={lot.title} />
    <div className="lot-card-body">
      <div className="lot-card-meta"><Status value={lot.status} /><span>{lot.status === 'live' ? 'Termina' : 'Início'} {when(lot.status === 'live' ? lot.endsAt : lot.startsAt)}</span></div>
      <h3>{lot.title}</h3>
      <p>{lot.artwork?.artist ?? lot.artwork?.artist_title ?? 'Coleção LanceArte'}</p>
      <div className="lot-card-price"><span>{lot.status === 'live' ? 'Lance atual' : 'Lance inicial'}</span><Money>{brl(lot.currentBid ?? lot.openingBid)}</Money></div>
      <div className="lot-card-footer"><span>Incremento {brl(lot.increment)}</span><b>{lot.status === 'live' ? 'Dar lance' : lot.status === 'scheduled' ? 'Ver lote' : 'Ver resultado'} <span aria-hidden="true">→</span></b></div>
    </div>
  </Link>;
}
function LiveBidTicker({ bids }: { bids: Bid[] }) {
  const recentBids = bids.slice(0, 8);
  const loop = [...recentBids, ...recentBids];
  return <div className="live-bid-ticker" aria-label="Lances recentes; lista em rolagem automática" aria-live="off">
    <div className="live-bid-track">
      {loop.map((bid, index) => <div className="bid-row" key={`${bid.createdAt}-${index}`} aria-hidden={index >= recentBids.length}>
        <span className="avatar tiny-avatar">{bid.bidder.slice(-1)}</span>
        <span><b>{bid.bidder}</b><small>{when(bid.createdAt)}</small></span>
        <strong>{brl(bid.amount)}</strong>
      </div>)}
    </div>
  </div>;
}
function ShellLayout({ children, user, onLogin, onLogout }: { children: React.ReactNode; user: User | null; onLogin: () => void; onLogout: () => void }) {
  const mark = <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="m8.2 6.4 4.2-4.2 10.1 10.1-4.2 4.2z" /><path d="m18.8 13.2-9.1 9.1" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="M5.6 23.2h16v3.2h-16z" /></svg>;
  return <><header className="topbar"><Link href="/" className="brand"><span className="brand-mark">{mark}</span><span>lance<span>arte</span></span></Link><nav className="main-nav"><Link href="/#auctions">Explorar lotes</Link>{user?.role === 'auctioneer' && <Link href="/console">Painel do leiloeiro</Link>}{user?.role === 'bidder' && <Link href="/wallet">Minha carteira</Link>}<Link href="/#how-it-works">Como participar</Link></nav><div className="account-area">{user ? <><span className="user-chip"><span className="avatar">{user.name.slice(0, 1)}</span><span>{user.name}<small>{user.role === 'auctioneer' ? 'Leiloeiro' : 'Licitante'}</small></span></span><button className="button button-quiet compact" onClick={onLogout}>Sair</button></> : <button className="button button-dark compact" onClick={onLogin}>Entrar</button>}</div></header><main>{children}</main><footer className="footer"><Link href="/" className="brand footer-brand"><span className="brand-mark">{mark}</span><span>lance<span>arte</span></span></Link><p>Arte encontra novos caminhos.</p><span>© 2026 LanceArte · Leilões de arte simulados</span></footer></>;
}

export function AppShell({ view, id }: { view: 'home' | 'console' | 'wallet' | 'lot' | 'audit' | 'receipt'; id?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [refresh, setRefresh] = useState(0);
  const notify = useCallback((kind: 'success' | 'error', text: string) => { setFlash({ kind, text }); window.setTimeout(() => setFlash(null), 4500); }, []);
  const authenticate = useCallback(async (mode: 'login' | 'register', credentials: { name?: string; email: string; password: string; role?: 'bidder' | 'auctioneer' }) => {
    const response = await apiFetch(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(credentials) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível acessar o acervo.');
    setUser(data.user); setLoginOpen(false); setRefresh(value => value + 1); notify('success', `${mode === 'register' ? 'Perfil criado' : 'Bem-vinda(o) de volta'}, ${data.user.name}.`);
  }, [notify]);
  const logout = async () => {
    try {
      const response = await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      if (!response.ok) throw new Error('Não foi possível encerrar a sessão. Tente novamente.');
      const session = await apiFetch('/auth/me').then(result => result.json());
      if (session.user) throw new Error('A sessão continua ativa. Atualize a página e tente sair novamente.');
      setUser(null);
      setRefresh(value => value + 1);
      notify('success', 'Você saiu da sua conta.');
    } catch (error: any) {
      notify('error', error.message ?? 'Não foi possível encerrar a sessão.');
    }
  };

  useEffect(() => {
    apiFetch('/auth/me').then(r => r.json()).then(session => setUser(session.user)).catch(() => {});
  }, [refresh]);

  return <ShellLayout user={user} onLogin={() => setLoginOpen(true)} onLogout={logout}>
    {flash && <div className={`flash flash-${flash.kind}`} role="status">{flash.text}<button onClick={() => setFlash(null)} aria-label="Fechar">×</button></div>}
    {view === 'home' && <HomeView onLogin={() => setLoginOpen(true)} key={refresh} />}
    {view === 'lot' && id && <LotView id={id} user={user} onLogin={() => setLoginOpen(true)} notify={notify} key={`${id}-${refresh}`} />}
    {view === 'console' && <ConsoleView user={user} notify={notify} key={refresh} />}
    {view === 'wallet' && <WalletView user={user} notify={notify} key={refresh} />}
    {view === 'audit' && id && <AuditView id={id} />}
    {view === 'receipt' && id && <ReceiptView token={id} />}
    {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onAuthenticate={authenticate} />}
  </ShellLayout>;
}

function LoginModal({ onClose, onAuthenticate }: { onClose: () => void; onAuthenticate: (mode: 'login' | 'register', credentials: { name?: string; email: string; password: string; role?: 'bidder' | 'auctioneer' }) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [role, setRole] = useState<'bidder' | 'auctioneer'>('bidder'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const demoAccounts = [
    { label: 'Licitante', email: 'colecionador@lancearte.test', password: 'Galeria#2026' },
    { label: 'Leiloeira', email: 'leiloeira@lancearte.test', password: 'Atelie#2026' }
  ];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onAuthenticate(mode, { name, email, password, role }); }
    catch (cause: any) { setError(cause.message ?? 'Não foi possível continuar. Confira os dados e tente novamente.'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className={`modal login-modal mode-${mode}`} role="dialog" aria-modal="true" aria-labelledby="access-title">
      <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
      <div className="login-artwork"><img src="/api/images/2d484387-2509-5e8e-2c43-22f9981972eb" alt="Detalhe da obra Um domingo na Grande Jatte, de Georges Seurat" /><span>UMA VISITA COMEÇA POR AQUI</span><small>Georges Seurat · Art Institute of Chicago</small></div>
      <div className="login-content">
        <span className="eyebrow">Acesso ao acervo</span><h2 id="access-title">{mode === 'login' ? 'Entre na galeria.' : 'Abra seu lugar na galeria.'}</h2>
        <p>{mode === 'login' ? 'Retome seus lances e acompanhe as obras que despertaram seu interesse.' : 'Crie um perfil para participar dos leilões ou montar seus próprios lotes.'}</p>
        <div className="access-tabs" role="group" aria-label="Entrar ou criar perfil">
          <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>Entrar</button>
          <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>Criar perfil</button>
        </div>
        <form className="access-form" onSubmit={submit}>
          {mode === 'register' && <label>Como podemos chamar você?<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required placeholder="Seu nome" /></label>}
          <label>Seu e-mail<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="voce@exemplo.com" /></label>
          <label>Senha<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === 'register' ? 10 : undefined} maxLength={128} required placeholder={mode === 'register' ? 'Pelo menos 10 caracteres' : 'Sua senha'} /></label>
          {mode === 'register' && <fieldset className="role-choice"><legend>Como deseja participar?</legend><label className={role === 'bidder' ? 'chosen' : ''}><input type="radio" name="role" value="bidder" checked={role === 'bidder'} onChange={() => setRole('bidder')} /><span><b>Quero dar lances</b><small>Descubra obras e acompanhe os arremates.</small></span></label><label className={role === 'auctioneer' ? 'chosen' : ''}><input type="radio" name="role" value="auctioneer" checked={role === 'auctioneer'} onChange={() => setRole('auctioneer')} /><span><b>Quero oferecer obras</b><small>Monte lotes e acompanhe os resultados.</small></span></label></fieldset>}
          {error && <div className="access-error" role="alert">{error}</div>}
          <button className="button button-dark access-submit" disabled={busy}>{busy ? 'Preparando seu acesso…' : mode === 'login' ? 'Entrar no acervo' : 'Criar perfil e continuar'}</button>
        </form>
        {mode === 'login' && <div className="test-access"><span>Quer conhecer por dentro?</span>{demoAccounts.map(account => <button key={account.email} type="button" onClick={() => { setEmail(account.email); setPassword(account.password); setError(''); }}><b>{account.label}</b><small>{account.email}</small><small>Senha · {account.password}</small><i>Preencher acesso</i></button>)}</div>}
        <small className="modal-note">Leilões e depósitos são simulados. Não há cobrança real.</small>
      </div>
    </section>
  </div>;
}

function HomeView({ onLogin }: { onLogin: () => void }) {
  const [lots, setLots] = useState<Lot[]>([]); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => { setLoading(true); setError(false); apiFetch('/lots').then(r => { if (!r.ok) throw new Error('API indisponível'); return r.json(); }).then(data => setLots(Array.isArray(data) ? data : [])).catch(() => setError(true)).finally(() => setLoading(false)); }, [loadAttempt]);
  const shown = lots.filter(lot => {
    const matchesStatus = filter === 'all' ? lot.status !== 'cancelled' : lot.status === filter;
    const searchableText = `${lot.title} ${lot.artwork?.artist ?? lot.artwork?.artist_title ?? ''}`.toLocaleLowerCase('pt-BR');
    return matchesStatus && searchableText.includes(search.trim().toLocaleLowerCase('pt-BR'));
  });
  const liveCount = lots.filter(lot => lot.status === 'live').length;
  return <>
    <section className="marketplace-heading">
      <div className="marketplace-title"><div><span className="eyebrow">LANCEARTE · LEILÕES DE ARTE</span><h1>Obras em disputa</h1><p>Explore os lotes, acompanhe os lances e encontre sua próxima obra.</p></div><div className="marketplace-live"><i /><strong>{liveCount.toString().padStart(2, '0')}</strong><span>leilões<br />ao vivo</span></div></div>
      <label className="gallery-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Buscar obra ou artista" placeholder="Busque por obra ou artista" value={search} onChange={event => setSearch(event.target.value)} /><kbd>⌕</kbd></label>
    </section>
    <section className="auction-section" id="auctions"><div className="catalog-toolbar"><div className="catalog-categories" aria-label="Filtrar lotes">{[['all', 'Todos os lotes'], ['live', 'Ao vivo'], ['scheduled', 'Em breve'], ['closed', 'Encerrados']].map(([value, label]) => <button key={value} className={`filter-pill ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{label}{value === 'live' && <span>{liveCount}</span>}</button>)}</div><span className="lot-count">{shown.length} {shown.length === 1 ? 'lote' : 'lotes'}</span></div>{loading ? <div className="empty-state"><span className="loader" />Carregando os lotes…</div> : error ? <div className="empty-state"><span className="empty-icon">⌁</span><b>Não foi possível carregar os leilões.</b><span>A conexão com a plataforma não respondeu. Verifique se a API está disponível e tente novamente.</span><button className="button button-outline" onClick={() => setLoadAttempt(value => value + 1)}>Tentar novamente ↻</button></div> : shown.length ? <div className="lot-grid">{shown.map(lot => <LotCard lot={lot} key={lot.id} />)}</div> : <div className="empty-state"><span className="empty-icon">◇</span><b>Nenhum lote por aqui ainda.</b><span>Os próximos leilões aparecem nesta galeria assim que forem publicados.</span><button className="button button-outline" onClick={onLogin}>Acessar o acervo</button></div>}</section>
    <section className="marketplace-assurances" id="how-it-works"><span><b>01</b> Depósitos simulados</span><span><b>02</b> Disputa em tempo real</span><span><b>03</b> Histórico público e verificável</span></section>
  </>;
}

function LotView({ id, user, onLogin, notify }: { id: string; user: User | null; onLogin: () => void; notify: (kind: 'success' | 'error', text: string) => void }) {
  const [lot, setLot] = useState<Lot | null>(null); const [bids, setBids] = useState<Bid[]>([]); const [amount, setAmount] = useState(''); const [busy, setBusy] = useState(false); const [clock, setClock] = useState(Date.now());
  const load = useCallback(async () => { const [lotResponse, bidResponse] = await Promise.all([apiFetch(`/lots/${id}`), apiFetch(`/lots/${id}/bids`)]); const lotData = await lotResponse.json(); if (lotResponse.ok) setLot(lotData); setBids(await bidResponse.json()); }, [id]);
  useEffect(() => { load().catch(() => notify('error', 'Não foi possível carregar este lote.')); }, [load, notify]);
  useEffect(() => { const channel: Socket = io(SOCKET, { withCredentials: true }); channel.emit('lot:join', id); channel.on('lot:bid', () => { load(); }); channel.on('lot:live', () => { load(); }); channel.on('lot:closed', () => { load(); }); return () => { channel.disconnect(); }; }, [id, load]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!lot || lot.status !== 'live') return; const timeout = window.setTimeout(() => load(), Math.max(0, new Date(lot.endsAt).getTime() - Date.now() + 300)); return () => window.clearTimeout(timeout); }, [lot?.status, lot?.endsAt, load]);
  const minimum = lot ? (lot.currentBid ?? (lot.openingBid - lot.increment)) + lot.increment : 0;
  const secondsLeft = lot ? Math.max(0, Math.floor((new Date(lot.endsAt).getTime() - clock) / 1000)) : 0;
  const countdown = `${String(Math.floor(secondsLeft / 3600)).padStart(2, '0')}:${String(Math.floor(secondsLeft % 3600 / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const placeBid = async () => { if (!user) return onLogin(); setBusy(true); try { const response = await apiFetch(`/lots/${id}/bids`, { method: 'POST', body: JSON.stringify({ amount: Number(amount || minimum) }) }); const data = await response.json(); if (!response.ok) return notify('error', data.error); setAmount(''); notify('success', data.extended ? 'Lance aceito. O lote ganhou mais dois minutos.' : 'Lance aceito. Você está na disputa.'); await load(); } finally { setBusy(false); } };
  if (!lot) return <div className="page-loader"><span className="loader" />Carregando o lote…</div>;
  const showBidTicker = lot.artwork?.seedKey === 'demo:van-gogh-bedroom' && bids.length > 1;
  return <section className="detail-page"><div className="breadcrumb"><Link href="/">Galeria</Link><span> / </span><span>{lot.title}</span></div><div className="detail-grid"><div><Artwork src={lot.imageUrl} title={lot.title} className="detail-art" /><div className="detail-links"><Link href={`/audit/${lot.id}`}>↗ Ver auditoria pública</Link>{lot.receiptToken && <Link href={`/receipt/${lot.receiptToken}`}>◇ Ver comprovante</Link>}</div></div><div className="detail-copy"><div className="detail-overline"><Status value={lot.status} /><span>LOTE #{lot.id.slice(0, 6).toUpperCase()}</span></div><h1>{lot.title}</h1><p className="detail-artist">{lot.artwork?.artist ?? lot.artwork?.artist_title} · {lot.artwork?.date ?? lot.artwork?.date_display}</p><p className="detail-description">Uma obra selecionada do acervo público. Conheça sua trajetória e acompanhe a disputa por uma peça única.</p><div className="detail-pricebox"><div><span>{lot.status === 'live' ? 'LANCE ATUAL' : lot.status === 'closed' ? 'ARREMATADO POR' : 'LANCE INICIAL'}</span><strong>{brl(lot.currentBid ?? lot.openingBid)}</strong></div><div className="leader-tag">{lot.leader ? <><span>NA LIDERANÇA</span><b>{lot.leader}</b></> : <><span>INCREMENTO MÍNIMO</span><b>{brl(lot.increment)}</b></>}</div></div>{lot.status === 'live' ? <><div className="detail-timing live-timing"><div><span>ABERTURA</span><b>{when(lot.startsAt)}</b></div><div><span>ENCERRA EM</span><b className="countdown">{countdown}</b></div></div>{user?.role === 'bidder' && lot.isCurrentUserLeader !== undefined && <div className={`lead-status ${lot.isCurrentUserLeader ? 'lead-winning' : 'lead-outbid'}`}>{lot.isCurrentUserLeader ? '✓ Você está ganhando neste lote.' : '↑ Você foi superado. Um novo lance pode colocar você na liderança.'}</div>}<div className="bid-panel"><label htmlFor="bid-amount">Seu lance</label><div className="bid-entry"><span>R$</span><input id="bid-amount" type="number" min={minimum} step={lot.increment} placeholder={minimum.toFixed(2)} value={amount} onChange={event => setAmount(event.target.value)} /><button className="button button-lime" onClick={placeBid} disabled={busy}>{busy ? 'Enviando…' : 'Dar meu lance ↗'}</button></div><small>O próximo lance deve ser de pelo menos {brl(minimum)}. Saldo simulado, sem pagamentos reais.</small>{!user && <button className="text-link login-prompt" onClick={onLogin}>Entre com uma conta de licitante para participar</button>}</div></> : <><div className="notice-box">{lot.status === 'closed' ? 'Este leilão foi encerrado.' : `Lances abrem em ${when(lot.startsAt)}.`}{lot.receiptToken && <Link href={`/receipt/${lot.receiptToken}`}> Abrir comprovante do arremate ↗</Link>}</div><div className="detail-timing"><div><span>ABERTURA</span><b>{when(lot.startsAt)}</b></div><div><span>ENCERRAMENTO</span><b>{when(lot.endsAt)}</b></div></div></>}<div className="bid-history"><div className="history-heading"><h3>Histórico de lances</h3><Link href={`/audit/${lot.id}`}>Verificar integridade ↗</Link></div>{bids.length ? showBidTicker ? <LiveBidTicker bids={bids} /> : bids.slice(0, 8).map((bid, index) => <div className="bid-row" key={`${bid.createdAt}-${index}`}><span className="avatar tiny-avatar">{bid.bidder.slice(-1)}</span><span><b>{bid.bidder}</b><small>{when(bid.createdAt)}</small></span><strong>{brl(bid.amount)}</strong></div>) : <p className="history-empty">Ainda não há lances. Seja o primeiro a participar.</p>}</div></div></div></section>;
}

function ConsoleView({ user, notify }: { user: User | null; notify: (kind: 'success' | 'error', text: string) => void }) {
  const [query, setQuery] = useState(''); const [items, setItems] = useState<Item[]>([]); const [selected, setSelected] = useState<Item | null>(null); const [lots, setLots] = useState<Lot[]>([]); const [opening, setOpening] = useState('500'); const [increment, setIncrement] = useState('50'); const [starts, setStarts] = useState(''); const [ends, setEnds] = useState(''); const [loading, setLoading] = useState(false); const [submitting, setSubmitting] = useState(false);
  const loadLots = useCallback(() => apiFetch('/auctioneer/lots').then(r => r.json()).then(data => setLots(Array.isArray(data) ? data : [])), []);
  useEffect(() => { if (user?.role === 'auctioneer') loadLots(); }, [user, loadLots]);
  const search = async () => { if (!query.trim()) return; setLoading(true); try { const response = await apiFetch(`/items?q=${encodeURIComponent(query)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setItems(data.items); if (!data.items.length) notify('error', 'Nenhuma obra encontrada. Tente outro termo.'); } catch (error: any) { notify('error', error.message); } finally { setLoading(false); } };
  const createLot = async (event: React.FormEvent) => { event.preventDefault(); if (!selected) return notify('error', 'Escolha uma obra para o lote.'); setSubmitting(true); try { const response = await apiFetch('/lots', { method: 'POST', body: JSON.stringify({ sourceId: selected.id, openingBid: Number(opening), increment: Number(increment), startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); notify('success', 'Lote publicado na galeria.'); setSelected(null); setItems([]); setQuery(''); await loadLots(); } catch (error: any) { notify('error', error.message); } finally { setSubmitting(false); } };
  const cancelLot = async (lotId: string) => { const response = await apiFetch(`/lots/${lotId}/cancel`, { method: 'POST' }); const data = await response.json(); if (!response.ok) notify('error', data.error); else { notify('success', 'Lote cancelado.'); await loadLots(); } };
  if (!user) return <AccessNotice title="Painel do leiloeiro" message="Entre com o perfil de leiloeiro para criar e gerenciar lotes." />;
  if (user.role !== 'auctioneer') return <AccessNotice title="Acesso ao ateliê" message="Este espaço é para quem organiza os lotes. Entre com um perfil de leiloeiro ou crie um perfil de leiloeiro para continuar." />;
  const ownLots = lots;
  return <section className="dashboard-page"><div className="dashboard-heading"><div><span className="eyebrow">Ateliê do leiloeiro</span><h1>Bom dia, {user.name}.</h1><p>Prepare a próxima obra para encontrar seu novo destino.</p></div><div className="dashboard-stat"><span>LOTES PUBLICADOS</span><strong>{ownLots.length.toString().padStart(2, '0')}</strong></div></div><div className="console-grid"><div className="panel create-panel"><div className="panel-heading"><div><span className="eyebrow">01 / CATÁLOGO</span><h2>Encontre uma obra</h2></div><span className="panel-icon">⌕</span></div><p>Busque no acervo do Art Institute of Chicago.</p><div className="search-input"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && search()} placeholder="Ex.: Monet, paisagem, flores…" /><button onClick={search} disabled={loading}>{loading ? '…' : 'Buscar ↗'}</button></div>{items.length > 0 && <div className="item-results">{items.map(item => <button key={item.id} className={`item-result ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelected(item)}><Artwork src={item.imageUrl} title={item.title} /><span><b>{item.title}</b><small>{item.artist} · {item.date}</small></span><span className="select-check">{selected?.id === item.id ? '✓' : '+'}</span></button>)}</div>}{selected && <form className="lot-form" onSubmit={createLot}><div className="selected-art"><span>OBRA SELECIONADA</span><b>{selected.title}</b><small>{selected.artist} · <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Fonte ↗</a></small></div><div className="form-row"><label>Lance inicial (R$)<input type="number" min="1" step="0.01" value={opening} onChange={event => setOpening(event.target.value)} required /></label><label>Incremento (R$)<input type="number" min="1" step="0.01" value={increment} onChange={event => setIncrement(event.target.value)} required /></label></div><div className="form-row"><label>Início<input type="datetime-local" value={starts} onChange={event => setStarts(event.target.value)} required /></label><label>Encerramento<input type="datetime-local" value={ends} onChange={event => setEnds(event.target.value)} required /></label></div><button className="button button-dark full-button" disabled={submitting}>{submitting ? 'Publicando…' : 'Publicar lote ↗'}</button></form>}</div><div className="panel dashboard-lots"><div className="panel-heading"><div><span className="eyebrow">02 / SEUS LOTES</span><h2>Em andamento</h2></div><span className="count-badge">{ownLots.length}</span></div>{ownLots.length ? ownLots.map(lot => <div className="managed-lot" key={lot.id}><Artwork src={lot.imageUrl} title={lot.title} /><div className="managed-lot-copy"><b>{lot.title}</b><span><Status value={lot.status} /> · {brl(lot.currentBid ?? lot.openingBid)}</span></div><div className="managed-actions"><Link href={`/lots/${lot.id}`} aria-label="Abrir lote">↗</Link>{lot.status === 'scheduled' && <button onClick={() => cancelLot(lot.id)} title="Cancelar lote">×</button>}</div></div>) : <div className="small-empty">Seus lotes aparecem aqui após a publicação.</div>}<div className="seller-note"><span>✦</span><p>Itens existentes permanecem disponíveis mesmo se o acervo externo ficar fora do ar.</p></div></div></div></section>;
}

function WalletView({ user, notify }: { user: User | null; notify: (kind: 'success' | 'error', text: string) => void }) {
  const [wallet, setWallet] = useState<any>(null); const [wins, setWins] = useState<any[]>([]); const [amount, setAmount] = useState('500'); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { const [balance, victories] = await Promise.all([apiFetch('/wallet/me'), apiFetch('/wallet/wins')]); if (balance.ok) setWallet(await balance.json()); if (victories.ok) setWins(await victories.json()); }, []);
  useEffect(() => { if (user?.role === 'bidder') refresh(); }, [user, refresh]);
  const deposit = async () => { setBusy(true); try { const response = await apiFetch('/wallet/deposits', { method: 'POST', body: JSON.stringify({ amount: Number(amount) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); notify('success', `Depósito simulado de ${brl(Number(amount))} concluído.`); await refresh(); } catch (error: any) { notify('error', error.message); } finally { setBusy(false); } };
  if (!user) return <AccessNotice title="Sua carteira" message="Entre com um perfil de licitante para consultar seu saldo." />;
  if (user.role !== 'bidder') return <AccessNotice title="Área do licitante" message="A carteira está disponível para perfis de licitante. Entre com uma conta de licitante ou crie seu perfil." />;
  return <section className="dashboard-page wallet-page"><div className="dashboard-heading"><div><span className="eyebrow">SUA CONTA</span><h1>Uma carteira para descobrir.</h1><p>Olá, {user.name}. Acompanhe seu saldo e seus arremates.</p></div></div><div className="wallet-grid"><div className="balance-card"><span className="eyebrow">SALDO DISPONÍVEL</span><strong>{brl(wallet?.available)}</strong><div className="balance-details"><span>Saldo total <b>{brl(wallet?.total)}</b></span><span>Comprometido <b>{brl(wallet?.committed)}</b></span></div><div className="wallet-deposit"><label htmlFor="deposit-amount">Adicionar saldo simulado</label><div className="bid-entry"><span>R$</span><input id="deposit-amount" type="number" min="1" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /><button className="button button-lime" disabled={busy} onClick={deposit}>{busy ? 'Adicionando…' : 'Adicionar saldo +'}</button></div><small>Este saldo é apenas demonstrativo. Nenhuma cobrança será realizada.</small></div></div><div className="panel win-panel"><div className="panel-heading"><div><span className="eyebrow">HISTÓRICO</span><h2>Meus arremates</h2></div><span className="count-badge">{wins.length}</span></div>{wins.length ? wins.map(win => <div className="managed-lot win-lot" key={win.id}><Artwork src={win.imageUrl} title={win.title} /><div className="managed-lot-copy"><b>{win.title}</b><span>{brl(win.amount)} · {when(win.closedAt)}</span></div><Link className="button button-outline compact" href={`/receipt/${win.receiptToken}`}>Comprovante ↗</Link></div>) : <div className="small-empty">Seus arremates e comprovantes aparecem aqui quando você vence um lote.</div>}</div></div><div className="wallet-tip"><span>◇</span><p>O saldo comprometido fica reservado enquanto você lidera um lote. Se outro lance superar o seu, o valor retorna ao saldo disponível imediatamente.</p></div></section>;
}

function AuditView({ id }: { id: string }) {
  const [audit, setAudit] = useState<any>(null);
  useEffect(() => { apiFetch(`/audit/lots/${id}`).then(r => r.json()).then(setAudit); }, [id]);
  if (!audit) return <div className="page-loader"><span className="loader" />Verificando histórico…</div>;
  return <section className="public-page"><div className="breadcrumb"><Link href={`/lots/${id}`}>Voltar ao lote</Link><span> / </span><span>Auditoria pública</span></div><span className="eyebrow">REGISTRO ABERTO</span><h1>Uma história que pode ser verificada.</h1><p className="public-subtitle">Histórico de lances de <b>{audit.title}</b>. Cada evento referencia criptograficamente o anterior.</p><div className={`integrity-banner ${audit.valid ? 'valid' : 'invalid'}`}><span>{audit.valid ? '✓' : '!'}</span><div><b>{audit.valid ? 'Histórico íntegro' : 'Integridade comprometida'}</b><small>{audit.valid ? 'A sequência de hashes corresponde aos eventos registrados.' : 'Um ou mais eventos foram alterados, removidos ou inseridos.'}</small></div><span className="integrity-label">{audit.valid ? 'VERIFICADO' : 'FALHA'}</span></div><div className="audit-list">{audit.events.length ? audit.events.map((event: any) => <article className="audit-event" key={event.sequence}><span className="audit-sequence">{String(event.sequence).padStart(3, '0')}</span><div className="audit-event-copy"><b>{event.type === 'bid_placed' ? `${event.bidder} deu um lance` : event.type === 'lot_closed' ? 'Leilão encerrado' : 'Lote cancelado'}</b><span>{event.amountCents ? brl(event.amountCents / 100) : event.winningBidCents ? brl(event.winningBidCents / 100) : '—'} · {when(event.createdAt)}</span><details><summary>Hash do evento</summary><code>{event.eventHash}</code><small>Anterior: {event.previousHash}</small></details></div></article>) : <div className="small-empty">Este lote ainda não tem eventos no histórico.</div>}</div><p className="audit-footnote">Os licitantes são representados por identificadores pseudônimos. A verificação recalcula a cadeia SHA-256 a partir do primeiro evento.</p></section>;
}

function ReceiptView({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<any>(null); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  useEffect(() => { apiFetch(`/receipts/${token}`).then(async r => { const data = await r.json(); if (!r.ok) setError(data.error); else setReceipt(data); }); }, [token]);
  if (error) return <section className="public-page"><div className="empty-state"><span className="empty-icon">◇</span><b>{error}</b><Link className="button button-outline" href="/">Voltar à galeria</Link></div></section>;
  if (!receipt) return <div className="page-loader"><span className="loader" />Abrindo comprovante…</div>;
  return <section className="receipt-page"><div className="receipt-check">✓</div><span className="eyebrow">COMPROVANTE DE ARREMATE</span><h1>Uma nova história<br /><em>começa agora.</em></h1><div className="receipt-card"><Artwork src={receipt.imageUrl} title={receipt.title} /><div className="receipt-copy"><span>LOTE ARREMATADO</span><h2>{receipt.title}</h2><div className="receipt-line"><span>Valor final</span><b>{brl(receipt.amount)}</b></div><div className="receipt-line"><span>Arrematante</span><b>{receipt.winner}</b></div><div className="receipt-line"><span>Encerrado em</span><b>{when(receipt.closedAt)}</b></div><div className="receipt-verified">✓ Comprovante público · lance verificado</div></div></div><div className="receipt-actions"><Link className="button button-dark" href={`/audit/${receipt.lotId}`}>Ver auditoria pública ↗</Link><button className="button button-outline" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Link copiado ✓' : 'Compartilhar comprovante ↗'}</button><Link href="/" className="text-link">Voltar à galeria</Link></div><small className="receipt-token">Código do comprovante · {receipt.token.slice(0, 12).toUpperCase()}</small></section>;
}

function AccessNotice({ title, message }: { title: string; message: string }) {
  return <section className="access-notice"><span className="empty-icon">◇</span><span className="eyebrow">Entrada na galeria</span><h1>{title}</h1><p>{message}</p><Link className="button button-dark" href="/">Voltar à galeria</Link></section>;
}
