import { AppShell } from '@/components/app-shell';

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell view="lot" id={id} />;
}
