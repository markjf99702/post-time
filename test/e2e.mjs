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
// (Nothing is saved until the meet is built. The Opening day screen stays up a moment after that, and what's
// saved by then is the meet, with its horses.)
if (early.building) assert.ok(early.stored === null || JSON.parse(early.stored).horses?.length > 20, 'changing a setting during Opening day saved an empty meet');
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

// A seed builds the same meet every time. (The riders were handed out with a sort that drew a random number
// in every comparison, and this browser's sort doesn't always make the same number of comparisons: four
// builds of one seed in one page gave three different meets. Compared here with each other, not with Node,
// whose arithmetic differs from the browser's in the last decimal place of some numbers.)
const sameSeed = await page.evaluate(async () => {
  const { createWorld } = await import('./js/world.js');
  const built = [1, 2, 3, 4].map(() => JSON.stringify(createWorld('same-seed', '2026-11-14')));
  return built.map(b => built.indexOf(b));
});
assert.deepEqual(sameSeed, [0, 0, 0, 0], 'one seed built four times in the page gave different meets');

// The photo finish is the race: every nose reaches the line in the column for the moment the race says it
// crossed, so the picture's order is the official order and the line is on the winner's nose. (Each of the
// first three is photographed alone, with the others taken away from the finish, and the column its nose
// gets to is read off the bare picture. The picture used to put the winner's nose 6 to 11 columns past the
// line, and the wrong nose in front in the closest finishes.)
const noses = await page.evaluate(async () => {
  const { createWorld, simulateRace, ownerSilks } = await import('./js/world.js');
  const { photoFinish } = await import('./js/draw/photo.js');
  const w = window.sameSeed = createWorld('same-seed', '2026-11-14'), W = 360, H = 216, out = [];
  for (const race of w.cards[0].races) {
    const run = simulateRace(race, w), res = run.results;
    const runners = race.entries.map(e => { const h = w.horses[e.hid]; return { number: e.pp, coat: h.coat, marks: h.marks, silks: ownerSilks(h.owner), name: h.name }; });
    const tWin = run.t0 + res[0].time;
    const from = Math.max(0, Math.floor((tWin - 0.6) / run.dt) - 3), to = Math.min(run.frames.length - 1, Math.ceil((tWin + 1) / run.dt) + 3);
    const shot = keep => {
      const frames = run.frames.slice();
      for (let i = from; i <= to; i++) {
        frames[i] = new Float32Array(run.frames[i]);
        for (let h = 0; h < run.n; h++) if (h !== keep) frames[i][h * 4] = -1000;
      }
      const c = document.createElement('canvas');
      const info = photoFinish(c, { run: { ...run, frames }, runners, width: W, height: H, grey: false, marks: false });
      return { ...info, data: c.getContext('2d').getImageData(0, 0, W, H).data };
    };
    const empty = shot(-1);
    const noseCol = keep => {
      const d = shot(keep).data;
      for (let c = W - 1; c >= 0; c--) for (let y = Math.round(H * 0.26) + 2; y < H; y++) {
        const i = (y * W + c) * 4;
        if (Math.abs(d[i] - empty.data[i]) + Math.abs(d[i + 1] - empty.data[i + 1]) + Math.abs(d[i + 2] - empty.data[i + 2]) > 24) return c;
      }
      return null;
    };
    for (const r of res.slice(0, 3)) {
      const due = empty.lineX - (r.time - res[0].time) / empty.dtCol; // the column the race puts this nose in
      if (due >= 20) out.push({ race: race.no, pos: r.pos, due: +due.toFixed(1), col: noseCol(r.h) });
    }
  }
  return out;
});
assert.ok(noses.filter(n => n.pos === 1).length === 8 && noses.length >= 12, `too few noses to check the photo finish with: ${noses.length}`);
const offLine = noses.filter(n => n.col === null || Math.abs(n.col - n.due) > 1.5);
assert.deepEqual(offLine, [], 'in the photo finish, a nose is not where the race says it crossed');

