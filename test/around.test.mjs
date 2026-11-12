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

