'use server';

import { revalidatePath } from 'next/cache';
import { parseBRL } from '../../../core/money';
import { slugify } from '../../../curation/documents';
import { detectBank, PARSERS, UNKNOWN_FILE } from '../../../integrations/files/statement';
import { importStatement } from '../../../jobs/import-statement';
import { requireUser } from '../../../web/server/auth';
import { getAppContext } from '../../../web/server/context';

export type UploadResult = { ok: true; inserted: number; skipped: number; month: string | null } | { ok: false; error: string };

export async function uploadStatement(_previous: UploadResult | null, form: FormData): Promise<UploadResult> {
  const user = await requireUser('/importar');
  try {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Escolha o arquivo da fatura.');
    const existing = String(form.get('account') ?? '');
    const newName = String(form.get('newName') ?? '').trim();
    if (existing === '' && newName === '') throw new Error('Escolha a conta ou dê um nome para a nova.');
    const accountId = existing !== '' ? existing : `file:${slugify(newName)}`;
    const total = String(form.get('total') ?? '').trim();
    const text = await file.text();
    // Sem banco escolhido, vale o que o arquivo diz.
    const bank = String(form.get('bank') ?? '') || detectBank(text);
    const reader = bank === null ? undefined : PARSERS[bank];
    if (reader === undefined) throw new Error(UNKNOWN_FILE);
    const statement = reader.parse(text, file.name);
    const app = getAppContext();
    const result = await importStatement(
      { db: app.db, pipeline: app.pipeline, classifier: app.classifier, now: app.now },
      {
        accountId,
        accountName: newName === '' ? accountId : newName,
        owner: user,
        statement,
        ...(total === '' ? {} : { totalCents: parseBRL(total) }),
      },
    );
    revalidatePath('/', 'layout');
    const months = statement.rows.map((r) => r.date.slice(0, 7)).sort();
    return { ok: true, inserted: result.inserted, skipped: result.skipped, month: months.at(-1) ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