// The lake in the infield lies on the ground: as the leader passes it, 330 metres from the wire, the water
// is a strip a few percent of the picture deep, most of the way across. (It was drawn five metres tall, a
// pale-blue slab over a quarter of the picture.) Measured by drawing the same moment with and without it.
const lake = await page.evaluate(async () => {
  const { simulateRace, ownerSilks } = await import('./js/world.js');
  const { RaceScene } = await import('./js/draw/scene.js');
  const { stateAt } = await import('./js/sim.js');
  const w = window.sameSeed, race = w.cards[0].races[0], run = simulateRace(race, w);
  const runners = race.entries.map(e => { const h = w.horses[e.hid]; return { number: e.pp, coat: h.coat, marks: h.marks, silks: ownerSilks(h.owner), name: h.name }; });
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:360px';
  document.body.append(c);
  const scene = new RaceScene(c, { race, run, runners, wx: w.cards[0].wx });
  let t = 0;
  while (Math.max(...stateAt(run, t, []).map(x => x.p)) < race.distance - 330) t += 0.1;
  const shot = () => { scene.draw(t); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const withIt = shot();
  scene.infield = scene.infield.filter(o => o.kind !== 'lake');
  const without = shot();
  c.remove();
  const deep = []; // in each column the lake is in, how many pixels of it
  for (let x = 0; x < c.width; x++) {
    let n = 0;
    for (let y = 0; y < c.height; y++) { const i = (y * c.width + x) * 4; if (withIt[i] !== without[i] || withIt[i + 1] !== without[i + 1] || withIt[i + 2] !== without[i + 2]) n++; }
    if (n) deep.push(n);
  }
  deep.sort((a, b) => a - b);
  return { across: +(deep.length / c.width).toFixed(2), deep: +((deep[deep.length >> 1] || 0) / c.height).toFixed(3) };
});
assert.ok(lake.across > 0.5 && lake.deep > 0.01 && lake.deep < 0.1, `the lake should be a thin strip of water across the infield: it is ${lake.deep} of the picture deep, across ${lake.across} of it`);

// A look at a later race shows its opening odds, and doesn't start its clock.
await page.locator('.race-row').nth(2).click();
await page.click('.tabs button:nth-child(4)');
assert.equal(await page.locator('.tote-top span').first().textContent(), 'Opening odds');
assert.equal(await page.evaluate(() => window.postTime.game.player.opened['0:3']), undefined, "race 3's clock started while race 1 was up");
// It opens for betting after race 2, the one before it, and race 1 is the one that's up.
assert.match(await page.locator('.tote + .note').textContent(), /^You can bet this race once race 2 is over\./);
assert.equal(await page.locator('.post-bar .info').textContent(), 'Race 1 is up first.');
// It has the board and that note, and no betting slip. (The slip used to be there, working, with a Buy
// ticket button that could never buy.)
assert.deepEqual([await page.locator('.tote-cell').count() >= 3, await page.locator('.builder, .picks-grid, .bet-foot').count()], [true, 0], "a race that isn't up for betting has a betting slip");
assert.match(await page.locator('meta[name="description"]').getAttribute('content'), /Horses, form and your bankroll carry over/);
await page.click('.rhead .back');
await page.waitForSelector('.races');

// The form: past performances open up.
await page.click('.race-row.next');
await page.waitForSelector('.entry');
await page.click('.entry-head');
assert.ok(await page.locator('.entry-more:not([hidden])').count() === 1, 'past performances open');
const firstTimer = await page.locator('.entry-more .first-timer').count();
if (!firstTimer) assert.ok(await page.locator('.pps tbody tr').count() >= 2, 'rows of past performances');

// A colt is called a horse from the year he turns five, and a filly a mare.
const sexWords = await page.evaluate(() => {
  const { game, card, nav } = window.postTime;
  const race = card().races.find(r => r.status !== 'official'), horse = game.world.horses[race.entries[0].hid];
  const was = [horse.sex, horse.foaled], year = +race.date.slice(0, 4), out = [];
  for (const [sex, age] of [['c', 4], ['c', 5], ['f', 4], ['f', 6], ['g', 6]]) {
    horse.sex = sex;
    horse.foaled = year - age;
    nav.refresh();
    document.querySelector('.entry-head').click();
    out.push(document.querySelector('.pedigree').textContent.match(/(\w+), (\d+) ·/).slice(1).join(' '));
  }
  [horse.sex, horse.foaled] = was;
  nav.refresh();
  return out;
});
assert.deepEqual(sexWords, ['colt 4', 'horse 5', 'filly 4', 'mare 6', 'gelding 6']);
// A horse's workouts are listed newest first by their dates, whatever order they were made in. (Two made
// on the same day are dated a few days apart, either way round.)
const works = await page.evaluate(async () => {
  const { shortDate } = await import('./js/world.js');
  const { game, card, nav } = window.postTime;
  const race = card().races.find(r => r.status !== 'official');
  const k = race.entries.findIndex(e => new Set(game.world.horses[e.hid].works.map(w => w.dt)).size >= 2);
  const horse = game.world.horses[race.entries[k].hid], was = horse.works;
  // Oldest first, then the newest moved to the front: no way of reading the list in order gets it right.
  const byDate = was.slice().sort((a, b) => (a.dt < b.dt ? -1 : 1));
  horse.works = [byDate[byDate.length - 1], ...byDate.slice(0, -1)];
  nav.refresh();
  document.querySelectorAll('.entry-head')[k].click();
  const shown = document.querySelectorAll('.entry')[k].querySelector('.works').textContent.match(/\d{1,2}[A-Z][a-z]{2}(?= \df)/g);
  horse.works = was;
  nav.refresh();
  return { shown, newestFirst: byDate.reverse().map(w => shortDate(w.dt).slice(0, -2)) };
});
assert.deepEqual(works.shown, works.newestFirst, 'the workouts are not listed newest first');
// The small print. A work is timed to the fifth of a second, with the bullet in front of a bulleted one
// (it was "3f ft :36.3 B 1/31 ●"). A stakes isn't "by invitation", and a race for fillies and mares says
// how old they are. The page under the race's name is drawn from each.
const smallPrint = await page.evaluate(async () => {
  const { game, card, nav } = window.postTime;
  const race = card().races.find(r => r.status !== 'official');
  const k = race.entries.findIndex(e => game.world.horses[e.hid].works.length >= 2);
  const horse = game.world.horses[race.entries[k].hid], was = horse.works, kept = { cls: race.cls, claim: race.claim, fm: race.fm };
  horse.works = [{ ...was[0], dt: '2026-01-02', f: 3, t: 36.3, g: 'B', rank: 1, of: 31, surf: 'd' }, { ...was[1], dt: '2026-01-09', f: 5, t: 61.1, g: 'H', rank: 4, of: 12, surf: 't' }];
  const out = { conditions: [] };
  for (const as of [{ cls: 'STK', claim: null, fm: false }, { cls: 'ALW', claim: null, fm: true }, { cls: 'MSW', claim: null, fm: true }, { cls: 'C16', claim: 16000, fm: true }, { cls: 'MSW', claim: null, fm: false }]) {
    Object.assign(race, as);
    nav.refresh();
    out.conditions.push(document.querySelector('.rhead .cond').textContent.replace(/^[^.]*\. /, '').replace(/ Purse .*$/, ''));
  }
  document.querySelectorAll('.entry-head')[k].click();
  out.works = document.querySelectorAll('.entry')[k].querySelector('.works').textContent;
  horse.works = was;
  Object.assign(race, kept);
  nav.refresh();
  return out;
});
assert.equal(smallPrint.works, 'Works: 9Jan 5f turf 1:01.2 H 4/12 · ●2Jan 3f ft :36.4 B 1/31');
assert.deepEqual(smallPrint.conditions, [
  'Three-year-olds and up. A stakes race: owners pay to enter.',
  'Fillies and mares, three and up, non-claiming.',
  'Fillies and mares, three and up, that have never won.',
  'Fillies and mares, three and up, each for sale for $16,000.',
  'Three-year-olds and up that have never won.',
]);

// The forum has posts with picks.
await page.click('.tabs button:nth-child(3)');
assert.ok(await page.locator('.post').count() >= 3, 'regulars post on the forum');

// The board says what a $2 win ticket pays, to the dime under $10, and that the odds will move.
await page.click('.tabs button:nth-child(4)');
const pays = await page.locator('.tote-cell .pay').allTextContents();
assert.ok(pays.length >= 5 && pays.every(t => /^\$2 pays ~\$(\d\.\d0|\d{2,})$/.test(t)), `the board's payouts: ${pays.join(' | ')}`);
assert.match(await page.locator('.tote + .note').textContent(), /^Odds keep moving until the gate opens\. Every ticket is paid at the final odds/);
// A pick that hasn't been bought. The bar at the bottom names it and offers to buy it, and To the gate
// doesn't run the race on one tap (or on a double tap): the first tap says what's about to be left behind.
const third = await page.evaluate(() => { const { game, nextRace } = window.postTime; const e = nextRace().entries[2]; return `#${e.pp} ${game.world.horses[e.hid].name}`; });
const barText = () => page.locator('.post-bar .info').textContent();
const barButtons = () => page.locator('.post-bar .btn').allTextContents();
assert.deepEqual([await barText(), await barButtons()], ['No tickets yet. You can watch without betting.', ['To the gate ▸']]);
await page.locator('.pick-row').nth(0).locator('button').nth(2).click();
await page.locator('.seg.amounts button', { hasText: /^\$10$/ }).click();
assert.equal(await page.locator('.bet-foot .cost').textContent(), `$10 to win on ${third} · you have $200.00`);
assert.deepEqual([await barText(), await barButtons()], [`${third} to win, $10: not bought yet`, ['To the gate ▸', 'Buy ticket · $10.00']], "the bar doesn't offer the pick that hasn't been bought");
assert.deepEqual(await page.locator('.post-bar .btn').evaluateAll(bs => bs.map(b => b.className)), ['btn ghost', 'btn brass'], 'with a pick not bought, Buy should be the brass button');
const unbought = await page.evaluate(() => {
  const gate = document.querySelector('.post-bar .btn.ghost');
  gate.click();
  gate.click(); // a double tap is one tap
  return { racing: !document.getElementById('watch').hidden, status: window.postTime.nextRace().no, same: document.querySelector('.post-bar .btn.ghost') === gate };
});
assert.deepEqual(unbought, { racing: false, status: 1, same: true }, 'To the gate ran the race with a pick not bought');
assert.equal(await barText(), `You picked ${third.split(' ')[0]} to win for $10 and haven't bought it. Tap again to go without it.`);
// Changing the pick puts the bar back, and so does buying it from the bar. With nothing picked the bar is
// as it was, and To the gate is one tap (as every race below goes off).
await page.locator('.pick-row').nth(0).locator('button').nth(2).click();
assert.deepEqual([await barText(), await barButtons()], ['No tickets yet. You can watch without betting.', ['To the gate ▸']], "the bar doesn't go back when the pick is cleared");
await page.locator('.pick-row').nth(0).locator('button').nth(2).click();
await page.click('.post-bar .btn.brass');
assert.deepEqual([await barText(), await barButtons(), await page.locator('#bank').textContent()], ['1 ticket · $10.00 on this race', ['To the gate ▸'], '$190.00'], "Buy ticket in the bar didn't buy the pick");
assert.equal(await page.locator('.ticket .what').textContent(), `$10 WIN ${third.slice(1).split(' ')[0]}`);
await page.click('.ticket button');
assert.equal(await page.locator('#bank').textContent(), '$200.00', 'the cancelled ticket was not paid back');
await page.locator('.seg.amounts button', { hasText: /^\$2$/ }).click();

// A $2 win ticket on the first horse, and an exacta.
await page.locator('.pick-row').nth(0).locator('button').nth(0).click();
assert.match(await page.locator('.bet-foot .cost').textContent(), /^\$2 to win on #\d+ .+ · you have \$200\.00$/);
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
// And what's on a button can be read, in the light and in the dark (figures are WCAG contrast ratios). The
// lettering on Buy ticket and on the pressed bet type is 4.5:1 or better on its ground (in the dark it was
// cream on green at 3.65:1). A bet type that isn't pressed has an edge of 3:1 against the card (it had none,
// and its ground is 1.03:1 against the card in the dark). A pick that isn't picked keeps its number at full
// strength on its cloth's own colour (the whole button used to be at 55%: 2.2:1 for the white 5 on green).
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  const seen = await page.evaluate(() => {
    const rgba = c => c.match(/[\d.]+/g).map(Number);
    const over = (top, under) => { const [r, g, b, a = 1] = rgba(top), u = rgba(under); return [r, g, b].map((v, i) => v * a + u[i] * (1 - a)); };
    const lum = c => c.slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const css = (el, prop) => getComputedStyle(typeof el === 'string' ? document.querySelector(el) : el)[prop];
    const words = el => ratio(rgba(css(el, 'color')), rgba(css(el, 'backgroundColor')));
    const card = css('.builder', 'backgroundColor'), picks = [...document.querySelectorAll('.picks-grid button')];
    return {
      buy: words('.builder .btn'), pressed: words('.seg button[aria-pressed="true"]'),
      edge: ratio(over(css('.seg button[aria-pressed="false"]', 'borderTopColor'), card), rgba(card)),
      pick: Math.min(...picks.map(b => ratio(rgba(css(b, 'color')), rgba(css(b.firstElementChild || b, 'backgroundColor'))))),
      faded: picks.filter(b => css(b, 'opacity') !== '1').length, picks: picks.length,
    };
  });
  const said = Object.entries(seen).map(([k, v]) => `${k} ${+v.toFixed(2)}`).join(', ');
  assert.ok(seen.buy >= 4.5 && seen.pressed >= 4.5, `${scheme}: the lettering on Buy ticket or on a pressed bet type is under 4.5:1 (${said})`);
  assert.ok(seen.edge >= 3, `${scheme}: a bet type that isn't pressed has no edge to speak of against the card (${said})`);
  assert.ok(seen.picks >= 6 && seen.faded === 0 && seen.pick >= 4.4, `${scheme}: a pick's number is faded, or hard to read on its ground (${said})`);
}
await page.emulateMedia({ colorScheme: 'light' });

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
const hintWas = await page.evaluate(() => { const hint = document.querySelector('.w-ctl .hint'); return [/^Tap a number in the running order to follow that horse\./.test(hint.textContent), hint.offsetHeight]; });
await page.evaluate(() => window.__watch.setT(window.__watch.endT - 0.05));
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
// Once the race is official there's nothing to follow: the line about following a horse is blank, in the
// room it had.
assert.deepEqual([hintWas[0], await page.evaluate(() => { const hint = document.querySelector('.w-ctl .hint'); return [hint.textContent, hint.offsetHeight]; })], [true, ['', hintWas[1]]], 'the hint about following a horse is still up after the race, or its room has gone');
// The running order left on the screen at the end is the official one.
const shownOrder = await page.locator('.order button').evaluateAll(bs => bs.map(b => +b.getAttribute('aria-label').match(/number (\d+)/)[1]));
const officialOrder = await page.evaluate(() => { const r = window.postTime.card().races[0]; return r.result.order.map(o => r.entries[o.k].pp); });
assert.deepEqual(shownOrder, officialOrder, 'the running order at the end is not the official order');
// The caller's last line (second, third and the time) has come up by the end. After a photo the winner's
// line is under it, put up with the official sign.
const lastCall = await page.evaluate(() => ({ now: document.querySelector('.call .now').textContent, prev: document.querySelector('.call .prev').textContent, official: window.__watch.call.official }));
if (lastCall.official) assert.deepEqual([lastCall.now, /The time, /.test(lastCall.prev)], [lastCall.official, true], "after a photo the call doesn't end on the winner's line");
else assert.match(lastCall.now, /The time, /, "the call's last line never came up");
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
// The photo's caption says what kind of race it was the way the card does: a maiden claimer with its price.
const kinds = await page.evaluate(async () => {
  const { photoCard } = await import('./js/ui/results.js');
  const { photoRecord } = await import('./js/game.js');
  const race = window.postTime.card().races[0], rec = photoRecord(race, race.result.order[0].k, 0);
  const said = as => photoCard({ ...rec, name: null, ...as }, false).querySelector('.horse').nextSibling.textContent;
  return [said({ cls: 'MCL', claim: 20000 }), said({ cls: 'C16', claim: 16000 }), said({ cls: 'MSW', claim: null }), said({ cls: 'STK', claim: null, name: 'Brass Pull Stakes' })];
});
assert.deepEqual(kinds, ['Maiden claiming $20,000', 'Claiming $16,000', 'Maiden special weight', 'Brass Pull Stakes']);
// It all survives a reload, and the next race is up.
await page.reload();
await page.waitForSelector('.races');
assert.equal(await page.locator('.race-row.done').count(), 1, 'race 1 is official after a reload');
assert.equal(await page.evaluate(() => window.postTime.game.player.bank), bank);
// Down to $1.40, with no win, place or show ticket that cheap: the ATM is offered.
await page.evaluate(() => { window.postTime.game.player.bank = 1.4; window.postTime.nav.refresh(); });
assert.equal(await page.locator('.day .atm .btn').textContent(), 'Take out $100', 'no ATM with $1.40 left');
assert.equal(await page.locator('.day .atm p').textContent(), "You're down to $1.40, not enough for a $2 ticket. There's an ATM by the paddock.", 'the card says $1.40 is no money at all');
await page.evaluate(() => { window.postTime.game.player.bank = 0.4; window.postTime.nav.refresh(); });
assert.equal(await page.locator('.day .atm p').textContent(), "You're out of money. There's an ATM by the paddock.");
// Broke, the ATM is where the player is. On the card it's under the date, on the screen without scrolling
// (it used to be under all eight races, 974 px down this 844 px screen, and nowhere else). The result of
// the race that did it says what's left, and the betting window has the ATM where the cost would be. The
// button leaves the player on the screen it was tapped on, with the $100.
const broke = async where => {
  await page.evaluate(() => { const { game } = window.postTime; game.player.bank = 0; game.player.atm = 0; });
  await page.evaluate(([screen, params]) => window.postTime.nav.go(screen, params), where);
};
await broke(['card', {}]);
const atmOnCard = await page.evaluate(() => { const r = document.querySelector('.atm .btn').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(); return r.top >= top.bottom && r.bottom <= innerHeight && scrollY === 0; });
assert.ok(atmOnCard, "with $0 the ATM isn't on the screen when the card opens");
await broke(['result', { no: 1 }]);
assert.equal(await page.locator('.summary .atm p').textContent(), "That leaves you $0.00. There's an ATM by the paddock.");
await page.click('.summary .atm .btn');
assert.deepEqual([await page.locator('.official').count(), await page.locator('.atm').count(), await page.locator('#bank').textContent()], [1, 0, '$100.00'], 'the ATM on a result should leave the result up, with $100');
await broke(['race', { no: 2, tab: 'bet' }]);
assert.deepEqual([await page.locator('.bet-foot .atm p').textContent(), await page.locator('.bet-foot .cost').count()], ["You're out of money. There's an ATM by the paddock.", 0], 'with $0 the betting window has no ATM where the cost goes');
await page.evaluate(() => window.scrollTo(0, 200));
await page.click('.bet-foot .atm .btn');
assert.deepEqual([await page.locator('.tabs button[aria-selected="true"]').textContent(), await page.locator('.bet-foot .atm').count(), await page.locator('.bet-foot .cost').textContent(), await page.locator('#bank').textContent(), await page.evaluate(() => [scrollY > 0, window.postTime.game.player.atm])],
  ['Bet', 0, 'Pick a horse.', '$100.00', [true, 100]], 'the ATM at the betting window should leave the window up, with $100');
await page.evaluate(b => { const { game, nav, save } = window.postTime; game.player.bank = b; game.player.atm = 0; save(); nav.go('card'); }, bank);
assert.equal(await page.locator('.atm').count(), 0, 'the ATM is offered with money left');

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

// When the browser refuses a save (storage blocked or full), a line under the header says the meet isn't
// being kept, and it goes when a save works again.
const unsaved = page.locator('.unsaved');
assert.equal(await unsaved.isVisible(), false, 'the line about saving shows when saving works');
await page.evaluate(() => {
  window.realSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  window.postTime.save();
});
assert.equal(await unsaved.isVisible(), true, "nothing says the browser isn't keeping the meet");
assert.equal(await unsaved.textContent(), "This browser isn't keeping your meet, so it will be gone when you close the page.");
const unsavedBox = await unsaved.boundingBox(), headerBox = await page.locator('#top').boundingBox();
assert.ok(unsavedBox.y >= headerBox.y + headerBox.height - 1 && unsavedBox.x >= 0 && unsavedBox.x + unsavedBox.width <= 390, 'the line about saving is under the header or off the side');
await page.evaluate(() => { Storage.prototype.setItem = window.realSetItem; window.postTime.save(); });
assert.equal(await unsaved.isVisible(), false, 'the line about saving stays after a save has worked');

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// A small phone with the browser's bars showing: the call stays in its box, the picture doesn't change
// size as the lines come and go, and the Results button is on the screen at the end.
await page.setViewportSize({ width: 320, height: 568 });
await page.click('.race-row.next');
// The past performances of every horse in the race, opened on this small phone: a table wider than its
// card can be slid sideways to the end of its rows (it used to be cut off at the card's edge). (A table is
// too wide when it runs into its box's padding on the right, which is narrower on a phone this size.)
const cutOff = await page.evaluate(() => {
  let wide = 0, stuck = 0;
  for (const head of document.querySelectorAll('.entry-head')) {
    head.click();
    const more = head.closest('.entry').querySelector('.entry-more'), table = more.querySelector('.pps');
    const edge = () => more.getBoundingClientRect().right - parseFloat(getComputedStyle(more).paddingRight) + 1;
    if (!table || table.getBoundingClientRect().right <= edge()) continue;
    wide++;
    more.scrollLeft = 1000;
    if (table.getBoundingClientRect().right > edge()) stuck++;
  }
  return { wide, stuck, sideways: document.documentElement.scrollWidth > innerWidth };
});
assert.deepEqual({ stuck: cutOff.stuck, sideways: cutOff.sideways }, { stuck: 0, sideways: false }, `${cutOff.stuck} of ${cutOff.wide} tables of past performances wider than their cards can't be reached`);
await page.click('.tabs button:nth-child(4)');
await page.locator('.pick-row').nth(0).locator('button').nth(0).click();
await page.click('.builder .btn');
// A second pick, not bought, on this small phone: both of the bar's buttons are on the screen, one tap on
// To the gate leaves the race where it is, and a second one, after a moment, goes without the pick.
await page.locator('.seg button', { hasText: /^Exacta box$/ }).click();
for (const n of [0, 1, 2]) await page.locator('.pick-row').nth(0).locator('button').nth(n).click();
assert.match(await page.locator('.bet-foot .cost').textContent(), /^\$2 exacta box \d+, \d+, \d+ · \$12\.00 \(6 bets of \$2\) · you have /);
assert.match(await page.locator('.post-bar .info').textContent(), /^Exacta box \d+, \d+, \d+, \$12: not bought yet$/);
const barFits = await page.locator('.post-bar .btn').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && b.scrollWidth <= b.clientWidth; }));
assert.deepEqual(barFits, [true, true], "the bar's two buttons don't fit a small phone");
await page.click('.post-bar .btn.ghost');
await page.waitForTimeout(300);
assert.deepEqual(await page.evaluate(() => [document.getElementById('watch').hidden, window.postTime.nextRace().no]), [true, 2], 'one tap on To the gate ran the race with a pick not bought');
assert.match(await page.locator('.post-bar .info').textContent(), /^You picked an exacta box \(\d+, \d+, \d+\) for \$12 and haven't bought it\. Tap again to go without it\.$/);
await page.waitForTimeout(600);
await page.click('.post-bar .btn.ghost');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
assert.equal(await page.evaluate(() => window.postTime.game.player.bets['0:2'].length), 1, "the pick that wasn't bought went to the gate as a ticket");
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
// This one goes to a photo. The caller says who won it when the official sign goes up, not before, and
// the line fits its box. The official sign goes up under the photo, not over it.
// Until then the running order doesn't say either: the two in the photo are side by side, lower number
// first, with no margin between them, and in the order they finished once the sign is up.
const photoCall = await page.evaluate(() => new Promise(resolve => {
  const w = window.__watch, line = "It's Number One, by a nose!";
  w.call.photo = true;
  w.call.official = line;
  w.setT(w.endT);
  let early = false, held = null;
  const strip = () => [...document.querySelector('.order').children].map(x => (x.matches('.pair') ? `[${[...x.children].map(b => b.getAttribute('aria-label').replace(/, .*/, '')).join(' | ')}]` : x.querySelector('button').getAttribute('aria-label').replace(/, .*/, ''))).slice(0, 3);
  const look = () => {
    const sign = document.querySelector('.w-photo .w-flash'), box = document.querySelector('.call');
    const up = !!sign && sign.classList.contains('up');
    const said = box.querySelector('.now').textContent === line;
    if (said && !up) early = true;
    if (sign && !up) held = strip();
    if (up) resolve({ early, said, spill: box.scrollHeight - box.clientHeight, held, after: strip(), first2: w.run.results.slice(0, 2).map(r => window.postTime.card().races[1].entries[r.h].pp) });
    else requestAnimationFrame(look);
  };
  look();
}));
assert.deepEqual({ early: photoCall.early, said: photoCall.said }, { early: false, said: true }, "a photo's winner is called before the official sign, or not at all");
assert.ok(photoCall.spill <= 1, `the winner's line spills ${photoCall.spill}px out of its box on a small phone`);
const [lower, higher] = photoCall.first2.slice().sort((a, b) => a - b);
assert.equal(photoCall.held[0], `[In the photo: number ${lower} | In the photo: number ${higher}]`, 'the running order gives a photo away before the official sign');
assert.deepEqual(photoCall.after.slice(0, 2), photoCall.first2.map((n, k) => `${k + 1}: number ${n}`), "the running order isn't the official one once the sign is up");
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
// Starting over takes two taps, and a double tap is one: two taps 120 ms apart leave the meet, the bankroll
// and the scrapbook as they were, with the button saying what a second tap will do, in a menu no wider for
// it. A second tap a moment later starts the new meet.
await page.click('#menuBtn');
const meetNow = () => page.evaluate(() => { const { game } = window.postTime; return [game.world.seed, game.world.day, game.player.bank, game.player.book.length, !!document.querySelector('.setup')]; });
const meetWas = await meetNow();
const menuWas = await page.evaluate(() => document.getElementById('menu').getBoundingClientRect().width);
await page.evaluate(async () => { const b = document.getElementById('restart'); b.click(); await new Promise(r => setTimeout(r, 120)); b.click(); });
await page.waitForTimeout(400);
assert.deepEqual(await meetNow(), meetWas, 'a double tap on Start a new meet started one');
assert.equal(await page.locator('#restart').textContent(), 'Tap again: new horses, $200, empty scrapbook');
assert.equal(await page.evaluate(() => document.getElementById('menu').getBoundingClientRect().width), menuWas, 'the menu gets wider when Start a new meet is tapped');
await page.waitForTimeout(500);
// The Opening day screen says what the wait is for ("Running the last ten weeks of races..."), and is up for
// at least 1.2 seconds, long enough to read: this machine builds a meet in a third of a second.
await page.evaluate(() => {
  const seen = window.__opening = []; // when the screen went up, and when it came down
  new MutationObserver(() => { if (!!document.querySelector('#app .setup .bar') !== (seen.length === 1)) seen.push(performance.now()); }).observe(document.getElementById('app'), { childList: true });
});
await page.click('#restart');
await page.waitForSelector('.races', { timeout: 30000 });
const opening = await page.evaluate(() => window.__opening);
assert.ok(opening.length === 2 && opening[1] - opening[0] >= 1150, `the Opening day screen was up for ${Math.round(opening[1] - opening[0])} ms`);
assert.notEqual((await meetNow())[0], meetWas[0], 'a second tap on Start a new meet, a second after the first, started nothing');
assert.equal(await page.locator('#bank').textContent(), '$200.00', 'a new meet starts with $200');
// (The slip is on the race that's up, so the new meet's first two races are run, with nothing on them.)
await page.evaluate(async () => {
  const { goToGate } = await import('./js/game.js');
  const { card, nav } = window.postTime;
  for (const race of card().races.slice(0, 2)) goToGate(race);
  nav.go('card');
});
await page.locator('.race-row').nth(2).click();
await page.click('.tabs button:nth-child(4)');
assert.equal(await page.locator('.bet-foot .cost').textContent(), 'Pick a horse.', 'the last meet\'s pick is still on the slip');
assert.equal(await page.locator('.tote-cell').count(), await page.evaluate(() => window.postTime.card().races[2].entries.length));
assert.ok(!/NaN/.test(await page.locator('.tote').textContent()), 'the tote has no odds for some horses');

// While a race is on, the keyboard can't get to the page behind it; and if the page moves on anyway,
// the race goes with it instead of staying on top, stuck.
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

// From here on a stand-in for the browser's voice notes what it's asked to read, and nothing is heard. Its
// voices are the ones Chrome lists on a Mac: Apple's, novelty ones and all, then Chrome's own, which need
// the internet.
const macVoices = JSON.parse(await readFile(join(root, 'test/voices.fixture.json'), 'utf8')).lists['Chrome, Mac (nothing downloaded)'];
// It says when a line starts and ends, as a real one does, and takes as long over a line as the page's own
// model of a voice says one does (js/audio.js, sayTime) times __slow, so the call is planned for a voice
// like this one. Everything it's asked to do is noted with the time.
await page.addInitScript(voices => {
  window.__voice = [];  // what it was asked to read, and '(cancel)'
  window.__said = [];   // the same lines, with the voice, pace and pitch asked for, and when
  window.__ended = [];  // the lines it got to the end of
  window.__heard = [];  // everything, in order: { ev: 'speak' | 'end' | 'cancel', text, at }
  window.__slow = 1;
  window.__quiet = () => !saying && !waiting.length;
  let saying = null, model = null;
  const waiting = [];
  const list = voices.map(([name, lang, local]) => ({ name, lang, localService: !!local }));
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  const takes = u => (model ? model(u.text, u.rate) * 1000 * window.__slow : Math.max(200, u.text.split(' ').length * 290));
  // Like the real one, it says what it's given in turn, and a cancel empties it.
  const next = () => {
    const u = waiting.shift();
    if (!u) return;
    const me = saying = { text: u.text };
    setTimeout(() => { if (saying === me && u.onstart) u.onstart({}); }, 120);
    setTimeout(() => { if (saying === me) { saying = null; window.__ended.push(u.text); window.__heard.push({ ev: 'end', text: u.text, at: performance.now() }); if (u.onend) u.onend({}); next(); } }, takes(u));
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => list,
    speak(u) {
      if (!model) import(new URL('js/audio.js', document.baseURI).href).then(m => { model = m.sayTime; });
      window.__voice.push(u.text);
      window.__said.push({ text: u.text, voice: u.voice ? u.voice.name : null, lang: u.lang, rate: u.rate, pitch: u.pitch, volume: u.volume, at: performance.now() });
      window.__heard.push({ ev: 'speak', text: u.text, silent: u.volume === 0, rate: u.rate, at: performance.now() });
      waiting.push(u);
      if (!saying) next();
    },
    cancel() { window.__voice.push('(cancel)'); window.__heard.push({ ev: 'cancel', text: saying ? saying.text : null, at: performance.now() }); saying = null; waiting.length = 0; },
    addEventListener() {},
  } });
  // The page's sound, kept where the tests can see whether it's running. Everything on its way to the
  // speaker goes through a tap, so how loud it is can be measured; the oscillators it makes are noted (the
  // starting bell is the only thing with one at 1760 Hz); and so is the crowd's own level, which is the
  // one a band-pass filter feeds.
  const Sound = window.AudioContext;
  window.__oscillators = [];
  window.AudioContext = class extends Sound {
    constructor(...a) { super(...a); window.__sound = this; }
    get destination() {
      if (!this.tap) { this.tap = this.createAnalyser(); this.tap.fftSize = 2048; this.tap.connect(super.destination); }
      return this.tap;
    }
    createOscillator() { const o = super.createOscillator(); o.madeAt = performance.now(); window.__oscillators.push(o); return o; }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...a) {
    if (this instanceof BiquadFilterNode && this.type === 'bandpass' && to instanceof GainNode) window.__crowd = to;
    return connect.call(this, to, ...a);
  };
}, macVoices);
await page.reload();
await page.waitForSelector('.races');

