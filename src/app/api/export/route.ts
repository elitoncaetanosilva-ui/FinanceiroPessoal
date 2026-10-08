import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth/session';
import { q } from '@/server/db';

export const dynamic = 'force-dynamic';

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  const format = new URL(req.url).searchParams.get('formato') ?? 'csv';
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const tables = ['institutions', 'accounts', 'credit_cards', 'card_statements', 'categories', 'movements', 'movement_splits', 'movement_links',
      'installment_groups', 'recurring_rules', 'budgets', 'classification_rules', 'balance_checkpoints', 'import_batches'];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user: u.email };
    for (const t of tables) out[t] = await q(`select * from ${t} where user_id=$1`, [u.id]);
    out.budget_items = await q('select i.* from budget_items i join budgets b on b.id=i.budget_id where b.user_id=$1', [u.id]);
    return new NextResponse(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="financas-backup-${stamp}.json"` } });
  }
  const rows = await q<Record<string, unknown>>(
    `select m.date as data, m.competence as competencia, m.description as descricao, coalesce(a.name, c.name) as conta_cartao,
       g.name as categoria, k.name as subcategoria, k.nature as natureza, s.amount_cents / 100.0 as valor, m.status, m.kind as tipo, m.source as origem,
       m.installment_number as parcela, m.installment_total as parcelas, m.notes as observacao
     from movements m join movement_splits s on s.movement_id=m.id left join categories k on k.id=s.category_id left join categories g on g.id=k.parent_id
     left join accounts a on a.id=m.account_id left join credit_cards c on c.id=m.card_id
     where m.user_id=$1 and m.deleted_at is null order by m.date, m.id`, [u.id]);
  const cols = rows[0] ? Object.keys(rows[0]) : ['data'];
  const body = '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => csvCell(c === 'valor' ? String(r[c]).replace('.', ',') : r[c])).join(';'))].join('\n');
  return new NextResponse(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lancamentos-${stamp}.csv"` } });
}
