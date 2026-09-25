/* Conciliador CAIXA 2026 — engine (browser + Node).
 * Núcleo = implementação de referência do brief (seção 7), sem alterações de regra.
 * Parsers recebem o objeto XLSX (SheetJS) por parâmetro para funcionar nos dois ambientes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- utils ----------
  const norm = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const k2 = n => r2(n).toFixed(2); // chave estável "24.00"
  const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const iso = d => ym(d) + '-' + String(d.getDate()).padStart(2, '0');
  const addMonths = (d, k) => { let y = d.getFullYear(), m = d.getMonth() + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; const day = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()); return new Date(y, m, day); };
  const fmtParc = (c, n) => String(c).padStart(2, '0') + '/' + String(n).padStart(2, '0');
  function normParc(raw) { if (raw == null || String(raw).trim() === '') return { c: 1, n: 1, s: '01/01' }; let m = String(raw).toLowerCase().match(/(\d+)\s*de\s*(\d+)/); if (m) return { c: +m[1], n: +m[2], s: fmtParc(+m[1], +m[2]) }; m = String(raw).match(/(\d+)\s*\/\s*(\d+)/); if (m) return { c: +m[1], n: +m[2], s: fmtParc(+m[1], +m[2]) }; return { c: 1, n: 1, s: '01/01' }; }
  const fmtBR = d => d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() : '';

  // ---------- dicionários (seção 5) — ordem = prioridade ----------
  const pairs = list => list.flatMap(([kws, sub]) => kws.map(k => [k, sub]));
  const CARD_RULES = pairs([
    [['PANVEL', 'DROGA', 'FARMAC'], 'Medicamentos'],
    [['ZAFFARI', 'ANDREAZZ', 'SUPERMERCAD', 'TIMY ALIMENTOS', 'COMERCIO DE ALIMEN', 'ATACAD'], 'Mercado / Limpeza'],
    [['RESTAURANTE', 'LANCHONETE', 'BURGER', 'IFOOD'], 'Lanches / Delivery'],
    [['INST EDUC'], 'Escola'],
    [['HOTELARIA', 'HOTEL'], 'Passeios'],
    [['NICK KIDS'], 'Roupas infantis'],
    [['RENNER', 'RIACHUELO', 'CEA MODAS', 'SHEIN', 'MODA', 'CALCADO', 'MALHAS'], 'Roupas'],
    [['POSTO', 'SHELL', 'IPIRANGA'], 'Combustível'],
    [['CINEMA'], 'Cinema / Teatro'],
    [['VETERIN'], 'Veterinário / Vacinas'],
    [['PETSHOP'], 'Ração / Alimentação'],
    [['ODONTO', 'DENTIST'], 'Odontologia'],
    [['AZUL SEGUROS', 'SEGURO'], 'Seguro'],
    [['MECANICA'], 'Mecânica / Manutenção'],
    [['INGRESSO'], 'Eventos / Shows'],
  ]);
  const CASH_RULES = pairs([
    [['IOF', 'TARIFA', 'ANUIDADE'], 'Tarifas / Encargos'],
    [['CLARO', 'VIVO', 'TIM '], 'Celular'],
    [['RGE', 'CEEE'], 'Energia elétrica'],
    [['SERRA DIESE', 'POSTO'], 'Combustível'],
    [['IMOVEIS', 'IMOBILIARIA', 'TOMASI'], 'Aluguel'],
    [['IGREJA', 'OBRA MISSION', 'DIZIMO'], 'Presentes / Doações'],
    [['INTERNET', 'FIBRA'], 'Internet'],
  ]);
  const INCOME_RULES = pairs([
    [['SALARIO', 'PROVENTOS', 'FOLHA PAGAMENTO', 'REMUNERACAO'], 'Salário'],
    [['DECIMO TERCEIRO'], '13º Salário'],
    [['RESGATE', 'APLICACAO'], 'Resgate'],
    [['RENDIMENTO'], 'Rendimento'],
    [['V4'], 'V4 Company'],
    [['SERVICO CONTABIL', 'CONTABIL'], 'Serviço Contábil'],
  ]);
  const INCOME_DESTINOS = ['Salário', '13º Salário', 'Serviço Contábil', 'V4 Company', 'Resgate', 'Rendimento', 'Outras entradas'];
  const DICTS = { CARD_RULES, CASH_RULES, INCOME_RULES };

  // ---------- categorização ----------
  function categorize(desc, builtin, userRules, apoioSet) {
    const d = norm(desc);
    for (const r of (userRules || [])) { const kw = norm(r.contains); if (kw && d.includes(kw) && (!apoioSet || apoioSet.has(r.subgrupo))) return r.subgrupo; }
    for (const [kw, sub] of builtin) { if (d.includes(kw) && (!apoioSet || apoioSet.has(sub))) return sub; }
    return '';
  }

  // ---------- reconcile ----------
  // state:{cartaoKeys:Set, cashKeys:Set, apoioSet:Set, rules:[{contains,subgrupo}]}
  // extrato:{rows:[{date:Date,desc,valor(signed)}], saldoAnterior, bankFinal, dataRef}
  // fatura:{rows:[{data:Date,desc,parcRaw,valor(pos)}], vencFatura:Date, cartao}
  function reconcile(state, extrato, fatura, dicts) {
    const { CARD_RULES, CASH_RULES, INCOME_RULES } = dicts || DICTS;
    const res = { cardNew: [], cardDup: 0, cardInstall: 0, cardInstallDup: 0, cashNew: [], cashDup: 0, excluded: [], receipts: [], pendentes: [] };
    const cartaoKeys = state.cartaoKeys, cashKeys = state.cashKeys, apoioSet = state.apoioSet, rules = state.rules || [];
    const isPagFatAnterior = (desc, v) => norm(desc).includes('PAGAMENTO DEBITO AUTOMATICO') || Number(v) < 0;
    const isFatNoExtrato = desc => { const d = norm(desc); return d.includes('FATURA') && ['MC BLA', 'UNICLASS', 'MASTER', 'CARTAO', 'VISA'].some(x => d.includes(x)); };

    for (const row of (fatura?.rows || [])) {
      if (isPagFatAnterior(row.desc, row.valor)) { res.excluded.push({ tipo: 'cartão', ...row, motivo: 'pagamento fatura anterior' }); continue; }
      const p = normParc(row.parcRaw), sub = categorize(row.desc, CARD_RULES, rules, apoioSet);
      const purchase = { data: row.data, desc: row.desc, parc: p.s, valor: r2(row.valor), cartao: fatura.cartao || 'Itaú Black', subgrupo: sub, parcelas: [] };
      for (let k = p.c; k <= p.n; k++) {
        const vk = addMonths(fatura.vencFatura, k - p.c), pk = fmtParc(k, p.n), key = k2(row.valor) + '|' + pk + '|' + ym(vk);
        if (cartaoKeys.has(key)) { res.cardInstallDup++; continue; }
        cartaoKeys.add(key);
        purchase.parcelas.push({ venc: vk, parc: pk, valor: r2(row.valor), desc: row.desc, cartao: purchase.cartao, subgrupo: sub });
        res.cardInstall++;
      }
      if (purchase.parcelas.length) res.cardNew.push(purchase); else res.cardDup++;
    }
    for (const row of (extrato?.rows || [])) {
      const d = norm(row.desc); if (d.includes('SALDO') || row.valor == null) continue;
      if (isFatNoExtrato(row.desc)) { res.excluded.push({ tipo: 'conta', ...row, motivo: 'pagamento da fatura do cartão (evita duplicar)' }); continue; }
      if (Number(row.valor) < 0) {
        const val = r2(Math.abs(row.valor)), key = iso(row.date) + '|' + k2(val);
        if (cashKeys.has(key)) { res.cashDup++; continue; }
        cashKeys.add(key);
        res.cashNew.push({ date: row.date, desc: row.desc, valor: val, subgrupo: categorize(row.desc, CASH_RULES, rules, apoioSet) });
      } else {
        let dest = ''; const dd = norm(row.desc);
        for (const [kw, x] of INCOME_RULES) { if (dd.includes(kw)) { dest = x; break; } }
        res.receipts.push({ date: row.date, desc: row.desc, valor: r2(row.valor), destino: dest });
      }
    }
    res.cashNew.forEach(x => { if (!x.subgrupo) res.pendentes.push({ origem: 'Conta', ref: x, ...x, tipo: 'despesa' }); });
    res.cardNew.forEach(p => { if (!p.subgrupo) res.pendentes.push({ origem: 'Cartão', ref: p, ...p, tipo: 'despesa' }); });
    res.receipts.forEach(r => { if (!r.destino) res.pendentes.push({ origem: 'Conta', ref: r, ...r, tipo: 'recebimento' }); });
    return res;
  }

  function conciliarSaldo(o) {
    const A = r2(o.saldoBanco), B = r2(o.saldoFinalPlanilha), dif = r2(A - B);
    const exp = r2((o.recebimentosNaoLancados || 0) + (o.faturasNaoPagas || 0) + (o.difSaldoInicial || 0) + (o.outrosAjustes || 0));
    return { diferencaApurar: dif, totalExplicado: exp, naoConciliado: r2(dif - exp), bate: Math.abs(r2(dif - exp)) < 0.5 };
  }

  // Classifica uma pendência: grava no objeto original (compra do cartão propaga às parcelas).
  function resolvePendente(p, valor) {
    if (p.tipo === 'recebimento') { p.ref.destino = valor; return; }
    p.ref.subgrupo = valor;
    if (p.ref.parcelas) p.ref.parcelas.forEach(x => { x.subgrupo = valor; });
  }
  const isPendente = p => p.tipo === 'recebimento' ? !p.ref.destino : !p.ref.subgrupo;

  // ---------- parsing helpers ----------
  // Itaú .xls: texto UTF-8 lido como latin1 ("CAFÃ‰" → "CAFÉ"). Refaz os bytes e decodifica em UTF-8.
  function fixMojibake(s) {
    if (typeof s !== 'string' || !/[Â-ô][\u0080-ÿ]/.test(s)) return s;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return s;
    try {
      const bytes = Uint8Array.from(s, c => c.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) { return s; }
  }
  const excelEpoch = Date.UTC(1899, 11, 30);
  function toDate(v, refYear) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      // SheetJS devolve meia-noite local deslocada em alguns fusos; arredonda para o dia mais próximo.
      const t = new Date(v.getTime() + 12 * 3600 * 1000);
      return v.getHours() >= 12 ? new Date(t.getFullYear(), t.getMonth(), t.getDate()) : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === 'number') {
      if (v < 20000 || v > 80000) return null;
      const d = new Date(excelEpoch + Math.round(v) * 86400000);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); return d.getMonth() === +m[2] - 1 ? d : null; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m && refYear) return new Date(refYear, +m[2] - 1, +m[1]);
    return null;
  }
  function toNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/R\$\s*/i, '').replace(/\s/g, '');
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (!isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }
  // Coluna "Parcela" da planilha: texto "05/09", mas o Sheets às vezes converte para data (5 de setembro).
  function parcCell(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date || typeof v === 'number') {
      const d = toDate(v); if (!d) return String(v);
      return fmtParc(d.getDate(), d.getMonth() + 1);
    }
    return normParc(v).s;
  }
  const sheetRows = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, cellDates: true, defval: null });
  const findSheet = (wb, ...names) => {
    for (const n of names) { const hit = wb.SheetNames.find(s => norm(s) === norm(n)); if (hit) return wb.Sheets[hit]; }
    for (const n of names) { const hit = wb.SheetNames.find(s => norm(s).includes(norm(n))); if (hit) return wb.Sheets[hit]; }
    return null;
  };
  const readWb = (XLSX, buf) => XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });

  // ---------- planilha-base ----------
  function parseBase(XLSX, buf) {
    const wb = readWb(XLSX, buf);
    const cash = findSheet(wb, 'CASH'), cartao = findSheet(wb, 'CARTÃO', 'CARTAO'), apoio = findSheet(wb, 'Apoio'), regras = findSheet(wb, 'Regras');
    if (!cash && !cartao) throw new Error('Planilha-base sem abas CASH/CARTÃO.');
    const cashKeys = [], cartaoKeys = [];
    let nCash = 0, nCartao = 0;
    if (cash) sheetRows(XLSX, cash).slice(1).forEach(r => {
      const d = toDate(r[2]), v = toNum(r[6]);
      if (!d || v == null) return;
      nCash++; cashKeys.push(iso(d) + '|' + k2(Math.abs(v)));
    });
    if (cartao) sheetRows(XLSX, cartao).slice(1).forEach(r => {
      const venc = toDate(r[3]), v = toNum(r[8]), p = parcCell(r[5]) || '01/01';
      if (!venc || v == null) return;
      nCartao++; cartaoKeys.push(k2(v) + '|' + p + '|' + ym(venc));
    });
    const apoioList = [], cartoes = [];
    if (apoio) sheetRows(XLSX, apoio).slice(1).forEach(r => {
      const sub = r[1] == null ? '' : String(r[1]).trim();
      if (sub) apoioList.push({ categoria: r[0] == null ? '' : String(r[0]).trim(), subgrupo: sub });
      const c = r[3] == null ? '' : String(r[3]).trim();
      if (c && !/^cart/i.test(c)) cartoes.push(c);
    });
    const rules = [];
    if (regras) sheetRows(XLSX, regras).slice(3).forEach(r => {
      const c = r[0] == null ? '' : String(r[0]).trim(), s = r[1] == null ? '' : String(r[1]).trim();
      if (c && s) rules.push({ contains: c, subgrupo: s });
    });
    return { cashKeys, cartaoKeys, apoio: apoioList, cartoes, rules, counts: { cash: nCash, cartao: nCartao } };
  }

  // ---------- extrato Itaú ----------
  function parseExtrato(XLSX, buf) {
    const wb = readWb(XLSX, buf);
    const ws = findSheet(wb, 'Lançamentos', 'Lancamentos') || wb.Sheets[wb.SheetNames[0]];
    const rows = sheetRows(XLSX, ws);
    let cData = 0, cDesc = 1, cVal = 3, cSaldo = 4;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = rows[i].map(x => norm(fixMojibake(x)));
      const iD = h.findIndex(x => x === 'DATA'), iL = h.findIndex(x => x.startsWith('LANCAMENTO')), iV = h.findIndex(x => x.startsWith('VALOR'));
      if (iD >= 0 && iL >= 0 && iV >= 0) { cData = iD; cDesc = iL; cVal = iV; const iS = h.findIndex(x => x.startsWith('SALDO')); if (iS >= 0) cSaldo = iS; break; }
    }
    const out = [];
    let saldoAnterior = null, dataIni = null, dataRef = null;
    for (const r of rows) {
      const date = toDate(r[cData]);
      const desc = fixMojibake(r[cDesc] == null ? '' : String(r[cDesc]).trim());
      if (!date || !desc) continue;
      const nd = norm(desc);
      if (nd.includes('SALDO ANTERIOR')) { saldoAnterior = toNum(r[cSaldo]) ?? toNum(r[cVal]); dataIni = date; continue; }
      if (nd.includes('SALDO')) continue;
      const valor = toNum(r[cVal]);
      if (valor == null) continue;
      out.push({ date, desc, valor: r2(valor) });
      if (!dataRef || date > dataRef) dataRef = date;
    }
    const soma = out.reduce((a, x) => a + x.valor, 0);
    return { rows: out, saldoAnterior: r2(saldoAnterior || 0), temSaldoAnterior: saldoAnterior != null, bankFinal: r2((saldoAnterior || 0) + soma), dataIni, dataRef };
  }

  // ---------- fatura Itaú ----------
  function parseFatura(XLSX, buf, cartaoPadrao) {
    const wb = readWb(XLSX, buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = sheetRows(XLSX, ws);
    let venc = null, hdr = -1;
    for (let i = 0; i < rows.length && hdr < 0; i++) {
      const r = rows[i], h = r.map(x => norm(fixMojibake(x)));
      if (!venc) {
        const j = h.findIndex(x => x.includes('VENCIMENTO'));
        if (j >= 0) {
          const inCell = String(r[j]).match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
          if (inCell) venc = toDate(inCell[1]);
          for (let k = j + 1; !venc && k < r.length; k++) venc = toDate(r[k]);
          if (!venc && rows[i + 1]) venc = toDate(rows[i + 1][j]);
        }
      }
      if (h.includes('DATA') && h.some(x => x.startsWith('LANCAMENTO')) && h.some(x => x.startsWith('VALOR'))) hdr = i;
    }
    if (hdr < 0) throw new Error('Fatura: cabeçalho Data/Lançamento/Valor não encontrado.');
    if (!venc) {
      const m = wb.SheetNames[0].match(/(\d{1,2})\D(\d{2,4})/);
      if (m) { let y = +m[2]; if (y < 100) y += 2000; venc = new Date(y, +m[1] - 1, 10); }
    }
    if (!venc) throw new Error('Fatura: data de vencimento não encontrada.');
    const h = rows[hdr].map(x => norm(fixMojibake(x)));
    const col = pred => h.findIndex(pred);
    const cD = col(x => x === 'DATA'), cL = col(x => x.startsWith('LANCAMENTO')), cP = col(x => x.startsWith('PARCELA')), cV = col(x => x.startsWith('VALOR'));
    const out = [];
    for (const r of rows.slice(hdr + 1)) {
      const desc = fixMojibake(r[cL] == null ? '' : String(r[cL]).trim()), valor = toNum(r[cV]);
      if (!desc || valor == null) continue;
      let data = toDate(r[cD], venc.getFullYear());
      if (data && data > venc && !(r[cD] instanceof Date) && /^\d{1,2}\/\d{1,2}$/.test(String(r[cD]).trim())) data = new Date(data.getFullYear() - 1, data.getMonth(), data.getDate());
      out.push({ data, desc, parcRaw: cP >= 0 ? r[cP] : null, valor: r2(valor) });
    }
    return { rows: out, vencFatura: venc, cartao: cartaoPadrao || 'Itaú Black', nome: wb.SheetNames[0] };
  }

  // ---------- export ----------
  const brNum = v => r2(v).toFixed(2).replace('.', ',');
  function cartaoLinhas(res) {
    const out = [];
    res.cardNew.forEach(p => p.parcelas.forEach(x => out.push({ data: p.data || x.venc, venc: x.venc, desc: x.desc, parc: x.parc, cartao: x.cartao, subgrupo: x.subgrupo || '', valor: x.valor })));
    return out;
  }
  // TSV a partir da coluna C (A/B são fórmulas na planilha e continuam sendo calculadas).
  function toTSV(res) {
    const esc = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ');
    const L = ['CARTÃO — cole na coluna C (DATA COMPRA … VALOR)', ['DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'Parcela', 'CARTÃO', 'SUBGRUPO', 'VALOR'].join('\t')];
    cartaoLinhas(res).forEach(x => L.push([fmtBR(x.data), fmtBR(x.venc), esc(x.desc), "'" + x.parc, esc(x.cartao), esc(x.subgrupo), brNum(x.valor)].join('\t')));
    L.push('', 'CASH — cole na coluna C (DATA COMPRA … VALOR)', ['DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR'].join('\t'));
    res.cashNew.forEach(x => L.push([fmtBR(x.date), fmtBR(x.date), esc(x.desc), esc(x.subgrupo), brNum(x.valor)].join('\t')));
    if (res.receipts.length) {
      L.push('', 'RECEBIMENTOS — lançar no topo do CAIXA MENSAL', ['DATA', 'DESCRIÇÃO', 'DESTINO', 'VALOR'].join('\t'));
      res.receipts.forEach(x => L.push([fmtBR(x.date), esc(x.desc), esc(x.destino), brNum(x.valor)].join('\t')));
    }
    return L.join('\n');
  }
  function toWorkbook(XLSX, res) {
    const wb = XLSX.utils.book_new();
    const monthF = c => ({ t: 'n', f: `DATE(YEAR(${c}),MONTH(${c}),1)`, z: 'mm/yyyy' });
    const d = x => ({ t: 'd', v: new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())), z: 'dd/mm/yyyy' });
    const car = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'Parcela', 'CARTÃO', 'SUBGRUPO', 'VALOR']];
    cartaoLinhas(res).forEach((x, i) => { const n = i + 2; car.push([monthF('C' + n), monthF('D' + n), d(x.data), d(x.venc), x.desc, x.parc, x.cartao, x.subgrupo, x.valor]); });
    const cash = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR']];
    res.cashNew.forEach((x, i) => { const n = i + 2; cash.push([monthF('C' + n), monthF('D' + n), d(x.date), d(x.date), x.desc, x.subgrupo, x.valor]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(car), 'CARTÃO');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cash), 'CASH');
    if (res.receipts.length) {
      const rec = [['DATA', 'DESCRIÇÃO', 'DESTINO', 'VALOR']];
      res.receipts.forEach(x => rec.push([d(x.date), x.desc, x.destino, x.valor]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rec), 'RECEBIMENTOS');
    }
    return wb;
  }

  return {
    norm, r2, k2, ym, iso, addMonths, fmtParc, normParc, fmtBR,
    CARD_RULES, CASH_RULES, INCOME_RULES, INCOME_DESTINOS, DICTS,
    categorize, reconcile, conciliarSaldo, resolvePendente, isPendente,
    fixMojibake, toDate, toNum, parcCell, parseBase, parseExtrato, parseFatura,
    cartaoLinhas, toTSV, toWorkbook,
  };
});
