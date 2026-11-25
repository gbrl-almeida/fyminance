import { redirect } from 'next/navigation';
import { getClosingStatus } from '../../../../queries/closing';
import { getAppContext } from '../../../../web/server/context';

/** Abre o fechamento no primeiro passo que falta. */
export default async function ClosingIndex({ params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  const app = getAppContext();
  const { steps } = getClosingStatus(app.db, mes, app.today(), app.dataDir);
  const next =
    steps.data === 'attention' && steps.reconciliation !== 'done'
      ? 'dados'
      : steps.reconciliation !== 'done'
        ? 'conciliacao'
        : steps.goals !== 'done'
          ? 'metas'
          : 'investimentos';
  redirect(`/fechamento/${mes}/${next}`);
}
