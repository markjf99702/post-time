// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base, { waitUntil: 'domcontentloaded' });
// First visit: the meet is built, with ten weeks of races behind it. Changing a setting meanwhile
// doesn't save an empty meet in its place.
await page.waitForSelector('.setup');
const early = await page.evaluate(() => {
  const building = !!document.querySelector('.setup');
  document.getElementById('menuBtn').click();
  document.getElementById('optSound').click();
  document.getElementById('optSound').click();
  document.getElementById('menuBtn').click();
  return { building, stored: localStorage.getItem('post-time/world') };
});
if (early.building) assert.equal(early.stored, null, 'changing a setting during Opening day saved an empty meet');
await page.waitForSelector('.races', { timeout: 30000 });
// While a meet is being built the bankroll is blank, and so is its box.
const emptyBank = await page.evaluate(() => {
  const b = document.getElementById('bank');
  const was = b.textContent;
  b.textContent = '';
  const shown = getComputedStyle(b).visibility;
  b.textContent = was;
  return shown;
});
assert.equal(emptyBank, 'hidden', 'an empty box shows where the bankroll goes');
await page.evaluate(() => document.fonts.ready);
assert.equal(await page.locator('.race-row').count(), 8, 'eight races on the card');
assert.equal(await page.locator('#bank').textContent(), '$200.00');

// A look at a later race shows its opening odds, and doesn't start its clock.
await page.locator('.race-row').nth(2).click();
await page.click('.tabs button:nth-child(4)');
assert.equal(await page.locator('.tote-top span').first().textContent(), 'Opening odds');
assert.equal(await page.evaluate(() => window.postTime.game.player.opened['0:3']), undefined, "race 3's clock started while race 1 was up");
await page.click('.rhead .back');
await page.waitForSelector('.races');

// The form: past performances open up.
await page.click('.race-row.next');
await page.waitForSelector('.entry');
await page.click('.entry-head');
assert.ok(await page.locator('.entry-more:not([hidden])').count() === 1, 'past performances open');
const firstTimer = await page.locator('.entry-more .first-timer').count();
if (!firstTimer) assert.ok(await page.locator('.pps tbody tr').count() >= 2, 'rows of past performances');

// The forum has posts with picks.
await page.click('.tabs button:nth-child(3)');
assert.ok(await page.locator('.post').count() >= 3, 'regulars post on the forum');

// A $2 win ticket on the first horse, and an exacta.
await page.click('.tabs button:nth-child(4)');
await page.locator('.pick-row').nth(0).locator('button').nth(0).click();
assert.equal(await page.locator('.bet-foot .cost').textContent(), '$2.00 · you have $200.00');
await page.click('.builder .btn');
await page.locator('.seg button', { hasText: /^Exacta$/ }).click();
await page.locator('.pick-row').nth(0).locator('button').nth(1).click();
await page.locator('.pick-row').nth(1).locator('button').nth(0).click();
await page.click('.builder .btn');
assert.equal(await page.locator('.ticket').count(), 2, 'two tickets printed');
assert.equal(await page.locator('#bank').textContent(), '$196.00', 'the tickets came out of the bankroll');
// In the dark, the pressed bet type and amount stand out from the others, and Buy ticket from its card.
await page.emulateMedia({ colorScheme: 'dark' });
const dark = await page.evaluate(() => {
  const lum = c => c.match(/[\d.]+/g).slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bg = sel => getComputedStyle(document.querySelector(sel)).backgroundColor;
  return {
    type: ratio(bg('.seg button[aria-pressed="true"]'), bg('.seg button[aria-pressed="false"]')),
    amount: ratio(bg('.seg.amounts button[aria-pressed="true"]'), bg('.seg.amounts button[aria-pressed="false"]')),
    buy: ratio(bg('.builder .btn'), bg('.builder')),
    header: bg('#top'),
  };
});
await page.emulateMedia({ colorScheme: 'light' });
assert.ok(dark.type >= 3 && dark.amount >= 3, `in the dark the pressed bet type (${dark.type.toFixed(2)}:1) or amount (${dark.amount.toFixed(2)}:1) is hard to tell from the others`);
assert.ok(dark.buy >= 3, `in the dark Buy ticket is ${dark.buy.toFixed(2)}:1 against its card`);
assert.equal(dark.header, 'rgb(23, 58, 44)', 'the header changed colour in the dark');

