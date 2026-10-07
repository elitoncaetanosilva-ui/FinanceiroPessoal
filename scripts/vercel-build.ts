/**
 * Build da Vercel: aplica as migrations (somente quando MIGRATE_ON_BUILD=1, definido apenas
 * no projeto deste app) e depois roda `next build`.
 */
import { spawnSync } from 'node:child_process';
import { opsFromEnv } from './ops-from-env';
import { runMigrations } from './migrate';

async function main() {
  if (process.env.MIGRATE_ON_BUILD === '1') {
    if (!process.env.DATABASE_URL) throw new Error('MIGRATE_ON_BUILD=1 mas DATABASE_URL não está definida.');
    await runMigrations();
    await opsFromEnv();
  } else {
    console.log('[build] MIGRATE_ON_BUILD != 1 — migrations não aplicadas neste build');
  }
  const r = spawnSync('next', ['build'], { stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}
main().catch(e => { console.error(e); process.exit(1); });
