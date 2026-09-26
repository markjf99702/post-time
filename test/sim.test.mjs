// The racing logic, in plain Node:  node --test test/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRace, figureFor } from '../js/sim.js';
import { coursePath, FURLONG, COURSES } from '../js/track.js';
import { createWorld, simulateRace } from '../js/world.js';
import { makeTote, board, settle, ticketReturn, cost } from '../js/tote.js';

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

test('the offline copy lists every file the page needs', async () => {
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const walk = d => readdirSync(join(root, d)).flatMap(f => statSync(join(root, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]);
  for (const f of [...walk('js'), ...walk('css'), ...walk('fonts')]) assert.ok(sw.includes(`'${f}'`), `sw.js is missing ${f}`);
});
