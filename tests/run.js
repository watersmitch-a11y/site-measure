// End-to-end tests: serve the app, drive it in headless Chromium, and check
// what it does. Run with `npm test` (after `npm install` and, the first time,
// `npx playwright install chromium`). Exits non-zero if anything fails.
// `node tests/run.js <name>` runs only the tests whose name contains <name>.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { tests } = require('./cases');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const only = process.argv[2];
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-measure-tests-'));
  const browser = await chromium.launch();
  let failed = 0;
  let ran = 0;
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    ran += 1;
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    const started = Date.now();
    try {
      await page.goto(base);
      await t.run({ page, context, browser, base, tmp, assert });
      assert.deepEqual(errors, [], 'no errors in the page');
      console.log(`  ✓ ${t.name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${t.name}\n      ${String(err.message || err).split('\n').join('\n      ')}`);
      if (errors.length) console.log(`      page errors: ${errors.join(' | ')}`);
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(`\n${ran - failed}/${ran} passed`);
  process.exit(failed ? 1 : 0);
})();