// The menu: which voice reads the call, under its tick while it's ticked. The best voice here comes first,
// the novelty voices aren't offered, the menu is no wider for it, and Hear it says a line in the voice
// that's chosen. The choice is kept.
await page.click('#menuBtn');
const menuWidth = () => page.evaluate(() => document.getElementById('menu').getBoundingClientRect().width);
const narrow = await menuWidth();
assert.equal(await page.locator('#voiceRow').isVisible(), false, 'the voice row shows with the call not read aloud');
await page.check('#optVoice');
// That tap says one word at no volume: a phone lets a page speak only once it has spoken inside a tap.
assert.deepEqual(await page.evaluate(() => window.__said.map(u => [u.volume, u.lang])), [[0, 'en-US']], 'ticking "Read the race call aloud" should say one silent word');
assert.equal(await page.locator('#voiceRow').isVisible(), true, 'no voice row under "Read the race call aloud"');
assert.equal(await menuWidth(), narrow, 'the voice row makes the menu wider');
const offered = await page.locator('#optVoiceName option').allTextContents();
// The first choice is "Best here", and the line under the list says which voice that is. (With the name in
// the choice itself the closed list read "Best here (Chrome OS ...", the number cut off.)
assert.equal(offered[0], 'Best here');
assert.equal(offered[1], 'Google US English (needs the internet)');
const reading = () => page.locator('#voiceNote').textContent();
assert.equal(await reading(), 'Reading in Google US English');
assert.deepEqual(await page.evaluate(() => { const row = document.getElementById('voiceRow').getBoundingClientRect(), note = document.getElementById('voiceNote').getBoundingClientRect(); return [note.width > 0 && note.left >= row.left && note.right <= row.right + 0.5, document.getElementById('voiceNone').hidden]; }), [true, true], "the line that says which voice is reading isn't inside the menu, or the no-voice line shows");
assert.ok(offered.includes('Samantha') && !offered.some(o => /^(Fred|Zarvox|Bells|Eddy)/.test(o)), `the voices offered: ${offered.join(', ')}`);
// Hear it, and what was said for it: one line, however soon after the last (a tap while it's still talking
// starts it again, a quarter of a second after the cancel).
const hearIt = async () => {
  await page.evaluate(() => window.__said.splice(0));
  await page.click('#hearIt');
  await page.waitForFunction(() => window.__said.some(u => u.volume !== 0));
  await page.waitForTimeout(400);
  return (await page.evaluate(() => window.__said.splice(0))).filter(u => u.volume !== 0);
};
const sample = await hearIt();
assert.deepEqual(sample.map(u => [u.text, u.voice, u.lang]), [['They turn for home! Copper Detour by a length and a half!', 'Google US English', 'en-US']], 'Hear it should say one line, in the best voice here');
// At the pace of a race: a little quicker than the steady 1.15, never past 1.2, at the voice's own pitch.
assert.ok(sample[0].rate > 1.15 && sample[0].rate <= 1.2 && sample[0].pitch === 1, `Hear it isn't at the pace of a race: ${sample[0].rate}, ${sample[0].pitch}`);
await page.selectOption('#optVoiceName', 'Samantha');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('post-time/player')).settings.voiceName), 'Samantha', "the voice chosen isn't saved");
assert.deepEqual((await hearIt()).map(u => u.voice), ['Samantha'], 'Hear it should say one line, in the voice chosen');
// The line goes out in the language of the voice chosen: on an Android phone that is what picks the voice.
await page.selectOption('#optVoiceName', 'Daniel');
assert.equal(await reading(), 'Reading in Daniel', "the line under the list doesn't follow the choice");
assert.deepEqual((await hearIt()).map(u => [u.voice, u.lang]), [['Daniel', 'en-GB']], 'Hear it should be sent in the language of the voice chosen');
await page.selectOption('#optVoiceName', 'Samantha');
assert.deepEqual((await hearIt()).map(u => [u.voice, u.lang]), [['Samantha', 'en-US']]);
await page.reload();
await page.waitForSelector('.races');
await page.click('#menuBtn');
assert.deepEqual(await page.evaluate(() => [document.getElementById('voiceRow').hidden, document.getElementById('optVoiceName').value]), [false, 'Samantha'], 'the voice chosen is gone after a reload');
// On a new visit with the call already ticked, Hear it is the first tap that speaks: the silent word goes
// with it, once.
await page.click('#hearIt');
await page.waitForFunction(() => window.__said.length > 1);
await page.click('#hearIt');
await page.waitForTimeout(500);
assert.deepEqual(await page.evaluate(() => window.__said.map(u => u.volume === 0)), [true, false, false], 'the silent word should be said once, with the first tap that speaks');
// A voice this browser hasn't got (chosen on another device, or deleted since): the best here reads the
// call meanwhile, and the choice is kept and shown.
await page.evaluate(() => { const { game, save } = window.postTime; game.player.settings.voiceName = 'Ava (Premium)'; save(); });
await page.reload();
await page.waitForSelector('.races');
await page.click('#menuBtn');
assert.equal(await page.locator('#optVoiceName option:checked').textContent(), 'Ava (Premium) (not here now)');
assert.equal(await reading(), 'Reading in Google US English');
assert.deepEqual((await hearIt()).map(u => u.voice), ['Google US English'], 'with the chosen voice missing, the best here should read');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('post-time/player')).settings.voiceName), 'Ava (Premium)', 'a missing voice was forgotten');
// Back to the best here: nothing is saved for it, as in a save from before there was a choice.
await page.selectOption('#optVoiceName', '');
assert.equal(await page.evaluate(() => 'voiceName' in JSON.parse(localStorage.getItem('post-time/player')).settings), false);
await page.click('#menuBtn');

