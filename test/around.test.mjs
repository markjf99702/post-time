// Around the races: horses to watch, the day in three lines, the meet so far, looking back at a race, and
// sharing. In plain Node, with stand-ins for the browser's storage:  node --test test/around.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
globalThis.window = new EventTarget();
const G = await import('../js/game.js');
const W = await import('../js/world.js');
const { game, load, save, card, goToGate, placeBet, advanceDay, START_BANK } = G;

// A meet with a fixed seed and first race day, and a new player, as the live version starts one.
function buildOn(seed, start = '2026-09-26') {
  game.world = W.createWorld(seed, start);
  game.player = { v: 1, bank: START_BANK, bets: {}, settled: {}, ledger: [], book: [], atm: 0, opened: {}, settings: { sound: true, voice: false }, best: null };
}
// The favourite by the morning line, as an entry index.
const chalk = race => race.entries.map((e, i) => [e.ml, i]).sort((a, b) => a[0] - b[0])[0][1];
// A race day played with a $2 win ticket on the morning-line favourite in each race, and in every third race
// one on the winner (the race is known before it's run: G.recordingOf).
function playDay(each = () => {}) {
  for (const race of card().races) {
    if (game.player.bank < 20) G.atm();
    placeBet(race, { type: 'win', sel: [chalk(race)], amt: 2 });
    if (race.no % 3 === 1) placeBet(race, { type: 'win', sel: [G.recordingOf(race).results[0].h], amt: 2 });
    each(race);
    goToGate(race);
  }
}

test("a save from before stars has the horses of its winner's circle photos starred, and a star taken off stays off", () => {
  buildOn('stars-1');
  save(); load();
  playDay();
  // As the live version saves it: photos without the horse's id, and no list of stars.
  for (const rec of game.player.book) delete rec.hid;
  delete game.player.stars;
  const names = [...new Set(game.player.book.map(r => r.horse.name))];
  assert.ok(names.length >= 2, `too few photos to check with: ${names.length}`);
  save();
  assert.equal(load(), true);
  const starred = game.player.stars.map(id => game.world.horses[id].name).sort();
  assert.deepEqual(starred, names.slice().sort(), "the horses of the photos aren't the ones starred");
  // Taken off, it's off for good: the photos don't star it again when the page is opened.
  const first = game.player.stars[0];
  G.toggleStar(first);
  load();
  assert.ok(!G.isStarred(first), 'a star taken off came back when the page was opened');
  G.toggleStar(first);
  assert.ok(G.isStarred(first));
});

test('a winner you cash is starred, its entry says what you cashed when it won, and the card marks its next race', () => {
  buildOn('stars-2');
  game.player.stars = [];
  save(); load();
  let found = null;
  for (let d = 0; d < 12 && !found; d++) {
    playDay();
    // Each photo's horse is starred, and says what it was worth.
    for (const rec of game.player.book) {
      assert.ok(G.isStarred(rec.hid), `${rec.horse.name} is in a photo and not starred`);
      const said = G.cashedOn(rec.hid);
      assert.ok(said.some(x => x.day === rec.day && x.no === rec.no && x.won === rec.won), `${rec.horse.name}'s cashes don't include race ${rec.no} of day ${rec.day}`);
    }
    advanceDay();
    // A starred horse in today's card.
    for (const race of card().races) {
      const i = G.starredIn(race)[0];
      if (i === undefined) continue;
      found = { race, i };
      break;
    }
  }
  assert.ok(found, 'no starred horse ran again in twelve race days');
  const { race, i } = found;
  const hid = race.entries[i].hid;
  // What it was cashed on is from before this race; the race itself, once it's run, isn't counted in its form.
  const before = G.cashedOn(hid, race);
  assert.ok(before.length && before.every(x => x.day < race.day), 'the cashes said on its entry are not from before the race');
});

test("the day's three lines: bet and back as the record has them, the best ticket, and the forum's best day", () => {
  buildOn('recap-1');
  save(); load();
  const was = structuredClone(game.world.tipsters);
  playDay();
  const r = G.dayRecap();
  const lines = game.player.ledger.filter(x => x.day === game.world.day);
  assert.equal(r.spent, G.round2(lines.reduce((s, x) => s + x.spent, 0)));
  assert.equal(r.back, G.round2(lines.reduce((s, x) => s + x.back, 0)));
  const best = lines.reduce((a, x) => (x.best > (a?.best || 0) ? x : a), null);
  assert.deepEqual(r.best, best ? { back: best.best, no: best.no } : null);
  // The forum's day is what was added to its records today.
  assert.ok(r.tip, 'no forum regular picked a winner all day');
  const now = game.world.tipsters[r.tip.id], then = was[r.tip.id] || { picks: 0, wins: 0, back: 0 };
  assert.deepEqual([r.tip.picks, r.tip.wins, r.tip.back], [now.picks - then.picks, now.wins - then.wins, G.round2(now.back - then.back)]);
  for (const [id, t] of Object.entries(game.world.tipsters)) {
    const b = was[id] || { picks: 0, wins: 0, back: 0 };
    assert.ok(t.back - b.back - 2 * (t.picks - b.picks) <= r.tip.back - 2 * r.tip.picks + 1e-9, `${id} had a better day than ${r.tip.id}`);
  }
});

