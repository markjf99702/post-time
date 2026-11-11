// The racing logic, in plain Node:  node --test test/sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRace, figureFor, stateAt, runningOrder } from '../js/sim.js';
import { coursePath, FURLONG, COURSES } from '../js/track.js';
import { rng } from '../js/rng.js';
import { createWorld, simulateRace, buildCard, applyResult, nextDay, ageOf } from '../js/world.js';
import { makeTote, board, settle, ticketReturn, cost, TAKEOUT } from '../js/tote.js';
import { fmtTime, fmtClock, fmtWork, marginShort, marginText, lengthsText, tripComment } from '../js/chart.js';
import { timeWords, timeSay, aloud, raceCall } from '../js/call.js';
import { forumPosts } from '../js/forum.js';
import { angles, newcomer, freshBullet, oddsText, oddsValue } from '../js/handicap.js';

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

// A field like the ones a card draws: figures spread about 78, styles and reserves from each horse's best
// distance as world.js draws them.
function realField(seed, n, f) {
  const R = rng(`field:${seed}`);
  return Array.from({ length: n }, () => {
    const dist = Math.max(5.5, Math.min(11, f + R.gauss() * 0.9));
    return { rating: 78 + R.gauss() * 5, style: Math.max(0.02, Math.min(0.98, 0.3 + (8.5 - dist) * 0.05 + R() * 0.5)), reserve: Math.max(82, Math.min(140, 112 + (7.5 - dist) * 5 + R.gauss() * 8)), gate: R(), jockey: R(), heart: R() };
  });
}

// Six furlongs went :23.1, :47.3 and 1:10.6, the last quarter faster than the second in every race: every
// horse spread its effort evenly to the wire. Dirt races are run fast early and tire late now.
test('six furlongs on dirt goes fast early and tires late: about :22.4, :45.6 and 1:10.6', () => {
  let q = 0, h = 0, fin = 0, slower = 0;
  const N = 120;
  for (let s = 0; s < N; s++) {
    const run = runRace(race(6, 'dirt', `six${s}`), realField(`six${s}`, 8, 6), { record: false });
    q += run.fractions[0].t; h += run.fractions[1].t; fin += run.finalTime;
    if (run.finalTime - run.fractions[1].t > run.fractions[1].t - run.fractions[0].t) slower++;
  }
  assert.ok(q / N < 22.6, `the quarter in ${(q / N).toFixed(2)}`);
  assert.ok(h / N < 46.1, `the half in ${(h / N).toFixed(2)}`);
  assert.ok(fin / N > 69.6 && fin / N < 71, `six furlongs in ${(fin / N).toFixed(2)}`);
  assert.ok(slower > N * 0.9, `the last quarter slower than the second in ${slower} of ${N}`);
});

// A stumble cost nothing (stumblers won as often as the rest: the horse was held back while it was barely
// moving) and a slow break about five lengths' worth (slow breakers won 1.8% of their starts). Both cost a
// horse about what a bump does now, a length or so: they win about 60% as often as a horse away cleanly.
test('a stumble and a slow break each cost about what a bump does', () => {
  const t = { stumble: [0, 0], slow: [0, 0], bumped: [0, 0], clean: [0, 0] };
  for (const f of [6, 8.5]) for (let s = 0; s < 3000; s++) {
    const run = runRace(race(f, 'dirt', `trouble${f}:${s}`), realField(`trouble${f}:${s}`, 8, f), { record: false });
    for (const r of run.results) {
      const k = r.stumble ? 'stumble' : r.slow ? 'slow' : r.bumped ? 'bumped' : 'clean';
      t[k][0]++; if (r.pos === 1) t[k][1]++;
    }
  }
  const rate = k => t[k][1] / t[k][0], vs = k => rate(k) / rate('clean');
  for (const k of ['stumble', 'slow']) assert.ok(vs(k) > 0.4 && vs(k) < 0.85, `a horse with a ${k} start wins ${(100 * rate(k)).toFixed(1)}% to ${(100 * rate('clean')).toFixed(1)}% for a clean start`);
});

