import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import LoginForm from './LoginForm';

export const metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const { de } = await searchParams;
  if (await currentUser()) redirect(de && de.startsWith('/') && !de.startsWith('//') ? de : '/');
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-on-primary">F</div>
          <h1 className="text-2xl font-bold">Finanças</h1>
          <p className="text-sm text-muted">Controle e planejamento financeiro pessoal</p>
        </div>
        <LoginForm next={de} />
      </div>
    </main>
  );
}
