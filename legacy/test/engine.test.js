// Testes da engine — node --test
// 1) Fixtures sintéticas (sempre rodam) calibradas para os números da seção 8 do brief.
// 2) Arquivos REAIS (opcional): coloque em test/fixtures/real/ os arquivos
//    base.xlsx, extrato.xls (ou .xlsx) e fatura.xlsx — a pasta é ignorada pelo git.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const E = require('../../public/conciliador/engine.js');
const { write } = require('./make-fixtures.js');

function stateFrom(base) {
  return {
    cartaoKeys: new Set(base.cartaoKeys),
    cashKeys: new Set(base.cashKeys),
    apoioSet: new Set(base.apoio.map(a => a.subgrupo)),
    rules: base.rules,
  };
}
function load(files) {
  const base = E.parseBase(XLSX, fs.readFileSync(files.base));
  const extrato = E.parseExtrato(XLSX, fs.readFileSync(files.extrato));
  const fatura = E.parseFatura(XLSX, fs.readFileSync(files.fatura), base.cartoes[0]);
  return { base, extrato, fatura };
}
const brl = n => E.r2(n).toFixed(2);
const parcelasDe = (res, kw) => res.cardNew.filter(p => E.norm(p.desc).includes(kw)).flatMap(p => p.parcelas);

// ---------- unidades ----------
test('utils: toNum pt-BR, toDate, normParc, mojibake', () => {
  assert.equal(E.toNum('1.234,56'), 1234.56);
  assert.equal(E.toNum('-6.699,92'), -6699.92);
  assert.equal(E.toNum('R$ 24,00'), 24);
  assert.equal(E.toNum(-12.5), -12.5);
  assert.equal(E.toNum(''), null);
  assert.equal(E.iso(E.toDate('05/09/2026')), '2026-09-05');
  assert.equal(E.iso(E.toDate(46270)), '2026-09-05');
  assert.equal(E.iso(E.toDate(new Date(2026, 8, 5))), '2026-09-05');
  assert.deepEqual(E.normParc('Parcela 5 de 9'), { c: 5, n: 9, s: '05/09' });
  assert.deepEqual(E.normParc(''), { c: 1, n: 1, s: '01/01' });
  assert.equal(E.parcCell(new Date(2026, 8, 5)), '05/09'); // Sheets transformou "05/09" em data
  assert.equal(E.fixMojibake(Buffer.from('CAFÉ Lançamento', 'utf8').toString('latin1')), 'CAFÉ Lançamento');
  assert.equal(E.fixMojibake('CAFÉ'), 'CAFÉ');
  assert.equal(E.k2(24), '24.00');
});

