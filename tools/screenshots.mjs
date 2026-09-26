// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, so the same meet (and the same pictures) come out every time.
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = +(process.env.SEED || 11); // change it until the pictures look good
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    localStorage.setItem('post-time/seen', '1');
  }, SEED);
  await page.goto(base);
  await page.waitForSelector('.races', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Save a PNG, quantised to 256 colours when upng-js is installed.
async function save(page, path, opts = {}) {
  const buf = await page.screenshot(opts);
  if (!UPNG) return writeFile(path, buf);
  const img = UPNG.decode(buf);
  const out = UPNG.encode([UPNG.toRGBA8(img)[0]], img.width, img.height, 256);
  await writeFile(path, Buffer.from(out));
}

const RACE_NO = +(process.env.RACE || 2);

// The moment in the race when the most horses are close together behind the leader.
function bunchedMoment() {
  const w = window.__watch, run = w.run;
  let best = null;
  for (let i = Math.round(w.winT * 0.5 / run.dt); i < Math.round((w.winT - 1.5) / run.dt); i += 6) {
    const f = run.frames[i];
    const ps = [];
    for (let k = 0; k < run.n; k++) ps.push(f[k * 4]);
    const lead = Math.max(...ps);
    const close = ps.filter(p => lead - p < 7).length + i * run.dt / 400;
    if (!best || close >= best.close) best = { close, t: i * run.dt };
  }
  return best.t;
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await save(page, join(root, 'docs/phone-card.png'));
  await page.evaluate(no => window.postTime.nav.go('race', { no }), 1);
  await page.waitForSelector('.entry');
  // Open the horse with the most past performances.
  const idx = await page.evaluate(() => {
    const { game, card } = window.postTime;
    const r = card().races[0];
    let best = 0;
    r.entries.forEach((e, i) => { if (game.world.horses[e.hid].pps.length > game.world.horses[r.entries[best].hid].pps.length) best = i; });
    return best;
  });
  await page.locator('.entry-head').nth(idx).click();
  await page.locator('.entry').nth(idx).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 150));
  await page.waitForTimeout(200);
  await save(page, join(root, 'docs/phone-form.png'));
  // Play through to the chosen race, then watch it.
  for (let no = 1; no < RACE_NO; no++) {
    await page.evaluate(n => window.postTime.nav.go('watch', { no: n }), no);
    await page.waitForSelector('.watch:not([hidden])');
    await page.evaluate(() => window.__watch.leave('card'));
  }
  await page.evaluate(no => window.postTime.nav.go('race', { no }), RACE_NO);
  await page.click('.tabs button:nth-child(4)');
  await page.locator('.pick-row').nth(0).locator('button').nth(1).click();
  await page.click('.builder .btn');
  await page.click('.post-bar .btn.brass');
  await page.waitForSelector('.watch:not([hidden])');
  const T = +(process.env.T || 0) || await page.evaluate(bunchedMoment);
  await page.evaluate(t => { window.__watch.setT(t); }, T - 3);
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__watch.pause());
  await save(page, join(root, 'docs/phone-race.png'));
  // Grab a frame for the link preview while we're here.
  await page.evaluate(() => window.__watch.leave('result'));
  await page.waitForSelector('.official');
  await page.click('.actions .btn.brass');
  await page.waitForSelector('.photo-frame canvas');
  await page.waitForTimeout(400);
  await save(page, join(root, 'docs/phone-circle.png'));
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, a frame of a race on the right.
{
  const page = await open({ width: 1000, height: 820 }, 1);
  for (let no = 1; no < RACE_NO; no++) {
    await page.evaluate(n => window.postTime.nav.go('watch', { no: n }), no);
    await page.waitForSelector('.watch:not([hidden])');
    await page.evaluate(() => window.__watch.leave('card'));
  }
  await page.evaluate(no => window.postTime.nav.go('watch', { no }), RACE_NO);
  await page.waitForSelector('.watch:not([hidden])');
  const T = +(process.env.T || 0) || await page.evaluate(bunchedMoment);
  await page.evaluate(t => { window.__watch.setT(t); }, T - 3);
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__watch.pause());
  await page.waitForTimeout(100);
  const frame = await page.evaluate(() => document.querySelector('canvas.scene').toDataURL('image/png'));
  const font = f => readFile(join(root, 'fonts', f)).then(b => b.toString('base64'));
  const [oswald, plex] = await Promise.all([font('oswald.woff2'), font('plex-condensed-400.woff2')]);
  await page.setViewportSize({ width: 1200, height: 630 });
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
    .c { background: #111511; border-radius: 6px; padding: 8px 10px 6px; text-align: center; min-width: 58px; box-shadow: inset 0 0 0 2px #26352d; }
    .c b { display: block; font: 600 16px/1 Oswald; width: 26px; height: 22px; line-height: 22px; margin: 0 auto 6px; border-radius: 3px; }
    .c span { font: 600 24px/1 Oswald; color: #f5b33d; }
    .r { background: url(${frame}) center / cover no-repeat; }
  </style></head><body>
    <div class="l"><div class="k">Larkspur Downs</div><h1>Post<br>Time</h1><p>Read the form, bet the tote, and watch every race from the gate to the wire.</p>
      <div class="tote">
        <div class="c"><b style="background:#d62828;color:#fff">1</b><span>5-2</span></div>
        <div class="c"><b style="background:#f4f4f0;color:#111">2</b><span>9-5</span></div>
        <div class="c"><b style="background:#1f4fd1;color:#fff">3</b><span>12-1</span></div>
        <div class="c"><b style="background:#f5d400;color:#111">4</b><span>4-1</span></div>
        <div class="c"><b style="background:#1e8a3a;color:#fff">5</b><span>30-1</span></div>
      </div>
    </div>
    <div class="r"></div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await save(page, join(root, 'og.png'));
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