// The race's Sound button quiets the caller too: turned off during a race, it cuts off the line being read
// and the ones after it until it's turned back on. The next race is read again with Sound off, since
// reading the call aloud has a tick of its own in the menu.
await page.waitForFunction(() => window.__quiet()); // the line Hear it said is over
await page.evaluate(() => window.__voice.splice(0));
await page.click('#menuBtn');
await page.check('#optSound');
await page.check('#optVoice');
await page.click('#menuBtn');
await page.click('.race-row.next');
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
const quieted = await page.evaluate(async () => {
  const w = window.__watch, lines = w.call.lines, v = window.__voice;
  const reach = async k => { w.setT(w.t0 + lines[k].t + 0.05); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };
  const sound = () => [...document.querySelectorAll('.w-ctl button')].find(b => b.textContent === 'Sound').click();
  const readSince = i => v.slice(i).filter(x => x !== '(cancel)');
  const mid = Math.max(3, Math.floor(lines.length / 2));
  await reach(2);
  const read = readSince(0).length > 0;
  sound(); // off
  const cut = v[v.length - 1] === '(cancel)';
  const off = v.length;
  await reach(mid);
  const whileOff = readSince(off);
  sound(); // on again
  const on = v.length;
  await reach(mid + 1);
  await new Promise(r => setTimeout(r, 400)); // a line waits a quarter of a second after a cancel
  return { read, cut, whileOff, again: readSince(on).length > 0 };
});
assert.deepEqual(quieted, { read: true, cut: true, whileOff: [], again: true }, "the race's Sound button doesn't quiet the caller, or doesn't let it carry on when it's back on");
await page.locator('.w-ctl button', { hasText: /^sound$/i }).click(); // off, and left off for the next race
await page.evaluate(() => window.__watch.setT(window.__watch.endT - 0.05));
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
await page.click('.w-ctl .btn');
await page.waitForSelector('.official');
await page.waitForFunction(() => window.__quiet());
await page.locator('.actions .btn', { hasText: /^Race 2/ }).click();
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
const nextRace = await page.evaluate(async () => {
  const w = window.__watch;
  window.__voice.splice(0); window.__said.splice(0); window.__ended.splice(0);
  w.setT(w.t0 + w.call.lines[2].t + 0.05);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { menu: ['optSound', 'optVoice'].map(id => document.getElementById(id).checked), read: window.__voice.filter(x => x !== '(cancel)') };
});
assert.deepEqual({ ...nextRace, read: nextRace.read.length }, { menu: [false, true], read: 1 }, "the next race isn't read aloud with Sound off and the call's own tick on");
// The call at the wire doesn't wait its turn: it comes at once (a quarter of a second after cutting off a
// line that has a way to go), at the top of the pace, which builds from the steady pace early on. Then
// the placings and the time, back at the steady pace, with the time in words though the call box keeps
// its digits. The top of the pace is 1.2 times the voice's own speed, at its own pitch: sped up more
// than that, a device's voice is a chipmunk.
const paced = await page.evaluate(async () => {
  const w = window.__watch, lines = w.call.lines, said = window.__said;
  const until = async f => { for (const end = performance.now() + 30000; !f();) { if (performance.now() > end) throw new Error(`still waiting: ${f}`); await new Promise(r => setTimeout(r, 30)); } };
  const wire = lines.find(l => l.wire), last = lines[lines.length - 1];
  w.setT(w.t0 + wire.t + 0.02);
  await until(() => said.some(u => u.text === wire.say));
  // The last line follows the winner's line directly.
  await until(() => said.some(u => u.text === last.say));
  const shown = document.querySelector('.call .now').textContent;
  w.setT(w.endT - 0.05);
  const pace = text => { const u = said.find(x => x.text === text); return [u.rate, u.pitch]; };
  return { early: pace(lines[2].say), wire: pace(wire.say), last: pace(last.say), read: last.say, shown, most: [Math.max(...said.map(u => u.rate)), Math.max(...said.filter(u => u.volume !== 0).map(u => u.pitch))] };
});
assert.deepEqual([paced.early, paced.wire, paced.last], [[1.15, 1], [1.2, 1], [1.15, 1]], "the caller's pace doesn't build to the wire and settle after it");
assert.deepEqual(paced.most, [1.2, 1], 'a line was asked for faster than 1.2, or at a raised pitch');
assert.match(paced.shown, /The time, (\d:)?\d\d\.\d\d\.$/, 'the call box lost the time in digits');
assert.match(paced.read, /The time, [a-z -]+\.$/, 'the voice is given the time in digits');
// On the way to the results the caller finishes the line he's on (second, third and the time; after a
// photo, who won it). Any other way out of a race, he stops.
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 20000 });
const toResults = await page.evaluate(() => {
  const heard = window.__heard, last = heard.filter(x => x.ev === 'speak').pop();
  const saying = heard.some(x => x.at > last.at && x.ev !== 'speak') ? null : last.text;
  document.querySelector('.w-ctl .btn').click();
  return { saying, at: last.at };
});
await page.waitForSelector('.official');
assert.ok(toResults.saying, 'the caller had finished before Results was tapped, and this checked nothing');
assert.equal(await page.evaluate(at => window.__heard.some(x => x.ev === 'cancel' && x.at > at), toResults.at), false, 'the caller was cut off on the way to the results');
await page.waitForFunction(({ saying, at }) => window.__heard.some(x => x.ev === 'end' && x.text === saying && x.at > at), toResults, { timeout: 15000 });
await page.waitForFunction(() => window.__quiet());
await page.locator('.actions .btn', { hasText: /^Race 3/ }).click();
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
// The page goes out of sight in the middle of a race (another tab, the phone locked): the voice stops, the
// line waiting behind it is forgotten, and the crowd and hooves are held. Back in sight, the voice is
// cancelled once in case it was left stuck, the sound comes back, and nothing is said until the next line.
// (The race is stopped where it is for this, so no line comes up but the ones it's moved to.)
const outOfSight = await page.evaluate(async () => {
  const w = window.__watch, v = window.__voice, lines = w.call.lines;
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const seen = yes => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !yes });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (yes ? 'visible' : 'hidden') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  [...document.querySelectorAll('.w-ctl button')].find(b => b.textContent === 'Sound').click(); // on
  // A line that takes a few seconds to say, and the one after it brought up while it's still being said.
  const k = lines.findIndex((l, i) => i > 3 && i < lines.length - 3 && lines[i - 1].t > 1 && lines[i - 1].d > 3);
  w.setT(w.t0 + lines[k - 1].t + 0.05); await frames();
  w.pause();
  await wait(300); // clear of the cancel that Sound made
  w.setT(w.t0 + lines[k].t + 0.05); await frames();
  await wait(100);
  const before = { saying: v[v.length - 1] === lines[k - 1].say, sound: window.__sound.state };
  seen(false);
  await wait(100);
  const away = { cut: v[v.length - 1] === '(cancel)', sound: window.__sound.state };
  const from = v.length;
  await wait(500);
  seen(true);
  await wait(500);
  const back = { said: v.slice(from), sound: window.__sound.state };
  w.setT(w.t0 + lines[k + 1].t + 0.05); await frames();
  await wait(100);
  return { k, before, away, back, next: v[v.length - 1] === lines[k + 1].say };
});
assert.ok(outOfSight.k > 3, 'no line of three seconds in this race to check with');
assert.deepEqual(outOfSight.before, { saying: true, sound: 'running' });
assert.deepEqual(outOfSight.away, { cut: true, sound: 'suspended' }, 'out of sight, the voice or the sound carries on');
assert.deepEqual(outOfSight.back, { said: ['(cancel)'], sound: 'running' }, 'back in sight: one cancel, the sound back, and nothing said until the next line');
assert.ok(outOfSight.next, "the next line wasn't read after the page came back");
const leftEarly = await page.evaluate(async () => {
  const v = window.__voice;
  const read = v[v.length - 1] !== '(cancel)';
  window.postTime.nav.go('card');
  return { read, cut: v[v.length - 1] === '(cancel)' };
});
assert.deepEqual(leftEarly, { read: true, cut: true }, 'leaving a race for the card leaves the caller talking');
await page.waitForSelector('.races');

