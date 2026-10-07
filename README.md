# Finanças — controle e planejamento financeiro pessoal

Aplicação web (mobile first, instalável como app) para controlar contas, cartões, parcelamentos, transferências,
investimentos, orçamento, previsão e fluxo de caixa, com importação de extratos e faturas.

**Prioridades do projeto:** integridade dos dados → regras financeiras corretas → facilidade de uso → informação gerencial → estética.

| | |
|---|---|
| Produção | Vercel, projeto `financeiro-pessoal` (região `gru1`, São Paulo) |
| Banco | Postgres gerenciado (Neon, integração da Vercel) |
| Stack | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · node-postgres · PGlite (dev/testes) · SheetJS · Recharts · Zod · Vitest · Playwright |

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Camadas, pastas, fluxo de uma requisição, autenticação, PWA, decisões |
| [docs/BANCO.md](docs/BANCO.md) | Modelo de dados, tabelas, índices, triggers, migrations, seed |
| [docs/REGRAS.md](docs/REGRAS.md) | **Regras financeiras**: natureza × direção, cartão, faturas, parcelamentos, transferências, rateio, competência × caixa, orçado/realizado/previsto, projeção |
| [docs/IMPORTACAO.md](docs/IMPORTACAO.md) | Fluxo de importação, **deduplicação**, classificação automática, importadores e como adicionar um banco |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Instalação local, variáveis de ambiente, migrations, deploy na Vercel, backup |
| [docs/PROPOSTA_V1.md](docs/PROPOSTA_V1.md) | Análise e proposta técnica aprovada antes da construção (histórico) |

## Rodar localmente (2 minutos)

```bash
npm install
npm run dev            # http://localhost:3000 — sem DATABASE_URL usa PGlite em ./.data/pglite
```

Sem `DATABASE_URL`, o app cria o banco local, aplica as migrations e o usuário `dev@local` / `dev-password-123`.
Para usar outro usuário: `npm run user:create -- email@exemplo.com 'senha-com-10+' 'Nome'`.

```bash
npm test               # regras financeiras + importação (Postgres em memória)
npm run typecheck
npx tsx tests/e2e/flow.ts   # fluxo completo no navegador (precisa do servidor em :3100 e dos arquivos reais)
```

Arquivos financeiros reais para testes ficam em `tests/fixtures/real/` — **a pasta está no .gitignore e nunca vai para o repositório**.

## Primeiro uso (produção)

1. Entrar com o e-mail e a senha iniciais (variáveis `ADMIN_EMAIL`/`ADMIN_PASSWORD`) e **trocar a senha** em Configurações.
2. **Importações → escolher o extrato** do banco. Se a conta ainda não existir, use “Cadastrar esta conta com os dados do arquivo”
   (agência, conta e saldo anterior vêm preenchidos). Confira a prévia e confirme.
3. Importar a **fatura** de cada cartão (o cadastro do cartão também pode ser feito a partir do arquivo — informe o dia de fechamento e o limite).
4. **Configurações → Planilha CAIXA** (opcional): migração inicial (histórico até o corte, entradas e orçamentos 2026/2027) e, depois, sincronização da planilha atualizada (só entra o que falta).
5. **Pendentes**: classificar o que o app não reconheceu com segurança. Marque “aplicar a semelhantes” para ele aprender.
6. Cadastrar **recorrências** (salário, aluguel, escola…) para o Previsto e a projeção de caixa.

## Estrutura

```
migrations/            SQL versionado (aplicado no build da Vercel)
scripts/               migrate, create-user, vercel-build
src/app/(app)/         telas autenticadas (Início, Movimentos, Pendentes, Orçamento, Cartões, Contas, Importações…)
src/app/actions/       server actions (validação no servidor; toda escrita em transação)
src/app/api/           exportação e cron diário
src/components/        UI (mobile first; tabela no notebook, cards no celular)
src/lib/               utilitários puros: dinheiro em centavos, datas sem fuso, texto, ciclo do cartão
src/server/domain/     regras financeiras (lançamentos, rateio, cartões, orçamento, projeção, classificação…)
src/server/import/     pipeline de importação + um importador por formato + migração da planilha
tests/                 Vitest (domínio e importação) e Playwright (fluxo e capturas)
```