// Off they go; skip to the end.
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
await page.waitForTimeout(800);
await page.evaluate(() => window.__watch.setT(25));
await page.waitForTimeout(400);
assert.ok((await page.locator('.order button').count()) >= 5, 'the running order shows');
assert.ok((await page.locator('.call .now').textContent()).length > 5, 'the caller is calling it');
// On a phone with room for it, the line before the current one is shown whole, not cut off.
const lineBefore = await page.evaluate(async () => {
  const w = window.__watch;
  const lines = w.call.lines;
  const i = lines.slice(0, -1).reduce((a, l, k) => (l.text.length > lines[a].text.length ? k : a), 0);
  w.setT(w.t0 + lines[i + 1].t + 0.05);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const prev = document.querySelector('.call .prev');
  const out = { same: prev.textContent === lines[i].text, cut: prev.scrollWidth > prev.clientWidth + 1 };
  w.setT(25);
  return out;
});
assert.deepEqual(lineBefore, { same: true, cut: false }, 'the line before is cut off on a phone with room for it');
// The keyboard keeps its place in the running order as the order changes.
const keptFocus = await page.evaluate(async () => {
  const name = b => b.getAttribute('aria-label').replace(/^\d+: /, '');
  const b = document.querySelectorAll('.order button')[2];
  b.focus();
  await new Promise(r => setTimeout(r, 1000));
  const a = document.activeElement;
  return !!a.closest('.order') && name(a) === name(b);
});
assert.ok(keptFocus, 'the running order loses the keyboard focus while the race is on');
// The race's Sound button is the menu's Sound setting, and it's kept.
await page.locator('.w-ctl button', { hasText: /^sound$/i }).click();
const soundOff = await page.evaluate(() => ({ menu: document.getElementById('optSound').checked, saved: JSON.parse(localStorage.getItem('post-time/player')).settings.sound }));
assert.deepEqual(soundOff, { menu: false, saved: false }, "turning the sound off in a race isn't kept, or the menu doesn't show it");
await page.locator('.w-ctl button', { hasText: /^sound$/i }).click();
await page.evaluate(() => window.__watch.setT(window.__watch.endT - 0.05));
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
// The running order left on the screen at the end is the official one.
const shownOrder = await page.locator('.order button').evaluateAll(bs => bs.map(b => +b.getAttribute('aria-label').match(/number (\d+)/)[1]));
const officialOrder = await page.evaluate(() => { const r = window.postTime.card().races[0]; return r.result.order.map(o => r.entries[o.k].pp); });
assert.deepEqual(shownOrder, officialOrder, 'the running order at the end is not the official order');
await page.click('.w-ctl .btn');
await page.waitForSelector('.official');
assert.equal(await page.locator('.board tbody tr.mine').count() >= 1, true, 'your horses are marked in the order of finish');

// The money adds up.
const { bank, back } = await page.evaluate(() => {
  const { game } = window.postTime;
  const s = Object.values(game.player.settled)[0];
  return { bank: game.player.bank, back: s.back };
});
assert.ok(Math.abs(bank - (196 + back)) < 0.001, `bankroll ${bank} should be 196 + ${back}`);

// The winner's circle.
await page.click('.actions .btn.brass');
await page.waitForSelector('.photo-frame canvas');
// It all survives a reload, and the next race is up.
await page.reload();
await page.waitForSelector('.races');
assert.equal(await page.locator('.race-row.done').count(), 1, 'race 1 is official after a reload');
assert.equal(await page.evaluate(() => window.postTime.game.player.bank), bank);
// Down to $1.40, with no win, place or show ticket that cheap: the ATM is offered.
await page.evaluate(() => { window.postTime.game.player.bank = 1.4; window.postTime.nav.refresh(); });
assert.equal(await page.locator('.card-foot .btn').textContent(), 'Take out $100', 'no ATM with $1.40 left');
assert.equal(await page.locator('.card-foot p').textContent(), "You're down to $1.40, not enough for a $2 ticket. There's an ATM by the paddock.", 'the card says $1.40 is no money at all');
await page.evaluate(() => { window.postTime.game.player.bank = 0.4; window.postTime.nav.refresh(); });
assert.equal(await page.locator('.card-foot p').textContent(), "You're out of money. There's an ATM by the paddock.");
await page.evaluate(b => { window.postTime.game.player.bank = b; window.postTime.nav.refresh(); }, bank);
assert.equal(await page.locator('.card-foot .btn').count(), 0, 'the ATM is offered with money left');