// The sound of a race, measured where it goes to the speaker (nobody hears it here). The starting bell
// rings as the race runs through the off. The crowd builds to the wire and roars as the winner crosses:
// the two seconds after the wire are louder than the two before. (The roar used to be replaced by the
// next frame's level, so the crowd fell away from the wire on.) The race is opened with the sound off, so
// the bugle isn't in the measurement, and the bell is over two seconds before the wire.
await page.evaluate(() => document.getElementById('optSound').click()); // off
await page.click('.race-row.next');
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
await page.locator('.w-ctl button', { hasText: /^sound$/i }).click(); // on
const roar = await page.evaluate(async () => {
  const w = window.__watch, tap = window.__sound.tap, buf = new Float32Array(2048);
  const bells = () => window.__oscillators.filter(o => o.frequency.value === 1760).length;
  const before = bells();
  w.setT(-0.15);
  while (w.T < 0.1) await new Promise(r => requestAnimationFrame(r));
  const rang = bells() - before;
  w.setT(w.winT - 3.8);
  const heard = []; // [seconds from the wire on the clock on the wall, the power going to the speaker, the crowd's level]
  let wire = null;
  for (;;) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now() / 1000;
    if (wire === null && w.T >= w.winT) wire = now;
    tap.getFloatTimeDomainData(buf);
    heard.push([now, buf.reduce((sum, v) => sum + v * v, 0) / buf.length, window.__crowd.gain.value]);
    if (wire !== null && now - wire > 2.05) break;
  }
  const mean = (from, to, k) => { const in2 = heard.filter(x => x[0] - wire >= from && x[0] - wire < to); return in2.reduce((sum, x) => sum + x[k], 0) / in2.length; };
  const db = power => +(10 * Math.log10(power)).toFixed(1);
  return { rang, sound: window.__sound.state, before: db(mean(-2, 0, 1)), after: db(mean(0, 2, 1)), crowdBefore: +mean(-2, 0, 2).toFixed(2), crowdAfter: +mean(0, 2, 2).toFixed(2), frames: heard.length };
});
assert.deepEqual([roar.rang, roar.sound], [1, 'running'], 'the starting bell should ring once as the race runs through the off');
assert.ok(roar.after > roar.before && roar.crowdAfter > roar.crowdBefore, `the two seconds after the wire (${roar.after} dB, crowd at ${roar.crowdAfter}) are no louder than the two before (${roar.before} dB, crowd at ${roar.crowdBefore})`);
await page.evaluate(() => window.postTime.nav.go('card'));
await page.waitForSelector('.races');
// Skip from the gate picks the race up with twelve seconds to run. The crowd and the hooves start there,
// and the bell, which is for the off, doesn't ring in mid-stretch.
await page.click('.race-row.next');
await page.click('.post-bar .btn.brass');
await page.waitForSelector('.watch:not([hidden]) canvas.scene');
const skipped = await page.evaluate(async () => {
  const w = window.__watch, made = window.__oscillators.length, crowd = window.__crowd;
  const inGate = w.T < 0;
  [...document.querySelectorAll('.w-ctl button')].find(b => /^Skip/.test(b.textContent)).click();
  for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
  return { inGate, toRun: Math.round(w.winT - w.T), bells: window.__oscillators.slice(made).filter(o => o.frequency.value === 1760).length, crowd: window.__crowd !== crowd };
});
assert.deepEqual(skipped, { inGate: true, toRun: 12, bells: 0, crowd: true }, 'after Skip from the gate the starting bell rings in mid-stretch, or the crowd never starts');
// On a wide screen that isn't tall, the picture gives way when anything under it grows. The camera keeps
// its place when the picture changes size (it used to snap to where it was easing to), and Results is the
// height of the buttons it joins, so the picture doesn't change size at the finish at all.
await page.setViewportSize({ width: 1280, height: 700 });
const steady = await page.evaluate(async () => {
  const w = window.__watch, stage = document.querySelector('.w-stage'), row = document.querySelector('.w-ctl');
  const frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); };
  const tall = el => el.getBoundingClientRect().height;
  await frames(3);
  // Follow the last horse, and stop the race while the camera is on its way across to it.
  [...document.querySelectorAll('.order button')].pop().click();
  await new Promise(r => setTimeout(r, 150));
  w.pause();
  await frames(3);
  const was = { off: w.cam.off, span: w.cam.span, stage: tall(stage) };
  row.style.paddingBottom = '20px'; // the row under the picture, 8 px taller
  await frames(4);
  const now = { off: w.cam.off, span: w.cam.span, stage: tall(stage) };
  row.style.paddingBottom = '';
  await frames(4);
  // On to the finish, at normal speed again.
  document.querySelector('.w-ctl button').click();
  const racing = { stage: tall(stage), row: tall(row) };
  w.setT(w.endT - 0.1);
  return { resized: was.stage - now.stage, moved: Math.abs(now.off - was.off) + Math.abs(now.span - was.span), racing };
});
assert.ok(steady.resized > 4, `the picture didn't change size for the check (${steady.resized}px)`);
assert.ok(steady.moved < 0.001, `the camera jumped ${steady.moved.toFixed(2)} m when the picture changed size`);
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
const atFinish = await page.evaluate(() => ({ stage: document.querySelector('.w-stage').getBoundingClientRect().height, row: document.querySelector('.w-ctl').getBoundingClientRect().height }));
assert.deepEqual(atFinish, steady.racing, 'the picture or the row of buttons changes height when Results appears');
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.postTime.nav.go('card'));
await page.waitForSelector('.races');

// The gate, with the sound and the voice both on: the bugle, then the caller, then the bell. The caller's
// first words used to be spoken over the bugle's last notes, and a race's name ran into the bell. Now his
// first line starts when the bugle is over (its notes are 3.78 seconds long), the gates wait for him, and
// "they're off" is said with the bell, in a race with a name as in any other.
await page.click('#menuBtn');
await page.check('#optSound');
await page.check('#optVoice');
await page.click('#menuBtn');
await page.waitForFunction(() => window.__quiet());
await page.click('.race-row.next');
const gate = await page.evaluate(async () => {
  window.postTime.nextRace().name = 'Odds and Ends Handicap';
  const heard = window.__heard, from = window.__from = heard.length, made = window.__oscillators.length;
  const tap = performance.now();
  document.querySelector('.post-bar .btn.brass').click();
  const w = window.__watch;
  // Every line as it comes up in the call box, with the time.
  const shown = window.__shown = [], box = document.querySelector('.call .now');
  new MutationObserver(() => shown.push({ text: box.textContent, at: performance.now() })).observe(box, { childList: true, characterData: true, subtree: true });
  for (const end = performance.now() + 20000; w.T < 0.6;) { if (performance.now() > end) throw new Error('the race never left the gate'); await new Promise(r => requestAnimationFrame(r)); }
  const spoken = heard.slice(from).filter(x => x.ev === 'speak' && !x.silent);
  const bell = window.__oscillators.slice(made).find(o => o.frequency.value === 1760);
  const [pre, off] = w.call.lines;
  return {
    wait: w.call.gate, line: pre.d, first: (spoken[0].at - tap) / 1000, bell: (bell.madeAt - tap) / 1000, off: (spoken[1].at - bell.madeAt) / 1000,
    said: spoken.slice(0, 2).map(x => x.text), lines: [pre.say, off.say], kinds: [pre.kind, off.kind], over: heard.some(x => x.ev === 'end' && x.text === pre.say && x.at <= spoken[1].at),
    cancels: heard.slice(from).filter(x => x.ev === 'cancel').length,
  };
});
assert.deepEqual([gate.said, gate.kinds, gate.cancels], [gate.lines, ['pre', 'off'], 0], 'the first two lines read should be the one before the off and the off');
assert.match(gate.lines[0], / for the Odds and Ends Handicap\.$/);
assert.ok(gate.first >= 3.78 && gate.first < 3.78 + 0.3 + 1.5, `the caller's first line started ${gate.first.toFixed(2)} s after the bugle did, and the bugle is 3.78 s long`);
assert.ok(Math.abs(gate.wait - (3.83 + 0.3 + gate.line + 0.4)) < 0.02 && gate.wait > 5.2, `${gate.wait.toFixed(2)} s in the gate for a first line of ${gate.line.toFixed(2)} s`);
assert.ok(gate.bell >= gate.wait - 0.05 && gate.bell < gate.wait + 1.5, `the bell rang ${gate.bell.toFixed(2)} s in, and the wait in the gate is ${gate.wait.toFixed(2)} s`);
assert.ok(gate.over && Math.abs(gate.off) <= 0.2, `the off was said ${gate.off.toFixed(2)} s from the bell${gate.over ? '' : ', with the first line still being read'}`);

