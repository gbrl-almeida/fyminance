'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadStatement, type UploadResult } from './actions';

export function UploadForm({ banks, accounts }: { banks: Array<{ id: string; label: string }>; accounts: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(uploadStatement, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Arquivo da fatura (CSV)
        <Input type="file" name="file" accept=".csv,text/csv" required className="bg-surface" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Banco
        <select name="bank" className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink">
          <option value="">Descobrir pelo arquivo</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Cartão
        <select name="account" className="h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink">
          <option value="">Novo cartão…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Nome do cartão novo
        <Input name="newName" placeholder="Ex.: C6 Carbon (arquivo)" className="bg-surface" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Total da fatura (se o arquivo não trouxer)
        <Input name="total" inputMode="decimal" placeholder="0,00" className="num bg-surface" />
      </label>
      {state !== null && !state.ok && <p className="text-sm text-warn">{state.error}</p>}
      {state !== null && state.ok && (
        <p className="text-sm text-good">
          {state.inserted} transações novas, {state.skipped} já existiam.{' '}
          {state.month !== null && (
            <Link href={`/fechamento/${state.month}/conciliacao`} className="font-semibold underline">
              Ir para a conciliação
            </Link>
          )}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 self-start px-5">
        {pending ? 'Importando…' : 'Importar'}
      </Button>
    </form>
  );
}
