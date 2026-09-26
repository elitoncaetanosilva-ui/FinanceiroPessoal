'use client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtDate, fmtMonth } from '@/lib/dates';
import { formatBRL, formatCompact } from '@/lib/money';

const AXIS = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;

function Tip({ active, payload, label, fmtLabel }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; fmtLabel: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted">{fmtLabel(String(label))}</p>
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: p.color }} />
          <b className="money tnum">{formatBRL(p.value)}</b> <span className="text-muted">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

/** Saldo projetado/histórico: série única, linha fina com área suave e linha do zero. */
export function BalanceChart({ data, daily = true, height = 240 }: { data: { date: string; balance: number | null }[]; daily?: boolean; height?: number }) {
  const min = Math.min(0, ...data.map(d => d.balance ?? 0));
  return (
    <div className="money" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {GRID}
          <XAxis dataKey="date" {...AXIS} tickFormatter={d => (daily ? fmtDate(d).slice(0, 5) : fmtMonth(d))} minTickGap={24} />
          <YAxis {...AXIS} width={48} tickFormatter={v => formatCompact(v)} domain={[min < 0 ? 'auto' : 0, 'auto']} />
          <ReferenceLine y={0} stroke="var(--chart-zero)" />
          <Tooltip content={<Tip fmtLabel={d => (daily ? fmtDate(d) : fmtMonth(d))} />} cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }} />
          <Area type="stepAfter" dataKey="balance" name="Saldo" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.08} connectNulls isAnimationActive={false} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Receitas × Despesas por mês: barras agrupadas, duas séries, legenda. */
export function IncomeExpenseChart({ data, height = 260 }: { data: { month: string; income: number; expense: number }[]; height?: number }) {
  return (
    <div className="money" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="25%">
          {GRID}
          <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
          <YAxis {...AXIS} width={48} tickFormatter={v => formatCompact(v)} />
          <Tooltip content={<Tip fmtLabel={fmtMonth} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.5 }} />
          <Legend iconType="rect" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Receitas" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expense" name="Despesas + dívidas" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

/** Gastos por cartão por mês (até 3 cartões; demais somados em "Outros"). */
export function CardSpendChart({ data, cards, height = 240 }: { data: Record<string, number | string>[]; cards: { id: string; name: string }[]; height?: number }) {
  const shown = cards.slice(0, cards.length > 3 ? 2 : 3);
  const rest = cards.slice(shown.length);
  const rows = data.map(d => ({ ...d, __outros: rest.reduce((s, c) => s + Number(d[c.id] ?? 0), 0) }));
  const keys = [...shown.map(c => ({ key: c.id, name: c.name })), ...(rest.length ? [{ key: '__outros', name: 'Outros' }] : [])];
  return (
    <div className="money" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {GRID}
          <XAxis dataKey="month" {...AXIS} tickFormatter={fmtMonth} />
          <YAxis {...AXIS} width={48} tickFormatter={v => formatCompact(v)} />
          <Tooltip content={<Tip fmtLabel={fmtMonth} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.5 }} />
          {keys.length > 1 && <Legend iconType="rect" iconSize={10} wrapperStyle={{ fontSize: 12 }} />}
          {keys.map((k, i) => (
            <Bar key={k.key} dataKey={k.key} name={k.name} stackId="c" fill={SERIES[i]} stroke="var(--surface)" strokeWidth={keys.length > 1 ? 2 : 0}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
