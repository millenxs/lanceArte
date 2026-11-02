'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const SOCKET =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

type User = {
  id: string;
  name: string;
  role: 'auctioneer' | 'bidder';
};

type Lot = {
  id: string;
  title: string;
  imageUrl?: string | null;
  artwork: any;
  openingBid: number;
  increment: number;
  startsAt: string;
  endsAt: string;
  status: 'live' | 'scheduled' | 'closed' | 'cancelled' | string;
  currentBid: number | null;
  leader: string | null;
  sellerId?: string;
  sellerName: string;
  receiptToken?: string | null;
  bidCount?: number;
  auditCount?: number;
  isCurrentUserLeader?: boolean;
};

type Bid = {
  bidder: string;
  amount: number;
  createdAt: string;
};

type Item = {
  id: string;
  title: string;
  artist: string;
  date: string;
  imageUrl?: string | null;
  publicDomain: boolean;
  sourceUrl: string;
};

type WalletTransaction = {
  id: string;
  lotId?: string | null;
  lotTitle?: string | null;
  kind: 'deposit' | 'reserve' | 'release' | 'settlement_debit' | 'settlement_credit' | string;
  availableDelta: number;
  committedDelta: number;
  note: string;
  createdAt: string;
};

type WalletData = {
  user: { id: string; name: string };
  available: number;
  committed: number;
  total: number;
  transactions?: WalletTransaction[];
};

type Flash = {
  kind: 'success' | 'error';
  text: string;
} | null;

const brl = (value?: number | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);

const when = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value)
      )
    : '—';

const whenFull = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(value))
    : '—';

const apiFetch = (path: string, init?: RequestInit) =>
  fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });

function formatRemaining(targetIso: string, nowMs: number): {
  text: string;
  urgent: boolean;
  expired: boolean;
} {
  const diffSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - nowMs) / 1000));
  if (diffSec <= 0) return { text: '00h 00m 00s', urgent: false, expired: true };
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text =
    days > 0
      ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
      : `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  return { text, urgent: diffSec <= 120, expired: false };
}

function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function Status({ value }: { value: string }) {
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

function Money({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={muted ? 'money muted' : 'money'}>{children}</span>;
}

function Artwork({
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

function LiveBidStream({ bids }: { bids: Bid[] }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (bids.length <= 1) return;
    const timer = window.setInterval(() => {
      setTick(t => (t + 1) % bids.length);
    }, 3400);
    return () => window.clearInterval(timer);
  }, [bids.length]);

  const ordered = useMemo(() => {
    if (bids.length <= 1) return bids;
    // Keep the leader at #0 and gently cycle the incoming feed indicator
    return bids;
  }, [bids]);

  return (
    <div className="live-stream-container">
      <div className="live-incoming-banner" key={tick}>
        <span className="pulse-dot" />
        <small>
          Última atividade: <b>{ordered[tick]?.bidder}</b> ofertou{' '}
          <strong>{brl(ordered[tick]?.amount)}</strong>
        </small>
      </div>
      <div className="bid-list">
        {ordered.slice(0, 8).map((bid, index) => (
          <div
            className={`bid-row ${index === 0 ? 'bid-row-leader' : ''} ${index === tick ? 'bid-row-highlight' : ''}`}
            key={`${bid.createdAt}-${index}`}
          >
            <span className="avatar tiny-avatar">{index === 0 ? '★' : `#${ordered.length - index}`}</span>
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

