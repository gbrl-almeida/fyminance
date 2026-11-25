import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DocumentInfo {
  path: string;
  kind: 'relatorio' | 'nota';
  updatedAt: string;
}

const MONTH = /^\d{4}-\d{2}$/;
const DOCUMENT_PATH = /^(relatorios|notas)\/[a-z0-9-]+\.md$/;
const FOLDERS: Array<[DocumentInfo['kind'], string]> = [
  ['relatorio', 'relatorios'],
  ['nota', 'notas'],
];

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'nota';
}

function write(dataDir: string, folder: string, name: string, markdown: string): string {
  mkdirSync(join(dataDir, folder), { recursive: true });
  writeFileSync(join(dataDir, folder, name), markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  return `${folder}/${name}`;
}

export function saveReport(dataDir: string, month: string, markdown: string): string {
  if (!MONTH.test(month)) throw new Error('Mês inválido; use AAAA-MM.');
  return write(dataDir, 'relatorios', `${month}.md`, markdown);
}

export function saveNote(dataDir: string, title: string, markdown: string, today: string): string {
  return write(dataDir, 'notas', `${today}-${slugify(title)}.md`, markdown);
}

export function listDocuments(dataDir: string): DocumentInfo[] {
  const documents: DocumentInfo[] = [];
  for (const [kind, folder] of FOLDERS) {
    const dir = join(dataDir, folder);
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort().reverse();
    for (const name of names) {
      documents.push({ path: `${folder}/${name}`, kind, updatedAt: statSync(join(dir, name)).mtime.toISOString() });
    }
  }
  return documents;
}

export function readDocument(dataDir: string, path: string): string {
  if (!DOCUMENT_PATH.test(path)) throw new Error('Caminho inválido. Use relatorios/AAAA-MM.md ou notas/<arquivo>.md.');
  const file = join(dataDir, path);
  if (!existsSync(file)) throw new Error(`Documento não encontrado: ${path}`);
  return readFileSync(file, 'utf8');
}

const OBSERVATIONS = '## Observações do Claude';

/**
 * Salva o relatório do mês. Se ele já existe (gerado pelo fechamento), o texto entra como a seção de
 * observações do Claude, substituindo observações anteriores, sem mexer no resto.
 */
export function saveReportOrObservations(dataDir: string, month: string, markdown: string): string {
  if (!MONTH.test(month)) throw new Error('Mês inválido; use AAAA-MM.');
  const file = join(dataDir, 'relatorios', `${month}.md`);
  if (!existsSync(file)) return saveReport(dataDir, month, markdown);
  const current = readFileSync(file, 'utf8');
  const base = current.includes(OBSERVATIONS) ? current.slice(0, current.indexOf(OBSERVATIONS)).trimEnd() : current.trimEnd();
  return write(dataDir, 'relatorios', `${month}.md`, `${base}\n\n${OBSERVATIONS}\n\n${markdown.trim()}\n`);
}
