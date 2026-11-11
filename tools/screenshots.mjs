// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The same pictures come out every time: Math.random is seeded, which fixes the meet's horses, and the clock
// is pinned, which fixes its first race day (the Saturday on or after "today"). The race is stopped at a
// moment and drawn there, not caught on the run. Set OUT to a folder to write them somewhere else for a look.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
let UPNG = null;
try { UPNG = require('upng-js'); } catch { /* optional: smaller PNGs */ }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.OUT || root;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
// Change these until the pictures look good: the meet, the race that's watched, and (T, in seconds from the
// start of its recording) the moment it's stopped at. Left to itself the tool stops the race where the most
// horses are in the picture.
const SEED = +(process.env.SEED || 11);
const RACE_NO = +(process.env.RACE || 3);
const TODAY = '2026-11-14T17:00:00Z'; // a Saturday, so it's the meet's first race day
const browser = await pw.chromium.launch();
await mkdir(join(out, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(TODAY));
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(base);
  await page.waitForSelector('.races', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready.then(() => 0));
  return page;
}

// Save a PNG, quantised to 256 colours when upng-js is installed.
async function save(page, path, opts = {}) {
  const buf = await page.screenshot(opts);
  if (!UPNG) return writeFile(path, buf);
  const img = UPNG.decode(buf);
  const png = UPNG.encode([UPNG.toRGBA8(img)[0]], img.width, img.height, 256);
  await writeFile(path, Buffer.from(png));
}

// Run the races before the chosen one, with nobody watching.
async function playUpTo(page, race) {
  for (let no = 1; no < race; no++) {
    await page.evaluate(n => window.postTime.nav.go('watch', { no: n }), no);
    await page.waitForSelector('.watch:not([hidden])');
    await page.evaluate(() => window.__watch.leave('card'));
  }
}

// Stop the race that's on the screen at the moment with the most of the field to be seen, and draw it there.
// The race is stepped through from a third of the way round to a second before the wire, with the camera
// where it would be at each step, and the horses that are whole in the picture (less `edge`, the share of
// the picture's width that will be cut from each side) are counted: those that have at least half a length
// of the track to themselves, since horses running side by side are drawn one over the other. The latest of
// the fullest moments is the one kept: the nearer the wire, the more there is to see. Returns what it chose.
async function stopAtFullest(page, edge = 0) {
  const chosen = await page.evaluate(async ([edge, fixed]) => {
    const w = window.__watch, run = w.run;
    const frames = n => new Promise(done => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : done()); step(); });
    w.pause();
    let best = fixed ? { t: fixed, seen: null } : null;
    for (let t = w.winT * 0.33; !fixed && t < w.winT - 1; t += 0.25) {
      w.setT(t);
      await frames(2);
      const at = run.frames[Math.round(t / run.dt)], half = w.cam.span * (0.5 - edge);
      const inView = [];
      for (let k = 0; k < run.n; k++) if (at[k * 4] - 3 > w.cam.x - half && at[k * 4] + 0.5 < w.cam.x + half) inView.push(at[k * 4]);
      let seen = 0, last = Infinity;
      for (const at of inView.sort((a, b) => b - a)) if (last - at >= 1.3) { seen++; last = at; }
      if (!best || seen >= best.seen) best = { t, seen };
    }
    w.setT(best.t);
    await frames(90); // the caller's line for the moment comes up, and fades in
    return { ...best, of: run.n, call: document.querySelector('.call .now')?.textContent };
  }, [edge, +(process.env.T || 0)]);
  console.log(`race ${RACE_NO} stopped at ${chosen.t.toFixed(2)} s${chosen.seen === null ? '' : `, ${chosen.seen} of ${chosen.of} horses to be seen in the picture`}: "${chosen.call}"`);
  return chosen;
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await save(page, join(out, 'docs/phone-card.png'));
  await page.evaluate(no => window.postTime.nav.go('race', { no }), 1);
  await page.waitForSelector('.entry');
  // Open the horse with the most past performances, and bring it to the top of the page, just under the tabs
  // (near enough to them that the horse above it is out of sight).
  const idx = await page.evaluate(() => {
    const { game, card } = window.postTime;
    const r = card().races[0];
    let best = 0;
    r.entries.forEach((e, i) => { if (game.world.horses[e.hid].pps.length > game.world.horses[r.entries[best].hid].pps.length) best = i; });
    return best;
  });
  await page.locator('.entry-head').nth(idx).click();
  await page.locator('.entry').nth(idx).evaluate(el => {
    const tabs = document.querySelector('.tabs');
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(tabs).top) - tabs.offsetHeight - 5);
  });
  await page.waitForTimeout(200);
  await save(page, join(out, 'docs/phone-form.png'));
  // Play through to the chosen race, buy a ticket on it, and watch it. The ticket is $2 to win on the horse
  // that's going to (a race comes out of its seed and its entries, so it can be run ahead of time to see):
  // the winner's circle picture is the one with you in it.
  await playUpTo(page, RACE_NO);
  const winner = await page.evaluate(async no => {
    const { simulateRace } = await import('./js/world.js');
    const { game, card } = window.postTime;
    return simulateRace(card().races[no - 1], game.world, { record: true }).results[0].h;
  }, RACE_NO);
  await page.evaluate(no => window.postTime.nav.go('race', { no }), RACE_NO);
  await page.click('.tabs button:nth-child(4)');
  await page.locator('.pick-row').nth(0).locator('button').nth(winner).click();
  await page.click('.builder .btn');
  await page.click('.post-bar .btn.brass');
  await page.waitForSelector('.watch:not([hidden])');
  await stopAtFullest(page);
  await save(page, join(out, 'docs/phone-race.png'));
  await page.evaluate(() => window.__watch.leave('result'));
  await page.waitForSelector('.official');
  await page.click('.actions .btn.brass');
  await page.waitForSelector('.photo-frame canvas');
  await page.waitForTimeout(400);
  await save(page, join(out, 'docs/phone-circle.png'));
  await page.context().close();
}

