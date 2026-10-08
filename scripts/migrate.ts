/** Aplica as migrations pendentes e garante o usuário inicial. Uso: npm run db:migrate */
import { createDb, migrate } from '../src/server/db';
import { ensureAdminUser } from '../src/server/bootstrap';

export async function runMigrations() {
  const db = await createDb();
  try {
    await migrate(db, m => console.log('[db]', m));
    await ensureAdminUser(db, m => console.log('[db]', m));
    console.log('[db] banco atualizado');
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  runMigrations().catch(e => { console.error(e); process.exit(1); });
}
