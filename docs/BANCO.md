# Banco de dados

PostgreSQL (Neon em produção; PGlite — Postgres em WASM — em desenvolvimento e testes). Esquema em `migrations/NNNN_*.sql`.

## Migrations

- Arquivos SQL numerados em `migrations/`, aplicados **em ordem e uma única vez** (tabela `schema_migrations`), cada um numa transação.
- Produção: aplicadas no **build da Vercel** (`scripts/vercel-build.ts`, somente com `MIGRATE_ON_BUILD=1`). Manual: `npm run db:migrate` com `DATABASE_URL`.
- Desenvolvimento: aplicadas automaticamente ao subir o app sem `DATABASE_URL`.
- Nunca edite uma migration já aplicada: crie a próxima (`0004_...sql`).

| Migration | Conteúdo |
|---|---|
| `0001_init.sql` | Modelo completo, índices, trigger do rateio |
| `0002_import_rows.sql` | Campos de trabalho da revisão de importação e do desfazer |
| `0003_budget_negative.sql` | Orçamento pode ser negativo (como na planilha) |

## Seed

`src/server/seed.ts` (idempotente, roda na criação do usuário e a cada migração): instituições, a **árvore de categorias da seção 7**
com a natureza de cada subcategoria, categorias de sistema (`TRANSFER`, `INVESTMENT_IN`/`OUT`, `ADJUSTMENT`, `CARD_PAYMENT`) e as
regras de classificação do sistema.

## Tabelas

| Tabela | Papel | Pontos de integridade |
|---|---|---|
| `users`, `sessions`, `login_attempts` | Acesso | Sessão guarda só o hash do token |
| `institutions` | Bancos | Único por usuário+nome |
| `accounts` | Contas (corrente, poupança, digital, investimento, carteira, dinheiro) | Saldo inicial + data; `in_available_balance` |
| `credit_cards` | Cartões | Dias 1–31; finais extras; padrões de pagamento |
| `card_statements` | Faturas | Única por cartão+mês de vencimento; datas reais editáveis |
| `categories` | Categorias (nível 1) e subcategorias (`parent_id`) | Natureza e seção checadas; nome único por nível; `system_key` único |
| `movements` | Lançamentos | Conta **ou** cartão (check); cartão ⇒ fatura (check); **índice único (portador, dedup_key)** entre não excluídos; exclusão lógica; `version` para edição concorrente |
| `movement_splits` | Rateio/classificação | **Trigger diferido: soma = valor do movimento**, ≥ 1 rateio; `category_id` nulo = pendente; `person_id` (futuro) |
| `movement_links` | Par de transferência / pagamento de fatura | Os dois movimentos apontam para o mesmo link |
| `installment_groups` | Compra parcelada | `group_key` único por portador (compras vindas de arquivo) |
| `recurring_rules` | Recorrências | Conta **ou** cartão |
| `budgets`, `budget_items` | Orçamento anual | Único (orçamento, categoria, mês) |
| `import_batches`, `import_rows` | Lotes e linhas importadas (linha bruta em `raw`) | Status do lote; decisões por linha; estado anterior para desfazer |
| `classification_rules` | Regras (sistema, suas, aprendidas) | Contagem de acertos |
| `balance_checkpoints` | Saldos informados pelo banco | Único por conta+data |
| `audit_events` | Histórico de alterações | Campo, valor anterior, novo, data/hora, contexto |
| `people` | Pessoa/Responsável (futuro) | — |

Relacionamentos principais:

```
accounts 1─n movements n─1 credit_cards 1─n card_statements 1─n movements
movements 1─n movement_splits n─1 categories (subcategoria) n─1 categories (categoria)
movements n─1 movement_links (par)      movements n─1 installment_groups (parcelas)
movements n─1 recurring_rules (previstos)   movements n─1 import_batches 1─n import_rows
budgets 1─n budget_items n─1 categories
```

## Índices relevantes para performance

- `movements(user_id, date desc, id)` — lista paginada por cursor (nunca carrega tudo no navegador).
- `movements(user_id, competence)` — orçamento, dashboard, análises (agregação no banco).
- `movements(statement_id)`, `(card_id, statement_id)`, `(settles_statement_id)` — faturas e limite.
- `movements(user_id, status, date) where PLANNED` — previstos e projeção.
- `movement_splits(user_id) where category_id is null` — contagem de pendentes.

## Por que um trigger para o rateio

A regra "rateio fecha com o valor" não pode depender só da tela nem só do código: o trigger `movement_splits_sum`/`movements_splits_sum`
é `DEFERRABLE INITIALLY DEFERRED`, então o movimento e seus rateios podem ser gravados em qualquer ordem dentro da transação e a
verificação acontece no COMMIT. Uma soma errada desfaz a transação inteira.

## Backup

- Neon mantém histórico para restauração pontual (conforme o plano) e permite *branch* do banco.
- Configurações → "Backup completo (.json)" exporta todas as tabelas do usuário; "Lançamentos (.csv)" abre no Excel/Sheets.
