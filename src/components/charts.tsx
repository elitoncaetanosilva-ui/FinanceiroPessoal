'use client';

import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtBRL, fmtEixo, fmtMes } from '@/lib/util';
import { COR, corCartao } from '@/lib/cores';


const eixo = { fontSize: 12, fill: 'var(--text-3)' };
const grade = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />;

type TTItem = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function Dica({ active, payload, label, extra }: { active?: boolean; payload?: TTItem[]; label?: string | number; extra?: (p: Record<string, unknown>) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div className="tt-title">{typeof label === 'string' && /^\d{4}-\d{2}$/.test(label) ? fmtMes(label) : label}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div className="tt-row" key={String(p.dataKey)}>
          <span><i className="dot" style={{ background: p.color }} />{p.name}</span>
          <span className="num">{fmtBRL(Number(p.value))}</span>
        </div>
      ))}
      {extra && payload[0]?.payload && extra(payload[0].payload)}
    </div>
  );
}

export function Legenda({ itens }: { itens: { label: string; cor: string; tipo?: 'barra' | 'linha' }[] }) {
  return (
    <div className="legend" aria-hidden>
      {itens.map(i => (
        <span key={i.label}>
          {i.tipo === 'linha' ? <i className="line" style={{ background: i.cor }} /> : <i className="dot" style={{ background: i.cor }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface PontoFluxo { mes: string; entradas: number; saidas: number; saldo: number | null; futuro?: boolean; }

/** Entradas × saídas por mês (barras) + saldo final (linha). Mesma unidade (R$) → um eixo só. */
export function FluxoChart({ dados, altura = 280 }: { dados: PontoFluxo[]; altura?: number }) {
  return (
    <div>
      <Legenda itens={[{ label: 'Entradas', cor: COR.entradas }, { label: 'Saídas', cor: COR.saidas }, { label: 'Saldo final', cor: COR.saldo, tipo: 'linha' }]} />
      <div style={{ height: altura, marginTop: 8 }} role="img" aria-label="Gráfico de entradas, saídas e saldo por mês">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
            {grade}
            <XAxis dataKey="mes" tickFormatter={fmtMes} tick={eixo} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
            <YAxis tickFormatter={fmtEixo} tick={eixo} axisLine={false} tickLine={false} width={60} />
            <ReferenceLine y={0} stroke="var(--text-3)" />
            <Tooltip content={<Dica />} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
            <Bar dataKey="entradas" name="Entradas" fill={COR.entradas} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="saidas" name="Saídas" fill={COR.saidas} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Line dataKey="saldo" name="Saldo final" stroke={COR.saldo} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: 'var(--surface)' }} activeDot={{ r: 5 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Faturas por mês, empilhadas por cartão. */
export function FaturasChart({ dados, cartoes, altura = 240, mesAtual }: { dados: Record<string, number | string>[]; cartoes: string[]; altura?: number; mesAtual?: string }) {
  return (
    <div>
      {cartoes.length > 1 && <Legenda itens={cartoes.map((c, i) => ({ label: c, cor: corCartao(i) }))} />}
      <div style={{ height: altura, marginTop: 8 }} role="img" aria-label="Faturas por mês e cartão">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
            {grade}
            <XAxis dataKey="mes" tickFormatter={fmtMes} tick={eixo} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
            <YAxis tickFormatter={fmtEixo} tick={eixo} axisLine={false} tickLine={false} width={60} />
            <Tooltip
              content={<Dica extra={p => (cartoes.length > 1 ? <div className="tt-row" style={{ marginTop: 4, fontWeight: 600 }}><span>Total</span><span className="num">{fmtBRL(Number(p.total))}</span></div> : null)} />}
              cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }}
            />
            {mesAtual && <ReferenceLine x={mesAtual} stroke="var(--text-3)" strokeDasharray="3 3" />}
            {cartoes.map((c, i) => (
              <Bar key={c} dataKey={c} name={c} stackId="c" fill={corCartao(i)} stroke="var(--surface)" strokeWidth={1}
                radius={i === cartoes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={34} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface PontoProj { mes: string; saldo: number; real?: boolean; entradas?: number; saidas?: number; parcelas?: number; }

/** Saldo realizado + projetado. */
export function ProjecaoChart({ dados, altura = 260 }: { dados: PontoProj[]; altura?: number }) {
  const serie = dados.map((d, i) => ({
    mes: d.mes,
    realizado: d.real ? d.saldo : null,
    // conecta a projeção ao último ponto realizado
    projetado: !d.real || (dados[i + 1] && !dados[i + 1].real) ? d.saldo : null,
    parcelas: d.parcelas,
  }));
  return (
    <div>
      <Legenda itens={[{ label: 'Saldo realizado', cor: COR.saldo, tipo: 'linha' }, { label: 'Saldo projetado', cor: 'var(--s7)', tipo: 'linha' }]} />
      <div style={{ height: altura, marginTop: 8 }} role="img" aria-label="Saldo realizado e projetado">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {grade}
            <XAxis dataKey="mes" tickFormatter={fmtMes} tick={eixo} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
            <YAxis tickFormatter={fmtEixo} tick={eixo} axisLine={false} tickLine={false} width={60} />
            <ReferenceLine y={0} stroke="var(--bad)" strokeDasharray="4 3" />
            <Tooltip content={<Dica />} />
            <Line dataKey="realizado" name="Saldo realizado" stroke={COR.saldo} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: 'var(--surface)' }} connectNulls={false} />
            <Line dataKey="projetado" name="Saldo projetado" stroke="var(--s7)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeWidth: 2, fill: 'var(--surface)' }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Uma série de barras (ex.: gasto de um subgrupo por mês). */
export function SerieChart({ dados, nome, cor = 'var(--s1)', altura = 200 }: { dados: { mes: string; valor: number }[]; nome: string; cor?: string; altura?: number }) {
  return (
    <div style={{ height: altura }} role="img" aria-label={`${nome} por mês`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
          {grade}
          <XAxis dataKey="mes" tickFormatter={fmtMes} tick={eixo} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis tickFormatter={fmtEixo} tick={eixo} axisLine={false} tickLine={false} width={60} />
          <Tooltip content={<Dica />} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
          <Bar dataKey="valor" name={nome} fill={cor} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
