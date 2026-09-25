import { authAtivo } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ de?: string }> }) {
  const { de } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div className="row"><span className="brand-mark" aria-hidden>↗</span><h1>Caixa Pessoal</h1></div>
        {authAtivo() ? (
          <LoginForm de={de ?? '/'} />
        ) : (
          <p className="alert alert-info">Defina a variável de ambiente <code>APP_PASSWORD</code> na Vercel para proteger o app. Em desenvolvimento local o acesso é livre.</p>
        )}
      </div>
    </div>
  );
}
