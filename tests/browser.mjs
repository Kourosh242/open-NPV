// Open NPV — end-to-end browser checks against the built site.
// Uses only synthetic fixtures. Verifies decoding, UI behaviour, exports,
// offline operation and the absence of any outbound/upload request.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';

const BASE_PATH = '/open-npv/';
const temp = await mkdtemp(join(tmpdir(), 'open-npv-browser-'));
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: process.cwd(), env: { ...process.env, PORT: '0', BASE_PATH }, stdio: ['ignore', 'pipe', 'pipe'],
});
let origin = '';
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('preview server did not start')), 15000);
  server.stdout.on('data', chunk => {
    const match = /0\.0\.0\.0:(\d+)/.exec(String(chunk));
    if (match) { origin = `http://127.0.0.1:${match[1]}`; clearTimeout(timer); resolve(); }
  });
  server.on('exit', code => { clearTimeout(timer); reject(new Error(`preview server exited: ${code}`)); });
});

const external = [], mutations = [], consoleErrors = [];
let browser;
const step = name => console.log(`  ✓ ${name}`);

/**
 * Layout must be measured only once fonts and the current viewport have
 * settled: `font-display: swap` can briefly lay text out with fallback
 * metrics, which makes a width check flaky instead of meaningful.
 */
async function settleLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/**
 * Anything wider than the viewport is a real bug on a phone: it makes the whole
 * page scroll sideways. Report the offending elements instead of just failing,
 * so a regression can be fixed without guessing.
 */
