// How long Joe takes over the game's lines, timed in his own worker in headless Chromium, as
// test/joe-times.fixture.json:   node tools/joe-times.mjs > test/joe-times.fixture.json
// (`--few` times a dozen clips and no more, to see that it runs. The whole of it takes about a quarter of
// an hour. It needs Playwright, as npm test does.)
//
// The lines are different spoken lines of the calls of 40 races the game makes (five seeds' first cards),
// so many of each kind: 438 of them. Each is made at 1.3 and at 1.5 times his own speed, the speed his
// call opens at and his top speed, and every third at 1.4. js/joe-call.js's model of how long he takes is
// a fit to these, and test/audio.test.mjs holds the model to them. He draws each sound's length at random,
// so a second run gives slightly different numbers.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, simulateRace } from '../js/world.js';
import { raceCall, aloud } from '../js/call.js';

const RACES = 40;
const OF_EACH = { pre: 6, off: 5, break: 14, run: 60, more: 70, fill: 30, frac: 30, turn: 25, drive: 70, eighth: 20, change: 30, wire: 25, placings: 25, mover: 8, sixteenth: 9, tired: 8, trouble: 3 };
const few = process.argv.includes('--few');

// The lines, by the kind of line each is.
const kinds = new Map();
let races = 0;
for (let seed = 0; races < RACES; seed++) {
  const world = createWorld(`fit-${seed}`, '2026-11-07');
  for (const race of world.cards[world.day].races) {
    const names = race.entries.map(e => world.horses[e.hid].name);
    for (const line of raceCall(race, simulateRace(race, world, { record: true }), names).lines) {
      const say = line.say || aloud(line.text);
      if (!kinds.has(line.slot)) kinds.set(line.slot, new Map());
      if (![...kinds.values()].some(of => of.has(say))) kinds.get(line.slot).set(say, line.slot);
    }
    races++;
  }
}
let jobs = [];
for (const [slot, of] of kinds) {
  const list = [...of.keys()], n = Math.min(OF_EACH[slot] || 5, list.length);
  for (let k = 0; k < n; k++) {
    const say = list[Math.floor(k * list.length / n)];
    jobs.push({ say, slot, speed: 1.3 }, { say, slot, speed: 1.5 });
    if (k % 3 === 0) jobs.push({ say, slot, speed: 1.4 });
  }
}
if (few) jobs = jobs.slice(0, 12);

// The game, served as GitHub Pages serves it, and the voice downloaded into a browser.
const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const { chromium } = createRequire(import.meta.url)(join(execSync('npm root -g').toString().trim(), 'playwright'));
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForSelector('.races', { timeout: 60000 });
  const made = await page.evaluate(async jobs => {
    const joe = await import('./js/joe.js');
    await joe.download();
    if (joe.status().state !== 'ready') throw new Error(`the download stopped: ${joe.status().problem}`);
    const out = [];
    for (const job of jobs) { const clip = await joe.speak(job.say, job.speed); out.push({ ...job, seconds: clip.seconds, ms: clip.ms }); }
    return out;
  }, jobs);
  const lines = new Map();
  let sound = 0, work = 0;
  for (const m of made) {
    if (!lines.has(m.say)) lines.set(m.say, { slot: m.slot });
    lines.get(m.say)[m.speed] = +m.seconds.toFixed(3);
    sound += m.seconds; work += m.ms / 1000;
  }
  console.log(JSON.stringify({
    made: `tools/joe-times.mjs: the voice's own worker in headless Chromium (one thread), ${new Date().toISOString().slice(0, 10)}`, voice: 'en_US-joe-medium', races,
    speeds: [1.3, 1.4, 1.5], clips: made.length, sound: +sound.toFixed(1), work: +work.toFixed(1),
    lines: [...lines].map(([say, x]) => [say, x.slot, x[1.3], x[1.4] ?? null, x[1.5]]),
  }));
} finally {
  await browser.close();
  server.close();
}
