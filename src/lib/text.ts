/** Normalização de descrições para busca, regras e deduplicação. */

/** "Café  do Ponto" → "CAFE DO PONTO" */
export const norm = (s: unknown) =>
  String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Corrige textos UTF-8 lidos como latin1 ("CAFÃ‰" → "CAFÉ"), comum no .xls do Itaú.
 */
export function fixMojibake(s: unknown): string {
  if (typeof s !== 'string') return s == null ? '' : String(s);
  if (!/[Â-ô][\u0080-ÿ]/.test(s)) return s;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return s;
  try {
    const bytes = Uint8Array.from(s, c => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Arquivo do Itaú às vezes corta o 2º byte (ex.: "DISPONÃVEL"); troca a sequência quebrada.
    return s.replace(/Ã[\u0080-¿]?/g, m => (m.length === 2 ? m : 'Í'));
  }
}

const PREFIXES = [
  'PIX QRS ', 'PIX TRANSF ', 'PIX ENVIADO ', 'PIX RECEBIDO ', 'PAG BOLETO ', 'PAGTO BOLETO ', 'PAG TIT ', 'DA ',
  'TED ', 'DOC ', 'TEF ', 'INT ', 'COMPRA CARTAO ', 'COMPRA ', 'DEB AUT ', 'DEBITO AUT ',
];
const GENERIC_FIRST = new Set(['SUPERMERCADOS', 'SUPERMERCADO', 'COMERCIO', 'COM', 'LOJA', 'LOJAS', 'RESTAURANTE', 'FARMACIA', 'POSTO', 'AUTO', 'CASA', 'MERCADO', 'PAY', 'PAG', 'BANCO', 'CIA', 'INST', 'CLINICA', 'CENTRO', 'EC', 'MP', 'PG', 'SH', 'SIM', 'NA', 'L.']);

/**
 * Núcleo da descrição (sem prefixos bancários, datas coladas, "Parcela x/y", cidade/"BRA" do cartão).
 * Usado para agrupar pendentes e sugerir o padrão de uma regra aprendida.
 */
export function coreDescription(desc: string): string {
  let d = norm(desc);
  d = d.replace(/\s*-?\s*PARCELA\s*\d+\s*(\/|DE)\s*\d+\s*$/, '');
  d = d.replace(/\s*\d{2}\/\d{2}(\/\d{2,4})?\s*$/, '');        // "SERRA DIESE01/09"
  for (const p of PREFIXES) if (d.startsWith(p)) { d = d.slice(p.length); break; }
  d = d.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
  return d;
}

/** Sugere o padrão (CONTAINS) de uma regra aprendida a partir de uma descrição. */
export function suggestPattern(desc: string): string {
  const core = coreDescription(desc);
  const tokens = core.split(' ').filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    if (/\d/.test(t) && out.length) break;          // "FILIAL 173CAXIAS" → para no número
    out.push(t.replace(/\d+$/, ''));
    const joined = out.join(' ');
    if (out.length === 1 && t.length >= 5 && !GENERIC_FIRST.has(t)) break;
    if (out.length >= 2 && joined.length >= 6) break;
    if (out.length >= 3) break;
  }
  return out.join(' ').trim() || core.slice(0, 20);
}
