import type { Ctx } from './types';

export async function audit(
  { q, userId }: Ctx, entity: string, entityId: string | null, action: string,
  change?: { field: string; old: unknown; new: unknown } | null, context: Record<string, unknown> = {},
) {
  const s = (v: unknown) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  await q.query(
    `insert into audit_events(user_id, entity, entity_id, action, field, old_value, new_value, context)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId, entity, entityId, action, change?.field ?? null, s(change?.old), s(change?.new), JSON.stringify(context)],
  );
}

export async function history({ q, userId }: Ctx, entity: string, entityId: string) {
  return q.query<{ id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; context: Record<string, unknown>; created_at: Date }>(
    `select id, action, field, old_value, new_value, context, created_at from audit_events
     where user_id=$1 and entity=$2 and entity_id=$3 order by created_at desc, id desc limit 100`,
    [userId, entity, entityId],
  );
}
