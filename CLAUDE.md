# Fyminance

App de finanças da casa: duas pessoas (`pessoa1`, `pessoa2`) e o que é dos dois (`casal`). Como rodar está no `README.md`.

## Comandos

- `pnpm test`: testes (Vitest)
- `pnpm typecheck`: checagem de tipos
- `pnpm test:e2e`: build e teste de ponta a ponta (Playwright, banco de demonstração)
- `pnpm fy <comando>`: CLI (`migrate`, `sync`, `reprocess`, `status`, `backup run`, `backup restore`, `eval-models`, `user set-password`, `accounts list|investment|window`, `import`, `demo`)
- `pnpm db:generate`: gera migração a partir de `src/db/schema.ts`
- `pnpm web:dev` / `pnpm web:build` / `pnpm web:start`: app web (porta 3210)

## Regras do código

- Valores em centavos, como inteiros. Datas `AAAA-MM-DD` no fuso `America/Sao_Paulo`.
- `src/core/` é lógica pura: não importa de `db`, `integrations`, `jobs`, `queries`, `curation`, `mcp` nem `web`.
- O app (`src/app/`, `src/web/`) é adaptador: lê por `src/queries/`, grava por `src/curation/` com o autor (`actor`) da sessão.
- Identificadores em inglês; textos para o usuário em português.
- Testes antes do código. Dados de teste são inventados: nenhum dado financeiro real entra no git.
- O banco fica em `FYMINANCE_DATA_DIR` (padrão `~/.local/share/fyminance/`), fora do repositório.
- Classificação manual nunca é sobrescrita por sync, reprocessamento ou regra.
- Leitor de fatura novo: siga `src/integrations/files/c6.ts` e registre em `src/integrations/files/statement.ts`.
