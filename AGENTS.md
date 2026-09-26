<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Projeto: Finanças (controle financeiro pessoal)

Antes de mudar regras financeiras, leia `docs/REGRAS.md`; para importação/deduplicação, `docs/IMPORTACAO.md`; esquema em `docs/BANCO.md`.

Invariantes que não podem quebrar (há testes para cada uma em `tests/`):
- Dinheiro em centavos inteiros; datas de negócio como texto `YYYY-MM-DD` (sem fuso).
- Classificação vive em `movement_splits`; soma do rateio = valor do movimento (trigger diferido — escreva sempre dentro de `tx`/`writeTx`).
- Natureza econômica vem da subcategoria; pagamento de fatura, transferências, aportes/resgates, empréstimos e ajustes nunca são receita/despesa.
- Deduplicação: índice único `(conta ou cartão, dedup_key)`; chave por formato + índice de ocorrência no arquivo.
- Toda consulta filtra `user_id`; toda action exige sessão (`readCtx`/`writeTx`).
- Nunca versionar arquivos financeiros reais (`tests/fixtures/real/` está no .gitignore).

Comandos: `npm test`, `npm run typecheck`, `npm run dev` (PGlite local), `npx tsx tests/e2e/flow.ts` (fluxo no navegador).