function LotCard({ lot, nowMs }: { lot: Lot; nowMs: number }) {
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

function ShellLayout({
  children,
  user,
  walletBalance,
  view,
  onLogin,
  onLogout,
  theme,
  onToggleTheme
}: {
  children: React.ReactNode;
  user: User | null;
  walletBalance: number | null;
  view: string;
  onLogin: () => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  const mark = (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="m8.2 6.4 4.2-4.2 10.1 10.1-4.2 4.2z" />
      <path
        d="m18.8 13.2-9.1 9.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M5.6 23.2h16v3.2h-16z" />
    </svg>
  );

  return (
    <>
      <div className="auction-ribbon">
        <div className="ribbon-inner">
          <span className="ribbon-live">
            <i />
            CASA DE LEILÕES AO VIVO
          </span>
          <span className="ribbon-center">
            Curadoria de Obras: Art Institute of Chicago · Projeto Portinari · LACMA
          </span>
          <span className="ribbon-note">Histórico público verificado · Lances e saldos simulados</span>
        </div>
      </div>

      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">{mark}</span>
            <span className="brand-text">
              <strong>
                lance<span>arte</span>
              </strong>
              <small>CASA DE LEILÕES</small>
            </span>
          </Link>

          <nav className="main-nav" aria-label="Navegação principal">
            <Link href="/#auctions" className={view === 'home' ? 'active' : ''}>
              Explorar Lotes
            </Link>
            <Link href="/#featured-auction">Pregão em Destaque</Link>
            {user?.role === 'auctioneer' && (
              <Link href="/console" className={`nav-role-link ${view === 'console' ? 'active' : ''}`}>
                <span>Painel do Leiloeiro</span>
                <ins>Vendedor</ins>
              </Link>
            )}
            {user?.role === 'bidder' && (
              <Link href="/wallet" className={`nav-role-link ${view === 'wallet' ? 'active' : ''}`}>
                <span>Minha Carteira</span>
                {walletBalance !== null && <ins>{brl(walletBalance)}</ins>}
              </Link>
            )}
          </nav>

          <div className="account-area">
            <button
              className="theme-toggle"
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
              <small>{theme === 'dark' ? 'Claro' : 'Escuro'}</small>
            </button>

            {user ? (
              <div className="account-logged">
                {user.role === 'auctioneer' ? (
                  <Link href="/console" className="header-quick-action">
                    + Criar Lote
                  </Link>
                ) : (
                  <Link href="/wallet" className="header-quick-action">
                    + Depositar
                  </Link>
                )}
                <span className="user-chip">
                  <span className={`avatar role-${user.role}`}>{user.name.slice(0, 1)}</span>
                  <span className="user-chip-copy">
                    <b>{user.name}</b>
                    <small>
                      {user.role === 'auctioneer'
                        ? 'Leiloeiro · Vendedor'
                        : 'Licitante · Cliente'}
                    </small>
                  </span>
                </span>
                <button className="button button-quiet compact" onClick={onLogout}>
                  Sair
                </button>
              </div>
            ) : (
              <button className="button button-primary compact" onClick={onLogin}>
                Entrar / Criar conta
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">{children}</main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-col">
            <Link href="/" className="brand footer-brand">
              <span className="brand-mark">{mark}</span>
              <span className="brand-text">
                <strong>
                  lance<span>arte</span>
                </strong>
                <small>CASA DE LEILÕES ONLINE</small>
              </span>
            </Link>
            <p>
              Casa de leilões de arte com pregões ao vivo, carteira com reserva imediata de saldo,
              comprovante público de arremate e histórico de lances aberto para consulta.
            </p>
          </div>
          <div className="footer-links">
            <div>
              <strong>Navegação</strong>
              <Link href="/#auctions">Vitrine de Lotes</Link>
              <Link href="/#featured-auction">Lote em Destaque</Link>
              <Link href="/console">Painel do Leiloeiro</Link>
              <Link href="/wallet">Carteira do Licitante</Link>
            </div>
            <div>
              <strong>Como Funciona</strong>
              <span>Leiloeiro publica lotes · não dá lances</span>
              <span>Licitante deposita saldo e disputa ao vivo</span>
              <span>Prorrogação automática nos 2 minutos finais</span>
              <span>Histórico de lances público sem login</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © 2026 LanceArte · Todos os valores e depósitos são simulados para demonstração.
          </span>
          <span>Art Institute of Chicago · Projeto Portinari · LACMA</span>
        </div>
      </footer>
    </>
  );
}

export function AppShell({
  view,
  id
}: {
  view: 'home' | 'console' | 'wallet' | 'lot' | 'audit' | 'receipt';
  id?: string;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [refresh, setRefresh] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const notify = useCallback((kind: 'success' | 'error', text: string) => {
    setFlash({ kind, text });
    window.setTimeout(() => setFlash(null), 5000);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const r = await apiFetch('/auth/me');
      const session = await r.json();
      setUser(session.user ?? null);
      if (session.user?.role === 'bidder') {
        const w = await apiFetch('/wallet/me');
        if (w.ok) {
          const wData = await w.json();
          setWalletBalance(wData.available);
        }
      } else {
        setWalletBalance(null);
      }
    } catch {
      setUser(null);
      setWalletBalance(null);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [refresh, loadSession]);

  const authenticate = useCallback(
    async (
      mode: 'login' | 'register',
      credentials: {
        name?: string;
        email: string;
        password: string;
        role?: 'bidder' | 'auctioneer';
      }
    ) => {
      const response = await apiFetch(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível acessar o acervo.');
      setUser(data.user);
      setLoginOpen(false);
      setRefresh(value => value + 1);
      notify(
        'success',
        `${mode === 'register' ? 'Conta criada com sucesso' : 'Acesso confirmado'}, ${data.user.name} (${data.user.role === 'auctioneer' ? 'Leiloeiro' : 'Licitante'}).`
      );
    },
    [notify]
  );

  const logout = async () => {
    try {
      const response = await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      if (!response.ok) throw new Error('Não foi possível encerrar a sessão. Tente novamente.');
      const session = await apiFetch('/auth/me').then(result => result.json());
      if (session.user)
        throw new Error('A sessão continua ativa. Atualize a página e tente sair novamente.');
      setUser(null);
      setWalletBalance(null);
      setRefresh(value => value + 1);
      notify('success', 'Sessão encerrada com segurança.');
    } catch (error: any) {
      notify('error', error.message ?? 'Não foi possível encerrar a sessão.');
    }
  };

  useEffect(() => {
    const saved = window.localStorage.getItem('lancearte-theme');
    setTheme(
      saved === 'dark' || saved === 'light'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    );
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () =>
    setTheme(current => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('lancearte-theme', next);
      return next;
    });

  return (
    <ShellLayout
      user={user}
      walletBalance={walletBalance}
      view={view}
      onLogin={() => setLoginOpen(true)}
      onLogout={logout}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {flash && (
        <div className={`flash flash-${flash.kind}`} role="status">
          <span>{flash.text}</span>
          <button onClick={() => setFlash(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}
      {view === 'home' && (
        <HomeView user={user} onLogin={() => setLoginOpen(true)} key={refresh} />
      )}
      {view === 'lot' && id && (
        <LotView
          id={id}
          user={user}
          onLogin={() => setLoginOpen(true)}
          notify={notify}
          onWalletChange={loadSession}
          key={`${id}-${refresh}`}
        />
      )}
      {view === 'console' && (
        <ConsoleView user={user} onLogin={() => setLoginOpen(true)} notify={notify} key={refresh} />
      )}
      {view === 'wallet' && (
        <WalletView
          user={user}
          onLogin={() => setLoginOpen(true)}
          notify={notify}
          onWalletChange={loadSession}
          key={refresh}
        />
      )}
      {view === 'audit' && id && <AuditView id={id} />}
      {view === 'receipt' && id && <ReceiptView token={id} />}
      {loginOpen && (
        <LoginModal onClose={() => setLoginOpen(false)} onAuthenticate={authenticate} />
      )}
    </ShellLayout>
  );
}

function LoginModal({
  onClose,
  onAuthenticate
}: {
  onClose: () => void;
  onAuthenticate: (
    mode: 'login' | 'register',
    credentials: {
      name?: string;
      email: string;
      password: string;
      role?: 'bidder' | 'auctioneer';
    }
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'bidder' | 'auctioneer'>('bidder');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const demoAccounts = [
    {
      label: 'Licitante 1 (Cliente)',
      roleTag: 'Dar lances e arrematar',
      email: 'colecionador@lancearte.test',
      password: 'Galeria#2026'
    },
    {
      label: 'Licitante 2 (Disputa)',
      roleTag: 'Testar disputa ao vivo',
      email: 'segundo.licitante@lancearte.test',
      password: 'Segundo#2026'
    },
    {
      label: 'Leiloeira (Vendedora)',
      roleTag: 'Criar e gerir lotes',
      email: 'leiloeira@lancearte.test',
      password: 'Atelie#2026'
    }
  ];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAuthenticate(mode, { name, email, password, role });
    } catch (cause: any) {
      setError(cause.message ?? 'Não foi possível continuar. Confira os dados e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal login-modal mode-${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        <div className="login-artwork">
          <img
            src="/api/images/2d484387-2509-5e8e-2c43-22f9981972eb"
            alt="Um domingo na Grande Jatte, de Georges Seurat"
          />
          <div className="login-artwork-caption">
            <span className="login-badge">CASA DE LEILÕES LANCEARTE</span>
            <strong>Descubra grandes obras e dispute lotes em tempo real.</strong>
            <small>Georges Seurat · Art Institute of Chicago</small>
          </div>
        </div>

        <div className="login-content">
          <span className="eyebrow">ACESSO À PLATAFORMA</span>
          <h2 id="access-title">
            {mode === 'login' ? 'Entre na sala de leilões.' : 'Crie sua conta na plataforma.'}
          </h2>
          <p>
            {mode === 'login'
              ? 'Acesse como Licitante para depositar saldo e ofertar lances, ou como Leiloeiro para publicar e gerenciar lotes.'
              : 'Escolha seu papel na plataforma: Licitante (cliente comprador) ou Leiloeiro (vendedor organizador).'}
          </p>

          <div className="access-tabs" role="group" aria-label="Entrar ou criar perfil">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              className={mode === 'login' ? 'selected' : ''}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              Entrar na conta
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              className={mode === 'register' ? 'selected' : ''}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              Criar novo perfil
            </button>
          </div>

          <form className="access-form" onSubmit={submit}>
            {mode === 'register' && (
              <label>
                Nome completo
                <input
                  autoComplete="name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                  placeholder="Ex.: Ana Beatriz"
                />
              </label>
            )}
            <label>
              E-mail
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
                placeholder="voce@exemplo.com"
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                minLength={mode === 'register' ? 10 : undefined}
                maxLength={128}
                required
                placeholder={mode === 'register' ? 'Mínimo de 10 caracteres' : 'Sua senha'}
              />
            </label>

            {mode === 'register' && (
              <fieldset className="role-choice">
                <legend>Selecione seu papel na Casa de Leilões</legend>
                <label className={role === 'bidder' ? 'chosen' : ''}>
                  <input
                    type="radio"
                    name="role"
                    value="bidder"
                    checked={role === 'bidder'}
                    onChange={() => setRole('bidder')}
                  />
                  <span>
                    <b>Licitante (Cliente)</b>
                    <small>
                      Deposita saldo simulado na carteira, dá lances ao vivo e recebe comprovantes
                      de arremate.
                    </small>
                  </span>
                </label>
                <label className={role === 'auctioneer' ? 'chosen' : ''}>
                  <input
                    type="radio"
                    name="role"
                    value="auctioneer"
                    checked={role === 'auctioneer'}
                    onChange={() => setRole('auctioneer')}
                  />
                  <span>
                    <b>Leiloeiro (Vendedor)</b>
                    <small>
                      Seleciona obras do acervo, define lance inicial, incremento e horários. Não
                      pode dar lances.
                    </small>
                  </span>
                </label>
              </fieldset>
            )}

            {error && (
              <div className="access-error" role="alert">
                {error}
              </div>
            )}

            <button className="button button-primary access-submit" disabled={busy}>
              {busy
                ? 'Autenticando…'
                : mode === 'login'
                  ? 'Acessar plataforma'
                  : 'Criar conta e continuar'}
            </button>
          </form>

          {mode === 'login' && (
            <div className="test-access">
              <span>Acesso rápido de demonstração (clique para entrar):</span>
              <div className="test-access-grid">
                {demoAccounts.map(account => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={async () => {
                      setEmail(account.email);
                      setPassword(account.password);
                      setError('');
                      setBusy(true);
                      try {
                        await onAuthenticate('login', {
                          email: account.email,
                          password: account.password
                        });
                      } catch (cause: any) {
                        setError(cause.message ?? 'Erro ao entrar com conta demo.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <b>{account.label}</b>
                    <small>{account.roleTag}</small>
                    <code>{account.email}</code>
                    <i>Entrar agora →</i>
                  </button>
                ))}
              </div>
            </div>
          )}

          <small className="modal-note">
            Ambiente demonstrativo: todos os saldos e lances são simulados.
          </small>
        </div>
      </section>
    </div>
  );
}

function HomeView({ user, onLogin }: { user: User | null; onLogin: () => void }) {
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

function LotView({
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
  const [bids, setBids] = useState<Bid[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    const [lotResponse, bidResponse] = await Promise.all([
      apiFetch(`/lots/${id}`),
      apiFetch(`/lots/${id}/bids`)
    ]);
    const lotData = await lotResponse.json();
    if (lotResponse.ok) setLot(lotData);
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
    channel.emit('lot:join', id);
    channel.on('lot:bid', () => {
      load();
      loadBidderWallet();
      onWalletChange();
    });
    channel.on('lot:live', () => {
      load();
    });
    channel.on('lot:closed', () => {
      load();
      loadBidderWallet();
      onWalletChange();
    });
    return () => {
      channel.disconnect();
    };
  }, [id, load, loadBidderWallet, onWalletChange]);

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
                      ? `Tempo real (${bids.length})`
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

function ConsoleView({
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
    applySchedulePreset(0, 120);
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
    } catch (error: any) {
      notify('error', error.message);
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
    } catch (error: any) {
      notify('error', error.message);
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

  const quickArtistTerms = ['Van Gogh', 'Monet', 'Portinari', 'Magritte', 'Rembrandt', 'Cézanne', 'Hokusai'];

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
            Busque obras no acervo do <b>Art Institute of Chicago</b>, <b>Projeto Portinari</b> e{' '}
            <b>LACMA</b>.
          </p>

          <div className="search-input">
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && runSearch()}
              placeholder="Digite artista, obra ou tema (ex.: Monet, Café, Magritte)…"
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

function WalletView({
  user,
  onLogin,
  notify,
  onWalletChange
}: {
  user: User | null;
  onLogin: () => void;
  notify: (kind: 'success' | 'error', text: string) => void;
  onWalletChange: () => void;
}) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [wins, setWins] = useState<any[]>([]);
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [balance, victories] = await Promise.all([
      apiFetch('/wallet/me'),
      apiFetch('/wallet/wins')
    ]);
    if (balance.ok) setWallet(await balance.json());
    if (victories.ok) setWins(await victories.json());
  }, []);

  useEffect(() => {
    if (user?.role === 'bidder') refresh();
  }, [user, refresh]);

  const deposit = async (customAmount?: number) => {
    const valueToDeposit = customAmount ?? Number(amount);
    setBusy(true);
    try {
      const response = await apiFetch('/wallet/deposits', {
        method: 'POST',
        body: JSON.stringify({ amount: valueToDeposit })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      notify('success', `Depósito simulado de ${brl(valueToDeposit)} creditado na sua carteira.`);
      await refresh();
      onWalletChange();
    } catch (error: any) {
      notify('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <AccessNotice
        title="Carteira do Licitante (Cliente)"
        message="Entre com uma conta de Licitante para depositar saldo simulado, acompanhar valores reservados em lances e acessar seus comprovantes de arremate."
        onLogin={onLogin}
      />
    );
  }
  if (user.role !== 'bidder') {
    return (
      <AccessNotice
        title="Área exclusiva para Licitantes"
        message="Você está conectado como Leiloeiro (Vendedor). A carteira de lances e arremates é exclusiva para o perfil de Licitante."
        onLogin={onLogin}
      />
    );
  }

  const quickDeposits = [500, 1000, 2500, 5000, 10000];
  const kindLabels: Record<string, string> = {
    deposit: 'Depósito simulado',
    reserve: 'Reserva em lance líder',
    release: 'Estorno (lance superado)',
    settlement_debit: 'Liquidação de arremate',
    settlement_credit: 'Recebimento de venda'
  };

  return (
    <section className="dashboard-page wallet-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">CARTEIRA DO LICITANTE · CLIENTE</span>
          <h1>Gestão de Saldo &amp; Arremates</h1>
          <p>
            Olá, <b>{user.name}</b>. Deposite saldo simulado para participar dos pregões ao vivo e
            acesse os comprovantes oficiais das obras que você venceu.
          </p>
        </div>
      </div>

      {/* 3 FINANCIAL SUMMARY CARDS */}
      <div className="wallet-summary-row">
        <div className="summary-card primary">
          <span className="eyebrow">SALDO DISPONÍVEL PARA LANCES</span>
          <strong>{brl(wallet?.available)}</strong>
          <small>Livre para ofertar imediatamente nos lotes ao vivo</small>
        </div>
        <div className="summary-card">
          <span className="eyebrow">SALDO COMPROMETIDO (RESERVADO)</span>
          <strong>{brl(wallet?.committed)}</strong>
          <small>Bloqueado nos lotes em que você está na liderança</small>
        </div>
        <div className="summary-card">
          <span className="eyebrow">SALDO PATRIMONIAL TOTAL</span>
          <strong>{brl(wallet?.total)}</strong>
          <small>Soma do saldo disponível + saldo comprometido</small>
        </div>
      </div>

      <div className="wallet-grid">
        {/* LEFT: DEPOSIT & STATEMENT */}
        <div className="wallet-left-col">
          <div className="panel deposit-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">CRÉDITO INSTANTÂNEO</span>
                <h2>Adicionar saldo simulado</h2>
              </div>
              <span className="panel-icon">+</span>
            </div>
            <p>
              Escolha um valor rápido ou informe o montante desejado (até R$ 10.000,00 por
              operação).
            </p>

            <div className="quick-deposit-pills">
              {quickDeposits.map(val => (
                <button
                  key={val}
                  type="button"
                  className={Number(amount) === val ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => setAmount(String(val))}
                >
                  + {brl(val)}
                </button>
              ))}
            </div>

            <div className="bid-entry">
              <span>R$</span>
              <input
                id="deposit-amount"
                type="number"
                min="1"
                max="10000"
                step="0.01"
                value={amount}
                onChange={event => setAmount(event.target.value)}
              />
              <button className="button button-primary" disabled={busy} onClick={() => deposit()}>
                {busy ? 'Creditando…' : 'Depositar Saldo +'}
              </button>
            </div>
            <small className="deposit-note">
              Saldo 100% demonstrativo. Nenhuma cobrança financeira real é efetuada.
            </small>
          </div>

          <div className="panel ledger-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">MOVIMENTAÇÕES</span>
                <h2>Extrato da carteira</h2>
              </div>
              <span className="count-badge">{wallet?.transactions?.length ?? 0}</span>
            </div>
            {wallet?.transactions?.length ? (
              <div className="ledger-list">
                {wallet.transactions.map(tx => (
                  <div className="ledger-row" key={tx.id}>
                    <div className="ledger-copy">
                      <b>{kindLabels[tx.kind] ?? tx.note}</b>
                      <small>
                        {tx.lotTitle ? `${tx.lotTitle} · ` : ''}
                        {whenFull(tx.createdAt)}
                      </small>
                    </div>
                    <div className="ledger-amounts">
                      {tx.availableDelta !== 0 && (
                        <strong className={tx.availableDelta > 0 ? 'pos' : 'neg'}>
                          {tx.availableDelta > 0 ? '+' : ''}
                          {brl(tx.availableDelta)} disp.
                        </strong>
                      )}
                      {tx.committedDelta !== 0 && (
                        <small className="committed-tag">
                          {tx.committedDelta > 0 ? '+' : ''}
                          {brl(tx.committedDelta)} reservado
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="small-empty">Nenhuma movimentação registrada ainda.</div>
            )}
          </div>
        </div>

        {/* RIGHT: WON LOTS & RECEIPTS */}
        <div className="panel win-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">GALERIA DO COLECIONADOR</span>
              <h2>Meus lotes arrematados</h2>
            </div>
            <span className="count-badge">{wins.length}</span>
          </div>
          <p>
            Cada lote vencido gera um comprovante público de arremate que você pode compartilhar
            por link.
          </p>

          {wins.length ? (
            <div className="wins-list">
              {wins.map(win => (
                <div className="managed-lot win-lot" key={win.id}>
                  <Artwork src={win.imageUrl} title={win.title} />
                  <div className="managed-lot-copy">
                    <span className="win-tag">✓ ARREMATADO</span>
                    <b>{win.title}</b>
                    <span>
                      Valor final: <strong>{brl(win.amount)}</strong>
                    </span>
                    <small>Encerrado em {when(win.closedAt)}</small>
                  </div>
                  <div className="win-actions">
                    <Link
                      className="button button-primary compact"
                      href={`/receipt/${win.receiptToken}`}
                    >
                      Comprovante ↗
                    </Link>
                    <Link className="button button-outline compact" href={`/lots/${win.id}`}>
                      Ver lote
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <span>◇</span>
              <p>
                Seus lotes arrematados e os respectivos comprovantes aparecerão aqui assim que você
                vencer um pregão.
              </p>
              <Link href="/#auctions" className="button button-outline compact">
                Explorar lotes ao vivo →
              </Link>
            </div>
          )}

          <div className="wallet-tip">
            <span>◇</span>
            <p>
              <b>Como funciona a reserva de saldo:</b> Ao liderar um lote, o valor do seu lance
              migra do saldo disponível para o saldo comprometido. Caso outro licitante supere seu
              lance, o valor retorna integralmente ao seu saldo disponível no mesmo instante.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditView({ id }: { id: string }) {
  const [audit, setAudit] = useState<any>(null);

  useEffect(() => {
    apiFetch(`/audit/lots/${id}`)
      .then(r => r.json())
      .then(setAudit);
  }, [id]);

  if (!audit) {
    return (
      <div className="page-loader">
        <span className="loader" />
        <span>Verificando histórico do lote…</span>
      </div>
    );
  }

  return (
    <section className="public-page">
      <div className="breadcrumb">
        <Link href={`/lots/${id}`}>← Voltar à sala do lote</Link>
        <span>/</span>
        <span>Auditoria Pública de Lances</span>
      </div>

      <span className="eyebrow">TRANSPARÊNCIA PÚBLICA · ACESSO SEM LOGIN</span>
      <h1>Histórico Auditado do Lote</h1>
      <p className="public-subtitle">
        Registro público de todos os eventos do lote <b>{audit.title}</b>. Qualquer pessoa pode
        conferir que a ordem e os valores dos lances não sofreram adulteração.
      </p>

      <div className={`integrity-banner ${audit.valid ? 'valid' : 'invalid'}`}>
        <span className="integrity-icon">{audit.valid ? '✓' : '!'}</span>
        <div className="integrity-copy">
          <b>
            {audit.valid
              ? 'Histórico Íntegro e Verificado'
              : 'Alerta: Divergência Detectada no Histórico'}
          </b>
          <small>
            {audit.valid
              ? 'Todos os eventos registrados conferem com a sequência oficial do leilão, sem alterações.'
              : 'Um ou mais eventos foram alterados, removidos ou inseridos fora da sequência.'}
          </small>
        </div>
        <span className="integrity-label">{audit.valid ? 'VERIFICADO' : 'FALHA'}</span>
      </div>

      <div className="audit-list">
        {audit.events?.length ? (
          audit.events.map((event: any) => (
            <article className="audit-event" key={event.sequence}>
              <div className="audit-sequence">
                <span>REGISTRO</span>
                <strong>#{String(event.sequence).padStart(3, '0')}</strong>
              </div>

              <div className="audit-event-copy">
                <div className="audit-event-header">
                  <b>
                    {event.type === 'bid_placed'
                      ? `${event.bidder} ofertou um lance`
                      : event.type === 'lot_closed'
                        ? 'Pregão encerrado'
                        : 'Lote cancelado pelo leiloeiro'}
                  </b>
                  <span className="audit-amount-badge">
                    {event.amountCents
                      ? brl(event.amountCents / 100)
                      : event.winningBidCents
                        ? `Arremate: ${brl(event.winningBidCents / 100)}`
                        : 'Encerramento'}
                  </span>
                </div>
                <span className="audit-timestamp">Registrado em {whenFull(event.createdAt)}</span>

                <details className="audit-tech-details">
                  <summary>Ver código técnico de verificação</summary>
                  <div className="audit-hashes">
                    <div className="hash-line">
                      <span>Registro atual:</span>
                      <code>{event.eventHash}</code>
                    </div>
                    <div className="hash-line">
                      <span>Registro anterior:</span>
                      <code>{event.previousHash}</code>
                    </div>
                  </div>
                </details>
              </div>
            </article>
          ))
        ) : (
          <div className="small-empty">
            Este lote está íntegro e aguarda o registro de novos eventos.
          </div>
        )}
      </div>

      <p className="audit-footnote">
        Para preservar a privacidade durante a disputa, os participantes são identificados por
        códigos públicos de licitante.
      </p>
    </section>
  );
}

function ReceiptView({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch(`/receipts/${token}`).then(async r => {
      const data = await r.json();
      if (!r.ok) setError(data.error);
      else setReceipt(data);
    });
  }, [token]);

  if (error) {
    return (
      <section className="public-page">
        <div className="empty-state">
          <span className="empty-icon">◇</span>
          <b>{error}</b>
          <Link className="button button-outline" href="/">
            Voltar à vitrine de leilões
          </Link>
        </div>
      </section>
    );
  }
  if (!receipt) {
    return (
      <div className="page-loader">
        <span className="loader" />
        <span>Emitindo comprovante de arremate…</span>
      </div>
    );
  }

  const artist =
    receipt.artwork?.artist ?? receipt.artwork?.artist_title ?? 'Acervo Catalogado';
  const year = receipt.artwork?.date ?? receipt.artwork?.date_display ?? '';

  return (
    <section className="receipt-page">
      <div className="receipt-header">
        <div className="receipt-check">✓</div>
        <span className="eyebrow">CERTIFICADO PÚBLICO DE ARREMATE · LANCEARTE</span>
        <h1>Comprovante Oficial de Arremate</h1>
        <p>
          Documento público verificável de encerramento e arremate de obra em pregão eletrônico.
        </p>
      </div>

      <div className="receipt-card">
        <div className="receipt-media">
          <Artwork src={receipt.imageUrl} title={receipt.title} />
          <span className="receipt-lot-tag">LOTE #{receipt.lotId.slice(0, 6).toUpperCase()}</span>
        </div>

        <div className="receipt-copy">
          <span className="receipt-kicker">OBRA ARREMATADA</span>
          <h2>{receipt.title}</h2>
          <p className="receipt-artist">
            {artist}
            {year ? ` · ${year}` : ''}
          </p>

          <div className="receipt-lines">
            <div className="receipt-line highlight">
              <span>Valor Final de Arremate</span>
              <b>{brl(receipt.amount)}</b>
            </div>
            {receipt.openingBid && (
              <div className="receipt-line">
                <span>Lance Inicial</span>
                <b>{brl(receipt.openingBid)}</b>
              </div>
            )}
            <div className="receipt-line">
              <span>Licitante Vencedor</span>
              <b>{receipt.winner}</b>
            </div>
            {receipt.sellerName && (
              <div className="receipt-line">
                <span>Leiloeiro Responsável</span>
                <b>{receipt.sellerName}</b>
              </div>
            )}
            <div className="receipt-line">
              <span>Data e Hora do Arremate</span>
              <b>{whenFull(receipt.closedAt)}</b>
            </div>
            <div className="receipt-line">
              <span>Código do Comprovante</span>
              <code>{receipt.token.slice(0, 16).toUpperCase()}</code>
            </div>
          </div>

          <div className="receipt-verified">
            <span>✓</span>
            <div>
              <b>Comprovante público · Arremate verificado</b>
              <small>Qualquer pessoa com este link pode confirmar a autenticidade do lote.</small>
            </div>
          </div>
        </div>
      </div>

      <div className="receipt-actions">
        <button
          className="button button-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 3000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? '✓ Link do comprovante copiado!' : 'Compartilhar link do comprovante ↗'}
        </button>
        <Link className="button button-outline" href={`/audit/${receipt.lotId}`}>
          Consultar histórico do lote →
        </Link>
        <Link className="button button-quiet" href={`/lots/${receipt.lotId}`}>
          Abrir página do lote
        </Link>
      </div>
    </section>
  );
}

function AccessNotice({
  title,
  message,
  onLogin
}: {
  title: string;
  message: string;
  onLogin?: () => void;
}) {
  return (
    <section className="access-notice">
      <span className="empty-icon">◇</span>
      <span className="eyebrow">CONTROLE DE ACESSO POR PAPEL</span>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="access-notice-actions">
        {onLogin && (
          <button className="button button-primary" onClick={onLogin}>
            Alternar conta / Entrar
          </button>
        )}
        <Link className="button button-outline" href="/">
          Voltar à vitrine de lotes
        </Link>
      </div>
    </section>
  );
}
