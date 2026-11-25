import type { ReactNode } from 'react';
import { Providers } from '../../web/components/providers';
import { requireUser } from '../../web/server/auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <Providers>{children}</Providers>;
}
