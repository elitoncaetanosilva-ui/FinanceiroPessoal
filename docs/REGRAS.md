# Regras financeiras

Este documento é a referência das regras de negócio. O código correspondente está em `src/server/domain/` e os
testes que as comprovam em `tests/core.test.ts` e `tests/import.test.ts`.

## 1. Convenções

- **Dinheiro em centavos inteiros** (`bigint`). Nenhum `float` em cálculo financeiro.
- **Sinal do ponto de vista do portador** (conta ou cartão):
  - conta: `+` entrou, `−` saiu;
  - cartão: `−` compra (aumenta a dívida), `+` pagamento ou estorno (reduz a dívida).
- **Datas de negócio sem fuso** (`YYYY-MM-DD`). Datas vindas do Excel são lidas como calendário (a fatura do Itaú vem em UTC 00:00 e não "volta um dia").
- **Competência** é sempre o 1º dia de um mês (`YYYY-MM-01`).

## 2. Natureza econômica × direção

Entrada de dinheiro não é necessariamente receita; saída não é necessariamente despesa.

- **Direção** vem do sinal (entrada/saída). Os dois lados de uma transferência interna se anulam no consolidado (neutro).
- **Natureza** vem da **subcategoria** (`categories.nature`):

| Natureza | Exemplos | Receitas/Despesas? | Onde aparece |
|---|---|---|---|
| `INCOME` | Salário, 13º, V4 Company, **Poupança › Rendimento** (receita financeira) | Receita | Resultado do mês |
| `EXPENSE` | Moradia, Alimentação… Tâmilly, Outros, Despesas Bancárias | Despesa | Resultado, orçamento, gastos |
| `FINANCING` | **Financiamentos › Parcela de veículo / Parcela de empréstimo**; **Bancário › Empréstimo** (entrada) | Não é consumo nem renda | Linha "Dívidas": orçamento, fluxo de caixa, comprometimento da renda |
| `INVESTMENT` | Poupança › Aporte, Poupança › Resgate, Bancário › Resgate | Não | "Valor poupado" (aportes − resgates) |
| `TRANSFER` | Poupança › Transferência entre contas; *Pagamento de fatura* (sistema, oculta) | Não | Neutro |
| `ADJUSTMENT` | Ajuste de Saldo › Correção manual | Não | Separado; nunca consumo |

"Resultado do mês" = Receitas − Despesas − Dívidas (visão econômica).

Movimentos têm ainda um **tipo estrutural** (`movements.kind`): `NORMAL`, `TRANSFER`, `CARD_PAYMENT`, `ADJUSTMENT`.
Ele é usado para vínculos e totais de fatura; a classificação econômica sempre vem da categoria.

## 3. Visão de caixa × visão econômica

- **Caixa**: movimentos **realizados em contas** (não em cartões), pela data. É o dinheiro que entrou ou saiu.
  A compra no cartão não mexe no caixa; o **pagamento da fatura** mexe. Transferências entre contas próprias (ligadas) são neutras.
- **Econômica**: rateios com natureza de receita/despesa, pela **competência**. Inclui as compras no cartão;
  exclui transferências, pagamentos de fatura, aportes, resgates, empréstimos e ajustes.

Cada visão olha para um lado só do evento: é isso que impede a duplicação cartão × conta.

## 4. Cartão de crédito e faturas

- Cartão: limite, dia de fechamento, dia de vencimento, conta de pagamento, finais (físico + virtuais) e
  **padrões de pagamento** (trechos que identificam o pagamento no extrato, ex.: `FATURA ITAU`, `NU PAGAMENT`).
- **Fatura** (`card_statements`) é uma entidade: mês de vencimento, **datas reais** de fechamento e vencimento (editáveis — feriados),
  total informado pelo banco no último arquivo, "quitada fora do app" (histórico).
- Datas calculadas (`src/lib/card-cycle.ts`):
  - vence no dia `due_day` do mês M;
  - fecha no dia `closing_day` de M se `closing_day < due_day`; senão no mês anterior (ex.: Itaú fecha 30, vence 7).
- **Em qual fatura cai uma compra (lançamento manual)**: a primeira cujo fechamento é **posterior** à data da compra.
  Compra no dia do fechamento vai para a próxima ("melhor dia de compra"). Ex.: fecha 10, vence 17 → compra 08 na fatura atual; 12 na próxima.
