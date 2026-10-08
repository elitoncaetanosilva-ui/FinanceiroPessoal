import Shell from '@/components/Shell';
import { requireUser } from '@/server/auth/session';
import { countPending } from '@/server/domain/queries';
import { getDb } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const pending = await countPending({ q: await getDb(), userId: user.id });
  return <Shell pending={pending} userName={user.name || user.email}>{children}</Shell>;
}
