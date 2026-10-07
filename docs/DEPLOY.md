# Instalação, variáveis de ambiente e deploy

## Local

Requisitos: Node 22+.

```bash
npm install
npm run dev                 # sem DATABASE_URL → PGlite em ./.data/pglite (migrations + usuário dev@local automáticos)
PGLITE_DIR=memory npm run dev   # banco em memória (zera a cada reinício)
DATABASE_URL=postgres://... npm run db:migrate   # aplica migrations num Postgres real
npm run user:create -- email@exemplo.com 'senha-com-10+' 'Nome'
```

Testes: `npm test` (Vitest + PGlite), `npm run typecheck`, `npx tsx tests/e2e/flow.ts` (Playwright; precisa do app em `:3100` e dos arquivos reais em `tests/fixtures/real/`, que não vão para o git).

## Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL` | Vercel (injetada pela integração Neon) | Conexão Postgres (pooled). Sem ela, o app usa PGlite local. |
| `MIGRATE_ON_BUILD` | Vercel: `1` (production e preview) | Aplica as migrations durante o build. Só neste projeto. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Vercel | Cria o primeiro usuário se ainda não houver nenhum. Depois de trocar a senha no app, `ADMIN_PASSWORD` pode ser apagada. |
| `CRON_SECRET` | Vercel | Autentica o cron diário (`Authorization: Bearer …`). |
| `PGLITE_DIR` | Local (opcional) | Pasta do banco local ou `memory`. |
| `PG_POOL_MAX` | Opcional | Conexões por instância (padrão 5). |
| `RESET_PASSWORD_EMAIL`, `RESET_PASSWORD` | Vercel (pontual) | Redefine a senha no próximo build e encerra as sessões. Apague depois. |
| `INCOMES_JSON`, `CAIXA_SYNC_B64`, `CLOSE_JSON` | Vercel (pontual) | Ajustes de dados no próximo build: receitas, sincronização da planilha e fechamento dos meses (`scripts/ops-from-env.ts`; log só com contagens). Apague depois. |

Modelo em `.env.example`. **Nunca versione `.env`** (está no .gitignore).

## Vercel (como está configurado)

- Projeto **`financeiro-pessoal`** ligado ao repositório GitHub `elitoncaetanosilva-ui/FinanceiroPessoal`; framework Next.js; região das funções `gru1` (`vercel.json`).
- Banco: store Neon **`financeiro-pessoal-db`** (região gru1), conectado ao projeto nos ambientes production, preview e development.
- Build: `npm run build` → `scripts/vercel-build.ts` (migrations + `next build`).
- Cron: `/api/cron/daily` às 09:15 UTC (`vercel.json`).
- Proteção: previews protegidos pela Vercel; domínio de produção público (o app tem login próprio).
- Domínios de produção: `financas-eliton.vercel.app` e `financeiro-pessoal-xi-eight.vercel.app`.

### Publicar

- Cada push no GitHub gera um deploy de **preview** automaticamente.
- Produção: faça merge na branch de produção do projeto (Settings → Git → Production Branch) ou promova um deploy
  (Deployments → ⋯ → Promote to Production). Pela API: `POST /v13/deployments` com `target: "production"` e `gitSource` da branch.
- As migrations rodam no build; um deploy nunca apaga dados (as migrations são aditivas e o banco é persistente).

### Homologação

Previews usam o mesmo banco por padrão. Para isolar, ative em Neon → Integration → "Create a branch for each preview" (cada preview ganha um branch do banco).

## Checklist de produção

- [ ] Trocar a senha inicial em Configurações.
- [ ] Apagar `ADMIN_PASSWORD` da Vercel depois do primeiro acesso.
- [ ] Cadastrar cartões com dia de fechamento e limite corretos (ou pelo arquivo da fatura).
- [ ] Conferir em Contas se o saldo confere com o banco (✓ verde).
- [ ] Exportar um backup (.json) de tempos em tempos.
