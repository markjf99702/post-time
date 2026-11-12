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
    // Run the day, cashing on races 1 and 3: each winner is starred on its result, the card says where the
    // starred horses finished, and the day is said in three lines under "That's the card".
    await runDay(page, [1, 3]);
    await page.evaluate(() => window.postTime.nav.go('result', { no: 1 }));
    assert.equal(await page.locator('.board tbody tr').first().locator('.star').getAttribute('aria-pressed'), 'true', 'the winner you cashed on is not starred');
    await page.evaluate(() => window.postTime.nav.go('card'));
    assert.match(await page.locator('.race-row').nth(1).locator('.starred').textContent(), new RegExp(`${name}, \\d+(st|nd|rd|th)$`));
    const recap = await page.locator('.day-over .recap li').allTextContents();
    assert.equal(recap.length, 3, `the day isn't three lines: ${recap.join(' | ')}`);
    assert.match(recap[0], /^Bet \$4\.00, back \$[\d.]+: \+\$[\d.]+ on the day\.$/);
    assert.match(recap[1], /^Your best ticket: \$[\d.]+ in race [13]\.$/);
    assert.match(recap[2], /had the forum's best day: \d+ of \d+ picks won, \$[\d.,]+ back for \$2 on each\.$|^Nobody on the forum picked a winner today\.$/);
    // (With the day over, the line of the day's money above it goes: the first of the three says it.)
    assert.equal(await page.locator('.daysum').count(), 0, "the day's money is said twice");
    await ctx.close();
  }

  // ---------------------------------------------------------------- the scrapbook
  {
    const { ctx, page } = await freshMeet();
    // Forty photos, as a long meet of cashing winners leaves, and nine trips to the ATM.
    await runDay(page, [1, 2, 3, 4, 5, 6, 7, 8]);
    const made = await page.evaluate(() => {
      const { game, save } = window.postTime;
      const eight = game.player.book.slice();
      for (let k = 1; k < 5; k++) for (const rec of eight) game.player.book.push({ ...rec, day: rec.day - k, date: `2026-0${9 - k}-1${k}` });
      game.player.book.sort((a, b) => a.day - b.day || a.no - b.no);
      game.player.atm = 900; game.player.bank += 900;
      save();
      return game.player.book.length;
    });
    assert.equal(made, 40);
    await page.evaluate(() => window.postTime.nav.go('book'));
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.sheet .contact')];
      const stats = Object.fromEntries([...document.querySelectorAll('.stat')].map(x => [x.querySelector('.kicker').textContent, [x.querySelector('b').textContent, x.querySelector('.muted')?.textContent || '']]));
      const standings = [...document.querySelectorAll('h2')].find(x => x.textContent === 'The forum standings');
      const photos = [...document.querySelectorAll('h2')].find(x => x.textContent === "Winner's circle photos");
      return {
        tiles: tiles.length, drawn: tiles.filter(t => t.querySelector('canvas').dataset.drawn).length,
        across: new Set(tiles.slice(0, 6).map(t => t.offsetTop)).size,
        first: tiles[0].textContent, height: document.documentElement.scrollHeight,
        standingsFirst: !!(standings.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING),
        putIn: stats['Put in'],
      };
    });
    assert.equal(sheet.tiles, 40);
    // Two across on a phone, newest first, drawn only as they come near the screen.
    assert.equal(sheet.across, 3, 'six photos are not two across on a phone');
    assert.match(sheet.first, /Race 8$/, 'the newest photo is not first');
    assert.ok(sheet.drawn > 0 && sheet.drawn <= 16, `${sheet.drawn} of 40 photos drawn as the scrapbook opened`);
    assert.ok(sheet.height < 6000, `the scrapbook is ${sheet.height} px tall with 40 photos`);
    assert.ok(sheet.standingsFirst, 'the forum standings are under the photos');
    assert.deepEqual(sheet.putIn, ['$1,100.00', '$200 to start, $900 from the ATM']);
    // A tap on a photo opens it full size with its caption, and Back comes back to the same place on the sheet.
    await page.evaluate(() => window.scrollTo(0, 1500));
    const tile = page.locator('.sheet .contact').nth(20);
    const name = await tile.locator('.nm').textContent();
    await tile.click();
    await page.waitForSelector('.photo-frame .caption');
    assert.equal(await page.locator('.photo-frame .caption .horse').textContent(), name);
    assert.match(await page.locator('.photo-frame .you-note').textContent(), /^That's you on the right/);
    // (The tile that was opened is on the screen again.)
    const inView = () => page.evaluate(() => { const r = document.querySelectorAll('.sheet .contact')[20].getBoundingClientRect(); return window.scrollY > 500 && r.top >= 0 && r.bottom <= innerHeight; });
    await page.goBack();
    await page.waitForSelector('.sheet');
    assert.ok(await inView(), 'Back from a photo did not come back to the same place on the sheet');
    await page.locator('.sheet .contact').nth(20).click();
    await page.click('.rhead .back');
    await page.waitForSelector('.sheet');
    assert.ok(await inView(), '‹ Scrapbook did not come back to the same place on the sheet');
    await ctx.close();
  }

  // ---------------------------------------------------------------- the meet so far
  {
    const { ctx, page } = await freshMeet();
    await runDay(page, [2, 5]);
    await page.click('#menuBtn');
    await page.click('#menu [data-go="meet"]');
    await page.waitForSelector('.leaders');
    const meet = await page.evaluate(() => {
      const boards = Object.fromEntries([...document.querySelectorAll('.board')].map(b => [b.querySelector('h3').textContent, b]));
      const shown = b => [...b.querySelectorAll('tbody tr')].filter(tr => !tr.hidden).length;
      return {
        title: document.querySelector('.rhead .title').textContent, boards: Object.keys(boards),
        riders: [shown(boards['Leading riders']), boards['Leading riders'].querySelectorAll('tbody tr').length],
        days: [...boards['Race day by race day'].querySelectorAll('tbody tr')].map(tr => tr.textContent),
        kinds: [...boards['By kind of bet'].querySelectorAll('tbody tr td:first-child')].map(td => td.textContent),
        note: !!boards['By kind of bet'].querySelector('.board-note'),
        perDollar: [...document.querySelectorAll('.stat')].find(x => x.textContent.startsWith('Back for every $1 bet'))?.querySelector('b').textContent,
        text: document.getElementById('app').textContent,
      };
    });
    assert.equal(meet.title, 'The meet so far');
    for (const b of ['Leading riders', 'Leading trainers', 'Most wins', 'Most earned', 'The stakes so far', 'Race day by race day', 'By kind of bet']) assert.ok(meet.boards.includes(b), `no ${b} on the meet's page`);
    assert.equal(meet.riders[0], 5, 'more or fewer than the top five riders show');
    assert.ok(meet.riders[1] > 5);
    assert.equal(meet.days.length, 1);
    assert.match(meet.days[0], /^1 · \w+ \d+\$4\.00/);
    assert.deepEqual(meet.kinds, ['Win']);
    assert.equal(meet.note, false);
    assert.match(meet.perDollar, /^\$\d+\.\d\d$/);
    assert.ok(!/null|undefined|NaN/.test(meet.text), 'the page says null, undefined or NaN');
    await page.click('.show-all');
    assert.equal(await page.locator('.leaders').first().locator('tbody tr:not([hidden])').count(), meet.riders[1], 'Show all does not show them all');
    await ctx.close();
  }

  // ---------------------------------------------------------------- looking back at a race
  {
    const { ctx, page } = await freshMeet();
    // The figures shown before race 1 is run, and after, from its results' The form.
    await page.evaluate(() => window.postTime.nav.go('race', { no: 1 }));
    const figs = () => page.locator('.entry .figs').evaluateAll(fs => fs.map(f => [...f.querySelectorAll('.fig, .chip')].map(x => x.textContent).join(' ')));
    const before = await figs();
    await runDay(page);
    await page.evaluate(() => window.postTime.nav.go('result', { no: 1 }));
    await page.locator('.actions .btn', { hasText: 'The form' }).click();
    await page.waitForSelector('.entry');
    assert.deepEqual(await figs(), before, "the form looked back at isn't the form as it stood before the race");
    assert.match(await page.locator('.panel .note').first().textContent(), /^The form as it stood before the race/);
    await page.locator('.entry-head').first().click();
    const first = page.locator('.entry').first().locator('.pps tbody tr').first();
    assert.equal(await first.getAttribute('class'), 'today', "the race's own line doesn't head the past performances");
    assert.match(await first.textContent(), /^This race/);
    // Its paddock and its forum, with the posts from before the race.
    await page.locator('.tabs button', { hasText: 'Forum' }).click();
    assert.ok(await page.locator('.post:not(.after)').count() > 0, 'no posts from before the race on its forum');
    await ctx.close();
  }

  // ---------------------------------------------------------------- earlier race days
  {
    const { ctx, page } = await freshMeet();
    await runDay(page, [3]);
    const ran = await page.evaluate(() => { const r = window.postTime.card().races[2]; return { day: r.day, winner: window.postTime.game.world.horses[r.entries[r.result.order[0].k].hid].name, time: r.result.time, pay: r.result.pay.win[r.result.order[0].k] }; });
    await page.evaluate(async () => { const G = await import('./js/game.js'); G.advanceDay(); window.postTime.nav.go('card'); });
    await page.reload();
    await page.waitForSelector('.races');
    // From the foot of the card: the race days kept, then the day's races, then a race's results.
    await page.locator('.card-foot .btn', { hasText: 'Earlier race days' }).click();
    await page.locator('.meet-row').first().click();
    assert.equal(await page.locator('.race-row').count(), 8);
    assert.match(await page.locator('.race-row').nth(2).textContent(), new RegExp(ran.winner));
    await page.locator('.race-row').nth(2).click();
    await page.waitForSelector('.official');
    const result = await page.evaluate(() => ({
      kicker: document.querySelector('.rhead .kicker').textContent, first: document.querySelector('.board tbody tr b').textContent,
      buttons: [...document.querySelectorAll('.actions .btn')].map(b => b.textContent), cashed: document.querySelector('.summary .big')?.textContent,
    }));
    assert.match(result.kicker, /^\w{3} \d+, \d{4} · race day 1 · Race 3$/);
    assert.equal(result.first, ran.winner);
    assert.deepEqual(result.buttons, ['Watch again'], "an earlier race day's result offers what it can't show, or not Watch again");
    assert.ok(result.cashed, 'what you cashed on it is not said');
    // Watched again, it's the same race, and Results comes back to it.
    await page.locator('.actions .btn', { hasText: 'Watch again' }).click();
    await page.waitForFunction(() => window.__watch && window.__watch.endT > 0);
    const again = await page.evaluate(() => window.__watch.run.results[0].time + 0);
    assert.ok(Math.abs(again - ran.time) < 0.01, `watched again the race took ${again}, and ${ran.time} when it was run`);
    await page.evaluate(() => window.__watch.leave('result'));
    await page.waitForSelector('.official');
    assert.match(await page.locator('.rhead .kicker').textContent(), /Race 3$/);
    // The browser's Back goes to the card from there.
    await page.goBack();
    await page.waitForSelector('.races');
    // A past performance's date opens its race's results, and so does a photo in the scrapbook.
    const link = await page.evaluate(() => {
      const { game, card } = window.postTime;
      for (const race of card().races) for (const e of race.entries) if (game.world.horses[e.hid].pps.some(p => p.d === game.world.day - 1)) return { no: race.no, hid: e.hid, k: race.entries.indexOf(e) };
      return null;
    });
    if (link) {
      await page.evaluate(no => window.postTime.nav.go('race', { no }), link.no);
      await page.locator('.entry-head').nth(link.k).click();
      await page.locator('.entry').nth(link.k).locator('.pp-link').first().click();
      await page.waitForSelector('.official');
      assert.match(await page.locator('.rhead .kicker').textContent(), /race day 1 · Race \d$/);
    }
    await page.evaluate(() => { const rec = window.postTime.game.player.book[0]; window.postTime.nav.go('photo', { day: rec.day, no: rec.no }); });
    await page.locator('.actions .btn', { hasText: 'The race' }).click();
    await page.waitForSelector('.official');
    assert.match(await page.locator('.rhead .kicker').textContent(), /Race 3$/);
    await ctx.close();
  }

  assert.deepEqual(problems, [], 'errors on the page');
  console.log('around: all checks passed');
} finally {
  await browser.close();
  server.close();
}
