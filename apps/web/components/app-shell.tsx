'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage } from './api-client';
import { brl } from './formatters';
import type { Flash, User } from './types';
import {
  AuditView,
  ConsoleView,
  HomeView,
  LoginModal,
  LotView,
  ReceiptView,
  WalletView
} from './views';

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
            Catálogos: Art Institute of Chicago · Projeto Portinari
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

          <nav
            className={`main-nav${mobileNavOpen ? ' mobile-nav-open' : ''}`}
            aria-label="Navegação principal"
          >
            <Link
              href="/#auctions"
              className={view === 'home' ? 'active' : ''}
              onClick={() => setMobileNavOpen(false)}
            >
              Explorar Lotes
            </Link>
            <Link href="/#featured-auction" onClick={() => setMobileNavOpen(false)}>
              Pregão em Destaque
            </Link>
            {user?.role === 'auctioneer' && (
              <Link
                href="/console"
                className={`nav-role-link ${view === 'console' ? 'active' : ''}`}
                onClick={() => setMobileNavOpen(false)}
              >
                <span>Painel do Leiloeiro</span>
                <ins>Vendedor</ins>
              </Link>
            )}
            {user?.role === 'bidder' && (
              <Link
                href="/wallet"
                className={`nav-role-link ${view === 'wallet' ? 'active' : ''}`}
                onClick={() => setMobileNavOpen(false)}
              >
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
                <span className="login-label-full">Entrar / Criar conta</span>
                <span className="login-label-short">Entrar</span>
              </button>
            )}
            <button
              className="mobile-nav-toggle"
              type="button"
              aria-label={mobileNavOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(open => !open)}
            >
              <span aria-hidden="true">{mobileNavOpen ? '×' : '☰'}</span>
            </button>
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
          <span>Art Institute of Chicago · Projeto Portinari</span>
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
    } catch (error) {
      notify('error', errorMessage(error, 'Não foi possível encerrar a sessão.'));
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
