export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** Markdown simples dos relatórios em blocos; nada vira HTML, o texto é renderizado como texto. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({ type: 'heading', level: (heading[1] as string).length as 1 | 2 | 3, text: (heading[2] as string).trim() });
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        const row = lines[i] as string;
        if (!/^\s*\|?\s*:?-{3,}/.test(row)) rows.push(cells(row));
        i += 1;
      }
      blocks.push({ type: 'table', header: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    const bullet = /^\s*(-|\*|\d+\.)\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i] as string)) {
        items.push((lines[i] as string).replace(bullet, '').trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() !== '' && !/^(#{1,3}\s|\s*\||\s*(-|\*|\d+\.)\s)/.test(lines[i] as string)) {
      paragraph.push((lines[i] as string).trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}