test('addMonths respeita fim de mês e virada de ano', () => {
  assert.equal(E.iso(E.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  assert.equal(E.iso(E.addMonths(new Date(2026, 9, 10), 5)), '2027-03-10');
});

test('categorize: regra do usuário > embutida; só subgrupos da Apoio', () => {
  const apoio = new Set(['Medicamentos', 'Academia']);
  assert.equal(E.categorize('PANVEL FILIAL', E.CARD_RULES, [], apoio), 'Medicamentos');
  assert.equal(E.categorize('PANVEL FILIAL', E.CARD_RULES, [{ contains: 'panvel', subgrupo: 'Academia' }], apoio), 'Academia');
  assert.equal(E.categorize('LOJAS RENNER', E.CARD_RULES, [], apoio), ''); // "Roupas" fora da Apoio → branco
  assert.equal(E.categorize('XPTO QUALQUER', E.CARD_RULES, [], apoio), '');
});

// ---------- aceitação (fixtures sintéticas no layout real) ----------
test('aceitação — fixtures sintéticas (seção 8)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-'));
  const { base, extrato, fatura } = load(write(dir));
  const state = stateFrom(base);

  // parsing
  assert.equal(extrato.dataRef && E.iso(extrato.dataRef), '2026-09-14');
  assert.equal(E.iso(fatura.vencFatura), '2026-10-10');
  assert.equal(fatura.cartao, 'Itaú Black');
  assert.ok(extrato.rows.some(r => r.desc === 'PIX TRANSF CAFÉ DO PONTO'), 'mojibake corrigido');

  const res = E.reconcile(state, extrato, fatura, E.DICTS);

  // Conta
  assert.equal(res.cashNew.length, 23);
  assert.equal(res.cashDup, 4);
  assert.deepEqual(res.receipts.map(r => brl(r.valor)).sort(), ['13524.35', '200.00', '320.52'].sort());
  assert.equal(res.excluded.length, 2);
  assert.ok(res.excluded.some(x => E.norm(x.desc).includes('PAGAMENTO DEBITO AUTOMATICO')));
  assert.ok(res.excluded.some(x => E.norm(x.desc).includes('FATURA ITAU') && E.norm(x.desc).includes('MC BLA')));

  // Cartão: série completa de parcelas
  assert.equal(res.cardInstall, 38);
  assert.equal(res.cardDup, 1);          // Amazon 2/5 já estava toda lançada
  assert.equal(res.cardInstallDup, 5);   // 4 Amazon + Odonto 02/04
  const panvel = parcelasDe(res, 'PANVEL');
  assert.deepEqual(panvel.map(p => p.parc + '@' + E.ym(p.venc)), ['01/02@2026-10', '02/02@2026-11']);
  const nick = parcelasDe(res, 'NICK KIDS');
  assert.deepEqual(nick.map(p => E.ym(p.venc)), ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.ok(nick.every(p => p.subgrupo === 'Roupas infantis'));
  const magalu = parcelasDe(res, 'MAGAZINE LUIZA');
  assert.equal(magalu[0].parc, '03/10');   // nunca lança as anteriores
  assert.equal(magalu.length, 8);
  assert.deepEqual(parcelasDe(res, 'ODONTO').map(p => p.parc), ['03/04', '04/04']);
  assert.equal(parcelasDe(res, 'SMART FIT')[0].subgrupo, 'Academia'); // aba Regras

  // Categorização "branco quando incerto" → Pendências
  const cat = d => res.cashNew.find(x => x.desc === d).subgrupo;
  assert.equal(cat('IOF'), 'Tarifas / Encargos');
  assert.equal(cat('TIM CELULAR'), 'Celular');
  assert.equal(cat('PAG BOLETO NET INTERNET'), 'Internet');
  assert.equal(cat('PIX TRANSF MARIA SILVA'), '');
  const ted = res.receipts.find(r => brl(r.valor) === '13524.35');
  assert.equal(ted.destino, '');           // TED dúbio não vira "Salário"
  assert.equal(res.receipts.find(r => brl(r.valor) === '320.52').destino, 'Resgate');
  assert.equal(res.pendentes.filter(p => p.tipo === 'recebimento').length, 2);
  assert.equal(res.pendentes.length, res.cashNew.filter(x => !x.subgrupo).length + res.cardNew.filter(x => !x.subgrupo).length + 2);

  // resolver pendência propaga às parcelas
  const pMl = res.pendentes.find(p => E.norm(p.desc).includes('MERCADO LIVRE'));
  E.resolvePendente(pMl, 'Diversos');
  assert.ok(parcelasDe(res, 'MERCADO LIVRE').every(p => p.subgrupo === 'Diversos'));
  assert.equal(E.isPendente(pMl), false);

  // Conciliação
  assert.equal(brl(extrato.bankFinal), '2984.77');
  const receb = E.r2(res.receipts.reduce((a, r) => a + r.valor, 0));
  const planilha = E.r2(extrato.bankFinal - receb - 1500); // planilha sem recebimentos, com 1.500 de fatura em aberto
  const semReceb = E.conciliarSaldo({ saldoBanco: extrato.bankFinal, saldoFinalPlanilha: planilha, faturasNaoPagas: 1500 });
  assert.equal(semReceb.bate, false);
  assert.equal(brl(semReceb.naoConciliado), brl(receb));
  const ok = E.conciliarSaldo({ saldoBanco: extrato.bankFinal, saldoFinalPlanilha: planilha, faturasNaoPagas: 1500, recebimentosNaoLancados: receb });
  assert.equal(ok.bate, true);

  // Export
  const tsv = E.toTSV(res);
  assert.ok(tsv.includes("'01/02"));
  assert.equal(tsv.split('\n').filter(l => /^\d\d\/\d\d\/\d{4}\t\d\d\/\d\d\/\d{4}\t/.test(l)).length, 38 + 23);
  const wb = XLSX.read(XLSX.write(E.toWorkbook(XLSX, res), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames.slice(0, 2), ['CARTÃO', 'CASH']);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['CARTÃO']).length, 38);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['CASH']).length, 23);

  // Idempotência: mesmos arquivos de novo (estado já contém as chaves geradas)
  const res2 = E.reconcile(state, E.parseExtrato(XLSX, fs.readFileSync(path.join(dir, 'extrato.xls'))), E.parseFatura(XLSX, fs.readFileSync(path.join(dir, 'fatura.xlsx'))), E.DICTS);
  assert.equal(res2.cardInstall, 0);
  assert.equal(res2.cashNew.length, 0);

  // Idempotência via planilha: o export colado na base vira histórico → 0 novos
  const exported = XLSX.read(XLSX.write(E.toWorkbook(XLSX, res), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
  const merged = stateFrom(base);
  XLSX.utils.sheet_to_json(exported.Sheets['CARTÃO'], { header: 1, raw: true }).slice(1)
    .forEach(r => merged.cartaoKeys.add(E.k2(r[8]) + '|' + E.parcCell(r[5]) + '|' + E.ym(E.toDate(r[3]))));
  XLSX.utils.sheet_to_json(exported.Sheets['CASH'], { header: 1, raw: true }).slice(1)
    .forEach(r => merged.cashKeys.add(E.iso(E.toDate(r[2])) + '|' + E.k2(Math.abs(r[6]))));
  const res3 = E.reconcile(merged, extrato, fatura, E.DICTS);
  assert.equal(res3.cardInstall, 0);
  assert.equal(res3.cashNew.length, 0);
});

