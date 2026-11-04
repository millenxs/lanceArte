import Link from 'next/link';
import { useState, useCallback, useEffect } from 'react';
import type { User, WalletData, WalletWin } from '../types';
import { apiFetch, errorMessage } from '../api-client';
import { brl, when, whenFull } from '../formatters';
import { Artwork } from '../auction-primitives';
import { AccessNotice } from './access-notice';

export function WalletView({
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
  const [wins, setWins] = useState<WalletWin[]>([]);
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
    } catch (error) {
      notify('error', errorMessage(error, 'Não foi possível realizar o depósito.'));
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
