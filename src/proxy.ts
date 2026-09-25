import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sessaoValida } from '@/lib/auth';

const PUBLICOS = ['/login', '/api/cron/', '/api/pluggy/webhook', '/conciliador'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICOS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (await sessaoValida(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?de=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
