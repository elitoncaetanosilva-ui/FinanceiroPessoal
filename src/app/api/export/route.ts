import { carregarBase, mesAtual } from '@/lib/dados';
import { calcFluxo, mesesAno } from '@/lib/finance';
import { exportPlanilha } from '@/lib/planilha';

export async function GET(req: Request) {
  const ano = Number(new URL(req.url).searchParams.get('ano')) || Number(mesAtual().slice(0, 4));
  const b = await carregarBase();
  const meses = mesesAno(ano);
  const f = calcFluxo(b.lancs, b.categorias, b.orcamentos, b.saldoInicial, meses);
  const linhas = [
    { rotulo: 'TOTAL DE ENTRADAS', nivel: 0 as const, valores: f.resumo.map(r => r.entradas) },
    ...f.linhas.filter(l => l.natureza === 'receita').map(l => ({ rotulo: l.subgrupo ?? l.grupo, nivel: (l.subgrupo ? 1 : 0) as 0 | 1, valores: l.realizado })),
    { rotulo: 'TOTAL DE SAÍDAS', nivel: 0 as const, valores: f.resumo.map(r => r.saidas) },
    ...f.linhas.filter(l => l.natureza === 'despesa').map(l => ({ rotulo: l.subgrupo ?? l.grupo, nivel: (l.subgrupo ? 1 : 0) as 0 | 1, valores: l.realizado })),
    { rotulo: 'GERAÇÃO DE CAIXA', nivel: 0 as const, valores: f.resumo.map(r => r.geracao) },
    { rotulo: 'SALDO INICIAL', nivel: 0 as const, valores: f.resumo.map(r => r.saldoInicial ?? 0) },
    { rotulo: 'SALDO FINAL', nivel: 0 as const, valores: f.resumo.map(r => r.saldoFinal ?? 0) },
  ];
  const buf = exportPlanilha({ lancamentos: b.lancs, categorias: b.categorias, cartoes: b.cartoes, fluxo: { meses, linhas } });
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="CAIXA_${ano}_app.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
