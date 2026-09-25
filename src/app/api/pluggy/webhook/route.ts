import { after, NextResponse } from 'next/server';
import { q } from '@/lib/db';
import { sincronizarItem } from '@/lib/sync';

export const maxDuration = 300;

// Pluggy chama este endpoint quando um item termina de atualizar ou chegam transações novas.
// Proteção: segredo na query string (a URL é registrada pelo próprio app no connect token).
export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!process.env.PLUGGY_WEBHOOK_SECRET || secret !== process.env.PLUGGY_WEBHOOK_SECRET) return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { event?: string; itemId?: string };
  const relevante = body.itemId && /^(item\/(updated|created)|transactions\/)/.test(body.event ?? '');
  if (relevante) {
    const conhecido = await q('select 1 from pluggy_items where item_id = $1', [body.itemId]);
    // Responde rápido (a Pluggy espera 2xx em poucos segundos) e sincroniza depois.
    if (conhecido.length) after(() => sincronizarItem(body.itemId!).then(() => undefined));
  }
  return NextResponse.json({ ok: true });
}
