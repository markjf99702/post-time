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
// card can be slid sideways to the end of its rows (it used to be cut off at the card's edge).
const cutOff = await page.evaluate(() => {
  let wide = 0, stuck = 0;
  for (const head of document.querySelectorAll('.entry-head')) {
    head.click();
    const more = head.closest('.entry').querySelector('.entry-more'), table = more.querySelector('.pps');
    if (!table || table.getBoundingClientRect().right <= more.getBoundingClientRect().right - 11) continue;
    wide++;
    more.scrollLeft = 1000;
    if (table.getBoundingClientRect().right > more.getBoundingClientRect().right - 11) stuck++;
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
await page.click('#restart');
await page.waitForSelector('.races', { timeout: 30000 });
assert.notEqual((await meetNow())[0], meetWas[0], 'a second tap on Start a new meet, a second after the first, started nothing');
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
assert.equal(offered[0], 'Best here (Google US English)');
assert.equal(offered[1], 'Google US English (needs the internet)');
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
      const line = w.call.lines.find(l => l.say === x.text) || null, up = line && shown.filter(y => y.text === line.text && y.at <= x.at + 20).pop();
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
const after4 = at4.lines.filter(l => l.at > at4.changed);
assert.ok(at4.plans >= 1, 'the call was not planned again for the new speed');
assert.ok(!at4.cutAtChange && at4.lines.find(l => l.text === at4.long).ended, `"${at4.long}" was cut off by the change to 4x`);
assert.deepEqual(at4.cancels.filter(slot => slot !== 'wire'), [], 'a line was cancelled, and not for the call at the wire');
assert.ok(at4.lines.some(l => l.slot === 'off') && after4.some(l => l.leader) && after4.some(l => l.slot === 'wire'), `at 4x the off, a line that says who leads, or the winner's line was not read: ${after4.map(l => l.text).join(' / ')}`);
assert.deepEqual(at4.lines.filter(l => l.age > (l.slot === 'placings' ? 6 : 1.5)).map(l => `${l.text}: ${l.age.toFixed(2)} s after it came up`), [], 'a line was read long after it came up');
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
  return { lines, skipped, jumped: w.winT - 12 > T, cancels: heard.slice(window.__from).filter(x => x.ev === 'cancel').map(x => (Math.abs(x.at - skipped) < 100 ? 'skip' : (lines.find(l => l.at > x.at) || {}).slot)) };
});
const after2 = at2.lines.filter(l => l.at > at2.skipped);
assert.ok(at2.jumped, 'the race was nearly over before Skip, and this checked nothing');
assert.ok(at2.lines.some(l => l.slot === 'off') && at2.lines.some(l => l.leader && l.at < at2.skipped) && after2.some(l => l.slot === 'wire'), `at 2x the off, a line that says who leads, or the winner's line was not read: ${at2.lines.map(l => l.text).join(' / ')}`);
assert.deepEqual(at2.cancels.filter(why => why !== 'skip' && why !== 'wire'), [], 'at 2x a line was cancelled, and not by Skip or for the call at the wire');
assert.deepEqual(at2.lines.filter(l => l.age > (l.slot === 'placings' ? 6 : 1.5)).map(l => `${l.text}: ${l.age.toFixed(2)} s after it came up`), [], 'at 2x a line was read long after it came up');
// (Twelve seconds of race at 2x is six of talk: a line or two, the winner's line, then second, third and the time.)
assert.ok(after2.length >= 2 && after2[after2.length - 1].slot === 'placings', `after Skip the caller said ${after2.map(l => l.text).join(' / ') || 'nothing'}`);
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
  await first.click('#menuBtn');
  await first.check('#optVoice');
  assert.equal(await first.locator('#voiceRow').isVisible(), false, 'a voice is offered in a browser that has none');
  await first.uncheck('#optVoice');
  await first.click('#menuBtn');

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
