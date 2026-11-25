import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('splits headings, lists, tables and paragraphs', () => {
    const blocks = parseMarkdown(
      ['# Relatório', '', '## Resultado', '', '- Renda: R$ 10', '- Gastos: R$ 5', '', '| Categoria | Mês |', '|---|---|', '| Casa | R$ 1 |', '', 'Texto livre', 'continua.', '', '1. Primeira', '2. Segunda'].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Relatório' },
      { type: 'heading', level: 2, text: 'Resultado' },
      { type: 'list', ordered: false, items: ['Renda: R$ 10', 'Gastos: R$ 5'] },
      { type: 'table', header: ['Categoria', 'Mês'], rows: [['Casa', 'R$ 1']] },
      { type: 'paragraph', text: 'Texto livre continua.' },
      { type: 'list', ordered: true, items: ['Primeira', 'Segunda'] },
    ]);
  });

  it('keeps html as plain text', () => {
    expect(parseMarkdown('<script>x</script>')).toEqual([{ type: 'paragraph', text: '<script>x</script>' }]);
  });
});
