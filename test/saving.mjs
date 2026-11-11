// Keeping the meet beyond this browser, through the real page in Chromium:  node test/saving.mjs  (needs Playwright)
// Save a copy and Open a copy, asking the browser to keep the meet, and saving to Google Drive through a
// stand-in for Google (test/fake-google.mjs): several phones that share one Drive.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

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
async function device(more = {}, init = null, google = null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block', ...more });
  if (init) await ctx.addInitScript(init);
  // Drive saving shows only at the game's own address: here it's let show at this one too.
  if (google) await google.install(ctx, { rewrite: { '**/js/drive.js': js => js.replace("['https://post-time.junkdrawer.works']", `['https://post-time.junkdrawer.works', '${new URL(base).origin}']`) } });
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

  // Once a ticket has been bought the browser is asked to keep the site's storage, once: not before, and not
  // in Firefox, which would put a question to the player.
  const asking = () => {
    window.__asked = 0;
    const storage = navigator.storage;
    storage.persisted = () => Promise.resolve(false);
    storage.persist = () => { window.__asked++; return Promise.resolve(false); };
  };
  const c = await device({}, asking);
  assert.equal(await c.page.evaluate(() => window.__asked), 0, 'asked before a ticket was bought');
  await playARace(c.page);
  await c.page.evaluate(async () => { const G = await import('./js/game.js'); G.placeBet(G.card().races[1], { type: 'show', sel: [2], amt: 2 }); });
  await c.page.waitForTimeout(100);
  assert.equal(await c.page.evaluate(() => window.__asked), 1);
  // (The next visit asks again, once: the browser may say yes this time.)
  await c.page.reload();
  await c.page.waitForSelector('.races');
  await c.page.waitForTimeout(100);
  assert.equal(await c.page.evaluate(() => window.__asked), 1);
  await c.ctx.close();
  const fox = await device({ userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0' }, asking);
  await playARace(fox.page);
  await fox.page.waitForTimeout(100);
  assert.equal(await fox.page.evaluate(() => window.__asked), 0, 'Firefox was asked');
  await fox.ctx.close();

  // ---------------------------------------------------------------- Google Drive
  // Not at this address as it stands (the game's own address is the only one Google takes): nothing shows.
  assert.equal(await a.page.locator('#driveRow').evaluate(el => el.hidden), true);
  assert.equal(await a.page.locator('#cloud').evaluate(el => el.hidden), true);

  const g = fakeGoogle();
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const meetFile = () => g.files().filter(f => f.appProperties?.postTime === 'meet' && !f.trashed);
  const inDrive = () => JSON.parse(meetFile()[0].body);
  const cloudIs = (page, s) => page.waitForFunction(want => document.getElementById('cloud').dataset.s === want, s, { timeout: 20000 });
  const synced = page => cloudIs(page, 'ok');
  // A device's meet sent to Drive: the copy there is at the same place as the meet here.
  const sent = async page => {
    await page.evaluate(async () => { window.__G = await import('./js/game.js'); });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('post-time.drive') || '{}').base?.mark === window.__G.progressMark() && document.getElementById('cloud').dataset.s === 'ok', null, { timeout: 20000, polling: 200 });
  };
  const bet = (page, no, amt = 2) => page.evaluate(async ([no, amt]) => {
    const G = await import('./js/game.js');
    const race = G.card().races.find(r => r.no === no);
    G.placeBet(race, { type: 'win', sel: [1], amt });
  }, [no, amt]);

  // The first phone turns it on: Google's window, asked to let the player choose an account, for drive.file
  // only. The meet goes into one file in a Post Time folder.
  const d1 = await device({}, null, g);
  await playARace(d1.page);
  await menu(d1.page);
  assert.equal(await d1.page.locator('#driveRow').isVisible(), true);
  await d1.page.waitForFunction(() => !!window.google);
  await d1.page.click('#driveOn');
  await synced(d1.page);
  assert.deepEqual(await d1.page.evaluate(() => [window.__cfg.scope, window.__prompts]), [SCOPE, [{ prompt: 'select_account' }]]);
  const folder = g.files().filter(f => f.appProperties?.postTime === 'folder');
  assert.deepEqual(folder.map(f => [f.name, f.mimeType]), [['Post Time', 'application/vnd.google-apps.folder']]);
  assert.equal(meetFile().length, 1);
  assert.deepEqual([meetFile()[0].name, meetFile()[0].parents], ['Post Time meet.json', [folder[0].id]]);
  const one = await meetOf(d1.page);
  assert.deepEqual([inDrive().postTime, inDrive().world.seed, inDrive().player.bank], ['post-time meet', one.seed, one.bank]);
  assert.equal(await d1.page.locator('#cloud').isVisible(), true);
  assert.match(await d1.page.locator('#driveRow').textContent(), /saved to mark@gmail\.com, in a Post Time folder/);
  // (How to play says where the meet goes now.)
  await d1.page.evaluate(() => window.postTime.nav.go('help'));
  assert.match(await d1.page.locator('.help .saving').textContent(), /A copy goes to your own Google Drive/);
  await d1.page.evaluate(() => window.postTime.nav.go('card'));

  // A second phone, with a meet built on its first visit and never played, and a sign-in another
  // junkdrawer.works project made within the hour: turning it on opens no Google window, and the phone takes
  // the meet in Drive. It keeps its own sound setting.
  const d2 = await device({}, null, g);
  await d2.page.evaluate(SCOPE => {
    localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-mark', exp: Date.now() + 3000000, scope: SCOPE, email: 'mark@gmail.com' }));
    window.postTime.game.player.settings.sound = false;
    window.postTime.save();
  }, SCOPE);
  await menu(d2.page);
  await d2.page.click('#driveOn');
  await d2.page.waitForFunction(seed => window.postTime.game.world.seed === seed, one.seed, { timeout: 20000 });
  await synced(d2.page);
  assert.deepEqual(await meetOf(d2.page), one);
  assert.equal(await d2.page.evaluate(() => window.__prompts), undefined, 'a Google window opened for a sign-in another project had made');
  assert.equal(await d2.page.evaluate(() => window.postTime.game.player.settings.sound), false, "the meet from Drive brought the other phone's settings");
  assert.equal(await d2.page.locator('#bank').textContent(), `$${one.bank.toFixed(2)}`);
  assert.match(await d2.page.locator('.drive-line').textContent(), /^Your meet from Google Drive: Meet 1, race day 1/);

  // The first phone plays on: its ticket goes to Drive, and the second, which hasn't moved since it took the
  // meet, takes it again when it syncs.
  await bet(d1.page, 2);
  await sent(d1.page);
  const two = await meetOf(d1.page);
  assert.equal(inDrive().player.bank, two.bank);
  await d2.page.click('#cloud');
  await d2.page.waitForFunction(bank => window.postTime.game.player.bank === bank, two.bank, { timeout: 20000 });
  await synced(d2.page);

  // Both play on before they sync: the second phone is asked which meet to keep. Keeping its own downloads
  // Drive's first, and sends its own; the first phone, which hadn't moved on since, then takes that.
  await bet(d1.page, 3);
  await sent(d1.page);
  const first = await meetOf(d1.page);
  await bet(d2.page, 4, 5);
  await d2.page.waitForSelector('#keepHere', { timeout: 20000 });
  await cloudIs(d2.page, 'choose');
  const second = await meetOf(d2.page);
  assert.notEqual(second.bank, first.bank);
  assert.match(await d2.page.locator('#keepDrive').textContent(), new RegExp(`Keep Google Drive's.*\\$${first.bank.toFixed(2)}`));
  assert.match(await d2.page.locator('#keepHere').textContent(), new RegExp(`Keep this device's.*\\$${second.bank.toFixed(2)}`));
  assert.equal(inDrive().player.bank, first.bank, 'Drive was changed before the player chose');
  let [gone] = await Promise.all([d2.page.waitForEvent('download'), d2.page.click('#keepHere')]);
  assert.equal(JSON.parse(await readFile(await gone.path(), 'utf8')).player.bank, first.bank, "the meet that went wasn't the one downloaded");
  await sent(d2.page);
  assert.equal(inDrive().player.bank, second.bank);
  assert.equal(await d2.page.locator('#keepHere').count(), 0);
  await d1.page.click('#cloud');
  await d1.page.waitForFunction(bank => window.postTime.game.player.bank === bank, second.bank, { timeout: 20000 });

  // And the other way: keeping Drive's downloads the one on the phone first.
  await bet(d1.page, 5);
  await sent(d1.page);
  const kept = await meetOf(d1.page);
  await bet(d2.page, 6, 5);
  await d2.page.waitForSelector('#keepDrive', { timeout: 20000 });
  const lost = await meetOf(d2.page);
  [gone] = await Promise.all([d2.page.waitForEvent('download'), d2.page.click('#keepDrive')]);
  assert.equal(JSON.parse(await readFile(await gone.path(), 'utf8')).player.bank, lost.bank);
  await d2.page.waitForFunction(bank => window.postTime.game.player.bank === bank, kept.bank);
  assert.deepEqual(await meetOf(d2.page), kept);
  assert.equal(inDrive().player.bank, kept.bank);
  await synced(d2.page);
  // (A device opened again after a sync has nothing to do: Drive is as it left it.)
  const calls = g.calls.length;
  await d2.page.reload();
  await d2.page.waitForSelector('.races');
  await synced(d2.page);
  await d2.page.waitForTimeout(300);
  assert.deepEqual(g.calls.slice(calls).filter(c => !c.startsWith('GET /drive/v3/files?')), [], 'a device with nothing new read or wrote the meet');

  // Google's sign-in runs out after an hour: the cloud goes red, a line under the header says so, and one tap
  // signs back in, without the account chooser, and syncs.
  await d2.page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('junkdrawer.google'));
    localStorage.setItem('junkdrawer.google', JSON.stringify({ ...t, exp: Date.now() - 1000 }));
  });
  await d2.page.reload();
  await d2.page.waitForSelector('.races');
  await cloudIs(d2.page, 'tap');
  assert.match(await d2.page.locator('.drive-line').textContent(), /Google Drive signed you out/);
  await d2.page.waitForFunction(() => !!window.google);
  await d2.page.click('.drive-line .link');
  await synced(d2.page);
  assert.deepEqual(await d2.page.evaluate(() => window.__prompts), [{ prompt: '', login_hint: 'mark@gmail.com' }]);
  assert.equal(await d2.page.locator('.drive-line').isHidden(), true);

  // A copy in Drive that can't be read is left alone, and the line says what to do.
  const inFile = g.drive.files[meetFile()[0].id];
  const good = inFile.body;
  inFile.body = '{"postTime":"post-time meet"'; inFile.version++;
  await d2.page.click('#cloud');
  await cloudIs(d2.page, 'error');
  assert.match(await d2.page.locator('.drive-line').textContent(), /can't be read, so it was left alone/);
  assert.equal(inFile.body, '{"postTime":"post-time meet"');
  assert.deepEqual(await meetOf(d2.page), kept);
  inFile.body = good; inFile.version++;

  // Stopping takes two taps, leaves the meet here and in Drive, and revokes nothing.
  await menu(d2.page);
  await d2.page.click('#driveOff');
  assert.equal(await d2.page.locator('#driveOff').textContent(), 'Tap again to stop saving to Drive here');
  await d2.page.click('#driveOff');
  assert.equal(await d2.page.locator('#cloud').isHidden(), true);
  assert.equal(await d2.page.locator('#driveOn').isVisible(), true);
  assert.equal(await d2.page.evaluate(() => [JSON.parse(localStorage.getItem('post-time.drive')).on, window.__revoked, !!localStorage.getItem('junkdrawer.google')]).then(x => JSON.stringify(x)), '[false,null,true]');
  assert.deepEqual(await meetOf(d2.page), kept);
  assert.equal(meetFile().length, 1);
  await d2.ctx.close();
  await d1.ctx.close();

  // A first sign-in whose Google window closes without a word (as it does when Google turns down the address)
  // says what to look for.
  const d3 = await device({}, null, g);
  await menu(d3.page);
  await d3.page.waitForFunction(() => !!window.google);
  await d3.page.evaluate(() => window.__cfg.error_callback({ type: 'popup_closed' }));
  assert.match(await d3.page.locator('#driveRow .drive-err').textContent(), /Error 400: origin_mismatch.*Authorized JavaScript origins/);

  // A phone with a meet of its own that has been played (Mark's Surface and phone, the day Drive comes): its
  // first sync is the choice between the two.
  await playARace(d3.page);
  const own = await meetOf(d3.page);
  await menu(d3.page);
  await d3.page.click('#driveOn');
  await d3.page.waitForSelector('#keepHere', { timeout: 20000 });
  assert.notEqual(own.seed, kept.seed);
  await d3.page.keyboard.press('Escape'); // (the menu is over the line)
  [gone] = await Promise.all([d3.page.waitForEvent('download'), d3.page.click('#keepHere')]);
  assert.equal(JSON.parse(await readFile(await gone.path(), 'utf8')).world.seed, kept.seed);
  await sent(d3.page);
  assert.deepEqual([inDrive().world.seed, inDrive().player.bank], [own.seed, own.bank]);
  assert.deepEqual(await meetOf(d3.page), own);
  await d3.ctx.close();

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
