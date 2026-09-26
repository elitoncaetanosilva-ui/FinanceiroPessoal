'use client';
import { useActionState } from 'react';
import { uploadCaixaAction } from '@/app/actions/settings';
import { Button, ErrorText, inputClass } from '@/components/ui';
import type { ActionResult } from '@/server/context';

export default function CaixaUpload() {
  const [s, action, pending] = useActionState(uploadCaixaAction, { ok: true } as ActionResult);
  return (
    <form action={action} className="space-y-3">
      <input type="file" name="file" accept=".xlsx" required className={`${inputClass} py-2`} />
      {!s.ok && <ErrorText>{s.error}</ErrorText>}
      <Button type="submit" disabled={pending}>{pending ? 'Lendo…' : 'Ler planilha'}</Button>
    </form>
  );
}
