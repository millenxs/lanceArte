import Link from 'next/link';
import { useState, useEffect } from 'react';
import { apiErrorMessage, apiFetch, errorMessage } from '../api-client';
import { brl, when, whenFull } from '../formatters';
import { Artwork } from '../auction-primitives';
import type { Receipt } from '../types';

export function ReceiptView({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch(`/receipts/${token}`).then(async r => {
      const data: unknown = await r.json();
      if (!r.ok) setError(apiErrorMessage(data, 'Comprovante ainda não disponível.'));
      else setReceipt(data as Receipt);
    }).catch(error => {
      setError(errorMessage(error, 'Não foi possível carregar o comprovante.'));
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
