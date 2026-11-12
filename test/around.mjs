// Around the races, through the real page in Chromium:  node test/around.mjs  (needs Playwright)
// Horses to watch, the day in three lines, the scrapbook, the meet so far, looking back at a race, sharing,
// and the little ceremonies around a result.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const problems = [];
const watch = page => {
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
};
// A fresh meet from a fixed seed, built in the page, with the card on the screen.
async function freshMeet(ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', ...ctxOpts });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(base);
  await page.waitForSelector('.races', { timeout: 60000 });
  return { ctx, page };
}
// Runs the races left on today's card with nobody watching, a $2 win ticket on each winner of `cash` (race numbers).
const runDay = (page, cash = []) => page.evaluate(async cash => {
  const G = await import('./js/game.js');
  for (const race of G.card().races) {
    if (race.status === 'official') continue;
    if (cash.includes(race.no)) G.placeBet(race, { type: 'win', sel: [G.recordingOf(race).results[0].h], amt: 2 });
    G.goToGate(race);
  }
}, cash);

try {
  // ---------------------------------------------------------------- horses to watch
  {
    const { ctx, page } = await freshMeet();
    // Star a horse from its entry in race 2's form: the card says it runs, and it's kept.
    await page.evaluate(() => window.postTime.nav.go('race', { no: 2 }));
    const name = await page.locator('.entry .nm').nth(1).textContent();
    const star = page.locator('.entry').nth(1).locator('.star');
    assert.equal(await star.getAttribute('aria-pressed'), 'false');
    await star.click();
    assert.equal(await star.getAttribute('aria-pressed'), 'true', 'the star did not go on');
    // (Starring a horse doesn't open its past performances.)
    assert.equal(await page.locator('.entry').nth(1).locator('.entry-more').isHidden(), true, 'the star opened the horse');
    await page.reload();
    await page.waitForSelector('.races');
    const line = await page.locator('.race-row').nth(1).locator('.starred').textContent();
    assert.equal(line, `★ Starred: ${name} runs`, 'the card does not mark the race with the starred horse');
    assert.equal(await page.locator('.race-row .starred').count(), 1, 'a race without a starred horse is marked');
    // Run the day, cashing on races 1 and 3: each winner is starred on its result, and the card says where the
    // starred horses finished.
    await runDay(page, [1, 3]);
    await page.evaluate(() => window.postTime.nav.go('result', { no: 1 }));
    assert.equal(await page.locator('.board tbody tr').first().locator('.star').getAttribute('aria-pressed'), 'true', 'the winner you cashed on is not starred');
    await page.evaluate(() => window.postTime.nav.go('card'));
    assert.match(await page.locator('.race-row').nth(1).locator('.starred').textContent(), new RegExp(`${name}, \\d+(st|nd|rd|th)$`));
    await ctx.close();
  }

  assert.deepEqual(problems, [], 'errors on the page');
  console.log('around: all checks passed');
} finally {
  await browser.close();
  server.close();
}
