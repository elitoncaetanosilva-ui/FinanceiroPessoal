import Link from 'next/link';
import UploadForm from '@/components/imports/UploadForm';
import { Badge, Card, CardTitle, PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { readCtx } from '@/server/context';
import { listBatches } from '@/server/import/pipeline';
import { IMPORTERS } from '@/server/import/registry';

export const metadata = { title: 'Importações' };
const STATUS: Record<string, { label: string; tone: 'neutral' | 'primary' | 'warning' | 'danger' | 'income' }> = {
  DRAFT: { label: 'aguardando revisão', tone: 'warning' }, COMMITTED: { label: 'importado', tone: 'income' },
  DISCARDED: { label: 'descartado', tone: 'neutral' }, REVERTED: { label: 'desfeito', tone: 'danger' },
};

export default async function Importacoes() {
  const ctx = await readCtx();
  const batches = await listBatches(ctx);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <PageHeader title="Importações" subtitle="Upload → identificação → leitura → validação → classificação → revisão → importação" />
        <Card><UploadForm /></Card>
        <Card>
          <CardTitle>Formatos reconhecidos</CardTitle>
          <ul className="space-y-1 text-sm">{IMPORTERS.map(i => <li key={i.id}>• {i.label}</li>)}</ul>
          <p className="mt-2 text-xs text-muted">Importar o mesmo arquivo de novo ou arquivos com períodos sobrepostos não duplica lançamentos.</p>
        </Card>
      </div>
      <Card className="self-start">
        <CardTitle>Histórico de lotes</CardTitle>
        {batches.length === 0 ? <p className="text-sm text-muted">Nenhuma importação ainda.</p> : (
          <ul className="divide-y divide-border">
            {batches.map(b => (
              <li key={b.id}>
                <Link href={`/importacoes/${b.id}`} className="block py-3 hover:bg-surface-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{b.file_name}</span>
                    <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {b.holder_name ?? b.institution_name} · {b.period_start ? `${fmtDate(b.period_start)} a ${fmtDate(b.period_end)}` : ''} · {new Date(b.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                  {b.stats?.total != null && (
                    <p className="text-xs text-muted">
                      {b.stats.total} lidos · {b.stats.imported ?? b.stats.new ?? 0} importados · {b.stats.duplicate ?? 0} duplicados · {b.stats.linked ?? b.stats.matched ?? 0} vinculados · {b.stats.pending ?? 0} pendentes
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
