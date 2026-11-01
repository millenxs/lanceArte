import type { Metadata } from 'next';
import './styles.css';
import './detail-overrides.css';
import './gallery.css';

export const metadata: Metadata = {
  title: 'LanceArte — leilões de arte ao vivo',
  description: 'Descubra obras, participe de leilões ao vivo e acompanhe cada lance com transparência.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
