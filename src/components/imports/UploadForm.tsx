'use client';
import { useActionState, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { uploadAction } from '@/app/actions/imports';
import { Button, ErrorText, cx } from '@/components/ui';
import type { ActionResult } from '@/server/context';

export default function UploadForm() {
  const [state, action, pending] = useActionState(uploadAction, { ok: true } as ActionResult);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="space-y-3">
      <label className={cx('flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center',
        name ? 'border-primary bg-primary-soft' : 'border-border bg-surface-2 hover:border-primary')}>
        <FileUp size={36} className="text-primary" />
        <span className="font-semibold">{name || 'Escolher arquivo do celular ou do computador'}</span>
        <span className="text-sm text-muted">Extrato ou fatura: .xls, .xlsx, .csv, .ofx (até 5 MB)</span>
        <input ref={input} type="file" name="file" accept=".xls,.xlsx,.csv,.ofx,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="sr-only" onChange={e => setName(e.target.files?.[0]?.name ?? '')} required />
      </label>
      {!state.ok && <ErrorText>{state.error}</ErrorText>}
      <Button type="submit" size="lg" className="w-full" disabled={!name || pending}>{pending ? 'Lendo arquivo…' : 'Ler arquivo e ver prévia'}</Button>
    </form>
  );
}
