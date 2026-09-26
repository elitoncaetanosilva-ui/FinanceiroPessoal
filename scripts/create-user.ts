/** Cria um usuário. Uso: npm run user:create -- email@exemplo.com 'senha-forte' 'Nome' */
import { createDb, migrate } from '../src/server/db';
import { createUser } from '../src/server/bootstrap';

const [email, password, name = ''] = process.argv.slice(2);
if (!email || !password) { console.error('Uso: npm run user:create -- <email> <senha> [nome]'); process.exit(1); }
(async () => {
  const db = await createDb();
  await migrate(db);
  const id = await db.tx(q => createUser(q, email, password, name));
  console.log('Usuário criado:', email, id);
  await db.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });
