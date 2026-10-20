// The racing logic, in plain Node:  node --test test/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRace, figureFor, stateAt, runningOrder } from '../js/sim.js';
import { coursePath, FURLONG, COURSES } from '../js/track.js';
import { createWorld, simulateRace, buildCard, applyResult, nextDay } from '../js/world.js';
import { makeTote, board, settle, ticketReturn, cost, TAKEOUT } from '../js/tote.js';
import { fmtTime, fmtClock } from '../js/chart.js';
import { timeWords, raceCall } from '../js/call.js';
import { forumPosts } from '../js/forum.js';

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

test('a maiden race short of horses is opened up until it has a field', () => {
  const w = createWorld('test-maidens', '2026-09-26');
  // Late in a long meet most of the maidens have won: leave six.
  let left = 6;
  for (const h of w.horses) if (h.maiden && !h.retired && left-- <= 0) h.maiden = false;
  let opened = 0;
  for (let d = 1; d <= 12; d++) {
    for (const r of buildCard(w, d).races) {
      assert.ok(r.entries.length >= 5, `race day ${d + 1}, race ${r.no} has ${r.entries.length} horses`);
      if (r.no === 1 || r.no === 3) opened += r.cls === 'C10';
    }
  }
  assert.ok(opened > 0, 'no maiden race was short of horses');
});

test('a race that winners still leave short is opened to any horse, but nobody runs twice in a day', () => {
  const w = createWorld('test-open-up', '2026-09-26');
  // Most of the barn ran last week: leave thirty horses rested for next Saturday.
  let rested = 30;
  for (const h of w.horses) if (!h.retired && rested-- <= 0) h.last = 0;
  const card = buildCard(w, 1);
  for (const r of card.races) {
    assert.ok(r.entries.length >= 5, `race ${r.no} has ${r.entries.length} horses`);
    assert.ok(r.entries.every(e => Number.isFinite(e.wt) && Number.isFinite(e.rating) && e.j >= 0 && e.ml > 0), `race ${r.no} has a horse without a weight, rider or morning line`);
  }
  const ids = card.races.flatMap(r => r.entries.map(e => e.hid));
  assert.equal(new Set(ids).size, ids.length, 'a horse is in two races');
  assert.ok(ids.some(id => w.horses[id].last === 0), 'no horse that ran last week was called on');
});

test('a field of one or two horses can be called, and the forum can talk about it', () => {
  // Late in a long meet a race could be left this short, and its forum and race call both broke on it.
  const w = createWorld('test-small-field', '2026-09-26');
  for (const n of [1, 2]) {
    for (const full of w.cards[0].races.slice(0, 2)) {
      const r = { ...full, entries: full.entries.slice(0, n), seed: `${full.seed}:${n}` };
      const run = simulateRace(r, w, { record: true });
      const call = raceCall(r, run, r.entries.map(e => w.horses[e.hid].name));
      const posts = forumPosts(w, r, { odds: r.entries.map(() => 1), text: r.entries.map(() => '1-1') });
      const said = [...call.lines, ...posts].map(x => x.text).join('\n');
      assert.ok(!/undefined|NaN/.test(said), `${n} horses:\n${said}`);
      assert.match(call.lines[call.lines.length - 1].text, /The time, /, `${n} horses: the time isn't called`);
    }
  }
});

