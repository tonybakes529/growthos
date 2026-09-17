import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  return <Shell orgSlug={orgSlug}>{children}</Shell>;
}