// ---------- aceitação com os arquivos reais (se presentes) ----------
const REAL = path.join(__dirname, 'fixtures', 'real');
const pick = (...names) => names.map(n => path.join(REAL, n)).find(f => fs.existsSync(f));
const real = { base: pick('base.xlsx'), extrato: pick('extrato.xls', 'extrato.xlsx'), fatura: pick('fatura.xlsx') };
test('aceitação — arquivos reais (test/fixtures/real)', { skip: !(real.base && real.extrato && real.fatura) && 'arquivos reais ausentes' }, () => {
  const { base, extrato, fatura } = load(real);
  const state = stateFrom(base);
  const res = E.reconcile(state, extrato, fatura, E.DICTS);
  console.log(`  real: conta ${res.cashNew.length} novos/${res.cashDup} dup, receb ${res.receipts.length}, excl ${res.excluded.length}, parcelas ${res.cardInstall} novas/${res.cardInstallDup} dup, banco ${brl(extrato.bankFinal)}`);
  assert.equal(res.cashNew.length, 23);
  assert.equal(res.cashDup, 4);
  assert.deepEqual(res.receipts.map(r => brl(r.valor)).sort(), ['13524.35', '200.00', '320.52'].sort());
  assert.equal(res.excluded.length, 2);
  assert.ok(Math.abs(res.cardInstall - 38) <= 2, `~38 parcelas novas (obtido ${res.cardInstall})`);
  assert.deepEqual(parcelasDe(res, 'PANVEL').filter(p => p.parc.endsWith('/02')).map(p => E.ym(p.venc)), ['2026-10', '2026-11']);
  assert.deepEqual(parcelasDe(res, 'NICK KIDS').map(p => E.ym(p.venc)), ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.equal(brl(extrato.bankFinal), '2984.77');
  const res2 = E.reconcile(state, extrato, fatura, E.DICTS);
  assert.equal(res2.cardInstall, 0);
  assert.equal(res2.cashNew.length, 0);
});