// The game open in a second tab: when that one saves, this one loads the newer save instead of carrying
// on with its old copy of the meet (and betting on a race it could see the result of over there).
const other = await ctx.newPage();
other.on('pageerror', e => problems.push(e.message));
await other.goto(base, { waitUntil: 'domcontentloaded' });
await other.waitForSelector('.races');
await page.evaluate(() => { window.staleCopy = true; });
await other.evaluate(() => { const { game, save } = window.postTime; game.player.bank += 5; save(); });
await page.waitForFunction(() => !window.staleCopy && document.querySelector('.races'), null, { timeout: 15000 });
assert.equal(await page.evaluate(() => window.postTime.game.player.bank), bank + 5, 'the first tab carries on with its old copy of the meet');
await other.close();
await page.evaluate(b => { window.postTime.game.player.bank = b; window.postTime.save(); }, bank);

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// A small phone with the browser's bars showing: the call stays in its box, the picture doesn't change
// size as the lines come and go, and the Results button is on the screen at the end.
await page.setViewportSize({ width: 320, height: 568 });
await page.click('.race-row.next');
await page.click('.tabs button:nth-child(4)');
await page.locator('.pick-row').nth(0).locator('button').nth(0).click();
await page.click('.builder .btn');
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
const small = await page.evaluate(async () => {
  const w = window.__watch;
  w.pause();
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = document.querySelector('.call');
  const stage = () => Math.round(document.querySelector('.w-stage').getBoundingClientRect().height);
  const heights = new Set([stage()]);
  let spill = 0;
  for (const line of w.call.lines.slice().sort((a, b) => b.text.length - a.text.length).slice(0, 3)) {
    w.setT(w.t0 + line.t + 0.05);
    await frames();
    spill = Math.max(spill, box.scrollHeight - box.clientHeight);
    heights.add(stage());
  }
  return { spill, heights: [...heights], label: document.querySelector('.w-top span').getBoundingClientRect().height };
});
assert.ok(small.spill <= 1, `the race call spills ${small.spill}px out of its box on a small phone`);
assert.equal(small.heights.length, 1, `the picture changes size with the call: ${small.heights}`);
assert.ok(small.label < 24, 'the race number wraps onto two lines');
// This one goes to a photo. The official sign goes up under the photo, not over it.
await page.evaluate(() => { window.__watch.call.photo = true; window.__watch.setT(window.__watch.endT); });
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
const photoSign = await page.evaluate(() => {
  const box = s => document.querySelector(s).getBoundingClientRect();
  const pic = box('.w-photo canvas'), sign = box('.w-photo .w-flash'), stage = box('.w-stage');
  return { clear: sign.top >= pic.bottom, inside: sign.bottom <= stage.bottom + 0.5, shown: getComputedStyle(document.querySelector('.w-photo .w-flash')).visibility };
});
assert.deepEqual(photoSign, { clear: true, inside: true, shown: 'visible' }, 'the official sign covers the photo, or falls off the picture');
const resultsBtn = await page.locator('.w-ctl .btn').boundingBox();
assert.ok(resultsBtn.y + resultsBtn.height <= 568, `the Results button is off the bottom of a small phone (${resultsBtn.y + resultsBtn.height})`);
await page.click('.w-ctl .btn');
await page.waitForSelector('.official');
await page.setViewportSize({ width: 390, height: 844 });

// A new meet starts on race day 1 again: its betting slip and tote are its own, not the last meet's.
await page.locator('.actions .btn', { hasText: /^Race 3/ }).click();
await page.waitForSelector('.entry');
await page.click('.tabs button:nth-child(4)');
await page.locator('.pick-row').nth(0).locator('button').last().click();
await page.click('#menuBtn');
await page.click('#restart');
await page.click('#restart');
await page.waitForSelector('.races', { timeout: 30000 });
assert.equal(await page.locator('#bank').textContent(), '$200.00', 'a new meet starts with $200');
await page.locator('.race-row').nth(2).click();
await page.click('.tabs button:nth-child(4)');
assert.equal(await page.locator('.bet-foot .cost').textContent(), 'Pick a horse.', 'the last meet\'s pick is still on the slip');
assert.equal(await page.locator('.tote-cell').count(), await page.evaluate(() => window.postTime.card().races[2].entries.length));
assert.ok(!/NaN/.test(await page.locator('.tote').textContent()), 'the tote has no odds for some horses');

// While a race is on, the keyboard can't get to the page behind it; and if the page moves on anyway,
// the race goes with it instead of staying on top, stuck.
await page.click('.post-bar .btn.ghost');
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
const cover = await page.evaluate(() => {
  const brand = document.querySelector('#top .brand');
  brand.focus();
  return { reached: document.activeElement === brand, inert: ['top', 'menu', 'app'].map(id => document.getElementById(id).inert) };
});
assert.deepEqual(cover, { reached: false, inert: [true, true, true] }, 'the header can be reached behind the race');
await page.evaluate(() => window.postTime.nav.go('card'));
await page.waitForSelector('.races');
const after = await page.evaluate(() => ({ hidden: document.getElementById('watch').hidden, overflow: document.body.style.overflow, inert: document.getElementById('app').inert }));
assert.deepEqual(after, { hidden: true, overflow: '', inert: false }, 'the race stays on top of the card');

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.races', { timeout: 10000 });
assert.ok(await page.title(), 'the page did not load offline');
await ctx.setOffline(false);

