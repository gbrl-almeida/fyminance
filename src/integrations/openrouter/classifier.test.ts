import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  createOpenRouterClassifier,
  sanitizeResults,
  selectExamples,
  type CategoryOption,
  type ClassifyItem,
  type Example,
} from './classifier';

const items: ClassifyItem[] = [
  { id: 't1', merchantKey: 'IFOOD IFOOD', description: 'IFOOD *IFOOD', amountCents: -4590, date: '2026-10-05', accountKind: 'credit_card' },
  { id: 't2', merchantKey: 'LOJA XPTO', description: 'LOJA XPTO', amountCents: -3300, date: '2026-10-06', accountKind: 'checking' },
];
const categories: CategoryOption[] = [
  { id: 5, path: 'Alimentação > Delivery', description: 'Pedidos por aplicativo' },
  { id: 9, path: 'Outros', description: 'O resto' },
];
const uber: Example = { merchantKey: 'UBER TRIP', description: 'UBER *TRIP', categoryPath: 'Transporte' };
const ifoodMarket: Example = { merchantKey: 'IFOOD MERCADO', description: 'IFOOD MERCADO', categoryPath: 'Alimentação > Mercado' };

describe('selectExamples', () => {
  it('puts merchants that share words with the batch first', () => {
    expect(selectExamples(items, [uber, ifoodMarket], 1)).toEqual([ifoodMarket]);
    expect(selectExamples(items, [uber, ifoodMarket])).toEqual([ifoodMarket, uber]);
  });
});

describe('buildPrompt', () => {
  it('lists categories, examples and transactions', () => {
    const prompt = buildPrompt(items, categories, [uber]);
    expect(prompt).toContain('5: Alimentação > Delivery (Pedidos por aplicativo)');
    expect(prompt).toContain('- "UBER *TRIP" → Transporte');
    expect(prompt).toContain('- id=t1 | 2026-10-05 | cartão | saída R$ 45,90 | IFOOD *IFOOD');
    expect(prompt).toContain('- id=t2 | 2026-10-06 | conta | saída R$ 33,00 | LOJA XPTO');
  });

  it('passes along what the bank says about the merchant', () => {
    const hinted = [{ ...items[1]!, bankHint: 'categoria do banco: Groceries' }];
    expect(buildPrompt(hinted, categories, [])).toContain('- id=t2 | 2026-10-06 | conta | saída R$ 33,00 | LOJA XPTO | categoria do banco: Groceries');
  });

  it('passes along the note the couple wrote, before what the bank says', () => {
    const noted = [{ ...items[1]!, note: 'creatina e pré-treino', bankHint: 'categoria do banco: Groceries' }];
    expect(buildPrompt(noted, categories, [])).toContain('- id=t2 | 2026-10-06 | conta | saída R$ 33,00 | LOJA XPTO | anotação do casal: creatina e pré-treino | categoria do banco: Groceries');
  });

  it('omits the examples section when there are none', () => {
    expect(buildPrompt(items, categories, [])).not.toContain('Exemplos');
  });
});

describe('sanitizeResults', () => {
  it('keeps one valid answer per known transaction', () => {
    const output = {
      results: [
        { id: 't1', categoryId: 5, confidence: 'high' as const },
        { id: 't1', categoryId: 9, confidence: 'low' as const },
        { id: 't2', categoryId: null, confidence: 'low' as const },
        { id: 'ghost', categoryId: 5, confidence: 'high' as const },
        { id: 't2', categoryId: 777, confidence: 'high' as const },
      ],
    };
    expect(sanitizeResults(output, items, categories)).toEqual([{ id: 't1', categoryId: 5, confidence: 'high' }]);
  });
});

describe('createOpenRouterClassifier', () => {
  it('sends the prompt and reports usage', async () => {
    const prompts: string[] = [];
    const classifier = createOpenRouterClassifier({ apiKey: 'k', model: 'cheap/model' }, async (prompt) => {
      prompts.push(prompt);
      return { output: { results: [{ id: 't2', categoryId: 9, confidence: 'medium' }] }, totalTokens: 321, costUsd: 0.0004 };
    });
    const run = await classifier.classify(items, categories, []);
    expect(classifier.model).toBe('cheap/model');
    expect(run).toEqual({
      results: [{ id: 't2', categoryId: 9, confidence: 'medium' }],
      model: 'cheap/model',
      totalTokens: 321,
      costUsd: 0.0004,
    });
    expect(prompts[0]).toContain('id=t2');
  });
});
