import { AppShell } from '@/components/app-shell';

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AppShell view="receipt" id={token} />;
}
