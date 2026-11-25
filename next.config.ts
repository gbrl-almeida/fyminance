import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 é nativo: fica fora do bundle do servidor.
  serverExternalPackages: ['better-sqlite3'],
  // O gate de tipos é `pnpm typecheck` (TypeScript 7); o build do Next não checa tipos.
  typescript: { ignoreBuildErrors: true },
};

export default config;
