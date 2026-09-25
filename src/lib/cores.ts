// Cores por entidade (ordem fixa da paleta categórica validada; valores em globals.css).
export const COR = { entradas: 'var(--s1)', saidas: 'var(--s2)', saldo: 'var(--s3)' };
export const corCartao = (i: number) => ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'][i] ?? 'var(--muted-bar)';
