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
  // ---------------------------------------------------------------- a first visit, and What do these mean?
  {
    // A first visit landed on the card with nothing to say what to do. Race day 1 of a new meet has a note,
    // until it's put away (and it stays away), and the form and the board open How to play at their part.
    const { ctx, page } = await freshMeet();
    assert.match(await page.locator('.welcome').textContent(), /^First time here\? Tap race 1, read the form, buy a \$2 ticket under Bet/);
    await page.locator('.race-row').first().click();
    await page.locator('.panel .note .help-link').click();
    await page.waitForSelector('.help');
    await page.waitForFunction(() => document.activeElement?.id === 'help-form');
    const top = await page.locator('#help-form').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(top > 50 && top < 150, `the form's part of How to play is ${top} px down the screen`);
    assert.equal(await page.locator('.rhead .back').textContent(), '‹ Race 1');
    await page.locator('.rhead .back').click();
    await page.getByRole('tab', { name: 'Bet' }).click();
    await page.locator('.tote ~ .note .help-link').click();
    await page.waitForFunction(() => document.activeElement?.id === 'help-odds');
    // Back, the browser's or the page's, goes to the race's tab it came from.
    await page.goBack();
    await page.waitForSelector('.tote');
    assert.equal(await page.locator('[role=tab][aria-selected=true]').textContent(), 'Bet');
    await page.locator('.rhead .back').click();
    await page.locator('.welcome button', { hasText: 'Got it' }).click();
    assert.equal(await page.locator('.welcome').count(), 0);
    await page.reload();
    await page.waitForSelector('.races');
    assert.equal(await page.locator('.welcome').count(), 0, 'the note came back after it was put away');
    // And it's only for the first race day: once race 1 is run it's gone anyway.
    await page.evaluate(() => { window.postTime.game.player.settings.welcome = true; });
    await runDay(page);
    await page.evaluate(() => window.postTime.nav.go('card'));
    assert.equal(await page.locator('.welcome').count(), 0);
    await ctx.close();
  }

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

  // ---------------------------------------------------------------- something to show a friend
  {
    const { ctx, page } = await freshMeet({ permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    await runDay(page, [2, 5]);
    // Copy my day, under the day's three lines.
    await page.evaluate(() => window.postTime.nav.go('card'));
    await page.locator('.copy-day').click();
    await page.waitForFunction(() => document.querySelector('.copy-day').textContent === 'Copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    assert.equal(lines.length, 4, text);
    assert.match(lines[0], /^Post Time, Saturday, \w+ \d+, \d{4} \(meet 1, race day 1 of 10\)$/);
    assert.match(lines[1], /^Cashed 2 of 2 races: bet \$4\.00, back \$[\d.,]+ \(\+\$[\d.,]+\)$/);
    assert.match(lines[2], /^Best ticket: \$[\d.,]+ in race [25], .+$/);
    assert.equal(lines[3], 'https://post-time.junkdrawer.works/');
    // Save the picture, from the winner's circle: one picture, the photo with its caption.
    await page.evaluate(() => window.postTime.nav.go('circle', { no: 2 }));
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.save-row .btn').click()]);
    assert.match(download.suggestedFilename(), /^Post Time, .+, \w+ \d+, \d{4}\.png$/);
    const png = await readFile(await download.path());
    const [w, hgt] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.ok(w === 1080 && hgt > 1000 && hgt < 1150, `the picture is ${w} by ${hgt}`);
    await ctx.close();
    // Where the browser can do neither (in a frame, as the Artifact copy is), neither is offered.
    const fctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    const outer = await fctx.newPage();
    watch(outer);
    await outer.setContent(`<iframe src="${base}" style="width:400px;height:880px;border:0"></iframe>`);
    const frame = await (await outer.waitForSelector('iframe')).contentFrame();
    await frame.waitForSelector('.races', { timeout: 60000 });
    await frame.evaluate(async () => {
      const G = await import('./js/game.js');
      for (const race of G.card().races) { G.placeBet(race, { type: 'win', sel: [G.recordingOf(race).results[0].h], amt: 2 }); G.goToGate(race); }
      window.postTime.nav.go('circle', { no: 1 });
    });
    assert.equal(await frame.locator('.save-row .btn').count(), 0, 'Save the picture is offered in a frame');
    await frame.evaluate(() => window.postTime.nav.go('card'));
    assert.equal(await frame.locator('.recap li').count(), 3);
    assert.equal(await frame.locator('.copy-day').count(), 0, 'Copy my day is offered in a frame');
    await fctx.close();
  }

  // ---------------------------------------------------------------- a little more ceremony
  for (const reduce of [false, true]) {
    const { ctx, page } = await freshMeet({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
    // Race 1 with two winning tickets and a losing one, watched to the end and on to its result.
    const bankWas = await page.evaluate(async () => {
      const G = await import('./js/game.js');
      const race = G.card().races[0], won = G.recordingOf(race).results[0].h;
      G.placeBet(race, { type: 'win', sel: [won], amt: 2 });
      G.placeBet(race, { type: 'show', sel: [won], amt: 2 });
      G.placeBet(race, { type: 'win', sel: [won === 0 ? 1 : 0], amt: 2 });
      window.postTime.nav.go('card');
      return document.getElementById('bank').textContent;
    });
    await page.evaluate(() => window.postTime.nav.go('watch', { no: 1 }));
    await page.waitForFunction(() => window.__watch && window.__watch.endT > 0);
    await page.evaluate(() => window.__watch.setT(window.__watch.endT - 0.05));
    await page.waitForSelector('.w-ctl .btn:not([hidden])', { timeout: 20000 });
    await page.click('.w-ctl .btn');
    await page.waitForSelector('.official');
    const landed = await page.evaluate(() => {
      const b = document.getElementById('bank');
      const anim = el => { const cs = getComputedStyle(el); return [cs.animationName, parseFloat(cs.animationDelay)]; };
      return {
        summary: document.querySelector('.summary').className, bank: [b.textContent, b.classList.contains('counting'), b.getAttribute('aria-busy')],
        has: window.postTime.game.player.bank,
        stamps: [...document.querySelectorAll('.summary .stamp')].map(anim), tear: anim(document.querySelector('.summary .ticket.lost')),
        note: document.querySelector('.ticket-note')?.textContent, fade: getComputedStyle(document.getElementById('app')).animationName,
      };
    });
    assert.equal(landed.bank[0], `$${landed.has.toFixed(2)}`, 'the box does not hold the new bankroll while it counts');
    assert.notEqual(landed.bank[0], bankWas);
    assert.equal(landed.note, 'Your first cashed ticket.');
    if (!reduce) {
      assert.match(landed.summary, /landing/);
      assert.deepEqual([landed.bank[1], landed.bank[2]], [true, 'true'], 'the bankroll does not count to its new figure');
      assert.equal(landed.stamps.length, 2);
      assert.ok(landed.stamps.every(([n]) => n === 'stamp') && landed.stamps[1][1] > landed.stamps[0][1], `the stamps don't land in turn: ${JSON.stringify(landed.stamps)}`);
      assert.ok(landed.tear[0] === 'tear' && landed.tear[1] > landed.stamps[1][1], "the losing ticket doesn't tear after the stamps");
      assert.equal(landed.fade, 'fade-in');
      await page.waitForFunction(() => !document.getElementById('bank').classList.contains('counting'), null, { timeout: 3000 });
    } else {
      assert.equal(landed.bank[1], false, 'the bankroll counts under Reduce Motion');
      assert.ok(landed.stamps.every(([n]) => n === 'none') && landed.tear[0] === 'none' && landed.fade === 'none', 'something moves under Reduce Motion');
    }
    // Drawn again, the tickets don't land a second time.
    await page.evaluate(() => window.postTime.nav.refresh());
    assert.doesNotMatch(await page.locator('.summary').getAttribute('class'), /landing/);
    // The camera flashes the first time you're in the photo, and not the next.
    await page.click('.actions .btn.brass');
    await page.waitForSelector('.photo-frame');
    const flash = () => page.evaluate(() => { const f = document.querySelector('.photo-frame'); return [f.classList.contains('flash'), getComputedStyle(f, '::after').animationName]; });
    assert.deepEqual(await flash(), [true, reduce ? 'none' : 'flash']);
    await page.goBack();
    await page.waitForSelector('.official');
    await page.click('.actions .btn.brass');
    await page.waitForSelector('.photo-frame');
    assert.equal((await flash())[0], false, 'the camera flashed again');
    await ctx.close();
  }

  assert.deepEqual(problems, [], 'errors on the page');
  console.log('around: all checks passed');
} finally {
  await browser.close();
  server.close();
}
