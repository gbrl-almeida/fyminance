import type { Owner } from './core/types';

// Os nomes vêm do .env na hora do build (NEXT_PUBLIC_*): trocar um nome pede um novo `pnpm web:build`.
export const OWNER_LABEL: Record<Owner, string> = {
  casal: 'Casal',
  pessoa1: process.env.NEXT_PUBLIC_NOME_PESSOA1?.trim() || 'Pessoa 1',
  pessoa2: process.env.NEXT_PUBLIC_NOME_PESSOA2?.trim() || 'Pessoa 2',
};
