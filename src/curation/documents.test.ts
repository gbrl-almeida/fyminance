import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listDocuments, readDocument, saveNote, saveReport, slugify } from './documents';

const dirs: string[] = [];
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fyminance-docs-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('documents', () => {
  it('saves a monthly report and reads it back', () => {
    const dir = dataDir();
    expect(saveReport(dir, '2026-10', '# Outubro')).toBe('relatorios/2026-10.md');
    expect(readDocument(dir, 'relatorios/2026-10.md')).toBe('# Outubro\n');
    saveReport(dir, '2026-10', '# Outubro revisado\n');
    expect(readDocument(dir, 'relatorios/2026-10.md')).toBe('# Outubro revisado\n');
  });

  it('rejects an invalid month', () => {
    expect(() => saveReport(dataDir(), 'outubro', 'x')).toThrow('Mês inválido; use AAAA-MM.');
  });

  it('saves notes with a dated slug', () => {
    const dir = dataDir();
    expect(saveNote(dir, 'Comprar ou alugar? Simulação', '# Estudo', '2026-10-14')).toBe(
      'notas/2026-10-14-comprar-ou-alugar-simulacao.md',
    );
    expect(slugify('!!!')).toBe('nota');
  });

  it('lists reports and notes', () => {
    const dir = dataDir();
    expect(listDocuments(dir)).toEqual([]);
    saveReport(dir, '2026-09', 'a');
    saveReport(dir, '2026-10', 'b');
    saveNote(dir, 'Imóvel', 'c', '2026-10-14');
    expect(listDocuments(dir).map((d) => [d.kind, d.path])).toEqual([
      ['relatorio', 'relatorios/2026-10.md'],
      ['relatorio', 'relatorios/2026-09.md'],
      ['nota', 'notas/2026-10-14-imovel.md'],
    ]);
  });

  it('refuses paths outside the data folders and missing files', () => {
    const dir = dataDir();
    for (const path of ['../etc/passwd', 'notas/../x.md', 'outra/x.md', 'notas/X.md']) {
      expect(() => readDocument(dir, path)).toThrow('Caminho inválido. Use relatorios/AAAA-MM.md ou notas/<arquivo>.md.');
    }
    expect(() => readDocument(dir, 'notas/nao-existe.md')).toThrow('Documento não encontrado: notas/nao-existe.md');
  });
});
