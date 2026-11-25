import { parseMarkdown } from '../markdown';

/** Renderiza o relatório como texto: nenhum HTML do arquivo chega à página. */
export function ReportView({ markdown }: { markdown: string }) {
  return (
    <article className="flex flex-col gap-4">
      {parseMarkdown(markdown).map((block, i) => {
        if (block.type === 'heading') {
          const Tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3';
          return (
            <Tag key={i} className={block.level === 1 ? 'text-[28px] font-bold' : block.level === 2 ? 'mt-4 text-xl font-bold' : 'text-lg font-semibold'}>
              {block.text}
            </Tag>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className={`flex flex-col gap-1 pl-5 text-[15px] ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-2">
                    {block.header.map((h, j) => (
                      <th key={j} className={`py-2 pr-3 font-medium ${j > 0 ? 'text-right' : ''}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j} className="border-b border-line">
                      {row.map((cell, k) => (
                        <td key={k} className={`py-2 pr-3 ${k > 0 ? 'num text-right whitespace-nowrap' : ''}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i} className="text-[15px] leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </article>
  );
}
