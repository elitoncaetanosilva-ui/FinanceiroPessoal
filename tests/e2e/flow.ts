/**
 * Fluxo real da seção 48 no navegador (celular 390px):
 *   login → importar extrato (cadastrar conta pelo arquivo) → usar saldo do arquivo → confirmar
 *   → importar fatura Itaú (cadastrar cartão) → importar Nubank → classificar pendentes
 *   → migrar planilha → movimentos → cartão → orçamento → dashboard; depois as mesmas telas no notebook.
 * Usa os arquivos de tests/fixtures/real/ (fora do git). Uso: npx tsx tests/e2e/flow.ts
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const REAL = path.join(process.cwd(), 'tests/fixtures/real');
const OUT = path.join(process.cwd(), 'tests/e2e/screens');
const problems: string[] = [];
let shot = 0;

async function snap(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const vp = page.viewportSize()!;
  const file = path.join(OUT, `flow-${String(++shot).padStart(2, '0')}-${vp.width}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  ✓ ${name} (${vp.width}px)${overflow > 1 ? `  ⚠ scroll horizontal ${overflow}px` : ''}`);
  if (overflow > 1) problems.push(`${name} @${vp.width}: scroll horizontal ${overflow}px`);
}

async function upload(page: Page, file: string) {
  await page.goto(BASE + '/importacoes');
  await page.setInputFiles('input[type=file]', path.join(REAL, file));
  await Promise.all([page.waitForURL(/\/importacoes\/[0-9a-f-]{36}/, { timeout: 60000 }), page.click('button[type=submit]')]);
}

async function confirmImport(page: Page) {
  await page.getByRole('button', { name: /^Confirmar:/ }).click();
  await page.waitForURL(/confirmado=1/, { timeout: 60000 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Download the React DevTools/.test(m.text())) problems.push('console: ' + m.text()); });

  const only = process.env.FROM_STEP ? Number(process.env.FROM_STEP) : 1;
  console.log('1. login');
  await page.goto(BASE + '/login');
  await snap(page, 'login');
  await page.fill('input[name=email]', process.env.E2E_EMAIL || 'dev@local');
  await page.fill('input[name=password]', process.env.E2E_PASSWORD || 'dev-password-123');
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  await snap(page, 'inicio-vazio');

  if (only <= 2) {
  console.log('2. importar extrato Itaú');
  await upload(page, 'Extrato_Conta_Corrente-250920262155.xls');
  await snap(page, 'extrato-sem-conta');
  await page.getByRole('link', { name: /Cadastrar esta conta/ }).click();
  await page.waitForURL(/\/contas\/nova/);
  await snap(page, 'conta-prefill');
  await Promise.all([page.waitForURL(/\/importacoes\//, { timeout: 60000 }), page.getByRole('button', { name: 'Salvar' }).click()]);
  await snap(page, 'extrato-previa');
  await confirmImport(page);
  await snap(page, 'extrato-confirmado');

  console.log('3. importar fatura Itaú');
  await upload(page, 'fatura-aberta-final_5850-outubro2026.xlsx');
  await page.getByRole('link', { name: /Cadastrar este cartão/ }).click();
  await page.waitForURL(/\/cartoes\/novo/);
  await page.fill('input[name=closing_day]', '30');
  await page.fill('input[name=limit]', '20000,00');
  await snap(page, 'cartao-prefill');
  await Promise.all([page.waitForURL(/\/importacoes\//, { timeout: 60000 }), page.getByRole('button', { name: 'Salvar' }).click()]);
  await snap(page, 'fatura-previa');
  await confirmImport(page);

  console.log('4. importar Nubank');
  await upload(page, 'Nubank_2026-10-27.csv');
  await page.getByRole('link', { name: /Cadastrar este cartão/ }).click();
  await page.waitForURL(/\/cartoes\/novo/);
  await page.fill('input[name=closing_day]', '20');
  await page.fill('input[name=due_day]', '27');
  await page.fill('input[name=limit]', '5000,00');
  await Promise.all([page.waitForURL(/\/importacoes\//, { timeout: 60000 }), page.getByRole('button', { name: 'Salvar' }).click()]);
  await snap(page, 'nubank-previa');
  await confirmImport(page);

  console.log('5. reimportar o extrato (não pode duplicar)');
  await upload(page, 'Extrato_Conta_Corrente-250920262155.xls');
  await snap(page, 'extrato-reimportado');
  const dupText = await page.textContent('body');
  if (!/já foi importado/i.test(dupText ?? '')) problems.push('reimportação: aviso de arquivo repetido não apareceu');
  await confirmImport(page);

  console.log('6. classificar pendentes');
  await page.goto(BASE + '/pendentes');
  await snap(page, 'pendentes');
  const chip = page.locator('button.rounded-full.bg-surface-2').first();
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1500); }
  await page.getByRole('button', { name: /Agrupados/ }).click();
  await snap(page, 'pendentes-agrupados');

  if (fs.existsSync(path.join(REAL, 'CAIXA_2026.xlsx'))) {
    console.log('7. migrar planilha');
    await page.goto(BASE + '/configuracoes/planilha');
    await page.setInputFiles('input[type=file]', path.join(REAL, 'CAIXA_2026.xlsx'));
    await Promise.all([page.waitForURL(/lote=/, { timeout: 60000 }), page.getByRole('button', { name: 'Ler planilha' }).click()]);
    await snap(page, 'planilha-previa');
    await page.getByRole('button', { name: 'Aplicar migração' }).click();
    await page.getByText(/Migração concluída/).first().waitFor({ timeout: 120000 });
    await snap(page, 'planilha-aplicada');
  }

  }
  console.log('8. telas principais (celular)');
  const cardHref = await (async () => { await page.goto(BASE + '/cartoes'); return page.locator('a[href^="/cartoes/"]:not([href="/cartoes/novo"])').first().getAttribute('href'); })();
  const screens = ['/', '/movimentos', '/movimentos?mes=2026-08', '/movimentos/novo?tipo=cartao', '/cartoes', cardHref ?? '/cartoes', '/orcamento', '/orcamento?mes=2026-08', '/orcamento/editar?ano=2026', '/projecao', '/analises', '/contas', '/importacoes', '/recorrencias/nova', '/cadastros/categorias', '/mais', '/configuracoes'];
  for (const s of screens) { await page.goto(BASE + s); await snap(page, s.replace(/[/?=&]+/g, '_') || 'home'); }
  await page.goto(BASE + '/movimentos');
  await page.locator('a[href^="/movimentos/"]').filter({ hasNotText: 'Novo' }).nth(2).click();
  await page.waitForURL(/\/movimentos\/[0-9a-f-]{36}/);
  await snap(page, 'movimento-detalhe');

  console.log('9. notebook (1366px)');
  await page.setViewportSize({ width: 1366, height: 860 });
  for (const s of ['/', '/movimentos', cardHref ?? '/cartoes', '/orcamento', '/orcamento/editar?ano=2026', '/analises', '/projecao', '/pendentes']) { await page.goto(BASE + s); await snap(page, 'desk' + (s.replace(/[/?=&]+/g, '_') || 'home')); }

  await browser.close();
  if (problems.length) { console.log('\nPROBLEMAS:\n- ' + [...new Set(problems)].join('\n- ')); process.exitCode = 1; }
  else console.log('\nFluxo completo sem problemas.');
})().catch(e => { console.error(e); process.exit(1); });