- **Na importação o arquivo manda**: todas as linhas do arquivo vão para a fatura do arquivo (vencimento lido do arquivo ou do nome `Nubank_AAAA-MM-DD.csv`).
- **Competência da compra no cartão = mês do vencimento da fatura** (decisão do usuário, igual à planilha CAIXA 2026).
- **Total da fatura** = compras − estornos da fatura (pagamentos não entram). **Pago** = créditos de pagamento que quitam a fatura.
  Status: aberta, fechada, vencida, paga parcialmente, paga, futura.
- **Limite utilizado** = soma do que falta pagar em todas as faturas, **incluindo parcelas futuras** (o banco reserva o total do parcelado).
  Recorrências previstas no cartão não consomem limite.

### Pagamento de fatura (nunca é despesa)

Um pagamento é **um evento com dois lados ligados** (`movement_links.kind = CARD_PAYMENT`):

- lado da **conta**: saída (ex.: `FATURA ITAU UNICLASS MC BLA −6.699,92`), com `pays_card_id` e `settles_statement_id`;
- lado do **cartão**: crédito (ex.: `Pagamento Debito Automatico`), que quita a fatura.

Os dois recebem a categoria de sistema *Pagamento de fatura* (natureza `TRANSFER`). Regras:

1. O lado do cartão sempre existe (é ele que quita a fatura). Se só o extrato foi importado, o app cria o lado do cartão.
2. Quando o outro arquivo chega, a linha correspondente **se vincula** ao lado existente (mesmo valor, até 7 dias) em vez de criar outro.
3. A fatura quitada é a fechada mais próxima (prefere a de valor igual ao saldo). No arquivo do Itaú, o pagamento de setembro aparece na fatura de outubro, mas quita a de setembro.
4. **Detecção retroativa**: ao cadastrar/editar um cartão ou importar qualquer arquivo, lançamentos de conta ainda sem categoria que batem com o padrão de pagamento do cartão viram pagamento de fatura.
5. Pagamento parcial: a fatura fica "paga parcialmente" com o restante em aberto.

Resultado (testado): compra de R$ 300 + pagamento de R$ 300 → despesa contada **uma vez**; o caixa sai uma vez; limite volta a zero.

## 5. Parcelamentos

- `installment_groups` guarda a compra (descrição, data, total, nº de parcelas); cada parcela é um movimento com `installment_number/total`.
- Lançamento manual: total dividido em centavos exatos, **diferença na 1ª parcela** (R$ 100 em 3× = 33,34 + 33,33 + 33,33).
  Parcela k cai na fatura k−1 meses depois da primeira; parcelas cujas faturas ainda não fecharam ficam **previstas** e viram realizadas quando a fatura fecha.
- Importação de "Parcela 3 de 10": cria a 3ª (realizada) e as **4 a 10 previstas** nas faturas seguintes, cada uma já com a chave de deduplicação
  que terá no próximo arquivo. Quando a próxima fatura chega, "Parcela 4 de 10" **realiza** a prevista (inclusive se o valor diferir em centavos). Parcelas anteriores não são criadas.
- Classificar uma parcela propaga a categoria para as demais do grupo que ainda estavam iguais.

## 6. Transferências, aportes, resgates, empréstimos

- **Transferência entre contas próprias**: dois movimentos ligados (−/+). Patrimônio não muda; nada em receita/despesa.
  Para conta de investimento/poupança vira **aporte**; no sentido inverso, **resgate** (natureza `INVESTMENT`).
- Classificar um lançamento como "Transferência entre contas" procura o outro lado (outra conta própria, valor oposto, até 3 dias) e liga os dois.
- Aporte/resgate para investimento **não controlado** no app: um movimento só, natureza `INVESTMENT` (não é despesa nem receita).
- **Empréstimo recebido**: entrada `FINANCING` — aumenta o caixa, não é renda. Parcelas pagas: `FINANCING` (linha Dívidas).

## 7. Rateio

- Todo movimento tem 1..n rateios (`movement_splits`); a classificação vive **sempre** no rateio.
- **O banco garante** que a soma dos rateios é igual ao valor do movimento: trigger de constraint **diferido** (verificado no COMMIT).
- Ex.: supermercado R$ 500 = 350 Mercado + 100 Outros + 50 Pet. O movimento continua único.
- Rateio sem categoria = **pendente de classificação**.

## 8. Saldos

