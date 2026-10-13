// The racing logic, in plain Node:  node --test test/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRace, figureFor, stateAt, runningOrder } from '../js/sim.js';
import { coursePath, FURLONG, COURSES } from '../js/track.js';
import { createWorld, simulateRace } from '../js/world.js';
import { makeTote, board, settle, ticketReturn, cost } from '../js/tote.js';
import { fmtTime, fmtClock } from '../js/chart.js';
import { timeWords } from '../js/call.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const race = (f, surface = 'dirt', seed = 'x') => {
  const r = { distance: f * FURLONG, surface, cond: surface === 'dirt' ? 'fast' : 'firm', seed };
  r.path = coursePath(surface, r.distance);
  return r;
};
const horse = (o = {}) => ({ rating: 80, style: 0.5, reserve: 110, gate: 0.6, jockey: 0.5, heart: 0.5, ...o });

test('every course adds up to its distance, and the laps are the right length', () => {
  assert.ok(Math.abs(COURSES.dirt.lap - 1609.344) < 0.01);
  for (const surface of ['dirt', 'turf']) {
    for (const f of [5, 5.5, 6, 6.5, 7, 8, 8.5, 9, 10]) {
      const path = coursePath(surface, f * FURLONG);
      const total = path.reduce((s, x) => s + x.len, 0);
      assert.ok(Math.abs(total - f * FURLONG) < 0.01, `${surface} ${f}f`);
    }
  }
});

test('a horse running alone earns about the figure it was given', () => {
  for (const f of [6, 7, 8.5, 9]) {
    let figs = 0;
    for (let i = 0; i < 8; i++) {
      const r = race(f, 'dirt', `solo${f}${i}`);
      const run = runRace(r, [horse({ rating: 85 })], { record: false });
      figs += figureFor(run.finalTime, r.distance, 'dirt', 'fast');
    }
    const avg = figs / 8;
    assert.ok(Math.abs(avg - 85) < 8, `${f}f solo figure ${avg}`);
  }
});

test('race times look like real ones', () => {
  const run = runRace(race(6, 'dirt', 'times'), Array.from({ length: 8 }, () => horse()), { record: false });
  assert.ok(run.finalTime > 67 && run.finalTime < 74, `6f in ${run.finalTime}`);
  const q = run.fractions[0].t;
  assert.ok(q > 21 && q < 25, `first quarter ${q}`);
});

test('the same race run twice comes out the same', () => {
  const field = Array.from({ length: 9 }, (_, i) => horse({ rating: 75 + i, style: i / 9 }));
  const a = runRace(race(8.5, 'dirt', 'same'), field);
  const b = runRace(race(8.5, 'dirt', 'same'), field);
  assert.deepEqual(a.results.map(r => [r.h, r.time]), b.results.map(r => [r.h, r.time]));
  assert.equal(a.frames.length, b.frames.length);
});

test('pace matters: lone speed does better than speed in a duel', () => {
  const wins = styles => {
    let w = 0;
    for (let s = 0; s < 120; s++) {
      const field = styles.map(st => horse({ style: st }));
      const run = runRace(race(6, 'dirt', `pace${styles.join()}${s}`), field, { record: false });
      if (run.results[0].h === 0) w++;
    }
    return w / 120;
  };
  const lone = wins([0.9, 0.4, 0.4, 0.2, 0.2, 0.3, 0.1, 0.45]);
  const duel = wins([0.9, 0.85, 0.95, 0.8, 0.2, 0.2, 0.1, 0.3]);
  assert.ok(lone > duel + 0.08, `lone speed ${lone}, in a duel ${duel}`);
});

