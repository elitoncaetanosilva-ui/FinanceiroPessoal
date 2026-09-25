/* Conciliador CAIXA 2026 — UI. Depende de window.XLSX (SheetJS) e window.Engine. */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = s => document.querySelector(s);
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = v => BRL.format(v || 0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mesAno = d => d ? d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/') : '';

  // ---------- storage (localStorage pode falhar: janela privada, bloqueio) ----------
  const K = { base: 'cc26.base', memo: 'cc26.memo', learned: 'cc26.learned', last: 'cc26.last', conc: 'cc26.conc', theme: 'cc26.theme' };
  const DATE_FIELDS = new Set(['date', 'data', 'venc', 'vencFatura', 'dataRef', 'dataIni']);
  const load = k => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s, (key, v) => DATE_FIELDS.has(key) && typeof v === 'string' ? new Date(v) : v) : null; } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Não foi possível salvar no navegador (armazenamento bloqueado ou cheio).'); return false; } };
  const drop = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  const S = {
    base: load(K.base),                                   // histórico da planilha-base
    memo: load(K.memo) || { cartaoKeys: [], cashKeys: [], lastRun: null }, // chaves geradas em conciliações anteriores
    learned: load(K.learned) || { despesa: [], receita: [] },
    extrato: null, fatura: null,
    last: load(K.last),                                   // {res, extrato:{...}, fatura:{...}}
    conc: load(K.conc) || {},
  };

  // ---------- tema ----------
  const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(load(K.theme));
  $('#theme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next); save(K.theme, next);
  };

  // ---------- abas ----------
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function showTab(name) {
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
    window.scrollTo(0, 0);
  }
  tabs.forEach(b => b.onclick = () => showTab(b.dataset.tab));

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  // ---------- arquivos ----------
  function setDrop(kind, text, state) {
    const el = $('#drop-' + kind), st = el.querySelector('.st');
    st.innerHTML = text || ''; st.classList.toggle('err', state === 'err');
    el.classList.toggle('done', state === 'ok');
  }
  async function readFile(kind, file) {
    if (!window.XLSX) { setDrop(kind, 'SheetJS não carregou (sem internet?). Recarregue a página.', 'err'); return; }
    try {
      const buf = await file.arrayBuffer();
      if (kind === 'base') {
        const b = E.parseBase(XLSX, buf);
        S.base = { ...b, name: file.name, loadedAt: new Date().toISOString() };
        save(K.base, S.base);
      } else if (kind === 'extrato') {
        const x = E.parseExtrato(XLSX, buf);
        if (!x.rows.length) throw new Error('nenhum movimento encontrado');
        S.extrato = { ...x, name: file.name };
      } else {
        S.fatura = { ...E.parseFatura(XLSX, buf, cartaoPadrao()), name: file.name };
      }
      renderImport();
    } catch (e) {
      console.error(e);
      setDrop(kind, 'Não consegui ler: ' + esc(e.message || e), 'err');
    }
  }
  const cartaoPadrao = () => (S.base?.cartoes || []).find(c => /ita/i.test(c)) || 'Itaú Black';

  document.querySelectorAll('.drop').forEach(el => {
    const input = el.querySelector('input'), kind = input.dataset.kind;
    input.onchange = () => { if (input.files[0]) readFile(kind, input.files[0]); input.value = ''; };
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(kind, f); });
  });

  function renderImport() {
    if (S.base) {
      const n = S.base.counts.cash + S.base.counts.cartao;
      setDrop('base', `✓ histórico: ${n.toLocaleString('pt-BR')} lançamentos <span class="tag">${S.base.counts.cartao} cartão · ${S.base.counts.cash} conta · ${S.base.apoio.length} subgrupos${S.base.rules.length ? ' · ' + S.base.rules.length + ' regras' : ''}</span>`, 'ok');
    } else setDrop('base', '');
    if (S.extrato) {
      const x = S.extrato;
      setDrop('extrato', `✓ ${x.rows.length} movimentos · ${E.fmtBR(x.dataIni || x.rows[0].date)} a ${E.fmtBR(x.dataRef)}<br>saldo ${money(x.bankFinal)}${x.temSaldoAnterior ? '' : ' <span class="tag">sem SALDO ANTERIOR</span>'}`, 'ok');
    } else setDrop('extrato', '');
    if (S.fatura) {
      const f = S.fatura, compras = f.rows.filter(r => r.valor > 0);
      setDrop('fatura', `✓ vence ${E.fmtBR(f.vencFatura)} · ${compras.length} compras · ${money(compras.reduce((a, r) => a + r.valor, 0))}`, 'ok');
    } else setDrop('fatura', '');
    const ready = !!S.base && !!(S.extrato || S.fatura);
    $('#btn-conciliar').disabled = !ready;
    $('#conciliar-hint').textContent = ready ? 'Pronto. O que já está na planilha (ou em conciliações já exportadas) é ignorado.' : 'Carregue a planilha-base e ao menos um arquivo (extrato ou fatura).';
    const nMemo = S.memo.cartaoKeys.length + S.memo.cashKeys.length;
    $('#mem').textContent = nMemo ? `Memória: ${nMemo} lançamentos de conciliações anteriores` : '';
  }

  // ---------- conciliar ----------
  function dicts() {
    const learnedInc = (S.learned.receita || []).map(r => [E.norm(r.contains), r.destino]);
    return { ...E.DICTS, INCOME_RULES: [...learnedInc, ...E.INCOME_RULES] };
  }
  // Uma conciliação só vira memória definitiva quando é exportada (copiar/baixar).
  // Antes disso, conciliar de novo substitui a rodada anterior em vez de somar a ela.
  function dropLastRunKeys() {
    const lr = S.memo.lastRun; if (!lr) return;
    const c = new Set(lr.cartaoKeys), k = new Set(lr.cashKeys);
    S.memo = { cartaoKeys: S.memo.cartaoKeys.filter(x => !c.has(x)), cashKeys: S.memo.cashKeys.filter(x => !k.has(x)), lastRun: null };
  }
  function markExported() {
    if (S.memo.lastRun && !S.memo.lastRun.exported) { S.memo.lastRun.exported = true; save(K.memo, S.memo); }
  }
  $('#btn-conciliar').onclick = () => {
    if (S.memo.lastRun && !S.memo.lastRun.exported) dropLastRunKeys();
    const before = { c: new Set([...S.base.cartaoKeys, ...S.memo.cartaoKeys]), k: new Set([...S.base.cashKeys, ...S.memo.cashKeys]) };
    const state = {
      cartaoKeys: new Set(before.c), cashKeys: new Set(before.k),
      apoioSet: new Set(S.base.apoio.map(a => a.subgrupo)),
      rules: [...S.base.rules, ...(S.learned.despesa || [])],
    };
    if (S.fatura) S.fatura.cartao = cartaoPadrao();
    const res = E.reconcile(state, S.extrato, S.fatura, dicts());
    delete res.pendentes; // a fila é derivada ao vivo (itens sem categoria)
    const addC = [...state.cartaoKeys].filter(k => !before.c.has(k)), addK = [...state.cashKeys].filter(k => !before.k.has(k));
    S.memo = { cartaoKeys: [...S.memo.cartaoKeys, ...addC], cashKeys: [...S.memo.cashKeys, ...addK], lastRun: { cartaoKeys: addC, cashKeys: addK } };
    save(K.memo, S.memo);
    const ex = S.extrato, fa = S.fatura;
    S.last = {
      res, at: new Date().toISOString(),
      extrato: ex ? { bankFinal: ex.bankFinal, dataRef: ex.dataRef, dataIni: ex.dataIni, saldoAnterior: ex.saldoAnterior, name: ex.name } : null,
      fatura: fa ? { vencFatura: fa.vencFatura, total: E.r2(fa.rows.filter(r => r.valor > 0).reduce((a, r) => a + r.valor, 0)), name: fa.name } : null,
    };
    // valores sugeridos do painel passam a refletir esta conciliação
    delete S.conc.banco; delete S.conc.rec; delete S.conc.fat;
    save(K.conc, S.conc);
    persistLast();
    renderAll();
    const nPend = pendentes().length;
    toast(res.cardInstall + res.cashNew.length ? `${res.cardInstall} parcelas e ${res.cashNew.length} lançamentos novos${nPend ? ` · ${nPend} pendências` : ''}` : 'Nada novo: tudo já está na planilha ou já foi exportado.');
  };
  const persistLast = () => { if (S.last) save(K.last, S.last); };

  $('#btn-desfazer').onclick = () => {
    const lr = S.memo.lastRun;
    if (!lr || !confirm('Desfazer esta conciliação? As chaves geradas saem da memória e uma nova conciliação volta a gerar esses lançamentos.')) return;
    dropLastRunKeys();
    save(K.memo, S.memo);
    S.last = null; drop(K.last);
    renderAll(); toast('Conciliação desfeita.');
  };

  // ---------- pendências ----------
  function pendentes() {
    const r = S.last?.res; if (!r) return [];
    return [
      ...r.cashNew.filter(x => !x.subgrupo).map(x => ({ origem: 'Conta', tipo: 'despesa', ref: x, date: x.date, desc: x.desc, valor: x.valor })),
      ...r.cardNew.filter(x => !x.subgrupo).map(x => ({ origem: 'Cartão', tipo: 'despesa', ref: x, date: x.data, desc: x.desc, valor: x.valor, parc: x.parc, n: x.parcelas.length })),
      ...r.receipts.filter(x => !x.destino).map(x => ({ origem: 'Conta', tipo: 'recebimento', ref: x, date: x.date, desc: x.desc, valor: x.valor })),
    ];
  }
  function optionsDespesa() {
    const groups = new Map();
    (S.base?.apoio || []).forEach(a => { const g = a.categoria || 'Outros'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a.subgrupo); });
    return [...groups].map(([g, subs]) => `<optgroup label="${esc(g)}">${subs.map(s => `<option>${esc(s)}</option>`).join('')}</optgroup>`).join('');
  }
  const optionsReceita = () => E.INCOME_DESTINOS.map(s => `<option>${esc(s)}</option>`).join('');

  function renderPendencias() {
    const list = pendentes();
    const el = $('#list-pend');
    $('#pend-h').textContent = list.length ? `${list.length} a classificar` : 'Pendências';
    if (!S.last) { el.innerHTML = '<div class="empty">Concilie os arquivos para ver o que precisa de categoria.</div>'; return; }
    if (!list.length) { el.innerHTML = '<div class="empty">Tudo classificado ✓</div>'; return; }
    const od = optionsDespesa(), orc = optionsReceita();
    el.innerHTML = list.map((p, i) => `
      <div class="row">
        <div class="d">${esc(p.desc)}</div>
        <div class="v">${p.tipo === 'recebimento' ? '+' : ''}${money(p.valor)}</div>
        <div class="m c"><span>${E.fmtBR(p.date)}</span><span class="tag">${p.origem}</span>${p.tipo === 'recebimento' ? '<span class="chip inc">recebimento</span>' : ''}${p.parc ? `<span class="tag">parc. ${p.parc}${p.n > 1 ? ` · ${p.n} lançamentos` : ''}</span>` : ''}</div>
        <div class="c"><select class="cat" data-i="${i}" aria-label="Categoria para ${esc(p.desc)}"><option value="">${p.tipo === 'recebimento' ? 'Escolha o destino…' : 'Escolha o subgrupo…'}</option>${p.tipo === 'recebimento' ? orc : od}</select></div>
      </div>`).join('');
    el.querySelectorAll('select.cat').forEach(sel => sel.onchange = () => {
      const p = list[+sel.dataset.i]; if (!sel.value) return;
      E.resolvePendente(p, sel.value);
      if ($('#lembrar').checked) learn(p, sel.value);
      persistLast(); renderAll();
    });
  }
  function learn(p, valor) {
    const contains = E.norm(p.desc);
    if (!contains) return;
    const key = p.tipo === 'recebimento' ? 'receita' : 'despesa';
    const arr = (S.learned[key] || []).filter(r => E.norm(r.contains) !== contains);
    arr.push(p.tipo === 'recebimento' ? { contains, destino: valor } : { contains, subgrupo: valor });
    S.learned[key] = arr; save(K.learned, S.learned);
  }
  function unresolve(kind, i) {
    const r = S.last.res;
    const o = kind === 'card' ? r.cardNew[i] : kind === 'cash' ? r.cashNew[i] : r.receipts[i];
    E.resolvePendente({ tipo: kind === 'rec' ? 'recebimento' : 'despesa', ref: o }, '');
    persistLast(); renderAll(); toast('Voltou para Pendências.');
  }

  // ---------- lançamentos ----------
  const chip = (v, kind, i, inc) => v
    ? `<button class="chip${inc ? ' inc' : ''}" data-un="${kind}:${i}" title="Devolver às Pendências">${esc(v)}</button>`
    : '<span class="chip blank">em branco</span>';
  function renderLancamentos() {
    const r = S.last?.res;
    const none = msg => `<div class="empty">${msg}</div>`;
    if (!r) { ['#list-cartao', '#list-cash', '#list-rec'].forEach(s => { $(s).innerHTML = none('Nada conciliado ainda.'); }); return; }
    $('#list-cartao').innerHTML = r.cardNew.length ? r.cardNew.map((p, i) => {
      const first = p.parcelas[0], last = p.parcelas[p.parcelas.length - 1];
      return `<div class="row">
        <div class="d">${esc(p.desc)}</div>
        <div class="v">${money(p.valor)}${p.parcelas.length > 1 ? `<div class="m" style="justify-content:flex-end">× ${p.parcelas.length} = ${money(p.valor * p.parcelas.length)}</div>` : ''}</div>
        <div class="m c"><span>compra ${E.fmtBR(p.data)}</span><span>venc ${E.fmtBR(first.venc)}${p.parcelas.length > 1 ? ' → ' + E.fmtBR(last.venc) : ''}</span>${chip(p.subgrupo, 'card', i)}</div>
        <div class="series c">${p.parcelas.map(x => `<span title="vence ${E.fmtBR(x.venc)}">${x.parc} · ${mesAno(x.venc)}</span>`).join('')}</div>
      </div>`;
    }).join('') : none(S.last.fatura ? 'Nenhuma parcela nova: a fatura já está toda na planilha.' : 'Sem fatura nesta conciliação.');
    $('#list-cash').innerHTML = r.cashNew.length ? r.cashNew.map((x, i) => `<div class="row">
        <div class="d">${esc(x.desc)}</div><div class="v">${money(x.valor)}</div>
        <div class="m c"><span>${E.fmtBR(x.date)}</span>${chip(x.subgrupo, 'cash', i)}</div></div>`).join('')
      : none(S.last.extrato ? 'Nenhum lançamento novo: o extrato já está na planilha.' : 'Sem extrato nesta conciliação.');
    $('#list-rec').innerHTML = r.receipts.length ? r.receipts.map((x, i) => `<div class="row">
        <div class="d">${esc(x.desc)}</div><div class="v" style="color:var(--ok)">+${money(x.valor)}</div>
        <div class="m c"><span>${E.fmtBR(x.date)}</span>${chip(x.destino, 'rec', i, true)}</div></div>`).join('')
      : none('Nenhum crédito no extrato.');
    document.querySelectorAll('[data-un]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.un.split(':'); unresolve(k, +i); });
  }

  // ---------- resumo / export ----------
  function renderResumo() {
    const r = S.last?.res;
    $('#resumo').hidden = !r;
    if (!r) return;
    const nPend = pendentes().length;
    $('#k-parc').textContent = r.cardInstall;
    $('#k-parc-s').textContent = `${r.cardNew.length} compras · ${r.cardInstallDup} já lançadas`;
    $('#k-cash').textContent = r.cashNew.length;
    $('#k-cash-s').textContent = `${r.cashDup} já existentes`;
    $('#k-pend').textContent = nPend;
    $('#k-rec').textContent = r.receipts.length;
    $('#k-rec-s').textContent = money(r.receipts.reduce((a, x) => a + x.valor, 0));
    $('#excluidos').innerHTML = (r.excluded.length ? `<div class="banner info"><b>${r.excluded.length} excluído(s) de propósito:</b> ${r.excluded.map(x => `${esc(x.desc)} (${money(Math.abs(x.valor))}) — ${esc(x.motivo)}`).join('; ')}.</div>` : '')
      + (nPend ? `<div class="banner warn">${nPend} item(ns) sem categoria. Dá para copiar agora (SUBGRUPO vai em branco), mas o ideal é classificar em <b>Pendências</b> antes.</div>` : '');
    $('#btn-desfazer').hidden = !S.memo.lastRun;
    const ta = $('#tsv'); if (!ta.hidden) ta.value = E.toTSV(r);
  }
  $('#btn-copiar').onclick = async () => {
    const txt = E.toTSV(S.last.res);
    markExported();
    try { await navigator.clipboard.writeText(txt); toast('Copiado. Cole no Google Sheets, na coluna C.'); }
    catch (e) { const ta = $('#tsv'); ta.hidden = false; ta.value = txt; ta.focus(); ta.select(); toast(document.execCommand('copy') ? 'Copiado.' : 'Selecione o texto abaixo e copie.'); }
  };
  $('#btn-vertsv').onclick = () => { const ta = $('#tsv'); ta.hidden = !ta.hidden; if (!ta.hidden) ta.value = E.toTSV(S.last.res); };
  $('#btn-baixar').onclick = () => {
    try { XLSX.writeFile(E.toWorkbook(XLSX, S.last.res), `lancamentos_novos_${E.iso(new Date())}.xlsx`); markExported(); }
    catch (e) { toast('Download bloqueado aqui. Use "Copiar lançamentos".'); }
  };

  // ---------- conciliação de saldo ----------
  const fields = { banco: '#c-banco', planilha: '#c-planilha', rec: '#c-rec', fat: '#c-fat', ini: '#c-ini', out: '#c-out' };
  function suggested() {
    const L = S.last, x = L?.extrato || (S.extrato && { bankFinal: S.extrato.bankFinal, dataRef: S.extrato.dataRef });
    const rec = L ? E.r2(L.res.receipts.reduce((a, r) => a + r.valor, 0)) : 0;
    let fat = 0;
    if (L?.fatura && (!x?.dataRef || L.fatura.vencFatura > x.dataRef)) fat = L.fatura.total;
    return { banco: x ? x.bankFinal : null, rec, fat, x };
  }
  function renderConc(fromInput) {
    const sg = suggested();
    if (!fromInput) {
      const put = (k, v) => { const el = $(fields[k]); if (document.activeElement !== el) el.value = v == null || v === '' ? '' : NUM.format(v); };
      put('banco', S.conc.banco ?? sg.banco); put('planilha', S.conc.planilha); put('rec', S.conc.rec ?? sg.rec);
      put('fat', S.conc.fat ?? sg.fat); put('ini', S.conc.ini); put('out', S.conc.out);
      $('#c-banco-ref').textContent = sg.x ? `extrato até ${E.fmtBR(sg.x.dataRef)} (saldo anterior + movimentos)` : 'leia um extrato ou digite';
      $('#c-rec-ref').textContent = S.last ? `${S.last.res.receipts.length} crédito(s) no extrato; zere o que já lançou` : '';
      $('#c-fat-ref').textContent = S.last?.fatura ? `fatura vence ${E.fmtBR(S.last.fatura.vencFatura)}${sg.fat ? '' : ' (já paga na data do extrato?)'}` : 'ex.: fatura aberta ainda não debitada';
    }
    const val = k => E.toNum($(fields[k]).value) || 0;
    const o = { saldoBanco: val('banco'), saldoFinalPlanilha: val('planilha'), recebimentosNaoLancados: val('rec'), faturasNaoPagas: val('fat'), difSaldoInicial: val('ini'), outrosAjustes: val('out') };
    const c = E.conciliarSaldo(o);
    $('#c-dif').value = NUM.format(c.diferencaApurar);
    $('#c-exp').value = NUM.format(c.totalExplicado);
    const hasPlan = $(fields.planilha).value.trim() !== '';
    const box = $('#c-result');
    box.className = 'result ' + (hasPlan ? (c.bate ? 'ok' : 'bad') : '');
    box.style.background = hasPlan ? '' : 'var(--surface-2)';
    $('#c-nc').textContent = hasPlan ? money(c.naoConciliado) : '—';
    $('#c-msg').textContent = !hasPlan ? 'Digite o saldo final da planilha (B).' : c.bate ? 'Bate ✓ (diferença abaixo de R$ 0,50)' : (c.naoConciliado > 0 ? 'Banco tem mais que o explicado: falta lançar entrada ou há despesa em dobro.' : 'Banco tem menos que o explicado: falta lançar alguma saída.');
    const pend = pendentes(), recP = pend.filter(p => p.tipo === 'recebimento'), desP = pend.filter(p => p.tipo === 'despesa');
    $('#c-falta').innerHTML = pend.length ? `<div class="banner warn">Falta classificar: ${recP.length ? `${recP.length} recebimento(s) (${money(recP.reduce((a, p) => a + p.valor, 0))})` : ''}${recP.length && desP.length ? ' e ' : ''}${desP.length ? `${desP.length} despesa(s) (${money(desP.reduce((a, p) => a + p.valor * (p.n || 1), 0))})` : ''}. Veja <b>Pendências</b>.</div>` : '';
  }
  Object.entries(fields).forEach(([k, sel]) => {
    const el = $(sel);
    el.addEventListener('input', () => { const v = el.value.trim(); if (v === '') delete S.conc[k]; else S.conc[k] = E.toNum(v); save(K.conc, S.conc); renderConc(true); });
    el.addEventListener('blur', () => { const v = E.toNum(el.value); if (v != null) el.value = NUM.format(v); });
  });

  // ---------- geral ----------
  function renderAll() {
    renderImport(); renderResumo(); renderLancamentos(); renderPendencias(); renderConc();
    const r = S.last?.res, nPend = pendentes().length;
    $('#pill-lanc').textContent = r ? r.cardInstall + r.cashNew.length : 0;
    const pp = $('#pill-pend'); pp.textContent = nPend; pp.classList.toggle('hot', nPend > 0);
  }
  $('#btn-esquecer').onclick = () => {
    if (!confirm('Apagar do navegador a planilha-base, a memória de conciliações, as regras aprendidas e a última conciliação?')) return;
    Object.values(K).forEach(k => k !== K.theme && drop(k));
    location.reload();
  };

  if (!window.XLSX) setDrop('base', 'SheetJS não carregou (sem internet?). Recarregue a página.', 'err');
  renderAll();
})();
