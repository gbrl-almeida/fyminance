import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps internal paths', () => {
    expect(safeNext('/fechamento/2026-09/metas?x=1')).toBe('/fechamento/2026-09/metas?x=1');
  });

  it('refuses anything that leaves the app', () => {
    for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\\/evil.example', '', null, undefined, 'metas']) {
      expect(safeNext(next), String(next)).toBe('/');
    }
  });
});