// Link preview, 1200 x 630: the name, one line and five of the race's runners at their final odds on the
// left, a frame of that race on the right. The race is watched in a window whose picture is the shape of
// the right-hand side (730 by 630, with 30 px to spare each side), so the frame isn't cut down to fit.
{
  const page = await open({ width: 790, height: 1016 }, 1);
  await playUpTo(page, RACE_NO);
  await page.evaluate(no => window.postTime.nav.go('watch', { no }), RACE_NO);
  await page.waitForSelector('.watch:not([hidden])');
  await stopAtFullest(page, 30 / 790);
  const frame = await page.evaluate(() => document.querySelector('canvas.scene').toDataURL('image/png'));
  // The board is the race's own: its first five runners, each on its saddle cloth's colours, at the odds they went off at.
  const chips = await page.evaluate(async no => {
    const { CLOTH } = await import('./js/data.js');
    const race = window.postTime.card().races[no - 1];
    return race.entries.slice(0, 5).map((e, i) => ({ no: e.pp, cloth: CLOTH[e.pp], odds: race.result.oddsText[i] }));
  }, RACE_NO);
  const font = f => readFile(join(root, 'fonts', f)).then(b => b.toString('base64'));
  const [oswald, plex] = await Promise.all([font('oswald.woff2'), font('plex-condensed-400.woff2')]);
  await page.setViewportSize({ width: 1200, height: 630 });
  // (The five chips share the column's width: at a fixed 78 px each the fifth stuck out over the brass rule.)
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Oswald; src: url(data:font/woff2;base64,${oswald}); font-weight: 400 700; }
    @font-face { font-family: Plex; src: url(data:font/woff2;base64,${plex}); }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: #1f4d3a; color: #f3ecd8; display: grid; grid-template-columns: 470px 1fr; }
    .l { padding: 64px 40px 56px 64px; display: flex; flex-direction: column; border-right: 6px solid #b8892d; position: relative; }
    .k { font: 500 20px/1 Oswald; letter-spacing: .2em; text-transform: uppercase; color: #d9c48c; }
    h1 { font: 700 104px/0.95 Oswald; letter-spacing: .02em; text-transform: uppercase; margin: 18px 0 26px; }
    p { font: 400 29px/1.3 Plex; margin: 0; color: #efe6cf; }
    .tote { margin-top: auto; display: flex; gap: 8px; }
    .c { flex: 1 1 0; min-width: 0; background: #111511; border-radius: 6px; padding: 8px 2px 6px; text-align: center; box-shadow: inset 0 0 0 2px #26352d; }
    .c b { display: block; font: 600 16px/1 Oswald; width: 26px; height: 22px; line-height: 22px; margin: 0 auto 6px; border-radius: 3px; }
    .c span { font: 600 24px/1 Oswald; color: #f5b33d; }
    .r { background: url(${frame}) center / cover no-repeat; }
  </style></head><body>
    <div class="l"><div class="k">Larkspur Downs</div><h1>Post<br>Time</h1><p>Read the form, bet the tote, and watch every race from the gate to the wire.</p>
      <div class="tote">${chips.map(c => `<div class="c"><b style="background:${c.cloth[0]};color:${c.cloth[1]}">${c.no}</b><span>${c.odds}</span></div>`).join('')}</div>
    </div>
    <div class="r"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready.then(() => 0));
  await save(page, join(out, 'og.png'));
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
