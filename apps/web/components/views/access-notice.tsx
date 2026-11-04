import Link from 'next/link';

export function AccessNotice({
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
