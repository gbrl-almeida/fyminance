import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listCategories } from '../../../../curation/categories';
import { getCategoryDetail } from '../../../../queries/category-detail';
import { Card, Money } from '../../../../web/components/bits';
import { ExpandableText } from '../../../../web/components/expandable-text';
import { TopBar } from '../../../../web/components/top-bar';
import { TxOwnerCategory } from '../../../../web/components/tx-owner-category';
import { capitalize, filterQuery, formatBRL, formatDay, monthName, OWNER_LABEL, readFilters } from '../../../../web/format';
import { getAppContext } from '../../../../web/server/context';

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const app = getAppContext();
  const { id } = await params;
  const { month, owner } = readFilters(await searchParams, app.today());
  const categoryId = Number(id);
  if (!Number.isInteger(categoryId)) notFound();
  let detail;
  try {
    detail = getCategoryDetail(app.db, categoryId, month, owner);
  } catch {
    notFound();
  }
  const options = listCategories(app.db)
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ id: c.id, path: c.path }));
  const path = `/categoria/${categoryId}${filterQuery(month, owner)}`;
  return (
    <>
      <TopBar path={`/categoria/${categoryId}`} month={month} owner={owner} />
      <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-6 lg:px-12 lg:py-10">
        <Link href={`/${filterQuery(month, owner)}`} className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Painel
        </Link>
        <header className="flex flex-col gap-1">
          <p className="text-[13px] text-ink-2">{detail.category.parentName === null ? capitalize(monthName(month)) : `${detail.category.parentName} · ${monthName(month)}`}</p>
          <h1 className="text-[28px] font-bold lg:text-[32px]">{detail.category.name}</h1>
          <Money cents={detail.totalCents} className="text-xl" />
        </header>
        {detail.groups.length === 0 && <p className="text-[15px] text-ink-2">Nenhum gasto nesta categoria no mês.</p>}
        {detail.groups.map((group) => {
          const first = group.items[0];
          return (
            <Card key={group.merchantKey} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <ExpandableText text={group.merchantKey} className="text-[15px] font-semibold" />
                  <span className="text-[13px] text-ink-3">
                    {group.items.length} {group.items.length === 1 ? 'transação' : 'transações'}
                  </span>
                </div>
                <Money cents={group.totalCents} className="text-[15px] font-medium" />
              </div>
              {first !== undefined && group.items.length > 1 && (
                <TxOwnerCategory
                  transactionIds={group.items.map((i) => i.id)}
                  categoryId={first.categoryId}
                  owner={first.owner}
                  options={options}
                  path={path}
                  label="Alterar todas"
                />
              )}
              <ul className="flex flex-col divide-y divide-line">
                {group.items.map((item) => (
                  <li key={`${item.id}:${item.part?.index ?? 0}`} className="flex flex-col gap-2 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col">
                        <Link href={`/lancamento/${encodeURIComponent(item.id)}`} title={item.description} className="truncate text-sm hover:underline">
                          {item.description}
                        </Link>
                        {item.note !== null && <span className="text-[13px] text-ink-2 italic wrap-anywhere">{item.note}</span>}
                        <span className="text-xs text-ink-3">
                          {[
                            formatDay(item.date),
                            item.account,
                            item.installment === null ? null : `parcela ${item.installment}`,
                            item.part === null ? null : `parte ${item.part.index + 1} de ${item.part.count} de ${formatBRL(-item.bankCents)}`,
                            item.offsetCents > 0 ? `voltou ${formatBRL(item.offsetCents)}` : null,
                            OWNER_LABEL[item.owner],
                          ]
                            .filter((x) => x !== null)
                            .join(' · ')}
                        </span>
                      </div>
                      <span className="num shrink-0 text-sm">{formatBRL(-item.amountCents)}</span>
                    </div>
                    {item.part === null && <TxOwnerCategory transactionIds={[item.id]} categoryId={item.categoryId} owner={item.owner} options={options} path={path} />}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </main>
    </>
  );
}
