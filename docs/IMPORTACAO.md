# Importação, deduplicação e classificação

Código: `src/server/import/` (pipeline, registro e importadores) e `src/server/domain/classification.ts`.
Testes: `tests/import.test.ts` (arquivos sintéticos no layout real e, localmente, os arquivos reais em `tests/fixtures/real/`).

## Fluxo

```
Upload → Identificação → Leitura → Validação → Deduplicação → Classificação → Prévia (lote DRAFT) → Revisão → Confirmação
```

1. **Upload** (`uploadAction`): .xls/.xlsx/.csv/.ofx até 5 MB; extensão e assinatura binária verificadas. No celular abre o seletor de arquivos do aparelho.
2. **Identificação**: cada importador dá uma nota de confiança (`detect`); o maior ≥ 0,5 vence. A conta é achada pela agência/número do arquivo;
   o cartão pelo final (inclui finais virtuais) ou pela instituição. Sem correspondência → a tela oferece escolher ou **cadastrar a partir do arquivo**
   (formulário pré-preenchido; ao salvar, o lote é identificado sozinho).
3. **Leitura** para `CanonicalRow` (data, descrição, valor no sinal do portador, parcela n/N, data da compra, id externo, se é pagamento).
4. **Prévia salva no banco** (`import_batches` + `import_rows`, com a linha bruta em `raw`): na Vercel não há memória entre requisições.
5. **Revisão**: por linha — importar / não importar / vincular ao existente; categoria (sugestão, escolha, "aplicar às semelhantes").
6. **Confirmação** (`commitBatch`) em **uma transação**, com trava do lote (`for update`): duplo clique ou duas abas não duplicam.
   Grava movimentos, parcelas futuras, vínculos, saldos de conferência e o total informado da fatura.
7. **Histórico de lotes** com contagens; **desfazer lote** a qualquer momento.

A prévia mostra: encontrados, novos, duplicados, que realizam previstos, possíveis duplicados, classificados, pendentes, pagamentos de fatura e erros;
e ainda: "saldo anterior do arquivo" (com botão para usá-lo como saldo inicial da conta), total da fatura informado × soma das linhas,
aviso de **arquivo já importado** (mesmo SHA-256) e linhas que **sumiram** de uma fatura aberta reimportada.

## Deduplicação (prioridade nº 1)

Em camadas, da mais forte para a mais fraca:

1. **Id original** (FITID do OFX, Identificador do Nubank conta) → chave `ext:<id>`.
2. **Chave por formato + índice de ocorrência** quando não há id:

   | Formato | Chave base |
   |---|---|
   | Extrato Itaú | `itau-cc \| data \| valor \| descrição` |
   | Fatura Itaú | `itau-card \| data da compra \| descrição \| valor \| n/N` |
   | Fatura Nubank | parcelada: `nu-card \| descrição sem "Parcela" \| valor \| n/N` · à vista: `nu-card \| data \| descrição \| valor` |
   | OFX sem FITID | `ofx \| data \| valor \| descrição` |

   A chave final recebe `| k`, onde **k é a ocorrência daquela chave dentro do arquivo**. Assim:
   - duas compras legítimas idênticas (mesmo dia, valor e descrição) → k = 1 e 2 → **as duas entram**;
   - o mesmo arquivo de novo → mesmas chaves → **nada entra**;
   - períodos sobrepostos → cada dia aparece inteiro nos dois arquivos → mesmas chaves;
   - um arquivo posterior com uma ocorrência a mais → só a nova entra.

   O banco tem **índice único** `(conta ou cartão, chave)` entre os não excluídos: mesmo com erro no código, duplicata é recusada (`on conflict do nothing`).
3. **Previsto correspondente**: parcela prevista (mesma chave, ou mesma descrição, n/N e valor ±5 centavos) ou ocorrência de recorrência
   (mesma conta, ±7 dias, valor na tolerância) → a linha **realiza** o previsto.
