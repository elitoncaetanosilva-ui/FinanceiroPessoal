/**
 * Capturas de tela das principais telas em largura de celular (390px) e notebook (1366px).
 * Uso: BASE_URL=http://localhost:3100 E2E_EMAIL=dev@local E2E_PASSWORD=dev-password-123 npm run e2e -- /,/movimentos
 * Também falha se houver scroll horizontal na página (conteúdo cortado no celular).
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const OUT = path.join(process.cwd(), 'tests/e2e/screens');
const paths = (process.argv[2] || '/').split(',');

async function login(page: Page) {
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', process.env.E2E_EMAIL || 'dev@local');
  await page.fill('input[name=password]', process.env.E2E_PASSWORD || 'dev-password-123');
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type=submit]')]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const problems: string[] = [];
  for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 800 }]] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await login(page);
    for (const p of paths) {
      const resp = await page.goto(BASE + p, { waitUntil: 'networkidle' });
      const status = resp?.status();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = path.join(OUT, `${name}${p.replace(/[/?=&]+/g, '_') || '_root'}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const line = `${name} ${p} → HTTP ${status}${overflow > 1 ? ` · SCROLL HORIZONTAL ${overflow}px` : ''}`;
      console.log(line);
      if ((status ?? 500) >= 400 || overflow > 1) problems.push(line);
    }
    if (errors.length) { console.log(`[${name}] erros no navegador:\n  ` + errors.slice(0, 10).join('\n  ')); problems.push(...errors.map(e => `${name}: ${e}`)); }
    await ctx.close();
  }
  await browser.close();
  if (problems.length) { console.log('\nPROBLEMAS:\n' + problems.join('\n')); process.exitCode = 1; }
})();
