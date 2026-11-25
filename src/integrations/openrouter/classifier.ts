import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { formatBRL } from '../../core/money';
import type { Confidence } from '../../core/types';

export interface ClassifyItem {
  id: string;
  merchantKey: string;
  description: string;
  amountCents: number;
  date: string;
  accountKind: 'checking' | 'credit_card';
  /** O que o banco diz da loja: categoria e empresa registrada. */
  bankHint?: string | null;
  /** O que o casal anotou sobre a compra. */
  note?: string | null;
}

export interface CategoryOption {
  id: number;
  path: string;
  description: string;
}

export interface Example {
  merchantKey: string;
  description: string;
  categoryPath: string;
}

export interface ClassifyResult {
  id: string;
  categoryId: number;
  confidence: Confidence;
}

export interface ClassifierRun {
  results: ClassifyResult[];
  model: string;
  totalTokens: number;
  costUsd: number | null;
}

export interface Classifier {
  readonly model: string;
  classify(
    items: readonly ClassifyItem[],
    categories: readonly CategoryOption[],
    examples: readonly Example[],
  ): Promise<ClassifierRun>;
}

export const ModelOutputSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      categoryId: z.number().int().nullable(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type GenerateFn = (prompt: string) => Promise<{ output: ModelOutput; totalTokens: number; costUsd: number | null }>;

export function selectExamples(items: readonly ClassifyItem[], pool: readonly Example[], limit = 30): Example[] {
  const tokens = new Set(items.flatMap((item) => item.merchantKey.split(' ')));
  return pool
    .map((example, index) => ({
      example,
      index,
      score: example.merchantKey.split(' ').filter((token) => tokens.has(token)).length,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((scored) => scored.example);
}

export function buildPrompt(
  items: readonly ClassifyItem[],
  categories: readonly CategoryOption[],
  examples: readonly Example[],
): string {
  const lines = [
    'Você classifica transações financeiras de um casal brasileiro.',
    'Para cada transação, escolha o id de uma categoria da lista. Prefira a subcategoria mais específica quando houver.',
    'Use categoryId null quando nenhuma categoria servir.',
    'Confiança: "high" quando o estabelecimento deixa a categoria inequívoca, "medium" quando é provável, "low" quando é um palpite.',
    'Devolva um resultado para cada id recebido, sem inventar ids.',
    'Algumas transações trazem o que o banco diz da loja (categoria do banco e empresa registrada, com o CNAE). Use como pista; a categoria final é da lista do casal.',
    'A anotação do casal, quando houver, diz o que foi comprado e vale mais que as outras pistas.',
    '',
    'Categorias (id: caminho (descrição)):',
    ...categories.map((c) => `${c.id}: ${c.path} (${c.description})`),
  ];
  if (examples.length > 0) {
    lines.push('', 'Exemplos já confirmados pelo casal:', ...examples.map((e) => `- "${e.description}" → ${e.categoryPath}`));
  }
  lines.push(
    '',
    'Transações:',
    ...items.map((item) => {
      const account = item.accountKind === 'credit_card' ? 'cartão' : 'conta';
      const direction = item.amountCents < 0 ? 'saída' : 'entrada';
      const note = item.note ? ` | anotação do casal: ${item.note}` : '';
      const hint = item.bankHint ? ` | ${item.bankHint}` : '';
      return `- id=${item.id} | ${item.date} | ${account} | ${direction} ${formatBRL(Math.abs(item.amountCents))} | ${item.description}${note}${hint}`;
    }),
  );
  return lines.join('\n');
}

export function sanitizeResults(
  output: ModelOutput,
  items: readonly ClassifyItem[],
  categories: readonly CategoryOption[],
): ClassifyResult[] {
  const itemIds = new Set(items.map((item) => item.id));
  const categoryIds = new Set(categories.map((category) => category.id));
  const seen = new Set<string>();
  const results: ClassifyResult[] = [];
  for (const result of output.results) {
    if (!itemIds.has(result.id) || seen.has(result.id)) continue;
    if (result.categoryId === null || !categoryIds.has(result.categoryId)) continue;
    seen.add(result.id);
    results.push({ id: result.id, categoryId: result.categoryId, confidence: result.confidence });
  }
  return results;
}

function openRouterGenerate(config: { apiKey: string; model: string }): GenerateFn {
  const openrouter = createOpenRouter({ apiKey: config.apiKey });
  return async (prompt) => {
    const result = await generateText({
      model: openrouter(config.model, { usage: { include: true } }),
      output: Output.object({ schema: ModelOutputSchema }),
      prompt,
      temperature: 0,
    });
    const usage = (result.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined)?.usage;
    return { output: result.output, totalTokens: result.usage.totalTokens ?? 0, costUsd: usage?.cost ?? null };
  };
}

export function createOpenRouterClassifier(config: { apiKey: string; model: string }, generate?: GenerateFn): Classifier {
  const run = generate ?? openRouterGenerate(config);
  return {
    model: config.model,
    async classify(items, categories, examples) {
      const { output, totalTokens, costUsd } = await run(buildPrompt(items, categories, examples));
      return { results: sanitizeResults(output, items, categories), model: config.model, totalTokens, costUsd };
    },
  };
}
