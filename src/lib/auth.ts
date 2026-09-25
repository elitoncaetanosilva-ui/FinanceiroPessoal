// Sessão de usuário único: cookie assinado com HMAC-SHA256 (Web Crypto — roda no proxy e no servidor).
export const SESSION_COOKIE = 'fp_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

export const authAtivo = () => !!process.env.APP_PASSWORD;

function secret() {
  return process.env.SESSION_SECRET || `fp:${process.env.APP_PASSWORD ?? ''}`;
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function criarSessao() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return { value: `${exp}.${await hmac(String(exp))}`, maxAge: MAX_AGE };
}

export async function sessaoValida(token: string | undefined) {
  if (!authAtivo()) return true;
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return iguais(sig, await hmac(exp));
}

export async function senhaConfere(senha: string) {
  const esperado = process.env.APP_PASSWORD ?? '';
  // compara HMACs para tempo constante
  return !!esperado && iguais(await hmac('pw:' + senha), await hmac('pw:' + esperado));
}