test('a first-time starter in a maiden claimer is seldom the morning-line favourite', () => {
  // The public guessed every horse that hadn't run at a 64, which is better than most maiden claimers
  // ever run, so one of them was the favourite in about a quarter of those races and seldom won.
  const w = createWorld('test-debut', '2026-09-26');
  let races = 0, first = 0, favs = 0;
  for (let d = 1; d <= 40; d++) {
    const r = buildCard(w, d).races.find(x => x.cls === 'MCL');
    if (!r) continue;
    races++;
    first += r.entries.filter(e => !w.horses[e.hid].pps.length).length;
    const fav = r.entries.reduce((a, e) => (e.ml < a.ml ? e : a));
    if (!w.horses[fav.hid].pps.length) favs++;
  }
  assert.ok(first >= 10, `only ${first} first-time starters in ${races} maiden claimers`);
  assert.ok(favs <= 2, `a first-time starter is the morning-line favourite in ${favs} of ${races} maiden claimers`);
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

test('no exotic ticket pays more than the whole pool', () => {
  // Three long shots finish in front: the public has only cents on that exacta and trifecta.
  const p = [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.01, 0.005, 0.003, 0.002];
  const tote = { n: p.length, early: p, late: p, size: 70000, wig: p.map(() => 0), seed: 'long-shots' };
  const { pools } = board(tote, 1);
  const pay = settle(tote, [9, 8, 7]);
  assert.ok(pay.exacta.pay <= pools.exacta * (1 - TAKEOUT.exacta), `a $2 exacta pays ${pay.exacta.pay} from a pool of ${pools.exacta * (1 - TAKEOUT.exacta)}`);
  assert.ok(pay.trifecta.pay <= pools.trifecta * (1 - TAKEOUT.trifecta), `a $1 trifecta pays ${pay.trifecta.pay} from a pool of ${pools.trifecta * (1 - TAKEOUT.trifecta)}`);
  assert.ok(pay.trifecta.pay > 30000, 'the only ticket on it gets about the whole pool');
});

test("following the late money doesn't pay, and neither do long-shot trifectas", () => {
  // Forty race days. Bet $2 to win on the horse whose odds came in most between the opening and 2
  // minutes to post, as the board shows them. When the final price kept little of what the late money
  // knew, that got back more than $2 for every $1 bet.
  const w = createWorld('late-money', '2026-09-26');
  let spent = 0, back = 0, tri = 0, races = 0;
  for (let d = 0; d < 40; d++) {
    for (const r of w.cards[w.day].races) {
      const tote = makeTote(r, w);
      const open = board(tote, 0).odds, late = board(tote, 0.9).odds;
      const move = late.map((o, i) => (open[i] + 1) / (o + 1));
      const steam = move.indexOf(Math.max(...move));
      const run = simulateRace(r, w, { record: false });
      const order = run.results.map(x => x.h);
      if (move[steam] > 1.15) {
        const bet = { type: 'win', sel: [steam], amt: 2 };
        spent += 2;
        back += ticketReturn(bet, settle(tote, order, [bet]));
      }
      // What a $1 trifecta on a combination picked at random gets back, on average.
      const n = r.entries.length;
      tri += settle(tote, order, [{ type: 'trifecta', sel: order.slice(0, 3), amt: 1 }]).trifecta.pay / (n * (n - 1) * (n - 2));
      races++;
      applyResult(w, r, run, board(tote, 1).odds);
    }
    nextDay(w);
  }
  assert.ok(back / spent < 1.4, `following the late money got back $${(back / spent).toFixed(2)} for every $1`);
  // The takeout is 25%. With the public's trifecta money spread as if second and third were as easy to
  // call as the winner, the long shots underneath paid so much that a random ticket got back about $1.
  assert.ok(tri / races < 0.9, `a random trifecta got back $${(tri / races).toFixed(2)} for every $1`);
});

test('your win money stays in the win pool', () => {
  // A small pool, so $100 of yours would show.
  const p = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04];
  const tote = { n: p.length, early: p, late: p, size: 3000, wig: p.map(() => 0), seed: 'own-money' };
  const order = [2, 0, 4];
  const others = [{ type: 'place', sel: [2], amt: 100 }, { type: 'show', sel: [4], amt: 100 }, { type: 'exacta', sel: [2, 0], amt: 100 }, { type: 'trifecta', sel: [2, 0, 4], amt: 100 }];
  const alone = settle(tote, order, others);
  const withWin = settle(tote, order, [{ type: 'win', sel: [5], amt: 100 }, ...others]);
  for (const pool of ['place', 'show', 'exacta', 'trifecta']) assert.deepEqual(withWin[pool], alone[pool], `a $100 win ticket changed what the ${pool} pays`);
  const b = board(tote, 1, [{ type: 'win', sel: [5], amt: 100 }]);
  assert.equal(Math.round(b.pools.win), 3100);
  assert.equal(Math.round(b.pools.place), Math.round(3000 * 0.46));
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