test('each line of your record says what kinds of bet it was, and the meet adds up race day by race day and by kind', () => {
  buildOn('kinds-1');
  save(); load();
  for (let d = 0; d < 2; d++) {
    playDay(race => {
      placeBet(race, { type: 'exbox', sel: [0, 1], amt: 1 });
      if (race.no === 7) placeBet(race, { type: 'dd', sel: [[0, 1], [0, 2]], amt: 1 });
    });
    advanceDay();
  }
  const m = game.world.meet;
  for (const x of game.player.ledger) {
    const kinds = Object.values(x.by);
    assert.equal(G.round2(kinds.reduce((s, k) => s + k[0], 0)), x.spent, `race ${x.no} of day ${x.day}: the kinds don't add up to what was bet`);
    assert.equal(G.round2(kinds.reduce((s, k) => s + k[1], 0)), x.back, `race ${x.no} of day ${x.day}: the kinds don't add up to what came back`);
  }
  const weeks = G.yourWeeks();
  assert.deepEqual(weeks.map(w => w.raceDay), [1, 2]);
  const you = G.yourMeet();
  assert.equal(G.round2(weeks.reduce((s, w) => s + w.spent, 0)), you.bet);
  assert.equal(G.round2(weeks.reduce((s, w) => s + w.back, 0)), you.back);
  const { since, kinds } = G.yourKinds();
  assert.equal(since, null, 'every line has its kinds, and the table says it runs from a later race day');
  assert.deepEqual(kinds.map(k => k.name), ['Win', 'Exacta', 'Daily double']);
  assert.equal(G.round2(kinds.reduce((s, k) => s + k.spent, 0)), you.bet);
  // A record from before the kinds were kept: the table runs from the first race day after its last such line.
  for (const x of game.player.ledger) if (x.day === m.first) delete x.by;
  assert.equal(G.yourKinds().since, 2);
  for (const x of game.player.ledger) delete x.by;
  assert.deepEqual(G.yourKinds(), { since: null, kinds: [] });
});

test("the meet's leading riders and trainers add up to its races, and its leading horses are the ones with most wins and earnings", () => {
  buildOn('leaders-1');
  for (let d = 0; d < 3; d++) {
    for (const race of card().races) W.makeOfficial(game.world, race, W.simulateRace(race, game.world, { record: false }));
    W.nextDay(game.world);
  }
  const r = W.meetRecord(game.world);
  assert.equal(r.riders.reduce((s, x) => s + x[2], 0), r.races, "the riders' wins aren't one a race");
  assert.equal(r.trainers.reduce((s, x) => s + x[2], 0), r.races, "the trainers' wins aren't one a race");
  assert.ok(r.riders.every((x, k) => !k || r.riders[k - 1][2] >= x[2]), 'the riders are not most wins first');
  assert.deepEqual(r.riders[0].slice(0, 3), [r.rider.i, r.rider.starts, r.rider.w], 'the top of the table is not the leading rider');
  const T = game.world.meet.tally.h;
  const mostWins = Math.max(...Object.values(T).map(x => x[1]));
  assert.equal(r.wins[0].w, mostWins);
  assert.equal(r.earners[0].hid, r.horse.hid, 'the horse that earned most is not the horse of the meet');
  assert.ok(r.wins.length === 5 && r.earners.length === 5);
});

test('a race looked at again after it is run has its form as it stood before: figures, running style, chips and records', async () => {
  const { angles } = await import('../js/handicap.js');
  const { runStyle } = await import('../js/forum.js');
  buildOn('before-1');
  save(); load();
  let checked = 0;
  for (const race of card().races) {
    const was = () => race.entries.map(e => {
      const { hs, rider, trainer } = G.formBefore(race, e, W.meetStats(game.world));
      return JSON.stringify({ figs: hs.pps.map(p => p.fig), style: runStyle(hs), chips: angles(race, hs, game.world.day), life: hs.life, rider, trainer });
    });
    const before = was();
    goToGate(race);
    assert.deepEqual(was(), before, `race ${race.no}: the form changed once the race was run`);
    // And each horse's line from the race is there, to be marked.
    for (const e of race.entries) assert.equal(G.formBefore(race, e, W.meetStats(game.world)).today?.no, race.no);
    checked++;
  }
  assert.equal(checked, 8);
});