test('the running order at the finish is the official order, with the official margins', () => {
  let goneBy = 0;
  for (let s = 0; s < 30; s++) {
    const field = Array.from({ length: 9 }, (_, i) => horse({ rating: 78 + ((i + s) % 4), style: ((i + s) * 0.37) % 1, reserve: 100 + ((i + s) * 7) % 30 }));
    const run = runRace(race([6, 7, 8.5, 5.5][s % 4], 'dirt', `order${s}`), field);
    const end = run.frames.length * run.dt;
    const o = runningOrder(run, end);
    assert.deepEqual(o.map(x => x.i), run.results.map(r => r.h), `race ${s}`);
    o.forEach((x, k) => assert.equal(x.gap, k ? run.results[k].toPrev : 0));
    // They keep running after the wire, and by then a horse that finished behind has often gone by.
    const live = stateAt(run, end).map((x, i) => [x.p, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    if (live.join() !== o.map(x => x.i).join()) goneBy++;
    // Halfway through the finish: the ones home in the official order, then the rest by where they are.
    const k = Math.floor(run.results.length / 2);
    const t = run.t0 + run.results[k].time + 0.001;
    const mid = runningOrder(run, t);
    assert.deepEqual(mid.slice(0, k + 1).map(x => x.i), run.results.slice(0, k + 1).map(r => r.h));
    const st = stateAt(run, t);
    const rest = mid.slice(k + 1).map(x => st[x.i].p);
    assert.deepEqual(rest, rest.slice().sort((a, b) => b - a));
    assert.ok(mid.every(x => x.gap >= 0));
  }
  assert.ok(goneBy > 0, 'no race in the sample where the order by position at the end is wrong');
});

test('the world builds a full card with past performances that happened', () => {
  const w = createWorld('test-world', '2026-09-26');
  const card = w.cards[0];
  assert.equal(card.races.length, 8);
  for (const r of card.races) {
    assert.ok(r.entries.length >= 5 && r.entries.length <= 12, `race ${r.no} has ${r.entries.length}`);
    for (const e of r.entries) {
      const h = w.horses[e.hid];
      assert.ok(!h.retired);
      for (const p of h.pps) {
        assert.ok(p.fin >= 1 && p.fin <= p.fs);
        assert.equal(p.line[p.line.length - 1][0], p.fin);
      }
    }
    // Nobody is entered twice on one day.
    const ids = card.races.flatMap(x => x.entries.map(e => e.hid));
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.ok(JSON.stringify(w).length < 900_000, 'the save stays small');
});

test('the tote pays like a tote', () => {
  const w = createWorld('test-tote', '2026-09-26');
  for (const r of w.cards[0].races) {
    const tote = makeTote(r, w);
    const b = board(tote, 1);
    const book = b.odds.reduce((s, o) => s + 1 / (o + 1), 0);
    assert.ok(book > 1.1 && book < 1.3, `the book adds to ${book}`);
    const run = simulateRace(r, w, { record: false });
    const order = run.results.map(x => x.h);
    const pay = settle(tote, order);
    const win = pay.win[order[0]];
    assert.ok(win >= 2.1);
    assert.ok(pay.place[order[0]] <= win + 1e-9);
    assert.ok(pay.show[order[0]] <= pay.place[order[0]] + 1e-9);
    assert.ok(pay.exacta.pay >= 2.1 && pay.trifecta.pay >= 1.05);
    // Tickets.
    assert.equal(ticketReturn({ type: 'win', sel: [order[0]], amt: 2 }, pay), win);
    assert.equal(ticketReturn({ type: 'win', sel: [order[1]], amt: 2 }, pay), 0);
    assert.equal(cost({ type: 'exbox', sel: [0, 1, 2], amt: 1 }), 6);
    assert.equal(cost({ type: 'tribox', sel: [0, 1, 2, 3], amt: 1 }), 24);
    assert.equal(cost({ type: 'wps', sel: [0], amt: 2 }), 6);
    const box = ticketReturn({ type: 'exbox', sel: [order[1], order[0]], amt: 2 }, pay);
    assert.equal(box, pay.exacta.pay);
  }
});

test('times round up into the next minute instead of reading 60 seconds', () => {
  assert.equal(fmtTime(59.996), '1:00.00');
  assert.equal(fmtTime(119.996), '2:00.00');
  assert.equal(fmtTime(59.994), ':59.99');
  assert.equal(fmtTime(22.4), ':22.40');
  assert.equal(fmtTime(71.126), '1:11.13');
  assert.equal(fmtClock(59.97), '1:00.0');
  assert.equal(fmtClock(119.96), '2:00.0');
  assert.equal(fmtClock(59.94), '0:59.9');
  assert.equal(fmtClock(5.04), '0:05.0');
  assert.equal(timeWords(59.996), '1:00.00');
  assert.equal(timeWords(119.996), '2:00.00');
  assert.equal(timeWords(58.5), '58.50');
  assert.equal(timeWords(97.44), '1:37.44');
});

test('the offline copy lists every file the page needs', async () => {
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const walk = d => readdirSync(join(root, d)).flatMap(f => statSync(join(root, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]);
  for (const f of [...walk('js'), ...walk('css'), ...walk('fonts')]) assert.ok(sw.includes(`'${f}'`), `sw.js is missing ${f}`);
});

test("the phone's status bar matches the header in light and dark", async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const css = await readFile(join(root, 'css/app.css'), 'utf8');
  const bars = Object.fromEntries([...html.matchAll(/<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: (light|dark)\)">/g)].map(m => [m[2], m[1]]));
  const light = css.match(/:root \{[^}]*--green: (#[0-9a-f]{6})/)[1];
  const dark = css.match(/:root\[data-theme="dark"\] \{[^}]*--green: (#[0-9a-f]{6})/)[1];
  assert.deepEqual(bars, { light, dark });
});