4. **Possível duplicado**: mesmo portador, mesmo valor, data ±3 dias, vindo de **outra fonte** (lançamento manual, outro formato, lado criado pelo sistema)
   → linha marcada para revisão com padrão **"vincular ao existente"** (mantém a categoria que você já deu). Linhas do mesmo formato nunca caem aqui (a chave já resolve).
5. **Arquivo idêntico** (SHA-256) → aviso na prévia.

Por que não só "conta + data + valor + descrição": falharia com duas compras iguais no mesmo dia (falso duplicado) e com o mesmo evento
descrito de formas diferentes em dois formatos (falsa novidade). O índice de ocorrência resolve o primeiro caso; a camada 4 o segundo.

## Classificação automática

Ordem (`src/server/domain/classification.ts`):

1. **Suas regras** (criadas em Cadastros → Regras ou aprendidas ao classificar com "aplicar a semelhantes") — confiança 0,98.
2. **Regras do sistema** (dicionário herdado do conciliador e ampliado; `src/server/seed.ts`) — 0,90. Entradas só por padrões inequívocos
   (RENDIMENTO, RESGATE, SALARIO); TED/PIX recebidos genéricos **nunca** são classificados no chute.
3. **Histórico**: mesma descrição (núcleo) já classificada ≥ 2 vezes sempre na mesma categoria — 0,90; uma vez ou com conflito — 0,4–0,6 (só sugestão).

Com confiança ≥ **0,85** a linha já entra classificada; abaixo disso fica **pendente** com a sugestão exibida (tela Pendentes).
Regras aceitam filtro de sentido (entrada/saída), conta/cartão e faixa de valor; tipos: contém, começa com, igual, expressão regular.
Padrões mais longos e de maior prioridade vencem (evita "TIM" pegar "TIMY ALIMENTOS").

**Aprendizado**: ao classificar com "aplicar a semelhantes", o app cria a regra com o trecho sugerido (editável, ex.: `SERRA DIESE`, `ZAFFARI`)
e classifica na hora os pendentes que contêm o trecho.

**Pagamento de fatura** é detectado antes da categoria: padrões do cartão (`FATURA ITAU`, `NU PAGAMENT`) no extrato; linhas "Pagamento recebido"/
"Pagamento Debito Automatico" nos arquivos de fatura.

## Importadores existentes

| Id | Formato | Observações do layout real |
|---|---|---|
| `itau-extrato` | Extrato conta corrente Itaú (.xls BIFF / .xlsx) | Aba "Lançamentos"; agência/conta no topo; `SALDO ANTERIOR` e `SALDO TOTAL DISPONÍVEL DIA` → conferência; acentos quebrados corrigidos |
| `itau-fatura` | Fatura Itaú (.xlsx) | Título "… final 5850"; "Valor (parcial)/Total"; "Vencimento"; vários finais (virtuais) na mesma fatura; data original da compra nas parcelas |
| `nubank-cartao` | Fatura Nubank (.csv `date,title,amount`) | Valores pt-BR com espaço no sinal; "Parcela 2/4" no título; vencimento no nome do arquivo |
| `nubank-conta` | Extrato NuConta (.csv `Data,Valor,Identificador,Descrição`) | Identificador = id original |
| `ofx` | OFX 1.x/2.x (qualquer banco: Sicredi, Mercado Pago, BB, Caixa…) | FITID como id; LEDGERBAL como conferência de saldo |

## Como adicionar um banco/formato

1. Crie `src/server/import/importers/<banco>-<formato>.ts` implementando `Importer` (`src/server/import/types.ts`):
   - `detect(file)` → 0..1 (olhe cabeçalho, nomes de abas, assinatura);
   - `parse(file)` → `ParsedFile` (valores **já no sinal do portador**; cartão: compra negativa);
   - `baseKey(row)` → chave estável entre reimportações (prefira o id do banco: `ext:<id>`);
   - para faturas com parcelas: `installmentKey(row, k)` e `groupKey(row)`.
2. Registre em `src/server/import/registry.ts`.
3. Crie um gerador sintético em `tests/fixtures.ts` e testes em `tests/import.test.ts` (reimportar = 0 novos; compras iguais no mesmo dia = todas entram).