// A save that reads but isn't a meet: a short message and a way to start over, instead of a blank page,
// and the save is left as it is until then.
await page.evaluate(() => localStorage.setItem('post-time/world', '{}'));
const keptPlayer = await page.evaluate(() => localStorage.getItem('post-time/player'));
await page.reload();
await page.waitForSelector('#app .setup .btn');
assert.match(await page.locator('#app .setup').textContent(), /can't be read/);
assert.equal(await page.locator('#bank').textContent(), '', 'a bankroll shows over a save that can\'t be read');
for (const go of ['card', 'book']) {
  await page.click('#menuBtn');
  await page.click(`#menu [data-go="${go}"]`);
  assert.equal(await page.locator('#app .setup .btn').count(), 1, `the menu's ${go} took the message away`);
}
assert.deepEqual(await page.evaluate(() => [localStorage.getItem('post-time/world'), localStorage.getItem('post-time/player')]), ['{}', keptPlayer], 'the save was written over before anyone asked');
await page.click('#app .setup .btn');
await page.waitForSelector('.races', { timeout: 60000 });
assert.equal(await page.locator('#bank').textContent(), '$200.00', 'the new meet starts with $200');

// Opening day, with the build held part-way: there's no card or scrapbook yet, so tapping them (or the
// name) leaves the progress up. How to play can be read meanwhile, and going back brings the progress back.
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const first = await ctx2.newPage();
  first.on('pageerror', e => problems.push(e.message));
  first.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await first.addInitScript(() => {
    const later = window.setTimeout, t0 = performance.now(), held = [];
    window.setTimeout = (fn, ms, ...a) => (performance.now() - t0 > 300 && !window.letGo ? (held.push(() => fn(...a)), 0) : later(fn, ms, ...a));
    window.finishBuilding = () => { window.letGo = true; held.splice(0).forEach(f => later(f, 0)); };
  });
  await first.goto(`${base}manifest.webmanifest`); // somewhere to leave to, for Back on the card
  await first.goto(base, { waitUntil: 'domcontentloaded' });
  await first.waitForSelector('.setup');
  await first.waitForTimeout(500);
  const opening = () => first.evaluate(() => ({ progress: !!document.querySelector('#app .setup'), bank: document.getElementById('bank').textContent }));
  for (const go of ['card', 'book']) {
    await first.click('#menuBtn');
    await first.click(`#menu [data-go="${go}"]`);
    assert.deepEqual(await opening(), { progress: true, bank: '' }, `the menu's ${go} took the Opening day screen away`);
  }
  await first.click('#top .brand');
  assert.deepEqual(await opening(), { progress: true, bank: '' }, 'the name took the Opening day screen away');
  await first.click('#menuBtn');
  await first.click('#menu [data-go="help"]');
  assert.equal(await first.locator('#app .help').count(), 1, "How to play can't be read during Opening day");
  await first.click('.rhead .back');
  assert.deepEqual(await opening(), { progress: true, bank: '' }, "the progress doesn't come back after How to play");
  await first.evaluate(() => window.finishBuilding());
  await first.waitForSelector('.races', { timeout: 60000 });
  assert.equal(await first.locator('#bank').textContent(), '$200.00');

  // The Back button goes back a screen, the way the page's own back buttons do: from a race to the card
  // (not to the tab before), from a race that's running to its result, from the winner's circle to the
  // result, and from the result to the card. On the card it leaves.
  const entries = await first.evaluate(() => history.length);
  await first.click('.race-row.next');
  await first.waitForSelector('.entry');
  for (const n of [2, 3, 4]) await first.click(`.tabs button:nth-child(${n})`);
  await first.goBack();
  await first.waitForSelector('.races');
  await first.click('.race-row.next');
  await first.click('.tabs button:nth-child(4)');
  await first.click('.post-bar .btn.brass');
  await first.waitForSelector('.watch:not([hidden]) canvas.scene');
  await first.goBack();
  await first.waitForSelector('.official');
  assert.deepEqual(await first.evaluate(() => ({ race: document.getElementById('watch').hidden, behind: document.getElementById('app').inert, scroll: document.body.style.overflow })),
    { race: true, behind: false, scroll: '' }, 'Back during a race left it on top of the result');
  await first.click('.actions .btn.brass');
  await first.waitForSelector('.photo-frame canvas');
  await first.goBack();
  await first.waitForSelector('.official');
  await first.goBack();
  await first.waitForSelector('.races');
  assert.ok(await first.evaluate(() => history.length) <= entries + 1, 'moving between screens piles up history');
  await first.goBack();
  assert.match(first.url(), /manifest\.webmanifest$/, 'Back on the card stays in the game');
  await ctx2.close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
