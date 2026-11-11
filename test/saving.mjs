// Keeping the meet beyond this browser, through the real page in Chromium:  node test/saving.mjs  (needs Playwright)
// Save a copy and Open a copy.
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
// A phone, with a meet of its own built on its first visit.
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('.races', { timeout: 60000 });
  return { ctx, page };
}
const menu = async page => { if (await page.locator('#menu').isHidden()) await page.click('#menuBtn'); };
const meetOf = page => page.evaluate(() => ({ seed: window.postTime.game.world.seed, bank: window.postTime.game.player.bank, ledger: window.postTime.game.player.ledger.length }));
// A ticket on the first race, and the race run, so the meet has moved on from where it was built.
const playARace = page => page.evaluate(async () => {
  const G = await import('./js/game.js');
  const race = G.card().races[0];
  G.placeBet(race, { type: 'win', sel: [0], amt: 2 });
  G.goToGate(race);
  window.postTime.nav.go('card');
});

try {
  const a = await device();
  await playARace(a.page);
  const meetA = await meetOf(a.page);

  // Save a copy: one file, named for the meet and its race day, that reads back as this meet.
  await menu(a.page);
  assert.equal(await a.page.locator('#keepRow').isVisible(), true);
  const [saved] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#saveCopy')]);
  assert.equal(saved.suggestedFilename(), 'Post Time, meet 1, race day 1.json');
  const file = await readFile(await saved.path(), 'utf8');
  const copy = JSON.parse(file);
  assert.deepEqual([copy.postTime, copy.world.seed, copy.player.bank], ['post-time meet', meetA.seed, meetA.bank]);
  assert.match(await a.page.locator('#copyNote').textContent(), /in your downloads/);

  // Open a copy, on another phone with a meet of its own: the file is checked and described, and a second
  // tap opens it in place of the meet there.
  const b = await device();
  const meetB = await meetOf(b.page);
  assert.notEqual(meetB.seed, meetA.seed);
  await menu(b.page);
  // (A file that isn't a meet is turned down, and says so.)
  let [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.click('#openCopy')]);
  await chooser.setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"shopping":["oats"]}') });
  await b.page.waitForFunction(() => document.getElementById('copyNote').textContent !== '');
  assert.equal(await b.page.locator('#copyNote').textContent(), "That file isn't a copy of a Post Time meet.");
  assert.deepEqual(await meetOf(b.page), meetB);
  [chooser] = await Promise.all([b.page.waitForEvent('filechooser'), b.page.click('#openCopy')]);
  await chooser.setFiles({ name: saved.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(file) });
  await b.page.waitForFunction(() => /^Tap again/.test(document.getElementById('openCopy').textContent));
  assert.match(await b.page.locator('#copyNote').textContent(), /^Meet 1, race day 1, Saturday, \w+ \d+: 1 race run, \$\d+\.\d\d\.$/);
  assert.deepEqual(await meetOf(b.page), meetB, 'picking the file opened it without a second tap');
  await b.page.click('#openCopy');
  await b.page.waitForSelector('#menu', { state: 'hidden' });
  assert.deepEqual(await meetOf(b.page), meetA);
  assert.equal(await b.page.locator('#bank').textContent(), `$${meetA.bank.toFixed(2)}`);
  assert.equal(await b.page.locator('.race-row.done').count(), 1, "the card shows the copy's race as run");
  // And it's the meet saved there now.
  await b.page.reload();
  await b.page.waitForSelector('.races');
  assert.deepEqual(await meetOf(b.page), meetA);
  await b.ctx.close();

  // Where a download can't start (the game in a frame, as in the Artifact copy) neither is offered.
  await a.page.setContent(`<iframe src="${base}" style="width:390px;height:700px"></iframe>`);
  const frame = await (await a.page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('.races', { timeout: 60000 });
  assert.equal(await frame.locator('#keepRow').evaluate(el => el.hidden), true);
  await a.ctx.close();

  assert.deepEqual(problems, []);
} finally {
  await browser.close();
  server.close();
}
console.log('saving: all good');
