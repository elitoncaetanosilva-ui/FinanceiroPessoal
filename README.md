# Caixa Pessoal

App de fluxo de caixa pessoal para a Vercel, construído sobre o modelo da planilha **CAIXA 2026**:

- **CASH**: movimentos da conta corrente.
- **CARTÃO**: uma linha por parcela. Cada parcela entra no caixa no mês de **vencimento da fatura**.
- **CAIXA MENSAL**: previsto × realizado por grupo e subgrupo, com saldo encadeado.
- **Apoio**: as categorias e os cartões (Itaú Black e Nubank).

Os extratos e as faturas do **Itaú** e do **Nubank** chegam por **Open Finance** (via [Pluggy](https://pluggy.ai)). São categorizados, conciliados com o que já está na planilha e projetados (parcelas futuras).

## O que o app faz

| Tela | Conteúdo |
|---|---|
| **Painel** | Entradas, saídas, geração de caixa e saldo final do mês (com % do previsto), gráfico de 12 meses, destaques, gastos por grupo contra a média, faturas por cartão |
| **Fluxo de caixa** | Réplica do CAIXA MENSAL: grupos e subgrupos × meses, previsto × realizado, edição do previsto com um clique, replicação do previsto entre meses, exportação .xlsx |
| **Lançamentos** | Filtros (mês, tipo, conta, subgrupo, busca), recategorização com **“lembrar”** (vira regra), ignorar (transferências), lançamento manual com parcelas, fila **Revisar** |
| **Cartões** | Fatura do mês por cartão, próximas faturas, limite (Open Finance), compras parceladas em aberto, resumo por subgrupo (a aba “Resumo Cartão”) |
| **Insights** | Projeção de saldo para 6 meses (cenário de entradas pela média ou pelo previsto), geração de caixa por mês, gastos recorrentes, tendência por grupo e alertas automáticos |
| **Dados & bancos** | Conectar Itaú e Nubank, sincronizar, data de corte, importar e exportar a planilha, saldo inicial, regras |

### Insights automáticos
- Saldo projetado negativo: primeiro mês em que o saldo fica abaixo de zero, somando as parcelas já contratadas.
- Subgrupos acima do previsto.
- Subgrupos que mais subiram ou caíram contra a média dos 3 meses anteriores.
- Total comprometido em parcelas e o mês em que elas “aliviam”.
- Gastos recorrentes, como assinaturas e aluguel.
- Peso da “Despesa não identificada” nas saídas.
- Maior saída do mês e participação do cartão nas saídas.
- Pendências de revisão.

## Como os dados se encaixam

- **Sinal do valor**: igual à planilha. Numa despesa, positivo é saída e negativo é estorno ou resgate. Numa receita, positivo é entrada. Geração de caixa = entradas − saídas.
- **Categorização**, em ordem de prioridade:
  1. regras suas (criadas com “lembrar”);
  2. regras **aprendidas do histórico da planilha** (cerca de 300);
  3. dicionário de palavras-chave (herdado do conciliador e ampliado);
  4. categoria da Pluggy;
  5. “Despesa não identificada”, que vai para a fila **Revisar**.
- **Conta (Open Finance)**:
  - débito → CASH;
  - crédito → entrada (Salário, V4, Serviço Contábil…), ou despesa negativa quando é resgate ou estorno;
  - **pagamento de fatura é ignorado**, porque as parcelas já estão no cartão.
- **Cartão (Open Finance)**:
  - o vencimento vem da fatura (`billId`) ou é calculado pelo dia de fechamento;
  - parcela *k/n* gera as parcelas *k+1…n* como **projeção**; quando a parcela real chega, ela substitui a projeção (mesma chave);
  - o crédito de pagamento da fatura é ignorado.
- **Conciliação com a planilha**: a partir da **data de corte** (padrão: 1º dia do mês atual), o banco alimenta o app. Um movimento do banco que já existe na planilha é **vinculado**, e não duplicado:
  - na conta: mesmo valor com data a até 3 dias;
  - no cartão: mesmo cartão, valor, parcela NN/MM e mês de vencimento.
- **Reimportar a planilha** substitui só as linhas vindas dela. O que veio do banco, o que foi lançado à mão e as recategorizações ficam.

Validação: o teste `test/real.test.ts` confere que, com a planilha real, o app reproduz **no centavo** as entradas, saídas e saldo final do REALIZADO do CAIXA MENSAL de jan a set/26. O teste roda só localmente, com o arquivo em `test/fixtures/real/caixa.xlsx`, pasta que o git ignora.

## Publicar na Vercel

1. **Importe o repositório** na Vercel: *Add New → Project*. O framework (Next.js) é detectado sozinho.
2. **Banco de dados**: em *Storage*, crie um **Neon Postgres** e conecte ao projeto. Isso preenche `DATABASE_URL`. As tabelas são criadas no primeiro acesso.
3. **Variáveis de ambiente** (*Settings → Environment Variables*), conforme o `.env.example`:
   - `APP_PASSWORD`: a senha para entrar no app;
   - `CRON_SECRET`: um texto aleatório longo. A Vercel o usa para chamar a sincronização diária (`vercel.json` agenda `/api/cron/sync` às 09:00 UTC, 06:00 em Brasília);
   - `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` (próximo passo);
   - opcional: `PLUGGY_WEBHOOK_SECRET`, para receber transações novas assim que a Pluggy as coleta.
4. **Deploy**. Abra o app, entre com a senha e vá em **Dados & bancos**:
   1. **Importar planilha**: baixe o CAIXA 2026 do Google Sheets (*Arquivo → Fazer download → .xlsx*). Isso traz o histórico, o previsto, o saldo inicial e as regras.
   2. **Conectar banco**: escolha Itaú e autorize no app do banco. Repita para o Nubank.
   3. Confira os **nomes dos cartões**. Eles devem ser iguais aos da coluna CARTÃO da planilha (“Itaú Black”, “Nubank”). O app já sugere esses nomes.

### Sobre a Pluggy (Open Finance)
Pessoa física não acessa diretamente as APIs do Open Finance Brasil. É preciso um agregador autorizado pelo Banco Central, e a Pluggy é um deles. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai), crie uma aplicação e copie *Client ID* e *Client Secret*. A Pluggy tem um ambiente de testes (*sandbox*, habilitado aqui com `NEXT_PUBLIC_PLUGGY_SANDBOX=1`). O acesso a dados reais depende do plano contratado. **Confira preços e condições para uso pessoal no site da Pluggy antes de conectar suas contas.** O consentimento dado no app do banco vale por até 12 meses. Quando expira, use **Reautorizar**.

O app só **lê** dados: extratos, faturas, saldos e limites. As credenciais bancárias nunca passam pelo app; a autorização acontece no ambiente do banco.

## Rodar localmente

```bash
npm install
npm run dev          # http://localhost:3000 — sem DATABASE_URL usa PGlite em ./.data/pglite
npm test             # testes (lógica, mapeamento Pluggy, conciliação e banco em memória)
npm run typecheck
```

Sem `APP_PASSWORD`, o acesso local é livre. Para testar com a planilha real, coloque o arquivo em `test/fixtures/real/caixa.xlsx`. Essa pasta nunca vai para o git.

## Estrutura

```
src/
  app/(app)/          páginas: painel, fluxo, lancamentos, cartoes, insights, conexoes
  app/api/            connect-token e webhook da Pluggy, cron de sincronização, exportação .xlsx
  app/actions.ts      server actions (importar, categorizar, previsto, sincronizar…)
  lib/
    planilha.ts       leitura/exportação no layout CAIXA 2026
    finance.ts        fluxo mensal (CAIXA MENSAL), faturas, parcelados, projeção
    insights.ts       geração de insights e detecção de recorrentes
    categorize.ts     regras, dicionários e mapeamento de categorias da Pluggy
    pluggy-map.ts     transações Pluggy → lançamentos (vencimento, parcelas, projeções)
    reconcile.ts      conciliação banco × planilha
    sync.ts           sincronização com a Pluggy
    db.ts / repo.ts   Postgres (Neon) / PGlite local
  proxy.ts            proteção por senha (cookie assinado)
public/conciliador/   conciliador estático antigo (100% no navegador), em /conciliador
legacy/               testes e README do conciliador antigo
```