// The call is read at 4x and at 2x (it used to be hushed at both). A change of speed doesn't cut off the line
// being said; the rest of the race is called for the new speed, each line said as it comes up. Here: to 4x
// in the middle of a line, and on to the end of the race.
// (What was read since __from, each line with its kind, how long after it came up in the call box it was
// begun, and the pace asked for.)
await page.evaluate(() => {
  window.__read = () => {
    const w = window.__watch, heard = window.__heard, shown = window.__shown;
    const out = [];
    for (const x of heard.slice(window.__from)) {
      if (x.ev !== 'speak' || x.silent) continue;
      // After a photo the winner's line goes up with the official sign. It isn't one of the call's lines (the
      // call hands it back on its own), and it can be said within a moment of the placings ending: it's
      // read here as a line of its own kind, timed from when it came up like the rest.
      const official = w.call.official && x.text === w.call.official.replace(/\bDr\. /g, 'Doctor ') ? { text: w.call.official, slot: 'official' } : null;
      const line = w.call.lines.find(l => l.say === x.text) || official, up = line && shown.filter(y => y.text === line.text && y.at <= x.at + 20).pop();
      out.push({ text: x.text, at: x.at, slot: line ? line.slot : 'not in the call', leader: !!line && (line.lead !== undefined || !!line.pair), age: up ? (x.at - up.at) / 1000 : 99, rate: x.rate, ended: heard.some(y => y.ev === 'end' && y.text === x.text && y.at > x.at) });
    }
    return out;
  };
});
const at4 = await page.evaluate(async () => {
  const w = window.__watch, heard = window.__heard;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = (what, ms) => { const end = performance.now() + ms; return () => { if (performance.now() > end) throw new Error(`still waiting for ${what}`); return true; }; };
  // A line of three seconds or more, half a second into it.
  let long = null;
  for (const going = until('a long line', 40000); !long && going();) {
    await wait(30);
    const last = heard.filter(x => x.ev === 'speak').pop(), line = w.call.lines.find(l => l.say === last.text);
    if (w.T > 3 && line && line.d >= 3 && performance.now() - last.at > 500 && performance.now() - last.at < 1500 && !heard.some(x => x.ev === 'end' && x.at > last.at)) long = last;
  }
  const changed = performance.now(), plans = w.call.plans;
  [...document.querySelectorAll('.w-ctl button')].find(b => b.textContent === '4×').click();
  for (const going = until('the end of the call at 4x', 90000); going() && !w.call.lines.some(l => l.placings && heard.some(x => x.ev === 'end' && x.text === l.say));) await wait(50);
  const lines = window.__read();
  const cancels = heard.slice(window.__from).filter(x => x.ev === 'cancel');
  return {
    lines, changed, plans: w.call.plans - plans, long: long.text,
    cutAtChange: cancels.some(x => x.at >= changed && x.at < changed + 3000 && x.text === long.text),
    cancels: cancels.map(x => { const then = lines.find(l => l.at > x.at); return then ? then.slot : 'nothing after it'; }),
  };
});
const after4 = at4.lines.filter(l => l.at > at4.changed && l.slot !== 'official'); // (the winner's line after a photo, if it's been said by now, has its own check below)
assert.ok(at4.plans >= 1, 'the call was not planned again for the new speed');
assert.ok(!at4.cutAtChange && at4.lines.find(l => l.text === at4.long).ended, `"${at4.long}" was cut off by the change to 4x`);
assert.deepEqual(at4.cancels.filter(slot => slot !== 'wire'), [], 'a line was cancelled, and not for the call at the wire');
assert.ok(at4.lines.some(l => l.slot === 'off') && after4.some(l => l.leader) && after4.some(l => l.slot === 'wire'), `at 4x the off, a line that says who leads, or the winner's line was not read: ${after4.map(l => l.text).join(' / ')}`);
assert.deepEqual(at4.lines.filter(l => l.age > (l.slot === 'placings' ? 6 : 1.5)).map(l => `${l.text}: ${l.age.toFixed(2)} s after it came up`), [], 'a line was read long after it came up');
assert.deepEqual(at4.lines.filter(l => l.slot === 'not in the call').map(l => l.text), [], 'at 4x something was read that is no line of the call');
const headlines = ['run', 'fill', 'change', 'turn', 'eighth', 'wire', 'placings'];
assert.deepEqual(after4.slice(1).filter(l => !headlines.includes(l.slot)).map(l => `${l.slot}: ${l.text}`), [], 'more than the headlines at 4x');
assert.deepEqual([after4.find(l => l.slot === 'wire').rate, after4.find(l => l.slot === 'placings').rate], [1.2, 1.15], "the winner's line and the placings aren't at their own pace at 4x");
assert.ok(after4.length >= 3, `only ${after4.length} lines read at 4x`);
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
await page.click('.w-ctl .btn');
await page.waitForSelector('.official');
await page.waitForFunction(() => window.__quiet());
// The next race at 2x from the gate, then skipped ahead once a line has said who leads: Skip cancels the
// line being said, and the caller picks the race up twelve seconds from the wire.
await page.locator('.actions .btn', { hasText: /^Race \d/ }).click();
const at2 = await page.evaluate(async () => {
  const heard = window.__heard;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.__from = heard.length;
  document.querySelector('.post-bar .btn.brass').click();
  const w = window.__watch, button = text => [...document.querySelectorAll('.w-ctl button')].find(b => b.textContent.startsWith(text));
  const shown = window.__shown = [], box = document.querySelector('.call .now');
  new MutationObserver(() => shown.push({ text: box.textContent, at: performance.now() })).observe(box, { childList: true, characterData: true, subtree: true });
  button('2×').click();
  const spoke = f => heard.slice(window.__from).some(x => x.ev === 'end' && w.call.lines.some(l => l.say === x.text && f(l)));
  const until = (what, ms) => { const end = performance.now() + ms; return () => { if (performance.now() > end) throw new Error(`still waiting for ${what}`); return true; }; };
  for (const going = until('a line that says who leads', 40000); going() && !spoke(l => l.t > 0 && (l.lead !== undefined || l.pair));) await wait(30);
  const skipped = performance.now(), T = w.T;
  button('Skip').click();
  for (const going = until('the end of the call at 2x', 60000); going() && !spoke(l => l.placings);) await wait(50);
  const lines = window.__read();
  // The first line said after the skip, if it calls a new leader: how long that horse had had its head in front.
  const { stateAt } = await import('./js/sim.js');
  const first = w.call.lines.find(l => l.say === (lines.find(x => x.at > skipped) || {}).text);
  const front = t => stateAt(w.run, w.t0 + t, []).reduce((a, x, i, st) => (x.p > st[a].p ? i : a), 0);
  let old = 0;
  if (first && first.change) while (old < 20 && front(first.t - old - 0.1) === first.lead) old += 0.1;
  return { lines, skipped, old, jumped: w.winT - 12 > T, cancels: heard.slice(window.__from).filter(x => x.ev === 'cancel').map(x => (Math.abs(x.at - skipped) < 100 ? 'skip' : (lines.find(l => l.at > x.at) || {}).slot)) };
});
const after2 = at2.lines.filter(l => l.at > at2.skipped && l.slot !== 'official');
assert.ok(at2.jumped, 'the race was nearly over before Skip, and this checked nothing');
assert.ok(at2.lines.some(l => l.slot === 'off') && at2.lines.some(l => l.leader && l.at < at2.skipped) && after2.some(l => l.slot === 'wire'), `at 2x the off, a line that says who leads, or the winner's line was not read: ${at2.lines.map(l => l.text).join(' / ')}`);
assert.deepEqual(at2.cancels.filter(why => why !== 'skip' && why !== 'wire'), [], 'at 2x a line was cancelled, and not by Skip or for the call at the wire');
assert.deepEqual(at2.lines.filter(l => l.age > (l.slot === 'placings' ? 6 : 1.5)).map(l => `${l.text}: ${l.age.toFixed(2)} s after it came up`), [], 'at 2x a line was read long after it came up');
assert.deepEqual(at2.lines.filter(l => l.slot === 'not in the call').map(l => l.text), [], 'at 2x something was read that is no line of the call');
// (Twelve seconds of race at 2x is six of talk: a line or two, the winner's line, then second, third and the time.)
assert.ok(after2.length >= 2 && after2[after2.length - 1].slot === 'placings', `after Skip the caller said ${after2.map(l => l.text).join(' / ') || 'nothing'}`);
// He picks it up with who leads now. A new leader is only called as one if the change is news: the horse
// that was in front when Skip was tapped is forty seconds ago by then.
assert.ok(at2.old <= 3.05, `after Skip the caller's first words were "${after2[0].text}", of a horse ${at2.old.toFixed(1)} s in front`);
assert.deepEqual([after2.find(l => l.slot === 'wire').rate, after2.find(l => l.slot === 'placings').rate], [1.2, 1.15], "the winner's line and the placings aren't at their own pace at 2x");
await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 15000 });
await page.evaluate(() => window.postTime.nav.go('card'));
await page.waitForSelector('.races');

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
  // This browser has no voice at all (as inside an Artifact viewer): the menu has no voice row.
  await first.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }));
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
  // The placing judges read a photo; the stewards rule on fouls.
  const howTo = await first.locator('#app .help').textContent();
  assert.ok(/In a close finish the placing judges read the photo\./.test(howTo) && !/stewards/.test(howTo), 'How to play has the stewards reading the photo');
  await first.click('.rhead .back');
  assert.deepEqual(await opening(), { progress: true, bank: '' }, "the progress doesn't come back after How to play");
  // Start a new meet does nothing while one is being built: taps on it, a second apart, don't start another
  // beside the first (which used to put up one meet's card and then replace it with the other's).
  await first.click('#menuBtn');
  await first.click('#restart', { force: true });
  await first.waitForTimeout(900);
  await first.click('#restart', { force: true });
  assert.deepEqual(await first.evaluate(() => { const b = document.getElementById('restart'); return [b.textContent, b.disabled]; }), ['Start a new meet', true], 'Start a new meet can be tapped while a meet is being built');
  await first.click('#menuBtn');
  await first.evaluate(() => window.finishBuilding());
  await first.waitForSelector('.races', { timeout: 60000 });
  const built = await first.evaluate(() => window.postTime.game.world.seed);
  await first.waitForTimeout(1500);
  assert.deepEqual(await first.evaluate(() => [window.postTime.game.world.seed, !!document.querySelector('.setup'), document.getElementById('restart').disabled]), [built, false, false], 'a second meet was built beside the first');
  assert.equal(await first.locator('#bank').textContent(), '$200.00');
  // With the call ticked, one line says there's no voice here, in place of the choice of voice and Hear it.
  const voiceRow = p => p.evaluate(() => {
    const seen = id => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0; };
    return { line: seen('voiceNone') ? document.getElementById('voiceNone').textContent : '', list: seen('optVoiceName'), hearIt: seen('hearIt'), note: seen('voiceNote') ? document.getElementById('voiceNote').textContent : '', ticked: document.getElementById('optVoice').checked };
  });
  const NO_VOICE = 'This browser has no voice to read the call. The call is still shown under the picture.';
  await first.click('#menuBtn');
  assert.deepEqual(await voiceRow(first), { line: '', list: false, hearIt: false, note: '', ticked: false });
  await first.check('#optVoice');
  assert.deepEqual(await voiceRow(first), { line: NO_VOICE, list: false, hearIt: false, note: '', ticked: true }, 'a voice is offered in a browser that has none, or nothing says there is none');
  await first.uncheck('#optVoice');
  await first.click('#menuBtn');
  // The commoner case: the browser has speech and no voice to speak with. Its list is empty and every line
  // comes back as failed (headless Chromium is one; so is a desktop with no speech service). The menu
  // offered "Best here" and Hear it, and tapping Hear it did nothing with no word of why. Now the same line
  // shows, the tick stays, and the choice comes back if a voice turns up.
  {
    const mute = await ctx2.newPage();
    mute.on('pageerror', e => problems.push(e.message));
    await mute.addInitScript(() => {
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      const speech = { list: [], tell: null, getVoices() { return this.list; }, speak(u) { setTimeout(() => u.onerror && u.onerror({ error: 'synthesis-failed' }), 1); }, cancel() {}, addEventListener(type, fn) { if (type === 'voiceschanged') this.tell = fn; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
    });
    await mute.goto(base, { waitUntil: 'domcontentloaded' });
    await mute.waitForSelector('.races');
    await mute.click('#menuBtn');
    await mute.check('#optVoice');
    await mute.waitForSelector('#voiceNone:not([hidden])', { timeout: 5000 });
    assert.deepEqual(await voiceRow(mute), { line: NO_VOICE, list: false, hearIt: false, note: '', ticked: true }, 'with speech and no voice, the menu still offers a voice');
    assert.equal(await mute.evaluate(() => document.getElementById('menu').scrollWidth <= document.getElementById('menu').clientWidth + 1), true, 'the line is wider than the menu');
    await mute.evaluate(() => { const s = window.speechSynthesis; s.list = [{ name: 'Chrome OS US English 4', lang: 'en-US', localService: true }, { name: 'Chrome OS US English 1', lang: 'en-US', localService: true }]; s.tell(); });
    await mute.waitForSelector('#voiceNone', { state: 'hidden' });
    assert.deepEqual(await voiceRow(mute), { line: '', list: true, hearIt: true, note: 'Reading in Chrome OS US English 4', ticked: true }, 'a voice turned up, and the choice is not back');
    await mute.uncheck('#optVoice');
    // How to play says where the call is, and that it can be read aloud.
    await mute.click('#menu [data-go="help"]');
    assert.match(await mute.locator('#app .help').textContent(), /The caller's lines run under the picture as the race goes\. Tick Read the race call aloud in the menu to have them spoken\./);
    await mute.close();
  }

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
  // Forward onto a race from a race day that's over stays on the card, rather than opening today's race
  // with the same number.
  await first.click('.race-row.next');
  await first.waitForSelector('.entry');
  await first.click('.rhead .back');
  await first.waitForSelector('.races');
  await first.evaluate(async () => { (await import('./js/game.js')).advanceDay(); window.postTime.nav.go('card'); });
  await first.goForward();
  await first.waitForTimeout(500);
  assert.equal(await first.locator('.races').count(), 1, "Forward opened today's race in place of the one from the day before");
  await first.waitForFunction(() => history.state === null); // and the game has stepped back to the card's entry
  await first.goBack();
  assert.match(first.url(), /manifest\.webmanifest$/, 'Back on the card stays in the game');
  await ctx2.close();
}

// The running order on a phone, with the day's biggest field: every number is on the screen, at the gate
// and in the middle of the race, 320 wide and 390 wide (with nine or more runners the row used to run off
// the right edge). A field too big for one row has two, and the picture is the same size at the gate as in
// the race. There are no margins for the first four seconds. Following a horse names it under the buttons.
{
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const phone = await ctx3.newPage();
  phone.on('pageerror', e => problems.push(e.message));
  phone.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await phone.goto(base, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('.races', { timeout: 60000 });
  await phone.evaluate(() => document.fonts.ready);
  const biggest = await phone.evaluate(() => { const { game, card, save } = window.postTime; game.player.settings.sound = false; save(); return card().races.reduce((a, r) => (r.entries.length > a.entries.length ? r : a)).no; });
  for (const width of [390, 320]) {
    await phone.setViewportSize({ width, height: width === 390 ? 844 : 568 });
    await phone.evaluate(no => window.postTime.nav.go('watch', { no }), biggest);
    await phone.waitForSelector('.watch:not([hidden]) canvas.scene');
    const strip = await phone.evaluate(async () => {
      const w = window.__watch, out = { field: w.run.n, off: [], stage: new Set(), rows: new Set(), margins: {} };
      const frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); };
      w.pause();
      for (const t of [-3, 2.5, 6, 20, w.winT - 14, w.winT - 6, w.winT - 1]) {
        w.setT(t);
        await frames(3);
        const buttons = [...document.querySelectorAll('.order button')];
        out.off.push(...buttons.filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).map(b => `${b.getAttribute('aria-label')} at ${t.toFixed(0)} s`));
        if (buttons.length !== w.run.n) out.off.push(`${buttons.length} numbers at ${t.toFixed(0)} s`);
        out.stage.add(Math.round(document.querySelector('.w-stage').getBoundingClientRect().height));
        out.rows.add(new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top))).size);
        out.margins[Math.round(t)] = document.querySelectorAll('.order .gap').length;
      }
      // Follow the last horse in the order, and stop following it.
      const last = [...document.querySelectorAll('.order button')].pop(), hint = document.querySelector('.w-ctl .hint');
      const name = last.getAttribute('aria-label').replace(/^\d+: number (\d+), /, '#$1 ');
      last.click();
      out.following = hint.textContent === `Following ${name}. Tap again for the leaders.`;
      await frames(3);
      out.ring = getComputedStyle(document.querySelector('.order button.follow .cloth')).boxShadow.includes('245, 179, 61');
      document.querySelector('.order button.follow').click();
      out.leaders = /^Tap a number in the running order/.test(hint.textContent);
      await frames(3);
      out.stage.add(Math.round(document.querySelector('.w-stage').getBoundingClientRect().height));
      return { ...out, stage: [...out.stage], rows: [...out.rows], two: document.querySelector('.order').classList.contains('two'), sideways: document.getElementById('watch').scrollWidth > innerWidth };
    });
    assert.deepEqual(strip.off, [], `${width} wide, ${strip.field} runners: running-order numbers off the screen`);
    assert.equal(strip.stage.length, 1, `${width} wide: the picture changes size as the running order does: ${strip.stage}`);
    assert.ok(Math.max(...strip.rows) <= (strip.two ? 2 : 1) && !strip.sideways, `${width} wide, ${strip.field} runners: the running order takes ${strip.rows} rows`);
    assert.deepEqual([strip.margins[-3], strip.margins[3], strip.margins[6], strip.margins[20]], [0, 0, strip.field - 1, strip.field - 1], `${width} wide: margins in the first four seconds, or none after`);
    assert.deepEqual([strip.following, strip.ring, strip.leaders], [true, true, true], "following a horse isn't shown under the buttons or with an amber ring");
    await phone.evaluate(() => window.postTime.nav.go('card'));
    await phone.waitForSelector('.races');
  }
  await ctx3.close();
}

