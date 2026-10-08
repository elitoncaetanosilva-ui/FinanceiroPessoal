# Arquitetura

```
 Celular / notebook (navegador ou PWA instalada)
        │ HTTPS · cookie de sessão httpOnly
        ▼
 Vercel (gru1) ── Next.js 16 App Router
   • src/proxy.ts ............ barreira rápida: sem cookie → /login
   • Server Components ....... leem o banco direto (src/server/domain/*)
   • Server Actions .......... escritas; validam no servidor; rodam em transação (writeTx)
   • /api/export, /api/cron .. exportação CSV/JSON e rotina diária (Vercel Cron)
        │ TLS (node-postgres, pool pequeno + attachDatabasePool)
        ▼
 Postgres (Neon)  ── migrations SQL aplicadas no build (MIGRATE_ON_BUILD=1)
```

## Camadas

| Camada | Pasta | Regra |
|---|---|---|
| Utilitários puros | `src/lib` | Sem I/O. Usados no servidor e no navegador (ex.: `card-cycle.ts` calcula a fatura de uma compra também no formulário). |
| Domínio | `src/server/domain` | Todas as regras financeiras. Funções recebem `Ctx = { q, userId }`; escritas esperam `q` de uma transação. |
| Importação | `src/server/import` | Pipeline genérico + importadores por formato (`importers/*`). Nunca escreve movimentos sem passar pelo domínio. |
| Ações | `src/app/actions` | Fronteira HTTP: converte FormData, chama o domínio dentro de `writeTx`, devolve `ActionResult` amigável (`safe`). |
| Telas | `src/app/(app)` | Server Components; interatividade em componentes cliente pequenos (`src/components`). |

`src/server/db.ts` abstrai o driver: **pg** em produção (DATABASE_URL) e **PGlite** (Postgres em WASM) em desenvolvimento e testes —
o mesmo SQL roda nos dois. Datas `date` chegam como texto `YYYY-MM-DD` (nunca `Date`, para não sofrer com fuso) e `bigint`/`numeric` como número.

## Autenticação e segurança

- Sessão própria: token aleatório de 32 bytes no cookie `fp_session` (httpOnly, Secure, SameSite=Lax); no banco fica só o SHA-256.
  Sessão de 30 dias renovada com uso. Senhas com scrypt (Node, sem dependência nativa).
- Cadastro fechado. O primeiro usuário vem de `ADMIN_EMAIL`/`ADMIN_PASSWORD` no primeiro build; depois a senha é trocada no app.
- Limite de tentativas de login (8 falhas em 15 min por e-mail ou IP).
- Toda página autenticada chama `requireUser()`; toda action usa `writeTx`/`readCtx`, que exigem sessão. Toda consulta filtra `user_id`.
- Validação no servidor (Zod nos cadastros; conversões explícitas nas ações). O banco também garante: índices únicos, checks, trigger do rateio.
- Uploads: extensão, tamanho (≤ 5 MB) e assinatura binária verificados; parsing no servidor com SheetJS 0.20.3 (versão sem as CVEs do 0.18.5).
- Cabeçalhos de segurança em `vercel.json` (HSTS, nosniff, frame DENY, Referrer-Policy).
- Nenhum segredo no código: `.env*` no .gitignore; variáveis na Vercel.

## Multiusuário

O app nasceu pessoal, mas toda tabela tem `user_id` e todo acesso é filtrado por ele. Abrir para mais usuários exige apenas uma tela de cadastro/convite.

## PWA

`src/app/manifest.ts` + ícones em `public/icons` + `public/sw.js`. O service worker guarda **somente** arquivos estáticos
(`/_next/static`, ícones) e uma página offline; **nunca** páginas ou dados financeiros. Instalação: “Adicionar à tela inicial”.

## Rotina diária (Vercel Cron, 09:15 UTC)

`/api/cron/daily` (autenticado por `CRON_SECRET`): estende o horizonte das recorrências (13 meses) e realiza parcelas de faturas já fechadas.
As mesmas rotinas também rodam ao abrir o dashboard/cartões/orçamento, então o app não depende do cron para estar correto.

## Evolução prevista (a arquitetura já comporta)

- **Open Finance / APIs bancárias**: um conector que produz `CanonicalRow` entra no mesmo pipeline (dedup, classificação, revisão) —
  `movements.source` já aceita `OPEN_FINANCE` e `external_id` guarda o id da transação.
- **Pessoa/Responsável**: tabela `people` e `movement_splits.person_id` já existem (sem tela na V1).
- **OCR de comprovantes, notificações de vencimento, 2FA/passkeys**: sem impacto no modelo.

## Decisões em relação à proposta

- ORM: a proposta citava Drizzle; a implementação usa **SQL versionado + node-postgres** (controle total de triggers diferidos,
  índices parciais e agregações, sem camada extra). O esquema está em `migrations/` e documentado em `docs/BANCO.md`.
- Projeto Vercel **separado** (`financeiro-pessoal`) com banco Neon próprio, para não interferir no projeto `caixa-pessoal` já existente na conta.
