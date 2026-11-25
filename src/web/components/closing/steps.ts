export const CLOSING_STEPS = [
  { slug: 'dados', label: 'Dados atualizados', key: 'data' },
  { slug: 'conciliacao', label: 'Conciliação', key: 'reconciliation' },
  { slug: 'metas', label: 'Categorias e metas', key: 'goals' },
  { slug: 'investimentos', label: 'Investimentos', key: 'investments' },
] as const;

export type StepSlug = (typeof CLOSING_STEPS)[number]['slug'];
