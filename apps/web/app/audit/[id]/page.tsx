import { AppShell } from '@/components/app-shell';

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell view="audit" id={id} />;
}
