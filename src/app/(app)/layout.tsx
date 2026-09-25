import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { contarPendentes } from '@/lib/repo';
import { authAtivo } from '@/lib/auth';
import { logout } from '../actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pendentes = await contarPendentes();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>↗</span>
            <span className="brand-text">Caixa Pessoal</span>
          </Link>
          <Nav pendentes={pendentes} />
          <div className="topbar-actions">
            <ThemeToggle />
            {authAtivo() && (
              <form action={logout}>
                <button className="btn btn-ghost btn-sm" type="submit">Sair</button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="main">{children}</main>
    </>
  );
}
