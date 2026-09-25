# Conciliador CAIXA 2026

Web app estático que concilia o **extrato da conta** e a **fatura do cartão** do Itaú com a planilha **CAIXA 2026**. Ele categoriza, deduplica, completa séries de parcelas, separa o que não reconheceu em **Pendências** e confere o saldo do banco contra o da planilha.

- Tudo roda **no navegador**: nenhum dado sai do dispositivo (CSP com `connect-src 'none'`). Não há backend nem banco de dados.
- A planilha-mestra **nunca é alterada**. O app só gera os lançamentos novos, para copiar (TSV) ou baixar (.xlsx).
- A planilha-base fica salva no `localStorage` do navegador. Você a carrega uma vez só.

## Estrutura

```
public/             ← o site (é isto que vai para o Vercel)
  index.html        UI (4 abas, tema claro/escuro, mobile-first)
  app.js            estado, abas, pendências, export, painel de conciliação
  engine.js         engine de referência + parsers SheetJS + export (roda no browser e no Node)
test/
  engine.test.js    testes da engine (critérios de aceitação)
  make-fixtures.js  gera arquivos SINTÉTICOS no layout real do Itaú/CAIXA 2026
  fixtures/         base.xlsx, extrato.xls, fatura.xlsx sintéticos (dados fictícios)
vercel.json         deploy estático (sem build) + cabeçalhos de segurança
```

O SheetJS vem do CDN: `cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5`.

## Rodar local

```bash
npm install        # só para os testes (instala o SheetJS no Node)
npm test           # roda a engine contra as fixtures
npm start          # serve public/ em http://localhost:3000
```

Qualquer servidor estático serve, por exemplo `python3 -m http.server -d public 3000`. Abrir o `index.html` direto (file://) também funciona na maioria dos navegadores.

### Testar com os seus arquivos reais

Coloque os arquivos em `test/fixtures/real/` (a pasta está no `.gitignore` e **nunca** vai para o repositório):

```
test/fixtures/real/base.xlsx       ← CAIXA 2026 CLAUDE - melhorado.xlsx
test/fixtures/real/extrato.xls     ← ou extrato.xlsx
test/fixtures/real/fatura.xlsx
```

Depois rode `npm test`. O teste "aceitação — arquivos reais" confere os números da especificação: 23 lançamentos novos na conta, 4 duplicados, 3 recebimentos, 2 excluídos, cerca de 38 parcelas, saldo de R$ 2.984,77 e idempotência. Sem esses arquivos, o teste é pulado.

## Publicar no Vercel

1. Suba este repositório no GitHub.
2. No Vercel: **Add New → Project → Import** o repositório. O `vercel.json` já define `outputDirectory: public` e desliga o build. Não é preciso configurar nada.
3. Clique em **Deploy**.

Pela CLI: `npx vercel --prod` na raiz do projeto.

## Como usar

1. **Importar → Planilha-base** (uma vez): baixe o CAIXA 2026 do Google Sheets (*Arquivo → Fazer download → .xlsx*) e solte aqui. O app lê as abas `CASH`, `CARTÃO`, `Apoio` e `Regras` e mostra "histórico: N lançamentos". Recarregue a base sempre que a planilha mudar muito.
2. **Extrato** (.xls/.xlsx do Itaú) e/ou **Fatura** (.xlsx, a fatura aberta).
3. **Conciliar**. O resumo mostra as parcelas do cartão (a série completa, da parcela atual até a última), os lançamentos da conta, as pendências e os recebimentos. Também lista o que foi excluído de propósito: o pagamento da fatura anterior e o débito da fatura no extrato.
4. **Pendências**: escolha o subgrupo (lista da aba Apoio) ou o destino do recebimento. O item sai da fila. Com "Lembrar" marcado, a mesma descrição passa a ser categorizada sozinha nas próximas vezes.
5. **Copiar lançamentos**: cole no Google Sheets **na coluna C** da aba correspondente (blocos CARTÃO e CASH). As colunas A/B continuam com as fórmulas da planilha. Se o navegador bloquear o clipboard, use **Ver texto**. **Baixar .xlsx** gera um arquivo com as abas CARTÃO e CASH (e RECEBIMENTOS, quando houver).
6. **Conciliação**: digite o saldo final da planilha (B). O painel soma os recebimentos não lançados e a fatura não paga, e mostra **Não conciliado** em verde (|diferença| < R$ 0,50) ou em vermelho.

### Regras de deduplicação

- Cartão: `valor | parcela NN/MM | ano-mês do vencimento`. Conta: `data | valor`.
- A conferência usa o histórico da base **e** as conciliações já **exportadas** (copiadas ou baixadas). Reimportar os mesmos arquivos depois de exportar gera 0 lançamentos novos.
- Antes de exportar, conciliar de novo **substitui** a rodada anterior. Assim dá para acrescentar a fatura depois do extrato sem perder nada. **Desfazer conciliação** tira da memória as chaves da última rodada.
- **Apagar dados salvos** (no rodapé) limpa a base, a memória, as regras aprendidas e a última conciliação.