// Posts 1 and 2 won 34% of races of a mile or more and post 1 a sixth of all races: the field went into
// the first turn in the lanes it broke from, and nothing was against the rail. Now riders drawn wide get
// over before the turn, horses with early speed get away quicker, and the rail horse is often squeezed at
// the break: riders dread drawing the rail.
test('the rail is no gift: post 1 wins less than posts 2 and 3, and the outside posts get their share', () => {
  const wins = (f, surface, N) => {
    const w = Array(9).fill(0);
    for (let s = 0; s < N; s++) w[runRace(race(f, surface, `posts${f}${surface}:${s}`), realField(`posts${f}${surface}:${s}`, 9, f), { record: false }).results[0].h]++;
    return w.map(x => x / N);
  };
  for (const [f, surface] of [[6, 'dirt'], [8.5, 'dirt'], [8, 'turf']]) {
    const w = wins(f, surface, 500), fair = 1 / 9;
    const say = `${f}f ${surface}: ${w.map(x => (100 * x).toFixed(0)).join(' ')}`;
    assert.ok(w[0] < (w[1] + w[2]) / 2, `post 1 wins more than posts 2 and 3 at ${say}`);
    assert.ok(w[0] + w[1] < 3 * fair, `posts 1 and 2 win too often at ${say}`);
    assert.ok((w[6] + w[7] + w[8]) / 3 > 0.5 * fair, `posts 7 to 9 win too seldom at ${say}`);
  }
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

test('a running line is called at three points that come one after another, at every distance on a card', () => {
  // The cut between sprint and route calls was 1,300 metres, so at 7 furlongs the second and third calls
  // were the same point (every horse's line said the same thing twice), at 6½ the third was taken half a
  // furlong before the second, and at 5 both fell at the half: one line in five.
  const w = createWorld('test-calls', '2026-09-26');
  const drawn = new Set();
  for (let d = 0; d < 40; d++) for (const r of buildCard(w, d).races) drawn.add(r.f);
  assert.deepEqual([...drawn].sort((a, b) => a - b), [5, 5.5, 6, 6.5, 7, 8, 8.5, 9], 'the distances a card can draw');
  const want = { 5: [1.5, 3, 4], 5.5: [2, 3, 4.5], 6: [2, 4, 5], 6.5: [2, 4, 5.5], 7: [2, 4, 6], 8: [4, 6, 7], 8.5: [4, 6, 7.5], 9: [4, 6, 8] };
  for (const f of drawn) {
    const field = Array.from({ length: 8 }, (_, i) => horse({ rating: 76 + i, style: (i * 0.37) % 1 }));
    const run = runRace(race(f, 'dirt', `calls${f}`), field, { record: false });
    const at = run.callPoints.map(p => +(p / FURLONG).toFixed(3));
    assert.deepEqual(at, want[f], `${f}f is called at ${at.join(', ')} furlongs`);
    assert.ok(at.every((p, k) => p > (k ? at[k - 1] : 0)) && at[2] < f, `${f}f: the calls don't rise, or don't stop short of the wire`);
    assert.equal(at[2], f - 1, `${f}f: the last call is a furlong from the finish`);
    // Each call was taken, with the leader in front by nothing and everyone else behind it; and the field
    // has moved between the second call and the third.
    for (const c of run.calls) assert.ok(c && c.length === 8 && c[0].behind === 0 && c.every((x, k) => !k || x.behind >= c[k - 1].behind), `${f}f: a call is missing or out of order`);
    assert.notDeepEqual(run.calls[1].map(x => x.behind), run.calls[2].map(x => x.behind), `${f}f: the second and third calls are the same`);
  }
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

// A stakes was weighted from 116 with a floor of 112: in one meet 83 of 168 stakes starters carried 112, and
// the top weight in a race was 116 at the median and never over 117.
test('a stakes is weighted from the top down: 124 for the best, 126 in a Handicap, and nobody under 114', () => {
  const w = createWorld('stakes-weights', '2026-09-26');
  const tops = [], all = [];
  for (let d = 0; d < 10; d++) {
    const stk = w.cards[w.day].races.find(r => r.cls === 'STK');
    const wts = stk.entries.map(e => e.wt);
    tops.push([stk.name, Math.max(...wts)]);
    all.push(...wts);
    for (const r of w.cards[w.day].races) applyResult(w, r, simulateRace(r, w, { record: false }), r.entries.map(() => 5));
    nextDay(w);
  }
  for (const [name, top] of tops) assert.equal(top, /Handicap/.test(name) ? 126 : 124, `the top weight in the ${name}`);
  assert.ok(tops.some(([name]) => /Handicap/.test(name)) && tops.some(([name]) => !/Handicap/.test(name)), 'ten race days without both kinds of stakes');
  assert.ok(all.every(x => x >= 114 && x <= 126), `stakes weights ${Math.min(...all)} to ${Math.max(...all)}`);
  const floor = all.filter(x => x === 114).length;
  assert.ok(floor < all.length / 3, `${floor} of ${all.length} stakes starters carried the 114 floor`);
});

// Two maiden races a week turned two maidens into winners, and horses shipped in only to replace the ones
// retired: in one meet race 1 was a maiden claimer on 45% of race days 21 to 40 and 20% of days 41 to 60.
test('the card keeps its two maiden races all meet: races 1 and 3 are for maidens on nine cards in ten', () => {
  const w = createWorld('maidens', '2026-09-26');
  let both = 0, cards = 0, late = 0;
  for (let d = 0; d < 60; d++) {
    const races = w.cards[w.day].races;
    const ok = races[0].cls === 'MCL' && races[2].cls === 'MSW';
    cards++; if (ok) both++;
    if (d >= 40 && ok) late++;
    for (const r of races) applyResult(w, r, simulateRace(r, w, { record: false }), r.entries.map(() => 5));
    nextDay(w);
  }
  assert.ok(both >= 0.9 * cards, `races 1 and 3 were maiden races on ${both} of ${cards} cards`);
  assert.ok(late >= 18, `and on ${late} of race days 41 to 60`);
  assert.ok(JSON.stringify(w).length < 1_500_000, 'the save stays small');
});

test('horses that ship in are three, four or five on the day they arrive, whatever year the meet began', () => {
  // A newcomer's foaling year was counted from the meet's first race day, so one drawn at three after a
  // New Year arrived at four, after two New Years at five, and so on: no three-year-old ever came
  // again, and the whole barn grew old together.
  const w = createWorld('test-new-year', '2026-12-19');
  const arrived = [];
  for (let k = 0; k < 3; k++) {
    const before = w.horses.length;
    nextDay(w);
    for (const h of w.horses.slice(before)) arrived.push({ day: w.day, date: w.cards[w.day].date, age: ageOf(w, h) });
  }
  assert.equal(w.cards[w.day].date, '2027-01-09');
  assert.ok(arrived.filter(a => a.date > '2027').length >= 3, `only ${arrived.length} horses shipped in`);
  assert.deepEqual(arrived.filter(a => a.age < 3 || a.age > 5), []);
  assert.ok(w.horses.some(h => !h.retired && ageOf(w, h) === 3), 'no three-year-old in the barn after the New Year');
});

test("LongshotLou calls a horse 'lightly raced and still improving' only in its three-year-old year", () => {
  // He counted its age from the year the meet began, so after a New Year he said it of four-year-olds
  // and never of the new three-year-olds.
  const w = createWorld('test-lou', '2026-12-19');
  const wrong = [];
  let said = 0;
  // (Twenty race days: whether he says it at all in the first ten depends on the horses the meet draws.)
  for (let d = 0; d < 20; d++) {
    for (const r of w.cards[w.day].races) {
      const odds = r.entries.map(e => e.ml);
      const lou = forumPosts(w, r, { odds, text: r.entries.map(e => e.mlText) }).find(p => p.who === 'lou');
      if (lou && /lightly raced and still improving/.test(lou.text)) {
        const h = w.horses[r.entries[lou.pick[0]].hid];
        if (ageOf(w, h) === 3) said++; else wrong.push(`${r.date}, race ${r.no}: ${h.name} is ${ageOf(w, h)}`);
      }
      applyResult(w, r, simulateRace(r, w, { record: false }), odds);
    }
    nextDay(w);
  }
  assert.deepEqual(wrong, []);
  assert.ok(said > 0, 'he never says it');
  assert.ok(w.cards[w.day].date > '2027-02', 'the meet never reached the New Year');
});

test('no horse comes with more wins, seconds and thirds than starts', () => {
  // In this meet Borrowed Ticket came with 3 wins, 3 seconds and 4 thirds from 9 starts.
  const w = createWorld('test-record-3', '2026-09-26');
  const over = w.horses.filter(h => h.life.w + h.life.p + h.life.s > h.life.starts);
  assert.deepEqual(over.map(h => `${h.name}: ${JSON.stringify(h.life)}`), []);
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

test("the recording runs long enough for the caller's last line", () => {
  // The recording ended about a second and a half after the last horse, and the line with second, third
  // and the time is due 3.2 seconds after the winner: in two races out of three it was never reached.
  const w = createWorld('test-last-line', '2026-09-26');
  const short = [];
  for (let d = 0; d < 2; d++) {
    for (const r of w.cards[w.day].races) {
      const run = simulateRace(r, w, { record: true });
      const call = raceCall(r, run, r.entries.map(e => w.horses[e.hid].name));
      const end = run.frames.length * run.dt;
      const lastHome = run.t0 + Math.max(...run.results.map(x => x.time));
      assert.ok(Math.abs(end - lastHome - 4) < 0.1, `race day ${d + 1}, race ${r.no}: the recording runs ${(end - lastHome).toFixed(2)} s past the last horse`);
      assert.match(call.lines[call.lines.length - 1].text, /The time, /);
      for (const l of call.lines) if (run.t0 + l.t >= end) short.push(`race day ${d + 1}, race ${r.no}: "${l.text}" is due ${(run.t0 + l.t - end).toFixed(2)} s after the recording ends`);
      applyResult(w, r, run, r.entries.map(() => 3));
    }
    nextDay(w);
  }
  assert.deepEqual(short, []);
});

test('a first-time starter in a maiden claimer is seldom the morning-line favourite', () => {
  // The public guessed every horse that hadn't run at a 64, which is better than most maiden claimers
  // ever run, so one of them was the favourite in about a quarter of those races and seldom won.
  // (This meet has ten horses that haven't run when it opens; some seeds leave only two, too few to judge by.)
  const w = createWorld('test-debut-8', '2026-09-26');
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

// A hand-made horse, a line on its card, and a race for it today (race day 4, 17 October 2026).
const line = (o = {}) => ({ d: 2, dt: '2026-10-10', f: 6, surf: 'd', cond: 'fast', cls: 'C16', clm: 16000, fin: 4, cm: 'Evenly', fig: 70, ...o });
const runner = (pps = [], o = {}) => ({ pps, works: [], life: { starts: pps.length, w: 0, p: 0, s: 0 }, ...o });
const today = (o = {}) => ({ day: 3, date: '2026-10-17', distance: 6 * FURLONG, surface: 'dirt', cond: 'fast', cls: 'C16', claim: 16000, ...o });
const chips = (r, h, day) => angles(r, h, day).map(c => c[0]);
const work = (dt, rank = 1) => ({ dt, f: 4, t: 48.2, g: 'B', rank, of: 30, surf: 'd' });

test('a horse with no race on its card is a first-time starter only if it has never raced', () => {
  // Horses arrive with a lifetime record. "First-time starter" and "Has not raced yet" were shown over
  // "Life: 10 starts, 1 win": on 16 of the 34 entries that wore the label in one meet, 11 of them winners.
  assert.deepEqual(newcomer(runner()), { chip: 'First-time starter', note: 'Has not raced yet. The workouts are all there is to go on.' });
  const shipped = n => newcomer(runner([], { life: { starts: n, w: 1, p: 0, s: 0 } }));
  assert.deepEqual(shipped(10), { chip: 'First start at Larkspur', note: 'Has raced 10 times elsewhere. None of it is on the card.' });
  assert.equal(shipped(1).note, 'Has raced once elsewhere. None of it is on the card.');
  assert.equal(shipped(2).note, 'Has raced twice elsewhere. None of it is on the card.');
  assert.equal(newcomer(runner([line()])), null);
  // In a meet: every horse without a line gets one label or the other, and the label agrees with its record.
  const w = createWorld('test-newcomers', '2026-09-26');
  let first = 0, elsewhere = 0;
  for (let d = 0; d < 6; d++) {
    for (const r of w.cards[w.day].races) {
      for (const e of r.entries) {
        const h = w.horses[e.hid], n = newcomer(h);
        assert.equal(!!n, !h.pps.length);
        if (n) { assert.equal(n.chip === 'First-time starter', h.life.starts === 0, `${h.name}: ${n.chip}, with ${h.life.starts} starts`); if (h.life.starts) elsewhere++; else first++; }
      }
      applyResult(w, r, simulateRace(r, w, { record: false }), r.entries.map(e => e.ml));
    }
    nextDay(w);
  }
  assert.ok(first > 0 && elsewhere > 0, `${first} first-time starters and ${elsewhere} first starts at Larkspur in six race days`);
});

test("a maiden claimer's winner meeting winners isn't a horse dropping in price", () => {
  // "Drops from $20k", in green, on a horse that had just won a $20,000 maiden claimer and was in for
  // $10,000 against winners: by the pars (60 against 63) that's a step up.
  const graduate = runner([line({ cls: 'MCL', clm: 20000, fin: 1 })]);
  assert.deepEqual(chips(today({ cls: 'C10', claim: 10000 }), graduate), ['First time against winners']);
  assert.deepEqual(chips(today({ cls: 'C25', claim: 25000 }), graduate), ['First time against winners']);
  assert.deepEqual(angles(today({ cls: 'C10', claim: 10000 }), graduate)[0], ['First time against winners', ''], 'a plain chip');
  // Still a maiden, in another maiden race: nothing to say.
  assert.deepEqual(chips(today({ cls: 'MCL', claim: 20000 }), runner([line({ cls: 'MCL', clm: 20000, fin: 2 })])), []);
  // A winner of a maiden special weight meets winners for the first time too.
  assert.deepEqual(chips(today({ cls: 'ALW', claim: null }), runner([line({ cls: 'MSW', clm: null, fin: 1 })])), ['First time against winners']);
  // It has met winners before: not the first time.
  assert.deepEqual(chips(today({ cls: 'ALW', claim: null }), runner([line({ cls: 'ALW', clm: null, d: 1 }), line({ cls: 'MSW', clm: null, fin: 1 })])), []);
  // Real moves in price, among winners.
  assert.deepEqual(angles(today({ cls: 'C10', claim: 10000 }), runner([line()])), [['Drops from $16k', 'good']]);
  assert.deepEqual(angles(today({ cls: 'C25', claim: 25000 }), runner([line()])), [['Up from $16k', '']]);
  assert.deepEqual(angles(today(), runner([line({ cls: 'ALW', clm: null })])), [['Drops into a claimer', 'good']]);
  assert.deepEqual(chips(today(), runner([line()])), [], 'the same price');
});

test('surface chips say only what the lines on the card show', () => {
  const turfRace = today({ surface: 'turf', cond: 'firm' });
  // Every start is on the card, none on turf: first time on turf. With starts the card doesn't show, it
  // may have run on turf before: 191 of 259 "First time on turf" chips were on horses like that.
  assert.deepEqual(chips(turfRace, runner([line(), line()])), ['First time on turf']);
  assert.deepEqual(chips(turfRace, runner([line(), line()], { life: { starts: 9, w: 1, p: 0, s: 0 } })), ['No turf race on the card']);
  assert.deepEqual(chips(turfRace, runner([line({ surf: 't' }), line()])), []);
  assert.deepEqual(chips(turfRace, runner([], { life: { starts: 4, w: 0, p: 0, s: 0 } })), [], 'a horse with no lines has no turf chip');
  // "Turf horse on dirt" after one race on turf said too much: it takes two, and none on dirt.
  const t = o => line({ surf: 't', cond: 'firm', ...o });
  assert.deepEqual(chips(today(), runner([t()])), []);
  assert.deepEqual(chips(today(), runner([t(), t()])), ['Turf horse on dirt']);
  assert.deepEqual(chips(today(), runner([t(), t(), line()])), []);
  // A wet track: only a good run on the same surface counts. Half of these chips were earned on the other one.
  const mud = today({ cond: 'sloppy' }), softTurf = today({ surface: 'turf', cond: 'yielding' });
  assert.deepEqual(chips(mud, runner([line(), t({ cond: 'yielding', fin: 1 })])), []);
  assert.deepEqual(angles(mud, runner([line({ cond: 'muddy', fin: 2 })])), [['Has run well on a wet track', 'good']]);
  assert.deepEqual(chips(mud, runner([line({ cond: 'muddy', fin: 3 })])), []);
  assert.deepEqual(chips(softTurf, runner([t(), line({ cond: 'sloppy', fin: 1 })])), []);
  assert.deepEqual(chips(softTurf, runner([t({ cond: 'soft', fin: 1 }), line()])), ['Has run well on a wet track']);
  assert.deepEqual(chips(today(), runner([line({ cond: 'muddy', fin: 1 })])), [], 'a fast track today');
});

test('"Bullet work" is for a bullet since the last race, or in the last three weeks for a horse with none', () => {
  // The chip showed if any of a horse's last five works was a bullet: of 203 in one meet, 174 were for a
  // bullet from before the horse's last race, and 135 for one more than six weeks old.
  const raced = works => runner([line({ dt: '2026-10-03', d: 1 })], { works });
  assert.deepEqual(chips(today(), raced([work('2026-09-22')])), [], 'a bullet from before its last race');
  assert.deepEqual(angles(today(), raced([work('2026-09-22'), work('2026-10-08')])), [['Bullet work', 'good']]);
  assert.deepEqual(chips(today(), raced([work('2026-10-08', 2)])), [], 'second best of the morning');
  assert.equal(freshBullet(raced([work('2026-10-06'), work('2026-10-13'), work('2026-10-09')]), today()).dt, '2026-10-13', 'the newest one');
  const unraced = works => runner([], { works });
  assert.deepEqual(chips(today(), unraced([work('2026-09-25')])), [], 'a bullet 22 days old on a horse that has not raced');
  assert.deepEqual(chips(today(), unraced([work('2026-09-26')])), ['Bullet work']);
  assert.deepEqual(chips(today(), unraced([work('2026-10-12', 5)])), []);
});

test('the other chips: distance, a claim, a layoff, a troubled trip', () => {
  const mile = today({ distance: 8 * FURLONG });
  assert.deepEqual(chips(mile, runner([line(), line({ f: 7 })])), ['First time going long']);
  assert.deepEqual(chips(mile, runner([line(), line({ f: 8.5 })])), []);
  assert.deepEqual(chips(today(), runner([line({ f: 8 }), line({ f: 9 })])), ['Cutting back to a sprint']);
  assert.deepEqual(angles(today(), runner([line({ claimed: { from: 2, price: 16000 } })])), [['New barn: claimed last out', 'good']]);
  assert.deepEqual(angles(today(), runner([line({ cm: 'Checked in traffic' })])), [['Troubled trip last time', 'good']]);
  // Only for real trouble: a stumble, a slow break or a check. (A bump or being blocked put it on about a
  // third of every field, and those horses won about as often as the rest next time.)
  assert.deepEqual(angles(today(), runner([line({ cm: 'Stumbled start; Evenly' })])), [['Troubled trip last time', 'good']]);
  assert.deepEqual(angles(today(), runner([line({ cm: 'Broke slowly; Late gain' })])), [['Troubled trip last time', 'good']]);
  assert.deepEqual(angles(today(), runner([line({ cm: 'Bumped start; Evenly' })])), []);
  assert.deepEqual(angles(today(), runner([line({ cm: 'Blocked stretch' })])), []);
  // The race day is passed in: five weeks since its last race is a layoff, four isn't.
  const rested = runner([line({ d: 2 })]);
  assert.deepEqual(chips(today(), rested, 7), ['Back from 5 weeks off']);
  assert.deepEqual(chips(today(), rested, 6), []);
  assert.deepEqual(angles(today({ day: 9 }), rested), [['Back from 7 weeks off', '']]);
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
    // (Unless the win pays the $2.10 least: a 1-20 shot's win pool can't pay it less, and its place pool can
    // pay it a dime or two more, as a track's does.)
    assert.ok(win === 2.1 || pay.place[order[0]] <= win + 1e-9, `the winner paid ${win} to win and ${pay.place[order[0]]} to place`);
    assert.ok(pay.place[order[0]] === 2.1 || pay.show[order[0]] <= pay.place[order[0]] + 1e-9);
    assert.ok(pay.exacta.pay >= 2.1 && pay.trifecta.pay >= 1.05);
    // "A $2 ticket pays in steps of 20 cents, and never less than $2.10", as How to play has it: a payout is
    // worked out per dollar and rounded down to the dime, so a $2 one is $2.10 or so many 20 cents, and the $1
    // trifecta $1.05 or so many dimes.
    const steps = (v, step, least) => v === least || Math.abs(v / step - Math.round(v / step)) < 1e-6;
    for (const v of [win, ...Object.values(pay.place), ...Object.values(pay.show), pay.exacta.pay]) assert.ok(steps(v, 0.2, 2.1), `a $2 payout of ${v}`);
    assert.ok(steps(pay.trifecta.pay, 0.1, 1.05), `a $1 trifecta payout of ${pay.trifecta.pay}`);
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

// The ten weeks before the meet are bet on the tote, like the races you watch. (They had odds from a stand-in
// book that held the favourite at a median 2.49-1, winning 27% of the time, where the tote has it at 1.70-1
// and 35%: so the prices on the lines from before the meet, and the records the forum regulars opened the
// meet with, came from another game.) Each race from before the meet is put back together from the lines its
// runners still hold; the favourite is the lowest price among them.
test('the weeks before the meet are bet on the tote: the favourite on those lines is the price it is live', () => {
  const w = createWorld('pinned', '2026-10-03');
  const races = new Map();
  for (const h of w.horses) for (const p of h.pps) races.set(`${p.d}:${p.no}`, [...(races.get(`${p.d}:${p.no}`) || []), p]);
  // (A race one of whose runners has since retired has lost a line, and with it perhaps its favourite.)
  const favs = [...races.values()].filter(ps => ps.length === ps[0].fs).map(ps => Math.min(...ps.map(p => p.odds))).sort((a, b) => a - b);
  assert.ok(favs.length >= 60, `only ${favs.length} whole races from before the meet`);
  const median = favs[Math.floor(favs.length / 2)];
  assert.ok(median < 2.2, `the median favourite before the meet is ${median}-1`);
  // And the regulars' records are the tote's: a winning pick is paid a tote's price, in steps of 20 cents.
  // (The stand-in book paid in steps of 10. A winner at the $2.10 least leaves a dime over, and one of this
  // meet's winning picks paid that.)
  const steps20 = x => Math.abs(x * 5 - Math.round(x * 5)) < 1e-6;
  for (const [who, r] of Object.entries(w.tipsters)) assert.ok(steps20(r.back) || steps20(r.back - 2.1), `${who} was paid ${r.back} on ${r.wins} winners`);
});

// A claim moves a horse to another owner as well as another trainer. (The new owner was drawn from all
// thirty, the present one included: one claim in thirty left the horse in the same silks under a line
// saying "Claimed from".)
test('a horse claimed out of a race goes to a different owner', () => {
  const w = createWorld('claims', '2026-10-03');
  let claims = 0;
  const same = [];
  for (let d = 0; d < 20; d++) {
    for (const r of w.cards[w.day].races) {
      const run = simulateRace(r, w, { record: false });
      applyResult(w, r, run, board(makeTote(r, w), 1).odds);
      for (const e of r.entries) {
        if (!e.ran) continue;
        claims++;
        const h = w.horses[e.hid];
        if (h.owner === e.ran.owner) same.push(`${h.name}, race day ${d + 1} race ${r.no}`);
        assert.notEqual(h.trainer, e.ran.trainer, `${h.name} was claimed by its own trainer`);
      }
    }
    nextDay(w);
  }
  assert.ok(claims >= 40, `only ${claims} claims in twenty race days`);
  assert.deepEqual(same, [], `of ${claims} claimed horses, these stayed with the owner they ran for`);
});

test('the board words a price at or just under what it pays: every whole number above 10-1', () => {
  // The board rounded down to the morning line's steps, which above 10-1 go 12, 15, 20, 30, 50, 99: "30-1"
  // over "$2 pays ~$97", and 463 of 1,411 final prices in one meet reading more than 10% under what was paid.
  const steps = ['1-9', '1-5', '2-5', '1-2', '3-5', '4-5', '1-1', '6-5', '7-5', '3-2', '8-5', '9-5', '2-1', '5-2', '3-1', '7-2', '4-1', '9-2', '5-1',
    ...Array.from({ length: 94 }, (_, k) => `${k + 6}-1`)];
  const seen = [];
  for (let k = 50; k <= 120000; k++) {
    const o = k / 1000, text = oddsText(o), shown = oddsValue(text);
    if (seen[seen.length - 1] !== text) seen.push(text);
    const next = steps[steps.indexOf(text) + 1];
    // Never more than the real price (but under 1-9, the least a board shows), and never a whole step under it.
    if (o >= 1 / 9) assert.ok(shown <= o + 1e-9, `${o} reads ${text}`);
    else assert.equal(text, '1-9');
    if (next) assert.ok(oddsValue(next) > o, `${o} reads ${text}, a step or more under`);
    else assert.equal(text, '99-1');
    // What a ticket pays is never more than a seventh over what the board says, and above 10-1 a tenth.
    if (o >= 1 / 9 && o < 100) assert.ok((o + 1) / (shown + 1) < (o >= 10 ? 1.1 : 1.17), `${o} reads ${text}`);
  }
  assert.deepEqual(seen, steps);
  assert.deepEqual([30.6, 47.9, 20.4, 28.9, 99.5, 250].map(oddsText), ['30-1', '47-1', '20-1', '28-1', '99-1', '99-1']);
  // On a board: the wording is made from the odds beside it.
  const w = createWorld('test-board', '2026-09-26');
  for (const r of w.cards[0].races) {
    const b = board(makeTote(r, w), 1);
    assert.deepEqual(b.text, b.odds.map(o => oddsText(o)));
  }
});

test('the morning line keeps its own steps and prints nothing longer than 50-1', () => {
  // About one race in twenty had a horse at 99-1 on the morning line. The price behind the line is as it
  // was (the early money reads it); only what's printed stops at 50-1.
  const w = createWorld('test-line', '2026-09-26');
  const made = new Set(['1-5', '2-5', '1-2', '3-5', '4-5', '1-1', '6-5', '7-5', '3-2', '8-5', '9-5', '2-1', '5-2', '3-1', '7-2', '4-1', '9-2', '5-1', '6-1', '7-1', '8-1', '9-1', '10-1', '12-1', '15-1', '20-1', '30-1', '50-1']);
  let capped = 0, entries = 0;
  for (let d = 0; d < 40; d++) {
    for (const r of buildCard(w, d).races) {
      for (const e of r.entries) {
        entries++;
        assert.ok(made.has(e.mlText), `race day ${d + 1}, race ${r.no}: a morning line of ${e.mlText}`);
        if (e.ml > 50) { capped++; assert.deepEqual([e.ml, e.mlText], [99, '50-1']); } else assert.equal(oddsValue(e.mlText), e.ml);
      }
    }
  }
  assert.ok(capped > 5, `only ${capped} of ${entries} morning lines were longer than 50-1, too few to show anything`);
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

test('margins read the way a chart prints them: nose, head, neck, a half, three quarters, a length', () => {
  // A neck stopped at 0.32 of a length, and from there to 0.375 the margin printed as a bare "¼", which no
  // chart has: 45 of 1,251 finish margins in one meet, and 191 running lines.
  const value = s => ({ no: -3, hd: -2, nk: -1, nose: -3, head: -2, neck: -1 })[s]
    ?? [...s.replace(/ lengths?$/, '')].reduce((n, c) => n + ({ '¼': 0.25, '½': 0.5, '¾': 0.75 }[c] ?? 0), parseInt(s, 10) || 0);
  for (const say of [marginShort, marginText]) {
    const seen = [];
    let before = -Infinity;
    for (let k = 0; k <= 3000; k++) {
      const l = k / 100, s = say(l);
      assert.ok(!/^¼/.test(s), `${l} lengths prints as "${s}"`);
      assert.ok(value(s) >= before, `the scale goes backwards at ${l} lengths: "${s}"`);
      // From half a length up, what's printed is the margin to the nearest quarter.
      if (value(s) > 0) assert.ok(Math.abs(value(s) - l) <= 0.125 + 1e-9, `${l} lengths prints as "${s}"`);
      before = value(s);
      if (seen[seen.length - 1] !== s) seen.push(s);
    }
    assert.deepEqual(seen.slice(0, 8), say === marginShort ? ['no', 'hd', 'nk', '½', '¾', '1', '1¼', '1½'] : ['nose', 'head', 'neck', '½ length', '¾ length', '1 length', '1¼ lengths', '1½ lengths']);
    assert.equal(seen.length, 3 + 119, 'a step for every quarter from a half to thirty lengths');
  }
  // A neck ends where half a length begins, and the plural goes with the number as printed.
  assert.deepEqual([0.059, 0.06, 0.179, 0.18, 0.374, 0.375].map(marginShort), ['no', 'hd', 'hd', 'nk', 'nk', '½']);
  assert.deepEqual([1.1, 1.12, 1.13, 0.9, 2].map(lengthsText), ['1 length', '1 length', '1¼ lengths', '1 length', '2 lengths']);
});

// A hand-made race of `n` horses for one horse's trip note: where it was at the first call, a furlong out
// and at the wire, how far behind the winner, and anything that happened to it. The others fill the gaps,
// a length apart.
function trip({ n = 8, first, str, pos, behind = pos - 1, third = 1, by = 1, ...happened }) {
  const at = place => { const order = Array.from({ length: n - 1 }, (_, i) => i + 1); order.splice(place - 1, 0, 0); return order.map((h, i) => ({ h, behind: i })); };
  const results = at(pos).map((x, i) => ({ h: x.h, pos: i + 1, behind: i, toPrev: i ? 1 : 0, wide: 1, checked: 0, blocked: 0, duel: 0, emptied: 0 }));
  Object.assign(results[pos - 1], { behind, toPrev: behind - (pos > 1 ? results[pos - 2].behind : 0), ...happened });
  if (results[2] && pos !== 3) results[2].toPrev = third;
  if (pos === 1) results[1].toPrev = by; // a winner's margin
  return tripComment({ calls: [at(first), at(Math.round((first + str) / 2)), at(str)], results }, 0, n);
}

test('a trip note says how the horse finished: a near miss, a place taken late, a place lost', () => {
  // Second or third within a neck of the winner was "Even trip" or "Stalked, no rally" more often than not.
  assert.equal(trip({ first: 2, str: 2, pos: 2, behind: 0.2 }), 'Just missed');
  assert.equal(trip({ first: 5, str: 4, pos: 2, behind: 0.04 }), 'Missed by a nose');
  assert.equal(trip({ first: 3, str: 3, pos: 3, behind: 0.37 }), 'Just missed');
  assert.equal(trip({ first: 1, str: 1, pos: 2, behind: 0.3 }), 'Set pace, just missed');
  assert.equal(trip({ first: 4, str: 3, pos: 2, behind: 0.375 }), 'Up for place', 'half a length is not a near miss');
  // Trouble keeps its words, and for a placed horse the note already says how it finished: nothing follows
  // ("Checked, rallied; Even trip" was on a dozen lines a meet).
  assert.equal(trip({ first: 5, str: 4, pos: 3, behind: 2, checked: 1 }), 'Checked, rallied');
  assert.equal(trip({ first: 4, str: 4, pos: 3, behind: 2, blocked: 4 }), 'Blocked, finished well');
  assert.equal(trip({ first: 4, str: 3, pos: 2, behind: 0.1, checked: 1 }), 'Checked, just missed');
  assert.equal(trip({ first: 4, str: 3, pos: 2, behind: 0.05, blocked: 4, slow: true }), 'Broke slowly');
  assert.equal(trip({ first: 6, str: 4, pos: 3, behind: 0.2, slow: true }), 'Broke slowly; Just missed');
  assert.equal(trip({ first: 5, str: 5, pos: 5, checked: 2, bumped: true }), 'Bumped start; Checked in traffic');
  assert.equal(trip({ first: 6, str: 6, pos: 5, blocked: 4 }), 'Blocked stretch; Improved position');
  assert.equal(trip({ first: 6, str: 4, pos: 1, by: 0.3, checked: 1 }), 'Checked, rallied; Up in time', "a winner's note still says how it won");
  // The placed horses that weren't close: a clear second, a place taken in the last furlong, lost there, or held.
  assert.equal(trip({ first: 3, str: 2, pos: 2, behind: 3, third: 2 }), 'Second best');
  assert.equal(trip({ first: 4, str: 2, pos: 2, behind: 3, third: 0.5 }), 'Held place');
  assert.equal(trip({ first: 2, str: 2, pos: 2, behind: 0.5 }), 'Stalked, held place');
  assert.equal(trip({ first: 5, str: 4, pos: 3, behind: 4 }), 'Up for show');
  assert.equal(trip({ first: 4, str: 2, pos: 3, behind: 4 }), 'Outfinished');
  assert.equal(trip({ first: 2, str: 2, pos: 3, behind: 4 }), 'Stalked, weakened');
  assert.equal(trip({ first: 3, str: 3, pos: 3, behind: 4 }), 'Stalked, no rally');
  assert.equal(trip({ first: 1, str: 1, pos: 2, behind: 1 }), 'Set pace, caught late');
  assert.equal(trip({ first: 1, str: 2, pos: 2, behind: 1 }), 'Set pace, held place', 'it had been caught before the last furlong');
  assert.equal(trip({ first: 7, str: 5, pos: 2, behind: 1 }), 'Closed well');
  assert.equal(trip({ first: 7, str: 1, pos: 2, behind: 1, third: 0.5 }), 'Outfinished', 'it led a furlong out and was caught');
  // In mid-field the note is what happened between the first call and the wire. These were all "Even trip",
  // a third of every line.
  assert.equal(trip({ n: 10, first: 6, str: 6, pos: 5 }), 'Improved position');
  assert.equal(trip({ n: 10, first: 4, str: 5, pos: 5 }), 'Weakened');
  assert.equal(trip({ n: 10, first: 2, str: 4, pos: 6 }), 'Faded');
  // A horse that moved up and then lost its place in the last furlong weakened, whatever it gained early:
  // one that led a furlong out and finished fourth was said to have "Improved position".
  assert.equal(trip({ n: 10, first: 5, str: 1, pos: 4 }), 'Faded');
  assert.equal(trip({ n: 10, first: 5, str: 2, pos: 4 }), 'Weakened');
  assert.equal(trip({ n: 10, first: 8, str: 3, pos: 5 }), 'Weakened', 'not a late gain');
  assert.equal(trip({ n: 10, first: 8, str: 5, pos: 5 }), 'Late gain');
  assert.equal(trip({ n: 10, first: 7, str: 4, pos: 5 }), 'Improved position');
  assert.equal(trip({ n: 10, first: 5, str: 4, pos: 5 }), 'Evenly');
  assert.equal(trip({ n: 10, first: 8, str: 4, pos: 6, wide: 3 }), '4 wide, no rally');
  assert.equal(trip({ n: 10, first: 5, str: 5, pos: 5 }), 'Evenly');
  assert.equal(trip({ n: 10, first: 7, str: 7, pos: 7 }), 'No rally');
  assert.equal(trip({ n: 10, first: 5, str: 5, pos: 5, wide: 0.3 }), 'Saved ground, evenly');
  assert.equal(trip({ n: 10, first: 5, str: 5, pos: 5, wide: 0.3, slow: true }), 'Broke slowly; Evenly');
  assert.equal(trip({ n: 10, first: 7, str: 7, pos: 6, wide: 3 }), '4 wide, mild rally');
  assert.equal(trip({ n: 10, first: 6, str: 7, pos: 7, wide: 3 }), '4 wide, no rally');
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

test('a workout is timed to the fifth of a second', () => {
  // Works were printed to the tenth (:36.3, 1:01.1), which a clocker's watch doesn't give: about half of
  // all work times in a meet were off a fifth.
  assert.deepEqual([36.3, 36.4, 36.5, 48, 59.9, 60, 61.1, 73.8].map(fmtWork), [':36.4', ':36.4', ':36.6', ':48.0', '1:00.0', '1:00.0', '1:01.2', '1:13.8']);
  const w = createWorld('test-works', '2026-09-26');
  const works = w.horses.flatMap(h => h.works);
  assert.ok(works.length > 300);
  for (const k of works) {
    const shown = fmtWork(k.t), [, m, s] = shown.match(/^(\d*):(\d\d\.\d)$/);
    assert.ok(/[02468]$/.test(shown), `${k.t} is shown as ${shown}`);
    assert.ok(Math.abs((+m || 0) * 60 + +s - k.t) <= 0.1 + 1e-9 && +s < 60, `${k.t} is shown as ${shown}`);
  }
  assert.ok(works.some(k => Math.round(k.t * 10) % 2), 'every work in this meet is on a fifth already');
});

test('the voice is given times and numbers in words', () => {
  // The call box showed "The time, 1:17.55." and "The quarter in 22 and 3.", and the voice was handed the
  // same digits to make what it could of. Now each line has a spoken form: a time in fifths, a part of a
  // fifth dropped, the way the quarter and the half are called.
  assert.equal(timeSay(59.996), 'one minute flat');
  assert.equal(timeSay(60.0), 'one minute flat');
  assert.equal(timeSay(63.37), 'one oh three and one');
  assert.equal(timeSay(109.79), 'one forty-nine and three');
  assert.equal(timeSay(58.5), 'fifty-eight and two');
  assert.equal(timeSay(77.55), 'one seventeen and two');
  assert.equal(timeSay(57.35), 'fifty-seven and one');
  assert.equal(timeSay(22.6), 'twenty-two and three');
  assert.equal(timeSay(22.4), 'twenty-two and two');
  assert.equal(timeSay(47.1), 'forty-seven flat');
  assert.equal(timeSay(120.2), 'two minutes and one');
  assert.equal(aloud("It's Dr. Fizz, by a nose!"), "It's Doctor Fizz, by a nose!");
  // Two race days of calls: nothing the voice is given has a digit or a sign in it, the call box keeps
  // its digits for the times, and a fraction says the same fifths both ways.
  const w = createWorld('test-spoken', '2026-09-26');
  const fifth = ['flat', 'and one', 'and two', 'and three', 'and four'];
  let fractions = 0;
  for (let d = 0; d < 2; d++) {
    for (const r of w.cards[w.day].races) {
      const run = simulateRace(r, w, { record: true });
      const call = raceCall(r, run, r.entries.map((e, i) => (i ? w.horses[e.hid].name : 'Dr. Fizz')));
      for (const l of call.lines) {
        assert.equal(typeof l.say, 'string', `"${l.text}" has no spoken form`);
        assert.ok(!/[\d#:½¼¾&<>]|Dr\./.test(l.say), `the voice is given "${l.say}"`);
        const shown = l.kind === 'frac' && l.text.match(/\d (flat|and (\d))/);
        if (l.kind === 'frac') { fractions++; assert.ok(shown && l.say.includes(` ${fifth[+shown[2] || 0]}`), `"${l.text}" is said as "${l.say}"`); }
      }
      const last = call.lines[call.lines.length - 1];
      assert.match(last.text, /The time, (\d:)?\d\d\.\d\d\.$/, 'the call box lost the time in digits');
      assert.ok(last.say.endsWith(`The time, ${timeSay(run.finalTime)}.`), `the time is said as "${last.say}"`);
      applyResult(w, r, run, r.entries.map(() => 3));
    }
    nextDay(w);
  }
  assert.ok(fractions > 10, 'no fractions were called');
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
