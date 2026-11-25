import type Database from 'better-sqlite3';

export function runReadOnlySql(
  sqlite: Database.Database,
  query: string,
  limit = 500,
): { columns: string[]; rows: unknown[]; truncated: boolean } {
  const single = query.trim().replace(/;+\s*$/, '');
  if (single.includes(';')) throw new Error('Envie uma única consulta.');
  const statement = sqlite.prepare(single);
  if (!statement.readonly) throw new Error('Apenas consultas de leitura são permitidas.');
  if (!statement.reader) throw new Error('A consulta não devolve linhas.');
  const rows: unknown[] = [];
  let truncated = false;
  for (const row of statement.iterate()) {
    if (rows.length === limit) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { columns: statement.columns().map((c) => c.name), rows, truncated };
}
