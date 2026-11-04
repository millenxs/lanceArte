import Link from 'next/link';
import { useState, useEffect } from 'react';
import { apiErrorMessage, apiFetch, errorMessage } from '../api-client';
import { brl, whenFull } from '../formatters';
import type { AuditReport } from '../types';

export function AuditView({ id }: { id: string }) {
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setAudit(null);
    setError('');
    apiFetch(`/audit/lots/${id}`)
      .then(async response => {
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(data, 'Não foi possível carregar a auditoria.'));
        if (active) setAudit(data as AuditReport);
      })
      .catch(cause => {
        if (active) setError(errorMessage(cause, 'Não foi possível carregar a auditoria.'));
      });
    return () => {
      active = false;
    };
  }, [id]);

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
          audit.events.map(event => (
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