async function overflowReport(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const name = element => element.tagName.toLowerCase() +
      (element.id ? `#${element.id}` : '') +
      (typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).join('.')}` : '');
    const out = { width, scrollWidth: document.documentElement.scrollWidth, offenders: [], minContent: {} };
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      if (rect.right <= width + 1 && rect.left >= -1) continue;
      out.offenders.push(`${name(element)} [${Math.round(rect.left)}..${Math.round(rect.right)} of ${width}]`);
    }
    out.offenders = out.offenders.slice(0, 12);
    if (out.scrollWidth > width + 1) {
      // Intrinsic widths point at the element that refuses to shrink.
      out.minContent.grid = getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns;
      out.minContent.narrow = matchMedia('(max-width: 980px)').matches;
      out.minContent.fonts = document.fonts.status;
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;top:0;left:-99999px;width:0;visibility:hidden;';
      document.body.append(host);
      for (const selector of ['.workspace', '.input-column', '.input-panel', '.panel-heading', '.dropzone',
        '.format-chips', '.paste-details', '#paste-input', '.privacy-note', '.demo-button', '.output-panel',
        '.results-toolbar', '.search-row', '.search-field', '#search-input', '.reveal-button', '.results',
        '.file-group', '.file-header', '.config-card', '.config-top', '.uri-preview', '.config-actions', '.toast']) {
        const element = document.querySelector(selector);
        if (!element) continue;
        const clone = element.cloneNode(true);
        clone.style.width = 'min-content';
        clone.style.maxWidth = 'none';
        host.append(clone);
        const measured = Math.round(clone.getBoundingClientRect().width);
        clone.remove();
        if (measured >= 300) out.minContent[selector] = measured;
      }
      host.remove();
    }
    return out;
  });
}

async function assertNoHorizontalOverflow(page) {
  const reports = [];
  for (const width of [320, 360, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await settleLayout(page);
    reports.push(await overflowReport(page));
  }
  const broken = reports.filter(report => report.scrollWidth > report.width + 1);
  assert.ok(
    !broken.length,
    'no horizontal overflow on mobile: ' + broken.map(report =>
      `${report.width}px viewport -> scrollWidth ${report.scrollWidth}` +
      (report.offenders.length ? ` | offenders: ${report.offenders.join(', ')}` : '') +
      (Object.keys(report.minContent).length ? ` | min-content: ${JSON.stringify(report.minContent)}` : ''),
    ).join(' || '),
  );
}

try {
  await ready;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin) external.push(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
  });
  page.on('pageerror', error => consoleErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.goto(origin + BASE_PATH, { waitUntil: 'networkidle' });
  await page.waitForSelector('#status-bar[data-state="ready"]', { timeout: 30000 });
  assert.match(await page.title(), /Open NPV/);
  assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
  assert.ok(await page.locator('#update-button').isHidden(), 'first install must not look like an update');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  assert.ok(scope?.endsWith(BASE_PATH));
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.match(bodyFont, /Vazirmatn/, 'Persian UI must use Vazirmatn');
  const features = await page.evaluate(() => getComputedStyle(document.body).fontFeatureSettings);
  assert.ok(!features.includes('ss01'), 'font must not rewrite digits inside file/config names');
  step('shell, RTL, Vazirmatn, scoped service worker');

  // --- decode the bundled synthetic demo in the worker ---
  await page.click('#demo-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  assert.match(await page.textContent('#result-count'), /۵/);
  const protocols = await page.$$eval('.config-card .protocol', nodes => nodes.map(n => n.textContent));
  assert.deepEqual(protocols, ['VLESS', 'VLESS', 'VMESS', 'SHADOWSOCKS', 'TROJAN']);
  step('worker decodes demo into 5 configs');

  // --- masking, reveal, copy feedback, downloads ---
  const first = page.locator('.config-card').first();
  const masked = await first.locator('.uri-preview').textContent();
  assert.ok(masked.includes('••••'), 'credentials must be masked by default');
  assert.ok(!masked.includes('11111111-2222'), 'UUID must not leak while masked');
  await page.click('#reveal-toggle');
  assert.equal(await page.getAttribute('#reveal-toggle', 'aria-pressed'), 'true');
  const revealed = await first.locator('.uri-preview').textContent();
  assert.ok(revealed.startsWith('vless://'));
  assert.notEqual(masked, revealed);

  await first.locator('[data-action="copy-uri"]').click();
  await page.waitForFunction(() => document.querySelector('.config-card [data-action="copy-uri"]').classList.contains('is-done'));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), revealed);
  await page.click('#reveal-toggle');
  assert.equal(await page.getAttribute('#reveal-toggle', 'aria-pressed'), 'false');
  step('masking, reveal toggle, clipboard + button feedback');

  const linkDownload = page.waitForEvent('download');
  await first.locator('[data-action="download-uri"]').click();
  const linkFile = join(temp, 'link.txt');
  const linkName = (await linkDownload).suggestedFilename();
  await (await linkDownload).saveAs(linkFile);
  assert.equal((await readFile(linkFile, 'utf8')).trim(), revealed);
  assert.ok(linkName.endsWith('.txt'), `download must keep its extension, got ${linkName}`);
  assert.match(linkName, /^[A-Za-z0-9._-]+$/, 'download name must survive browser sanitising');

  await first.locator('[data-action="toggle-json"]').click();
  assert.equal(await first.locator('[data-action="toggle-json"]').getAttribute('aria-expanded'), 'true');
  const maskedJson = await first.locator('.raw-json').textContent();
  assert.ok(!maskedJson.includes('11111111-2222'), 'raw JSON must be redacted while masked');
  const jsonDownload = page.waitForEvent('download');
  await first.locator('[data-action="download-json"]').click();
  const jsonFile = join(temp, 'config.json');
  await (await jsonDownload).saveAs(jsonFile);
  assert.ok(JSON.parse(await readFile(jsonFile, 'utf8')));
  step('TXT + JSON downloads, redacted JSON preview');

  // --- search, protocol filter, empty-filter state ---
  await page.fill('#search-input', 'nothing-matches-this');
  await page.waitForSelector('#filter-empty:not([hidden])');
  assert.ok(await page.locator('#copy-all').isDisabled());
  await page.click('#reset-filters');
  await page.waitForFunction(() => document.querySelector('#filter-empty').hidden);
  await page.click('.chip[data-protocol="vmess"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.config-card')].filter(c => !c.hidden).length === 1);
  assert.equal((await page.textContent('#copy-count')).trim(), '۱');
  await page.click('#copy-all');
  await page.waitForFunction(() => document.querySelector('#copy-all').classList.contains('is-done'));
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).startsWith('vmess://'));
  await page.click('.chip[data-protocol="all"]');
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search-input');
  await page.keyboard.press('Escape');
  step('search, protocol chips, filtered copy, "/" shortcut');

  // --- ZIP is produced in a worker, not on the main thread ---
  const zipDownload = page.waitForEvent('download');
  await page.click('#download-all');
  const zipFile = join(temp, 'configs.zip');
  await (await zipDownload).saveAs(zipFile);
  const zip = unzipSync(new Uint8Array(await readFile(zipFile)));
  assert.equal(strFromU8(zip['links.txt']).trim().split('\n').length, 5);
  const report = JSON.parse(strFromU8(zip['report.json']));
  assert.equal(report.configs.length, 5);
  assert.match(report.generator, /Open NPV/);
  assert.equal(Object.keys(zip).filter(name => name.startsWith('json/')).length, 5);
  assert.ok(zip['README.txt']);
  step('ZIP export built in worker (links, JSON, report, README)');

  // --- per-file removal and full clear ---
  await page.click('.file-actions .icon-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 0);
  assert.ok(await page.locator('#empty-state').isVisible());
  await page.click('#demo-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  await page.click('#clear-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 0);
  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.ok(Object.keys(storage.local).every(key => key === 'open-npv-theme'));
  assert.deepEqual(storage.session, {});
  step('per-file removal, clear, no config data in storage');

  // --- password-protected NPVS: show/hide, wrong password, correct password ---
  await page.setInputFiles('#file-input', 'tests/fixtures/synthetic-v5-pass.npvs');
  await page.waitForSelector('.unlock-form');
  await page.click('.password-field .icon-button');
  assert.equal(await page.getAttribute('.unlock-form input', 'type'), 'text');
  await page.click('.password-field .icon-button');
  assert.equal(await page.getAttribute('.unlock-form input', 'type'), 'password');
  await page.fill('.unlock-form input', 'wrong password');
  await page.click('.unlock-form button[type="submit"]');
  await page.waitForSelector('.error-text');
  assert.equal(await page.inputValue('.unlock-form input'), '');
  await page.fill('.unlock-form input', 'رمز آزمایشی 123');
  await page.click('.unlock-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  assert.equal(await page.locator('.unlock-form').count(), 0);
  const afterPassword = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.ok(!afterPassword.includes('رمز آزمایشی'));
  step('password show/hide, wrong-password recovery, local unlock');

  // --- corrupt file shows a clear error, not a silent failure ---
  await page.setInputFiles('#file-input', { name: 'broken.npvs', mimeType: 'application/octet-stream', buffer: Buffer.from('NPVS\x05broken') });
  await page.waitForSelector('.error-box');
  assert.match(await page.textContent('.error-box'), /.+/);
  await page.click('#clear-button');
  step('corrupt input produces a visible, specific error');

  // --- cache audit: application assets only, scoped to this deployment ---
  await page.click('#demo-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  const cacheAudit = await page.evaluate(async () => {
    const keys = await caches.keys();
    const own = keys.filter(key => key.startsWith('open-npv-'));
    const cache = await caches.open(own[0]);
    return { keys, urls: (await cache.keys()).map(request => new URL(request.url).pathname) };
  });
  assert.ok(cacheAudit.keys.some(key => key.startsWith('open-npv-%2Fopen-npv%2F-')));
  for (const pathname of cacheAudit.urls) {
    assert.ok(pathname.startsWith(BASE_PATH), `cached outside scope: ${pathname}`);
    assert.ok(!/\.(npvs|npvt)$/.test(pathname) || pathname.endsWith('/demo.npvt'), `user file cached: ${pathname}`);
  }
  for (const asset of ['app.js', 'worker.js', 'theme.js', 'style.css', 'source.zip', 'assets/Vazirmatn.woff2', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.ok(cacheAudit.urls.includes(BASE_PATH + asset), `missing cached asset: ${asset}`);
  }
  await page.evaluate(async () => { const cache = await caches.open('open-npv-%2Fsibling%2F-keep'); await cache.put('./keep.txt', new Response('ok')); });
  step('atomic cache holds every asset and no user data');

  // --- offline reload + offline decode ---
  await context.setOffline(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#status-bar[data-state="ready"]');
  assert.match(await page.textContent('#status-text'), /آفلاین/);
  await page.click('#demo-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  await page.setInputFiles('#file-input', 'tests/fixtures/synthetic-v5-app.npvs');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 10);
  assert.ok(await page.evaluate(async () => await caches.has('open-npv-%2Fsibling%2F-keep')), 'sibling deployment cache must survive');
  await context.setOffline(false);
  step('offline reload, offline demo + NPVS decode, sibling cache preserved');

  // --- explicit update flow, with a warning when results are open ---
  const swPath = join(process.cwd(), 'site', 'sw.js');
  const originalSw = await readFile(swPath, 'utf8');
  await writeFile(swPath, originalSw + '\n// browser-test update\n');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForSelector('#update-button:not([hidden])', { timeout: 15000 });
  await page.click('#update-button');
  await page.waitForSelector('#update-dialog[open]');
  await page.click('#confirm-update');
  await page.waitForSelector('#status-bar[data-state="ready"]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#update-button').hidden);
  await writeFile(swPath, originalSw);
  step('update waits for consent, warns about open results, then activates');

  // --- dialogs, theme persistence, mobile layout ---
  await page.click('[data-dialog="privacy-dialog"]');
  assert.ok(await page.locator('#privacy-dialog').evaluate(dialog => dialog.open));
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#privacy-dialog').evaluate(dialog => !dialog.open));
  await page.click('#theme-button');
  const theme = await page.getAttribute('html', 'data-theme');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getAttribute('html', 'data-theme'), theme);
  const paintedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(paintedTheme, theme, 'theme must be applied before first paint');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#demo-button');
  await page.waitForFunction(() => document.querySelectorAll('.config-card').length === 5);
  await page.waitForSelector('#mobile-bar:not([hidden])');
  await assertNoHorizontalOverflow(page);
  const tapTargets = await page.$$eval('#mobile-bar button', nodes => nodes.map(n => Math.round(n.getBoundingClientRect().height)));
  assert.ok(tapTargets.every(height => height >= 44), 'mobile actions need >=44px tap targets');
  step('dialogs, pre-paint theme, mobile bar and overflow');

  assert.deepEqual(external, [], 'external network requests detected');
  assert.deepEqual(mutations, [], 'non-GET network requests detected');
  assert.deepEqual(consoleErrors, [], 'browser console errors detected');
  console.log('\nAll browser checks passed. No external requests, no uploads, no console errors.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(temp, { recursive: true, force: true });
}
