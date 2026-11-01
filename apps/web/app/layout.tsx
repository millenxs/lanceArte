import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'LanceArte — Casa de Leilões de Arte ao Vivo',
  description: 'Descubra obras de acervos públicos, participe de pregões ao vivo e audite cada lance via SHA-256.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
