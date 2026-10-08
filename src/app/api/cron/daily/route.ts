import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { autoRealizeInstallments } from '@/server/domain/movements';
import { generateAll } from '@/server/domain/recurring';

export const dynamic = 'force-dynamic';

/** Vercel Cron (diário): estende o horizonte das recorrências e realiza parcelas de faturas fechadas. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  const db = await getDb();
  const users = await db.query<{ id: string }>('select id from users');
  const out: Record<string, number> = {};
  for (const u of users) {
    out[u.id] = await db.tx(async q => {
      const ctx = { q, userId: u.id };
      await autoRealizeInstallments(ctx);
      return generateAll(ctx);
    });
  }
  return NextResponse.json({ ok: true, generated: out });
}
