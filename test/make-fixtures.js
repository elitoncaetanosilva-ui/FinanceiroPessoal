// Gera fixtures SINTÉTICAS (dados fictícios) no layout exato dos arquivos do Itaú / planilha CAIXA 2026,
// calibradas para reproduzir os números dos critérios de aceitação (seção 8 do brief).
// Uso: node test/make-fixtures.js [pasta]   (padrão: test/fixtures)
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const br = d => String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
const r2 = n => Math.round(n * 100) / 100;

function base() {
  const wb = XLSX.utils.book_new();
  const cash = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'SUBGRUPO', 'VALOR']];
  const addCash = (d, desc, sub, v) => cash.push([null, null, d, d, desc, sub, v]);
  addCash(D(2026, 8, 5), 'TOMASI IMOVEIS', 'Aluguel', 1850);
  addCash(D(2026, 8, 12), 'RGE SUL', 'Energia elétrica', 231.1);
  // já lançados que também aparecem no extrato (4 duplicados)
  addCash(D(2026, 8, 31), 'CLARO', 'Celular', 89.99);
  addCash(D(2026, 9, 1), 'RGE SUL', 'Energia elétrica', 245.3);
  addCash(D(2026, 9, 2), 'TOMASI IMOVEIS', 'Aluguel', 1850);
  addCash(D(2026, 9, 5), 'TAR PACOTE ITAU', 'Tarifas / Encargos', 39.9);
  const ws = XLSX.utils.aoa_to_sheet(cash);
  for (let i = 2; i <= cash.length; i++) { ws['A' + i] = { t: 'n', f: `DATE(YEAR(C${i}),MONTH(C${i}),1)` }; ws['B' + i] = { t: 'n', f: `DATE(YEAR(D${i}),MONTH(D${i}),1)` }; }
  XLSX.utils.book_append_sheet(wb, ws, 'CASH');

  const car = [['MÊS_COMPRA', 'MÊS_VENC', 'DATA COMPRA', 'VENCIMENTO', 'DESCRIÇÃO', 'Parcela', 'CARTÃO', 'SUBGRUPO', 'VALOR']];
  const addCar = (dc, venc, desc, parc, sub, v) => car.push([null, null, dc, venc, desc, parc, 'Itaú Black', sub, v]);
  addCar(D(2026, 7, 20), D(2026, 8, 10), 'MAGAZINE LUIZA', '01/10', '', 120);
  addCar(D(2026, 7, 20), D(2026, 9, 10), 'MAGAZINE LUIZA', '02/10', '', 120);
  [9, 10, 11, 12, 13].forEach((m, i) => addCar(D(2026, 8, 3), D(2026 + Math.floor((m - 1) / 12), ((m - 1) % 12) + 1, 10), 'AMAZON MARKETPLACE', `0${i + 1}/05`, '', 75));
  addCar(D(2026, 8, 15), D(2026, 9, 10), 'CLINICA ODONTO SORRISO', '01/04', 'Odontologia', 180);
  addCar(D(2026, 8, 15), D(2026, 10, 10), 'CLINICA ODONTO SORRISO', '02/04', 'Odontologia', 180);
  addCar(D(2026, 8, 22), D(2026, 9, 10), 'ZAFFARI BOURBON', '01/01', 'Mercado / Limpeza', 287.4);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(car), 'CARTÃO');

  const subs = [
    ['Casa', 'Aluguel'], ['Casa', 'Energia elétrica'], ['Casa', 'Internet'], ['Casa', 'Celular'], ['Casa', 'Mercado / Limpeza'],
    ['Saúde', 'Medicamentos'], ['Saúde', 'Odontologia'], ['Saúde', 'Academia'], ['Alimentação', 'Lanches / Delivery'],
    ['Filhos', 'Escola'], ['Filhos', 'Roupas infantis'], ['Pessoal', 'Roupas'], ['Transporte', 'Combustível'],
    ['Transporte', 'Mecânica / Manutenção'], ['Transporte', 'Seguro'], ['Lazer', 'Passeios'], ['Lazer', 'Cinema / Teatro'],
    ['Lazer', 'Eventos / Shows'], ['Pet', 'Veterinário / Vacinas'], ['Pet', 'Ração / Alimentação'],
    ['Financeiro', 'Tarifas / Encargos'], ['Outros', 'Presentes / Doações'], ['Outros', 'Diversos'],
  ];
  const apoio = [['Categoria', 'Subgrupo', null, 'Cartões']];
  subs.forEach((s, i) => apoio.push([s[0], s[1], null, i === 0 ? 'Itaú Black' : i === 1 ? 'Nubank' : null]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(apoio), 'Apoio');

  const regras = [['REGRAS DE CATEGORIZAÇÃO'], [], ['Contém (palavra-chave)', 'Subgrupo'], ['SMART FIT', 'Academia'], ['PALAVRA SEM SUBGRUPO', 'Inexistente']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(regras), 'Regras');
  return wb;
}

// "CAFÉ" em UTF-8 lido como latin1 — o que o .xls do Itaú às vezes entrega.
const moji = s => Buffer.from(s, 'utf8').toString('latin1');

