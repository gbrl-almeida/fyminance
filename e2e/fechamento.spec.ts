import { expect, test, type Page } from '@playwright/test';

/** Mês que o banco de demonstração deixa para fechar: o anterior ao de hoje, em São Paulo. */
function closingMonth(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
  const [year, month] = today.split('-').map(Number) as [number, number];
  const index = year * 12 + month - 2;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

async function login(page: Page, who: 'Pessoa 1' | 'Pessoa 2') {
  await page.goto('/login');
  await page.getByText(who, { exact: true }).click();
  await page.getByLabel('Senha').fill('demo-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

const month = closingMonth();
const nextMonth = (() => {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
})();

test('login and dashboard', async ({ page }) => {
  await login(page, 'Pessoa 2');
  await expect(page.getByText(/Sobrou em|Faltou em/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Para onde foi o dinheiro' })).toBeVisible();
});

test('icons load on the login page', async ({ page, request }) => {
  await page.goto('/login');
  for (const rel of ['icon', 'apple-touch-icon']) {
    const href = await page.locator(`link[rel="${rel}"]`).first().getAttribute('href');
    expect(href, rel).not.toBeNull();
    expect((await request.get(href as string)).ok(), rel).toBe(true);
  }
});

test('expired session returns to the same page', async ({ page, context }) => {
  await login(page, 'Pessoa 1');
  await context.clearCookies();
  await page.goto(`/fechamento/${month}/metas`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByText('Pessoa 1', { exact: true }).click();
  await page.getByLabel('Senha').fill('demo-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`/fechamento/${month}/metas$`));
});

test('no horizontal scroll on phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'só no celular');
  await login(page, 'Pessoa 2');
  await page.goto(`/fechamento/${month}/conciliacao`);
  await expect(page.locator('li', { hasText: 'PIX ENVIADO MARIA S' })).toBeVisible();
  for (const path of ['/', `/fechamento/${month}/dados?busca=amazon`, `/fechamento/${month}/conciliacao`, `/fechamento/${month}/metas`, `/fechamento/${month}/investimentos`, '/importar']) {
    await page.goto(path);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, path).toBeLessThanOrEqual(360);
  }
});

test('search on the data step finds what arrived from the banks', async ({ page }) => {
  await login(page, 'Pessoa 1');
  await page.goto(`/fechamento/${month}/dados`);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('amazon');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(/busca=amazon/);
  await expect(page.locator('li', { hasText: 'AMAZON MKTPLACE' }).first()).toBeVisible();
  await expect(page.getByText(/a revisar: /).first()).toBeVisible();
});

test('entry page notes and splits a purchase', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'altera o banco; roda uma vez');
  await login(page, 'Pessoa 1');
  await page.goto(`/fechamento/${month}/dados?busca=supermercado`);
  await page.getByRole('link', { name: 'SUPERMERCADO BOM PRECO' }).first().click();
  await expect(page).toHaveURL(/\/lancamento\//);
  await page.getByLabel('Anotação').fill('compras do mês e uma panela');
  await page.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(page.getByText('Anotação salva.')).toBeVisible();

  await page.getByRole('button', { name: 'Dividir em categorias' }).click();
  await page.getByLabel('Valor da parte 1').fill('50,00');
  await page.locator('li', { has: page.getByLabel('Valor da parte 2') }).getByLabel('Categoria').selectOption({ label: 'Casa' });
  await page.getByRole('button', { name: 'Salvar divisão' }).click();
  await expect(page.getByText('Compra dividida.')).toBeVisible();
  await expect(page.getByText('Dividida em 2 partes')).toBeVisible();

  await page.goto(`/fechamento/${month}/dados?busca=panela`);
  await expect(page.getByText('compras do mês e uma panela').first()).toBeVisible();
});

test('long description shows in full on tap', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'só no celular, com a fila de revisão cheia');
  await login(page, 'Pessoa 1');
  await page.goto(`/fechamento/${month}/conciliacao`);
  const name = page.getByRole('button', { name: 'MP *LOJAOBRASIL ELETRODOMESTICOS' });
  const isCut = () => name.evaluate((el) => el.scrollWidth > el.clientWidth);
  await expect(name).toHaveAttribute('title', 'MP *LOJAOBRASIL ELETRODOMESTICOS');
  expect(await isCut()).toBe(true);
  await name.click();
  expect(await isCut()).toBe(false);
  await name.click();
  expect(await isCut()).toBe(true);
});

test('full closing', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'o fechamento altera o banco; roda uma vez');
  await login(page, 'Pessoa 2');
  await page.goto('/');
  await page.getByRole('link', { name: /Continuar fechamento/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/fechamento/${month}/conciliacao$`));

  // A busca filtra a revisão.
  const review = page.locator('li', { hasText: 'PG *BISTRO DA VILA' });
  await page.getByRole('searchbox', { name: 'Buscar' }).first().fill('amazon');
  await expect(review).toBeHidden();
  await expect(page.locator('li', { hasText: 'AMAZON MKTPLACE' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar' }).first().fill('');

  // Trocar a categoria salva a linha na hora, e ela sai do "confirmar todas".
  await review.getByLabel('Categoria').selectOption({ label: 'Lazer' });
  await expect(review.getByRole('button', { name: 'Salvo' })).toBeVisible();
  await page.getByRole('button', { name: /Confirmar 1 sugestão/ }).click();
  await expect(page.getByText('1 sugestão confirmada.')).toBeVisible();
  await expect(review).toBeVisible();
  for (const [desc, category] of [
    ['PIX ENVIADO MARIA S', 'Presentes e doações'],
    ['AMAZON MKTPLACE', 'Casa'],
  ] as const) {
    const row = page.locator('li', { hasText: desc });
    await row.getByLabel('Categoria').selectOption({ label: category });
    await expect(row.getByRole('button', { name: 'Salvo' })).toBeVisible();
  }
  // Estorno: a linha mostra a compra encontrada e abate num toque.
  const refund = page.locator('li', { hasText: 'Refund' });
  await expect(refund.getByText('BUS SERVICOS*CLICKBUS')).toBeVisible();
  await refund.getByRole('button', { name: 'É estorno' }).click();
  await expect(page.getByText(/Abatido R\$\s420,00/)).toBeVisible();
  // O que foi salvo continua salvo depois de recarregar.
  await page.reload();
  await expect(page.getByText('Nada para revisar neste mês.')).toBeVisible();

  const bill = page.locator('li', { hasText: 'Fatura do' });
  await bill.getByRole('button', { name: /Conferi, está certo/ }).click();
  await bill.getByPlaceholder(/Nota/).fill('IOF de compra internacional');
  await bill.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText(/Conferida por Pessoa 2/)).toBeVisible();

  const flash = page.locator('form', { has: page.getByLabel('Gasto do vale-alimentação no mês') });
  await flash.getByLabel('Gasto do vale-alimentação no mês').fill('1.250,00');
  await flash.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: 'Nada este mês' }).click();
  await page.getByRole('link', { name: /Concluir conciliação/ }).click();
  await expect(page).toHaveURL(new RegExp(`/fechamento/${month}/metas$`));

  await page.getByRole('button', { name: 'Anotar mudança' }).click();
  await page.getByLabel('Título da anotação').fill('Viagem para Floripa');
  await page.locator('form').getByLabel('Categoria').selectOption({ label: 'Viagem' });
  await page.getByLabel('Valor da mudança').fill('2.250,00');
  await page.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(page.getByText('Pessoa 2 anotou')).toBeVisible();
  // A anotação entra na meta: média de Viagem (R$ 1.000) mais R$ 2.250.
  await expect(page.getByLabel('Meta de Viagem')).toHaveValue('3.250,00');
  await page.getByRole('button', { name: /Salvar metas/ }).click();
  await expect(page).toHaveURL(new RegExp(`/fechamento/${month}/investimentos$`));
  await expect(page.getByRole('heading', { name: 'Rendimento dos resgates' })).toBeVisible();
  await expect(page.getByText(/resgatado em/)).toBeVisible();

  // A meta de aporte digitada vale ao fechar, mesmo sem salvar à parte.
  await page.getByLabel(/Meta de aporte de/).fill('3.000,00');
  await page.getByRole('button', { name: /^Fechar / }).click();
  await expect(page).toHaveURL(new RegExp(`/relatorios/${month}$`));
  await expect(page.getByRole('heading', { name: /Relatório de/ })).toBeVisible();
  await expect(page.getByText(/IOF de compra internacional/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByText(/Fechamento de/)).toHaveCount(0);
  await page.goto(`/fechamento/${nextMonth}/investimentos`);
  await expect(page.getByText(/de R\$ 3\.000,00/)).toBeVisible();
});

test('invalid session is refused on client navigation', async ({ page, context }) => {
  await login(page, 'Pessoa 1');
  await context.addCookies([{ name: 'fy_session', value: 'sessao-invalida', domain: 'localhost', path: '/' }]);
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page).toHaveURL(/\/login/);
});
