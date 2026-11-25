import type { CategoryKind } from '../core/types';
import { inTransaction, type Db } from './client';
import { categories } from './schema';

interface SeedCategory {
  name: string;
  description: string;
  children?: Array<{ name: string; description: string }>;
}

const EXPENSE: SeedCategory[] = [
  { name: 'Moradia', description: 'Aluguel, condomínio, energia, água, gás, internet e telefone' },
  {
    name: 'Alimentação',
    description: 'Comida e bebida',
    children: [
      { name: 'Mercado', description: 'Supermercado, atacado, hortifrúti e açougue' },
      { name: 'Restaurante', description: 'Refeições em restaurantes, bares e lanchonetes' },
      { name: 'Delivery', description: 'Pedidos por aplicativo, como iFood, Rappi e Zé Delivery' },
      { name: 'Padaria e café', description: 'Padarias, cafeterias e docerias' },
    ],
  },
  { name: 'Transporte', description: 'Aplicativos de corrida, combustível, estacionamento, pedágio e transporte público' },
  { name: 'Saúde', description: 'Farmácia, consultas, exames, plano de saúde e academia' },
  { name: 'Cuidados pessoais', description: 'Roupas, calçados, salão, barbearia e cosméticos' },
  { name: 'Lazer', description: 'Cinema, shows, passeios, jogos e hobbies' },
  { name: 'Assinaturas', description: 'Streaming, aplicativos e serviços recorrentes' },
  { name: 'Educação', description: 'Cursos, livros e mensalidades' },
  { name: 'Casa', description: 'Móveis, eletrodomésticos, utensílios e manutenção' },
  { name: 'Viagem', description: 'Passagens, hospedagem e aluguel de carro' },
  { name: 'Presentes e doações', description: 'Presentes, doações e vaquinhas' },
  { name: 'Impostos e tarifas', description: 'IOF, anuidade, tarifas bancárias, juros e impostos' },
  { name: 'Outros', description: 'O que não se encaixa nas demais categorias' },
];

const INCOME: SeedCategory[] = [
  { name: 'Salário', description: 'Salário de quem é CLT' },
  { name: 'Pró-labore', description: 'Pró-labore pago pelo seu PJ' },
  { name: 'Lucros do PJ', description: 'Distribuição de lucros do seu PJ' },
  { name: 'Voucher', description: 'Crédito mensal do voucher de alimentação' },
  { name: 'Outras rendas', description: 'Entradas que não se encaixam nas demais' },
];

export function seedCategories(db: Db): number {
  if (db.select({ id: categories.id }).from(categories).limit(1).all().length > 0) return 0;
  let inserted = 0;
  const groups: Array<[CategoryKind, SeedCategory[]]> = [
    ['expense', EXPENSE],
    ['income', INCOME],
  ];
  inTransaction(db, () => {
    for (const [kind, list] of groups) {
      for (const parent of list) {
        const row = db
          .insert(categories)
          .values({ name: parent.name, kind, description: parent.description, parentId: null })
          .returning({ id: categories.id })
          .get();
        inserted += 1;
        for (const child of parent.children ?? []) {
          db.insert(categories).values({ name: child.name, kind, description: child.description, parentId: row.id }).run();
          inserted += 1;
        }
      }
    }
  });
  return inserted;
}