function extrato() {
  const mov = [
    [D(2026, 8, 30), 'PIX QRS SERRA DIESEL', -180],
    [D(2026, 8, 30), 'PAG BOLETO NET INTERNET', -129.9],
    [D(2026, 8, 31), 'IOF', -3.47],
    [D(2026, 8, 31), 'CLARO', -89.99],
    [D(2026, 9, 1), 'TED 102.0001 EMPRESA XYZ LTDA', 13524.35],
    [D(2026, 9, 1), 'RGE SUL', -245.3],
    [D(2026, 9, 1), 'PIX TRANSF IGREJA BATISTA', -300],
    [D(2026, 9, 1), 'PIX TRANSF MARIA SILVA', -150],
    [D(2026, 9, 2), 'TOMASI IMOVEIS', -1850],
    [D(2026, 9, 2), 'CEEE EQUATORIAL', -98.1],
    [D(2026, 9, 2), 'PIX QRS PADARIA DO ZE', -23.5],
    [D(2026, 9, 3), 'TIM CELULAR', -49.99],
    [D(2026, 9, 3), moji('PIX TRANSF CAFÉ DO PONTO'), -18],
    [D(2026, 9, 4), 'PAG BOLETO CONDOMINIO', -420],
    [D(2026, 9, 4), 'SAQUE 24H', -200],
    [D(2026, 9, 5), 'TAR PACOTE ITAU', -39.9],
    [D(2026, 9, 5), 'PIX QRS POSTO BOA VIAGEM', -150],
    [D(2026, 9, 5), 'RESGATE APLICACAO AUT', 320.52],
    [D(2026, 9, 6), 'PAG TIT BANCO', -58],
    [D(2026, 9, 8), 'DA OBRA MISSIONARIA', -50],
    [D(2026, 9, 8), 'PIX TRANSF JOAO PEREIRA', -75],
    [D(2026, 9, 9), 'TARIFA TED', -10.45],
    [D(2026, 9, 9), 'PIX QRS FARMACIA CENTRAL', -32.4],
    [D(2026, 9, 10), 'FATURA ITAU UNICLASS MC BLA', -4210.33],
    [D(2026, 9, 10), 'ANUIDADE DIFERENCIADA', -25],
    [D(2026, 9, 10), 'PIX QRS ACOUGUE BOM CORTE', -67.8],
    [D(2026, 9, 11), 'PAG BOLETO ESCOLA', -890],
    [D(2026, 9, 12), 'PIX TRANSF DIZIMO', -120],
    [D(2026, 9, 12), 'PIX RECEBIDO ANA SOUZA', 200],
    [D(2026, 9, 13), 'PIX QRS LAVACAR', -40],
    [D(2026, 9, 14), 'SEGURO VIDA', -35.9],
  ];
  const FINAL = 2984.77;
  const saldoAnt = r2(FINAL - mov.reduce((a, m) => a + m[2], 0));
  const rows = [
    ['Extrato Conta Corrente'], [], ['Nome:', 'TITULAR TESTE'], ['Agência:', '0000', 'Conta:', '00000-0'], [],
    ['Período:', '30/08/2026 a 14/09/2026'], [], [moji('Lançamentos')], [],
    ['data', moji('lançamento'), 'ag./origem', 'valor (R$)', 'saldos (R$)'],
    ['29/08/2026', 'SALDO ANTERIOR', null, null, saldoAnt],
  ];
  let saldo = saldoAnt;
  mov.forEach((m, i) => {
    saldo = r2(saldo + m[2]);
    rows.push([br(m[0]), m[1], '0000', m[2], null]);
    const next = mov[i + 1];
    if (!next || +next[0] !== +m[0]) rows.push([br(m[0]), moji('SALDO TOTAL DISPONÍVEL DIA'), null, null, saldo]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Lançamentos');
  return wb;
}

function fatura() {
  const compras = [
    ['15/09/2026', 'PAGAMENTO DEBITO AUTOMATICO', null, -4210.33],
    ['12/09/2026', 'PANVEL FILIAL 123', 'Parcela 1 de 2', 89.9],
    ['13/09/2026', 'NICK KIDS', 'Parcela 1 de 6', 59.9],
    ['14/09/2026', 'ZAFFARI HIPER', null, 312.45],
    ['15/09/2026', 'POSTO SHELL AV BRASIL', null, 250],
    ['16/09/2026', 'LOJAS RENNER', 'Parcela 1 de 10', 49.99],
    ['20/07/2026', 'MAGAZINE LUIZA', 'Parcela 3 de 10', 120],
    ['03/08/2026', 'AMAZON MARKETPLACE', 'Parcela 2 de 5', 75],
    ['18/09/2026', 'IFOOD *RESTAURANTE SABOR', null, 45.8],
    ['19/09/2026', 'SMART FIT', null, 99.9],
    ['15/08/2026', 'CLINICA ODONTO SORRISO', 'Parcela 2 de 4', 180],
    ['21/09/2026', 'HOTEL SERRA GAUCHA', 'Parcela 1 de 3', 400],
    ['10/06/2026', 'MERCADO LIVRE', 'Parcela 4 de 6', 33.33],
  ];
  const rows = [
    ['Fatura do cartão'], ['Cartão', 'ITAU UNICLASS BLACK MASTERCARD'], ['Vencimento', D(2026, 10, 10)], ['Total', 1234.56], [],
    ['Data', 'Lançamento', 'Parcelamento', 'Valor', 'Titularidade', 'Nome', 'Tipo do cartão', 'Número do cartão'],
  ];
  compras.forEach(c => rows.push([c[0], c[1], c[2], c[3], 'Titular', 'TITULAR TESTE', 'Físico', '**** 0000']));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Fatura 10-26');
  return wb;
}

function write(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    base: path.join(dir, 'base.xlsx'),
    extrato: path.join(dir, 'extrato.xls'),
    fatura: path.join(dir, 'fatura.xlsx'),
  };
  XLSX.writeFile(base(), files.base);
  XLSX.writeFile(extrato(), files.extrato, { bookType: 'biff8' });
  XLSX.writeFile(fatura(), files.fatura);
  return files;
}

module.exports = { write };
if (require.main === module) {
  const f = write(process.argv[2] || path.join(__dirname, 'fixtures'));
  console.log('Fixtures geradas:', Object.values(f).join(', '));
}
