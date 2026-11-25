import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Um banco só para todos os testes: nada em paralelo.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3322', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  // O celular roda primeiro, com a fila de revisão ainda cheia; o fechamento completo roda depois, no computador.
  projects: [
    { name: 'celular', use: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
    { name: 'computador', use: { viewport: { width: 1440, height: 900 } }, dependencies: ['celular'] },
  ],
  webServer: { command: 'bash e2e/serve.sh', url: 'http://localhost:3322/login', reuseExistingServer: false, timeout: 120_000 },
});