// The running order with a mouse and with the keyboard. Its buttons are made once and kept for the race: the
// strip used to be emptied and built again whenever a margin changed, three times a second, so a mouse press
// held 150 ms lost its button before it came up (9 of 20 presses followed nothing), and a button with the
// keyboard's focus was replaced by a new one each time. Now a number moves only when its horse has gone a
// head past another: for five seconds of the biggest field the strip's children change less than once a
// second, the button with the focus is the same one at the end, and twenty presses all follow the horse
// that was under the pointer when it went down.
{
  const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desk = await ctx4.newPage();
  desk.on('pageerror', e => problems.push(e.message));
  desk.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await desk.goto(base, { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('.races', { timeout: 60000 });
  await desk.evaluate(() => document.fonts.ready);
  const biggest = await desk.evaluate(() => { const { game, card, save } = window.postTime; game.player.settings.sound = false; save(); return card().races.reduce((a, r) => (r.entries.length > a.entries.length ? r : a)).no; });
  // A scrapbook with nothing in it says how a photo gets there.
  await desk.evaluate(() => window.postTime.nav.go('book'));
  assert.equal(await desk.locator('.pad.muted').textContent(), "Back a winner and you're in the picture. Your photos collect here.");
  // The keyboard's focus is never under the header, the tabs or the bar at the bottom, and it has the game's
  // own ring. In a window 600 px tall, Tab through the Bet tab from the top (12 of its 52 stops used to be
  // wholly under the bar), then back up through the Form with Shift+Tab (6 of 39 were under the header and
  // the tabs). The page keeps room clear at its top and bottom for what's fixed there.
  await desk.setViewportSize({ width: 1280, height: 600 });
  for (const [tab, key] of [['bet', 'Tab'], ['form', 'Shift+Tab']]) {
    await desk.evaluate(tab => { window.postTime.nav.go('race', { no: 1, tab }); if (tab === 'form') [...document.querySelectorAll('.entry-head')].pop().focus(); }, tab);
    const under = [], rings = new Set();
    let stops = 0;
    for (let k = 0; k < 70; k++) {
      await desk.keyboard.press(key);
      const at = await desk.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect(), box = s => document.querySelector(s).getBoundingClientRect(), cs = getComputedStyle(el);
        const fixed = el.closest('.top, .tabs, .post-bar, .menu');
        const belowTabs = !!(document.querySelector('.tabs').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        const hid = fixed ? '' : r.bottom > box('.post-bar').top + 1 ? 'the bar' : r.top < box('.top').bottom - 1 ? 'the header' : belowTabs && r.top < box('.tabs').bottom - 1 ? 'the tabs' : '';
        return { hid, name: (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30), ring: `${cs.outlineStyle} ${cs.outlineWidth}` };
      });
      if (!at) continue;
      stops++;
      rings.add(at.ring);
      if (at.hid) under.push(`${at.name}, under ${at.hid}`);
    }
    assert.ok(stops >= 10, `${key} on the ${tab} tab stopped at only ${stops} controls`);
    assert.deepEqual(under, [], `${key} on the ${tab} tab put the focus where it can't be seen`);
    assert.deepEqual([...rings], ['solid 3px'], 'a control with the keyboard focus should have the 3 px ring');
  }
  await desk.setViewportSize({ width: 1280, height: 800 });
  await desk.evaluate(no => window.postTime.nav.go('watch', { no }), biggest);
  await desk.waitForSelector('.watch:not([hidden]) .order button');
  await desk.evaluate(() => window.__watch.setT(8));
  await desk.waitForTimeout(400);
  const parked = await desk.evaluate(() => new Promise(resolve => {
    const strip = document.querySelector('.order'), b = strip.querySelectorAll('button')[3];
    let changes = 0, given = 0;
    const seen = new MutationObserver(() => { changes++; });
    seen.observe(strip, { childList: true, subtree: true });
    b.focus();
    strip.addEventListener('focusin', () => given++);
    setTimeout(() => { seen.disconnect(); resolve({ changes, given, same: document.activeElement === b, role: strip.getAttribute('role'), pressed: [...strip.querySelectorAll('button')].map(x => x.getAttribute('aria-pressed')).join() }); }, 5000);
  }));
  assert.ok(parked.changes < 5, `the running order's buttons were moved or made again ${parked.changes} times in 5 seconds`);
  assert.deepEqual([parked.same, parked.given], [true, 0], 'the button with the keyboard focus was replaced, or given the focus again, while the race ran');
  assert.ok(parked.role === 'group' && /^false(,false)+$/.test(parked.pressed), 'the running order is not a group of buttons that say whether they are pressed');
  await desk.evaluate(() => document.querySelector('.order').addEventListener('pointerdown', e => { window.__down = e.target.closest('button')?.dataset.i ?? null; }, true));
  const missed = [];
  for (let k = 0; k < 20; k++) {
    // Nothing followed, and a number from the middle of the strip.
    const at = await desk.evaluate(() => {
      const w = window.__watch, on = document.querySelector('.order button[aria-pressed="true"]');
      if (on) on.click();
      if (w.T > w.winT - 15) w.setT(8);
      const r = document.querySelectorAll('.order button')[2].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await desk.mouse.move(at.x, at.y);
    await desk.mouse.down();
    await desk.waitForTimeout(150);
    await desk.mouse.up();
    const took = await desk.evaluate(() => { const on = document.querySelectorAll('.order button[aria-pressed="true"]'); return { down: window.__down, on: [...on].map(b => b.dataset.i), ring: [...on].every(b => b.classList.contains('follow')) }; });
    if (took.down === null || took.on.length !== 1 || took.on[0] !== took.down || !took.ring) missed.push(`press ${k + 1}: down on ${took.down}, following ${took.on.join() || 'nothing'}`);
  }
  assert.deepEqual(missed, [], 'a mouse press held 150 ms on a running-order number did not follow that horse');
  await ctx4.close();
}

// The ticket just bought prints where it can be seen: once the page has come to rest it is whole between the
// tabs and the bar at the bottom, on a phone and on a small one, whichever Buy button bought it (the slip's
// or the bar's). It used to come out behind the bar, 40 of its 53 px hidden. And only that ticket prints:
// opening the Bet tab again, or cancelling another ticket, used to slide the last one out again.
{
  const ctx5 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const shop = await ctx5.newPage();
  shop.on('pageerror', e => problems.push(e.message));
  shop.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  // Every oscillator the page makes is noted (nobody hears it here): the cash window's three are the only
  // triangle waves.
  await shop.addInitScript(() => {
    const Sound = window.AudioContext;
    window.__made = [];
    window.AudioContext = class extends Sound { createOscillator() { const o = super.createOscillator(); window.__made.push(o); return o; } };
  });
  await shop.goto(base, { waitUntil: 'domcontentloaded' });
  await shop.waitForSelector('.races', { timeout: 60000 });
  await shop.evaluate(() => { const { game, save } = window.postTime; game.player.settings.sound = false; save(); return document.fonts.ready.then(() => 0); });
  const printing = () => shop.evaluate(() => [...document.querySelectorAll('.ticket')].filter(t => t.classList.contains('printed') || getComputedStyle(t).animationName !== 'none').length);
  // How many of these are in each row on the screen.
  const rowsOf = sel => shop.evaluate(sel => { const tops = [...document.querySelectorAll(sel)].map(x => Math.round(x.getBoundingClientRect().top)); return [...new Set(tops)].map(t => tops.filter(x => x === t).length); }, sel);
  const even = rows => Math.max(...rows) - Math.min(...rows) <= 1;
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await shop.setViewportSize({ width, height });
    // A line made of pieces with dots between them (a race's small line on the card, a horse's rider and
    // trainer in the form) breaks only between pieces, and a dot goes to the next line with what follows
    // it. ("purse" used to be left alone on a second line, or a dot left hanging at the end of the first.)
    const pieces = { n: 0, broken: [] };
    for (const [screen, params] of [['card', {}], ['race', { no: 8 }]]) {
      await shop.evaluate(([screen, params]) => window.postTime.nav.go(screen, params), [screen, params]);
      const seen = await shop.evaluate(() => {
        const bits = [...document.querySelectorAll('.race-row .sub .bit, .entry .who .bit')];
        const tall = b => b.getBoundingClientRect().height > parseFloat(getComputedStyle(b).lineHeight) * 1.5;
        return { n: bits.length, broken: bits.filter(b => tall(b) || (b.previousElementSibling && !b.textContent.startsWith('· '))).map(b => b.textContent) };
      });
      pieces.n += seen.n;
      pieces.broken.push(...seen.broken);
    }
    assert.ok(pieces.n >= 40, `only ${pieces.n} pieces of dotted lines on the card and in a race's form`);
    assert.deepEqual(pieces.broken, [], `${width} wide: a piece of a dotted line is broken across two lines, or has lost its dot`);
    // A field that takes two rows on the tote board has them as near the same length as can be: seven as
    // four and three, ten as five and five (they were six and one, six and four). Every race's board is
    // looked at, and the picks of the race that's up, which are set out the same way.
    const uneven = [];
    for (let no = 8; no >= 1; no--) {
      await shop.evaluate(no => window.postTime.nav.go('race', { no, tab: 'bet' }), no);
      const board = await rowsOf('.tote-cell');
      if (!even(board)) uneven.push(`race ${no}'s board: ${board.join(' and ')}`);
    }
    await shop.waitForSelector('.builder');
    const picks = await rowsOf('.picks-grid button');
    if (!even(picks)) uneven.push(`race 1's picks: ${picks.join(' and ')}`);
    assert.deepEqual(uneven, [], `${width} wide: rows of uneven length`);
    const behind = [];
    for (const [k, buy] of [[0, '.builder .btn'], [1, '.post-bar .btn.brass'], [2, '.builder .btn']]) {
      await shop.locator('.pick-row').nth(0).locator('button').nth(k).click();
      await shop.click(buy);
      assert.equal(await shop.evaluate(() => [...document.querySelectorAll('.ticket')].map(t => +t.classList.contains('printed')).join('')), '0'.repeat(await shop.locator('.ticket').count() - 1) + '1', 'the ticket that prints is not the one just bought');
      await shop.waitForTimeout(1200); // the page moves to it, and it slides out
      const at = await shop.evaluate(() => {
        const box = s => [...document.querySelectorAll(s)].pop().getBoundingClientRect();
        return { top: box('.ticket').top, bottom: box('.ticket').bottom, tabs: box('.tabs').bottom, bar: box('.post-bar').top };
      });
      if (at.bottom > at.bar || at.top < at.tabs) behind.push(`ticket ${k + 1}, bought with ${buy}: ${Math.round(at.top)} to ${Math.round(at.bottom)}, with the tabs down to ${Math.round(at.tabs)} and the bar from ${Math.round(at.bar)}`);
    }
    assert.deepEqual(behind, [], `${width} wide: the ticket just bought is behind the bar or the tabs`);
    await shop.click('.tabs button:nth-child(1)');
    await shop.click('.tabs button:nth-child(4)');
    assert.equal(await printing(), 0, 'opening the Bet tab prints a ticket again');
    await shop.locator('.ticket button').first().click();
    assert.deepEqual([await shop.locator('.ticket').count(), await printing()], [width === 390 ? 2 : 4, 0], 'cancelling a ticket prints another one again');
  }
  // A field of twelve is picked from two rows of six or, on a phone too narrow for six in a row, three rows of
  // four. (A phone between 351 and 357 px wide was set out for six to a row and wrapped them five, five and
  // two.) Twelve stand-in picks are put in the slip, set out as the race's page sets out a field of twelve.
  const twelve = [];
  for (const width of [320, 344, 351, 353, 357, 358, 360, 375, 390, 430]) {
    await shop.setViewportSize({ width, height: 800 });
    const rows = await shop.evaluate(() => {
      const row = document.querySelector('.pick-row'), mine = row.cloneNode(true), grid = mine.querySelector('.picks-grid');
      while (grid.children.length < 12) grid.append(grid.firstElementChild.cloneNode(true));
      for (const [name, n] of [['--by5', 4], ['--by6', 6], ['--field', 12]]) grid.style.setProperty(name, n); // what evenRows() gives for twelve
      row.after(mine);
      const tops = [...grid.children].map(x => Math.round(x.getBoundingClientRect().top));
      mine.remove();
      return [...new Set(tops)].map(t => tops.filter(x => x === t).length);
    });
    if (!even(rows)) twelve.push(`${width} wide: ${rows.join(' and ')}`);
  }
  assert.deepEqual(twelve, [], 'twelve picks are in rows of uneven length');
  await shop.setViewportSize({ width: 320, height: 568 });

  // A losing ticket is torn where nothing is printed: the tear runs down the gutter before the words
  // "torn up", on the result and on the Bet tab, on this small phone. (It was cut at 51 to 59% of the width,
  // through the horses' numbers: "5, 7, 2, 1" read "5, , 2, 1".) A trifecta box on the last four home is the
  // longest thing a ticket says. Where the tear is, is read from the ticket's own outline.
  const last4 = await shop.evaluate(async () => {
    const { simulateRace } = await import('./js/world.js');
    const { game, card } = window.postTime;
    return simulateRace(card().races[0], game.world, { record: true }).results.map(r => r.h).slice(-4);
  });
  await shop.locator('.seg button', { hasText: /^Trifecta box$/ }).click();
  for (const i of last4) await shop.locator('.pick-row').nth(0).locator('button').nth(i).click();
  await shop.click('.builder .btn');
  await shop.evaluate(() => { window.postTime.nav.go('watch', { no: 1 }); window.postTime.nav.go('result', { no: 1 }); });
  await shop.waitForSelector('.official .ticket.lost');
  const torn = () => shop.evaluate(() => [...document.querySelectorAll('.ticket.lost')].map(t => {
    const box = t.getBoundingClientRect();
    // The outline's corners that aren't at the ticket's own edges are the tear.
    const xs = [...getComputedStyle(t).clipPath.matchAll(/(calc\(100% - ([\d.]+)px\)|([\d.]+)%|([\d.]+)px) [\d.]+(?:%|px)/g)]
      .map(m => (m[2] ? box.width - m[2] : m[3] ? box.width * m[3] / 100 : +m[4])).filter(x => x > 1 && x < box.width - 1);
    const from = box.left + Math.min(...xs), to = box.left + Math.max(...xs);
    const print = [];
    for (const el of t.querySelectorAll('.what, .small')) {
      const r = document.createRange();
      r.selectNodeContents(el);
      print.push(...[...r.getClientRects()].map(q => ({ left: q.left, right: q.right, text: el.textContent })));
    }
    return { corners: xs.length, cut: print.filter(q => q.right > from && q.left < to).map(q => q.text), label: [...t.children].pop().textContent, alone: print.filter(q => q.left >= to).map(q => q.text).join() };
  }));
  for (const where of ['the result', 'the Bet tab']) {
    const tickets = await torn();
    assert.ok(tickets.length >= 3 && tickets.every(t => t.corners === 8), `${where}: ${tickets.length} torn tickets, with ${tickets.map(t => t.corners)} corners to their tears`);
    assert.deepEqual(tickets.flatMap(t => t.cut), [], `${where}: the tear in a losing ticket goes through its print`);
    assert.deepEqual([...new Set(tickets.map(t => `${t.label} | ${t.alone}`))], ['torn up | torn up'], `${where}: a losing ticket's right-hand piece should say "torn up" and nothing else`);
    await shop.evaluate(() => window.postTime.nav.go('race', { no: 1, tab: 'bet' }));
    await shop.waitForSelector('.tickets .ticket.lost');
  }

  // Past performances fit a phone. With every horse opened in all eight races, no table is wider than its
  // box at 390, at 360 or at 320, so nothing has to be slid sideways to be read. (At 360, 12 tables of 34
  // were up to 23 px too wide, and the rider under the odds read "Villase".) One horse is given lines with
  // every column at its widest at once, in the longest class labels there are: its table fits too, by
  // putting the last of its calls on a second line. The rider is on the comment line.
  await shop.evaluate(() => {
    const { game, card } = window.postTime;
    const race = card().races[7], hs = game.world.horses[race.entries.find(e => game.world.horses[e.hid].pps.length).hid];
    const widest = (nm, cls, fm) => ({ ...hs.pps[0], dt: '2026-09-26', cond: 'sloppy', f: 8.5, surf: 't', fs: 12, nm, cls, fm, fig: 100, line: [[12, 2.25], [12, 3.25], [11, 4.5], [11, 12.75]], fin: 11, odds: 99.9 });
    hs.pps = [widest('Odds and Ends Handicap', 'STK', false), widest(null, 'C40', true), widest(null, 'MSW', true), widest('Thumbtack Stakes', 'STK', false)];
    window.widest = hs.name;
  });
  for (const [width, height] of [[320, 568], [360, 740], [390, 844]]) {
    await shop.setViewportSize({ width, height });
    const tables = { n: 0, wide: [], labels: [], rider: [] };
    for (let no = 1; no <= 8; no++) {
      await shop.evaluate(n => window.postTime.nav.go('race', { no: n }), no);
      const seen = await shop.evaluate(no => {
        for (const head of document.querySelectorAll('.entry-head')) head.click();
        const all = [...document.querySelectorAll('.entry-more')].filter(m => m.querySelector('.pps'));
        const made = all.find(m => m.closest('.entry').querySelector('.nm').textContent === window.widest);
        return {
          n: all.length,
          wide: all.filter(m => m.scrollWidth > m.clientWidth).map(m => `race ${no}, ${m.closest('.entry').querySelector('.nm').textContent}: ${m.scrollWidth - m.clientWidth} px`),
          labels: made ? [...made.querySelectorAll('tbody tr:not(.c) td:nth-child(3)')].map(td => td.textContent) : [],
          rider: made ? [...made.querySelectorAll('tbody tr')].slice(0, 2).map(tr => / · [A-Z][\p{L}'-]+ up( · |$)/u.test(tr.textContent)) : [],
        };
      }, no);
      tables.n += seen.n;
      for (const k of ['wide', 'labels', 'rider']) tables[k].push(...seen[k]);
    }
    assert.ok(tables.n >= 30, `only ${tables.n} tables of past performances to measure`);
    assert.deepEqual(tables.wide, [], `${width} wide: tables of past performances wider than their boxes`);
    assert.deepEqual(tables.labels, ['ThumbtackS', 'f-MdSpWt', 'f-Clm40k', 'OddsEndsH'], 'the short names of a stakes and of a claiming race'); // newest line first
    assert.deepEqual(tables.rider, [false, true], "the rider should be on a line's comment, and not under its odds");
  }

  // Cashing a ticket. The header's bankroll stays as it was while the race is on the screen (the race is
  // settled as it goes to the gate, and the bankroll used to change then, with its flash, behind the race),
  // and changes, with the flash, when the result opens. The cash window rings for any ticket that paid: here
  // a place ticket on the horse that runs second, which used to cash in silence.
  const second = await shop.evaluate(async () => {
    const { simulateRace } = await import('./js/world.js');
    const { game, card } = window.postTime;
    return simulateRace(card().races[1], game.world, { record: true }).results[1].h;
  });
  await shop.click('#menuBtn');
  await shop.check('#optSound');
  await shop.click('#menuBtn');
  await shop.evaluate(() => window.postTime.nav.go('race', { no: 2, tab: 'bet' }));
  await shop.locator('.seg button', { hasText: /^Place$/ }).click();
  await shop.locator('.pick-row').nth(0).locator('button').nth(second).click();
  await shop.click('.builder .btn');
  const bankroll = () => shop.evaluate(async () => {
    const { money } = await import('./js/ui/dom.js');
    const b = document.getElementById('bank'), { game } = window.postTime;
    return { shown: b.textContent, has: money(game.player.bank), flash: b.classList.contains('up'), rings: window.__made.filter(o => o.type === 'triangle').length, back: game.player.settled['0:2']?.back };
  });
  const atWindow = await bankroll();
  await shop.click('.post-bar .btn.brass');
  await shop.waitForSelector('.watch:not([hidden]) canvas.scene');
  const racing = await bankroll();
  assert.ok(racing.back > 0 && racing.has !== atWindow.has, 'the place ticket on the runner-up paid nothing, and this checked nothing');
  assert.deepEqual([racing.shown, racing.flash], [atWindow.shown, false], 'the header shows the new bankroll while the race is still on the screen');
  await shop.evaluate(() => window.__watch.setT(window.__watch.endT - 0.05));
  await shop.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 20000 });
  const atFinish = await bankroll();
  assert.deepEqual([atFinish.shown, atFinish.rings - racing.rings], [atWindow.shown, 3], 'at the finish: the bankroll as it was, and the cash sound (three triangle waves) for a place ticket that paid');
  await shop.click('.w-ctl .btn');
  await shop.waitForSelector('.official');
  const onResult = await bankroll();
  assert.deepEqual([onResult.shown, onResult.flash], [racing.has, true], "the result doesn't show the new bankroll, or shows it without its flash");

  // The end of the card, and the record. With the last race run, "That's the card" and Next race day are at
  // the top of the card, on the screen when it opens, as well as under the eight results (where the button
  // was about 1,170 px down this 844 px screen). The record's best day is worked out from the betting record
  // with today in it (it used to wait until Next race day was pressed), and it and the biggest ticket say
  // "None yet" until there's a winning one. A photo says "tickets" when more than one ticket cashed.
  const lastRace = await shop.evaluate(async () => {
    const g = await import('./js/game.js');
    const { simulateRace } = await import('./js/world.js');
    const { money } = await import('./js/ui/dom.js');
    const { game, card, nextRace, nav } = window.postTime;
    // Two win tickets on the winner of race 3, one on the winner of race 4, and the rest run with nothing on them.
    for (const [no, tickets] of [[3, 2], [4, 1]]) {
      const race = card().races[no - 1], first = simulateRace(race, game.world, { record: true }).results[0].h;
      for (let k = 0; k < tickets; k++) g.placeBet(race, { type: 'win', sel: [first], amt: 2 });
    }
    while (nextRace()) g.goToGate(nextRace());
    nav.go('card');
    const top = document.querySelector('.day .day-over') || document.createElement('div'), b = (top.querySelector('.btn') || top).getBoundingClientRect();
    const net = game.player.ledger.reduce((sum, x) => sum + x.back - x.spent, 0), biggest = Math.max(...game.player.ledger.map(x => x.best));
    return {
      card: [top.textContent.replace(/Next race day.*/, ''), b.top >= document.getElementById('top').getBoundingClientRect().bottom && b.bottom <= innerHeight && scrollY === 0, [...document.querySelectorAll('.btn')].filter(x => x.textContent === 'Next race day ▸').length],
      want: { 'Biggest ticket': money(biggest), 'Best day': Math.round(net * 100) > 0 ? money(net, { sign: true }) : 'None yet' }, saved: game.player.best,
    };
  });
  assert.deepEqual(lastRace.card, ["That's the card.", true, 2], 'a finished card should have Next race day on the screen when it opens, and under the results too');
  await shop.evaluate(() => window.postTime.nav.go('book'));
  const record = await shop.evaluate(() => ({
    stats: Object.fromEntries([...document.querySelectorAll('.stat')].map(x => [x.querySelector('.kicker').textContent, x.querySelector('b').textContent])),
    photos: Object.fromEntries([...document.querySelectorAll('.photo-frame')].map(f => [f.textContent.match(/Race (\d)/)[1], f.querySelector('.you-note').textContent.replace(/ that paid.*/, '')])),
  }));
  assert.equal(lastRace.saved, null, 'the best day was saved before the next race day, and this checked nothing');
  assert.deepEqual({ 'Biggest ticket': record.stats['Biggest ticket'], 'Best day': record.stats['Best day'] }, lastRace.want, "the record's biggest ticket or best day");
  assert.deepEqual([record.photos[3], record.photos[4]], ["That's you on the right, holding tickets", "That's you on the right, holding a ticket"], 'a photo for two cashed tickets should say "tickets"');
  // Nothing won yet, on a record with nothing in it.
  const none = await shop.evaluate(() => {
    const { game, nav } = window.postTime, kept = game.player.ledger;
    game.player.ledger = [{ day: 0, no: 1, spent: 10, back: 0, best: 0 }];
    nav.go('book');
    const stats = Object.fromEntries([...document.querySelectorAll('.stat')].map(x => [x.querySelector('.kicker').textContent, x.querySelector('b').textContent]));
    game.player.ledger = kept;
    return [stats['Biggest ticket'], stats['Best day']];
  });
  assert.deepEqual(none, ['None yet', 'None yet'], 'with nothing won, the record should say so (it said "Biggest ticket $0.00" and "Best day −$10.00")');

  // "That's you on the right" is the same person in every photo of a meet. Each photo in the scrapbook is
  // drawn again here, and the strip of it you stand in (nobody else does, and the wall behind is the same in
  // every photo) comes out the same to the pixel, though the races and the winners differ. (Your skin, hair,
  // hat and trousers came from each race's own random numbers.) Another meet's you is somebody else.
  const you = await shop.evaluate(async () => {
    const { drawCircle } = await import('./js/draw/circle.js');
    const { ownerSilks } = await import('./js/world.js');
    const { game } = window.postTime, W = 360, H = 250, from = W / 2 + 2.4 * W / 7.4;
    const strip = (rec, meet, you = true) => {
      const c = document.createElement('canvas');
      drawCircle(c, { horse: rec.horse, silks: ownerSilks(rec.owner), number: rec.number, stakes: rec.stakes, you, seed: rec.seed, meet, width: W, height: H });
      const x = Math.round(from * c.width / W);
      return c.getContext('2d').getImageData(x, 0, c.width - x, c.height).data;
    };
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const book = game.player.book, mine = book.map(rec => strip(rec, game.world.seed));
    return {
      photos: new Set(book.map(rec => rec.seed)).size,
      alike: mine.every(p => same(p, mine[0])),
      there: !same(mine[0], strip(book[0], game.world.seed, false)),
      others: ['a', 'b', 'c', 'd', 'e', 'f'].filter(meet => !same(strip(book[0], meet), mine[0])).length,
    };
  });
  assert.ok(you.photos >= 2 && you.there, `${you.photos} photos to compare, and you ${you.there ? 'are' : "aren't"} in them`);
  assert.ok(you.alike, "you're a different person from one photo in the scrapbook to the next");
  assert.ok(you.others >= 4, `in six other meets you're drawn the same as in this one ${6 - you.others} times`);
  await ctx5.close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
// Offline, checked the junkdrawer house kit's way, from a server that answers like GitHub Pages: a browser may keep
// each file for ten minutes, and asks again by its ETag. `net` is the connection: 'up', 'down' (the server drops every
// connection) or 'stalled' (a plane's or a train's wifi: it takes each request and holds on to it). With `release`
// set it serves the next release. The server's own switches are needed because the browser's offline switch can't
// make a stall, and in some Chromium builds it doesn't stop the service worker's own requests.
{
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  let net = 'up', release = false;
  const held = [];
  const server = createServer((req, res) => {
    if (net === 'down') { req.socket.destroy(); return; }
    if (net === 'stalled') { held.push([req, res]); return; }
    serve(req, res);
  }).listen(0);
  async function serve(req, res) {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    let body;
    try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
    if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, head);
    res.end(body);
  }
  const base = `http://localhost:${server.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  const title = await page.title();

  // Works offline once it has been opened.
  net = 'down';
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.title(), title, 'the page did not open offline');
  await ctx.setOffline(false);

  // On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
  // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
  net = 'stalled';
  const t0 = Date.now();
  await page.reload({ timeout: 10000 }).catch(() => {});
  const took = Date.now() - t0;
  assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
  assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
  net = 'up';
  for (const [req, res] of held.splice(0)) serve(req, res);

  // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
  // the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
  release = true;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  for (const end = Date.now() + 10000; !(await page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')));) {
    assert.ok(Date.now() < end, "the new release's offline copy kept the old index.html");
    await new Promise(r => setTimeout(r, 100));
  }
  assert.deepEqual(problems, [], 'problems while offline or on a stalled connection');
  await ctx.close();
  server.close();

  // sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js
  // is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
  // index.html; the first 8 hex of the sha1 of those).
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
  const all = createHash('sha1');
  for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
}

await browser.close();
server.close();
console.log('all good');