- Saldo da conta = **saldo inicial** (fim do dia `opening_balance_date`) + movimentos **realizados** com data **posterior**.
  Movimentos anteriores (ex.: histórico migrado da planilha) aparecem nos relatórios e no orçamento, mas não mexem no saldo.
- **Saldo disponível consolidado** = contas ativas marcadas "somar no disponível". Investimentos entram no patrimônio, não no disponível.
- **Conferência com o banco**: os saldos diários do extrato ("SALDO TOTAL DISPONÍVEL DIA") viram `balance_checkpoints`; a tela da conta
  mostra, dia a dia, se o saldo calculado confere. Diferença = lançamento faltando/sobrando (ou ajuste necessário).
- **Ajuste de saldo**: correção excepcional (conta, data, valor ou "saldo correto do banco", motivo, observação). Natureza `ADJUSTMENT`; nunca consumo.
- No Itaú, o saldo do extrato inclui a aplicação automática ("poup aut"): a conta no app representa "conta + aplicação automática".

## 9. Orçado × Realizado × Previsto × Realizado + Previsto

- **Orçado**: `budget_items` (ano, mês, categoria ou subcategoria). Orçamento de categoria = o valor da própria categoria, se houver; senão a soma das subcategorias.
  Pode ser negativo (ex.: resgates previstos numa categoria de saída, como na planilha).
- **Realizado**: rateios de movimentos realizados com competência no mês.
- **Previsto**: movimentos previstos (recorrências, parcelas futuras, lançamentos futuros) com competência no mês. Previstos vencidos continuam contando.
- **R + P** = Realizado + Previsto; **Desvio** = R + P − Orçado.
- Valores exibidos no sentido da seção: Entradas positivas quando entram; Saídas positivas quando saem (igual ao CAIXA MENSAL).
- Em transferências/aportes, a perna na conta de investimento (fora do disponível) não conta, para o aporte não se anular.
- Dinheiro sem categoria fica **fora** do orçamento e é mostrado à parte ("sem categoria neste mês").
- **Previsto que se realiza sai do previsto**: a importação casa o real com o previsto (parcela, recorrência) — nunca os dois somam.

## 10. Recorrências

Regra com valor, categoria, conta/cartão, início, fim, frequência (semanal, quinzenal, mensal, anual, personalizada), dia do vencimento,
trecho da descrição e tolerância de valor. Gera previstos até ~13 meses (cron diário estende). A data da ocorrência fica em `due_date`
("vaga"): ocorrência excluída ou realizada não é gerada de novo. Na importação, um lançamento real na mesma conta, com data até 7 dias
e valor dentro da tolerância (e contendo o trecho, se definido), **realiza** a ocorrência.

## 11. Projeção de caixa

Saldo disponível hoje + eventos futuros até o horizonte (30/60/90/180/365 dias):

1. previstos em contas disponíveis (previstos vencidos entram "hoje");
2. faturas: o que falta pagar sai na data de vencimento (na conta de pagamento);
3. opcional (ligado por padrão): **orçamento restante** de cada mês para gastos/entradas variáveis (mercado, combustível…),
   para a projeção não ficar otimista. Não duplica: o orçamento restante já desconta o realizado e o previsto do mês.

Mostra o saldo em cada marco, o **menor saldo previsto** (e a data) e o resumo por mês.

## 12. Dashboard e indicadores

- Receitas / Despesas / Dívidas / Resultado do mês (econômico) e entrada/saída de caixa.
- Orçamento de gastos (despesas + dívidas): O / R / P / R+P e as 3 categorias com maior desvio.
- Cartões: fatura atual/fechada, vencimento, limite disponível; faturas futuras comprometidas.
- **Comprometimento da renda** = (dívidas + recorrentes + parcelas do mês) ÷ entradas (R+P) do mês.
- **Valor poupado** = aportes − resgates do mês (contas disponíveis).
- Todo número leva aos lançamentos que o formam (drill-down para Movimentos com filtros de mês, categoria, natureza, conta/cartão).

## 13. Histórico e exclusão

- Edições relevantes geram `audit_events` (campo, valor anterior, novo, data/hora); a tela do lançamento mostra o histórico.
- Exclusão de movimento é **lógica** (`deleted_at`) e leva junto o par (transferência/pagamento). Cadastros com uso não são excluídos: são **inativados**.
- Lote de importação pode ser **desfeito**: remove o que criou e devolve os previstos que realizou ao estado anterior.
