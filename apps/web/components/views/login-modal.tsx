import { useState } from 'react';
import { errorMessage } from '../api-client';

export function LoginModal({
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
    } catch (cause) {
      setError(errorMessage(cause, 'Não foi possível continuar. Confira os dados e tente novamente.'));
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
                      } catch (cause) {
                        setError(errorMessage(cause, 'Erro ao entrar com conta demo.'));
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
