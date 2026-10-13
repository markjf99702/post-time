// Your side of the game (bankroll, tickets, saving) in plain Node, with stand-ins for the browser's
// storage:  node --test test/game.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
globalThis.window = new EventTarget();
const { game, newMeet, load, save, card, toteFor, placeBet, goToGate, mtpState } = await import('../js/game.js');

function build(seed) {
  const meet = newMeet(seed);
  while (!meet.step()) { /* a week of history at a time */ }
}

test("a new meet starts with its own tote, not the last meet's", () => {
  build('meet-a');
  const before = card().races[0];
  assert.equal(toteFor(before).n, before.entries.length);
  // Find a new meet whose first race has a different number of runners.
  let after = before;
  for (const seed of ['meet-b', 'meet-c', 'meet-d', 'meet-e', 'meet-f', 'meet-g']) {
    build(seed);
    after = card().races[0];
    if (after.entries.length !== before.entries.length) break;
  }
  assert.notEqual(after.entries.length, before.entries.length, 'no meet with a different first race to try');
  assert.equal(toteFor(after).n, after.entries.length, 'the tote has a pool for every horse in the race');
});

test("a ticket on a number that isn't in the race is taken back, and the money with it", () => {
  build('strays');
  const [r1, r2] = card().races;
  assert.ok(placeBet(r1, { type: 'win', sel: [0], amt: 2 }).ok);
  assert.equal(placeBet(r1, { type: 'win', sel: [r1.entries.length], amt: 2 }).ok, false, 'sold a ticket on a horse that is not in the race');
  // A save from before the fix: a stray ticket on race 1, which has been run, and one on race 2.
  game.player.bets['0:1'].push({ type: 'win', sel: [r1.entries.length], amt: 2, cost: 2 });
  game.player.bets['0:2'] = [{ type: 'exacta', sel: [0, r2.entries.length + 2], amt: 2, cost: 2 }];
  game.player.bank -= 4;
  goToGate(r1);
  const bank = game.player.bank;
  save();
  load();
  assert.equal(game.player.bank, bank + 4, 'both stray tickets are refunded');
  assert.deepEqual(game.player.bets['0:1'].map(b => b.sel), [[0]]);
  assert.deepEqual(game.player.bets['0:2'], []);
  const s = game.player.settled['0:1'];
  assert.equal(s.returns.length, 1, 'the settled race keeps one return per ticket');
  assert.equal(s.spent, 2);
  assert.equal(game.player.ledger.find(l => l.no === 1).spent, 2);
});

test("looking ahead at a later race doesn't start its clock", () => {
  build('clocks');
  const [r1, , r3] = card().races;
  assert.deepEqual(mtpState(r3), { mtp: 12, frac: 0 }, 'a later race shows the opening odds');
  assert.equal(game.player.opened['0:3'], undefined, "race 3's clock started while race 1 was up");
  mtpState(r1);
  assert.ok(game.player.opened['0:1'], 'the race up next has its clock');
  // A save from before: race 3's clock was started ten minutes ago, from a look at its form.
  game.player.opened['0:3'] = Date.now() - 600000;
  save();
  load();
  assert.equal(game.player.opened['0:3'], undefined);
  assert.ok(game.player.opened['0:1']);
});
