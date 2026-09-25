import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parsePlanilha } from '@/lib/planilha';
import { calcFluxo, mesesAno } from '@/lib/finance';
import type { Lancamento } from '@/lib/types';

const REAL = path.join(__dirname, 'fixtures/real/caixa.xlsx');

// Aceitação com a planilha real (pasta ignorada pelo git). Pulado quando o arquivo não existe.
describe.skipIf(!fs.existsSync(REAL))('aceitação — planilha real CAIXA 2026', () => {
  const imp = parsePlanilha(fs.readFileSync(REAL));
  const lancs = imp.lancamentos.map((l, i) => ({ ...l, id: i + 1 })) as Lancamento[];
  const fluxo = calcFluxo(lancs, imp.categorias, imp.orcamentos, imp.saldoInicial, mesesAno(2026));

  it('importa as abas', () => {
    expect(imp.stats.cash).toBe(286);
    expect(imp.stats.cartao).toBe(737);
    expect(imp.saldoInicial).toEqual({ mes: '2026-01', valor: 1642.82 });
  });

  it('reproduz o REALIZADO do CAIXA MENSAL (jan–set/26)', () => {
    // [entradas, saídas, saldo final] da planilha, colunas REALIZADO
    const esperado: Record<string, [number, number, number]> = {
      '2026-01': [10985.03, 12155.45, 472.4],
      '2026-02': [11181, 9938.63, 1714.77],
      '2026-03': [14212.45, 12412.48, 3514.74],
      '2026-04': [9424.84, 12705.02, 234.56],
      '2026-05': [11062.05, 9916.77, 1379.84],
      '2026-06': [13302.19, 13365.99, 1316.04],
      '2026-07': [12626.18, 10680.82, 3261.4],
      '2026-08': [9877, 13725.35, -586.95],
      '2026-09': [15642.03, 14817.18, 237.9],
    };
    for (const [mes, [e, s, f]] of Object.entries(esperado)) {
      const r = fluxo.resumo.find(x => x.mes === mes)!;
      expect([mes, r.entradas, r.saidas, r.saldoFinal]).toEqual([mes, e, s, f]);
    }
  });
});
