import { NextResponse } from 'next/server';
import { sincronizarTudo } from '@/lib/sync';

export const maxDuration = 300;

// Vercel Cron (vercel.json) chama com "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }
  const r = await sincronizarTudo({ atualizarNoBanco: true });
  return NextResponse.json({ ok: true, itens: r });
}