Nada mais muda: deduplicação, classificação, revisão, vínculos e desfazer são do pipeline.

## Migração da planilha CAIXA 2026

`src/server/import/planilha.ts` (tela Configurações → Migrar planilha):

- **CASH** → lançamentos na conta escolhida (valor positivo = saída); **CARTÃO** → lançamentos no cartão mapeado, na fatura do MÊS_VENC (faturas até o corte ficam "quitadas");
- **CAIXA MENSAL**: REALIZADO das entradas → uma entrada por subcategoria/mês; PREVISTO → orçamento de todos os anos presentes (inclusive valores negativos);
- **Corte**: conta até ago/26 e faturas que vencem até set/26 (padrão). Depois disso valem só os arquivos do banco — assim nada é importado duas vezes.
- Chaves `mig|…` tornam a migração idempotente. Linhas sem descrição usam a subcategoria.
- Verificado com o arquivo real: o REALIZADO de entradas e saídas de **jan a ago/26 bate no centavo** com a linha TOTAL do CAIXA MENSAL.

## Sincronização com a planilha atualizada

`src/server/import/planilha-sync.ts` (Configurações → Planilha CAIXA): o usuário continua lançando na planilha e envia o
arquivo de novo. Prévia (`planSync`) e aplicação (`applySync`, numa transação):

- Cada linha CASH/CARTÃO procura, no mesmo portador, um lançamento ainda não usado: chave `mig|…`/`plan|…`;
  conta: mesmo valor e data a ±3 dias; cartão: mesma parcela n/N na fatura do mesmo mês de vencimento (parcelas aceitam
  até R$ 1,00 de arredondamento — o banco ajusta centavos na última) ou compra à vista a ±3 dias.
- **O arquivo do banco manda.** Linha sem correspondência dentro do período já coberto por extrato/fatura importados
  (até a última data importada naquele portador; no cartão, só compras à vista definem a data) é **ignorada** e listada
  à parte. Só entra o que é posterior ao último arquivo do banco.
- Lançamentos pendentes que casam com uma linha classificada recebem a subcategoria da planilha.
- Linhas novas: chave `plan|sha1(conteúdo + ocorrência)` — reenviar o arquivo não duplica, mesmo com linhas inseridas no meio.
  Cartão: entram na fatura do mês de vencimento da planilha; parcelas futuras ficam previstas.
- Saldo do banco opcional (data + valor): a prévia mostra o saldo calculado depois de aplicar e, ao aplicar, ele fica
  registrado como conferência manual da conta (também dá para informar em Contas → conta → Conferência com o banco).
- Verificado com o arquivo real (`tests/sync.test.ts`): após extrato até 23/09 e faturas, entram 14 linhas da conta
  (24/09 a 07/10) e 7 do cartão; o saldo calculado em 30/09 bate com o do banco (R$ 108,51); reenviar = 0 novos.

## Receitas mensais informadas

`src/server/domain/incomes.ts` (`reconcileIncomes`) concilia uma tabela de receitas realizadas por mês/subcategoria
(a de entradas do CAIXA MENSAL) com o app, sem duplicar:

1. receita que já está no app (parte de rateio com a subcategoria, competência no mês e mesmo valor) é mantida;
   histórico migrado no dia 1º passa para o **primeiro dia útil** do mês (`firstBusinessDay`, feriados bancários nacionais);
2. senão, um crédito do extrato no mês, pendente ou classificado como entrada, com valor igual a uma receita ou à soma
   de várias, é classificado/rateado (ex.: TED de 03/09 = Salário + Rescisão);
3. o que sobra é lançado no primeiro dia útil: antes do saldo inicial, na conta principal (histórico, sem efeito no
   saldo); depois, na conta **"Outras contas"**, para a conta principal continuar conferindo com o banco.
   Mês sem extrato importado fica aguardando.

Aplicação pontual em produção: variável `INCOMES_JSON` no build (ver `scripts/incomes-from-env.ts`; os valores nunca
vão para o git). O log do build mostra só contagens. Depois do deploy, apague a variável.
