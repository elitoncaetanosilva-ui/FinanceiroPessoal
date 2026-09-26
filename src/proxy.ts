import { NextResponse, type NextRequest } from 'next/server';

/**
 * Barreira rápida: sem cookie de sessão, redireciona para /login.
 * A validação completa da sessão (no banco) acontece em cada página/ação via requireUser().
 */
const PUBLIC = ['/login', '/api/cron/', '/manifest.webmanifest', '/sw.js', '/icons/', '/offline.html', '/icon.svg'];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get('fp_session')?.value) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?de=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
