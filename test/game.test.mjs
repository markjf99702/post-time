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
const { game, newMeet, load, save, card, toteFor, placeBet, goToGate, mtpState, advanceDay, callFor, horseOf } = await import('../js/game.js');

function build(seed) {
  const meet = newMeet(seed);
  while (!meet.step()) { /* a week of history at a time */ }
}

// A long meet played the way the page plays it: every race sent to the gate and called. What each race
// came to is kept for the tests below, so the meet is played once.
let longMeet = null;
function playLongMeet(days = 60) {
  if (longMeet) return longMeet;
  build('long-meet');
  const races = [];
  for (let d = 0; d < days; d++) {
    for (const race of card().races) {
      const { run } = goToGate(race);
      const call = callFor(race, run);
      races.push({
        day: d + 1, no: race.no, field: race.entries.length, lines: call.lines.map(l => l.text), photo: call.photo,
        winner: horseOf(race.entries[run.results[0].h]).name, reactions: (race.forumAfter || []).map(p => p.text),
      });
    }
    advanceDay();
  }
  return (longMeet = races);
}

test("a setting changed while the first meet is being built doesn't save an empty meet", () => {
  // What the page has during Opening day, before the meet exists.
  game.world = null;
  game.player = { settings: { sound: false, voice: false }, bank: 0 };
  save();
  assert.equal(store.size, 0, 'saved a meet that is not there');
  assert.equal(load(), false, 'the next visit would open an empty meet instead of building one');
  build('settings-first');
  assert.equal(game.player.settings.sound, false, 'the setting is kept with the new meet');
  assert.equal(game.player.bank, 200);
  assert.ok(JSON.parse(store.get('post-time/world')).cards, 'the new meet is saved');
});

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

test('the next race day comes after the page is opened again', () => {
  build('reopened');
  advanceDay();
  assert.equal('_names' in JSON.parse(store.get('post-time/world')), false, 'the save has a list of names that JSON empties');
  // A save from before: the names in use were kept with the world, and JSON had made them {}.
  const old = JSON.parse(store.get('post-time/world'));
  old._names = {};
  store.set('post-time/world', JSON.stringify(old));
  // Reopen the page before every race day, until horses have shipped in on two of them.
  let shippedDays = 0;
  for (let k = 0; k < 10 && shippedDays < 2; k++) {
    load();
    const before = game.world.horses.length;
    advanceDay();
    if (game.world.horses.length > before) shippedDays++;
  }
  assert.equal(shippedDays, 2, 'no horses shipped in, so their names were never needed');
  const names = game.world.horses.map(h => h.name);
  assert.equal(new Set(names).size, names.length, 'two horses have the same name');
});

test('a race left with fewer than three horses is drawn again when the game loads', () => {
  build('short-field');
  const [r1, r2, r3, r4] = card().races;
  goToGate(r1);
  goToGate(r2);
  // A save from before: race 3, a maiden race, was left with two horses, and there's a ticket on it;
  // race 4 has one.
  r3.entries = r3.entries.slice(0, 2);
  r4.entries = r4.entries.slice(0, 1);
  game.player.bets['0:3'] = [{ type: 'win', sel: [0], amt: 2, cost: 2 }];
  game.player.bank -= 2;
  const bank = game.player.bank;
  save();
  load();
  const races = card().races;
  for (const r of [races[2], races[3]]) assert.ok(r.entries.length >= 5, `race ${r.no} has ${r.entries.length} horses`);
  assert.equal(game.player.bank, bank + 2, 'the ticket on it is paid back');
  assert.equal(game.player.bets['0:3'], undefined);
  const ids = races.flatMap(r => r.entries.map(e => e.hid));
  assert.equal(new Set(ids).size, ids.length, 'a horse is in two races');
  assert.ok(races[2].entries.every(e => e.ml > 0 && e.j >= 0 && e.pp >= 1), 'the new field has a morning line, riders and numbers');
  // The rest of the day runs, and the next one comes.
  for (const r of races.slice(2)) goToGate(r);
  assert.ok(races.every(r => r.status === 'official'));
  advanceDay();
  assert.equal(game.world.day, 1);
});

test('a long meet keeps running: sixty race days, and every race has a field', () => {
  // Maidens win faster than new ones ship in, so meets used to stop between race days 25 and 45 on a
  // race with one horse or none, which couldn't be sent to the gate or called.
  const races = playLongMeet();
  assert.equal(races.length, 60 * 8);
  assert.deepEqual(races.filter(r => r.field < 5).map(r => `race day ${r.day}, race ${r.no}: ${r.field} horses`), []);
  assert.deepEqual(races.filter(r => r.lines.some(l => /undefined|NaN/.test(l))).map(r => `race day ${r.day}, race ${r.no}`), []);
});

test("two regulars don't post the same reaction after a race", () => {
  const races = playLongMeet();
  const twice = races.filter(r => new Set(r.reactions).size !== r.reactions.length);
  assert.deepEqual(twice.map(r => `race day ${r.day}, race ${r.no}: ${r.reactions.join(' / ')}`), []);
  assert.ok(races.reduce((n, r) => n + r.reactions.length, 0) > races.length * 3, 'the regulars have gone quiet');
});

test("the caller doesn't sound sure of a leader who then gets caught or goes to a photo", () => {
  const races = playLongMeet();
  const sure = races.filter(r => r.lines.some(l => /clear and drawing away|won't catch/.test(l)));
  const wrong = sure.filter(r => r.photo || !r.lines.find(l => /clear and drawing away|won't catch/.test(l)).includes(r.winner));
  assert.deepEqual(wrong.map(r => `race day ${r.day}, race ${r.no}: ${r.lines.slice(-3).join(' / ')}`), []);
  assert.ok(sure.length > races.length / 10, `the caller is sure of a winner in only ${sure.length} races`);
});

test("a save that isn't a meet is left alone until a new meet is started", () => {
  build('damaged');
  game.player.settings.sound = false;
  save();
  const world = store.get('post-time/world'), player = store.get('post-time/player');
  const later = JSON.parse(world);
  later.day += 1; // no card drawn for that day
  for (const bad of ['null', '{}', '[]', 'not json', JSON.stringify(later)]) {
    store.set('post-time/world', bad);
    assert.equal(load(), 'damaged', `a save of ${bad.slice(0, 20)} loaded as a meet`);
    assert.equal(game.world, null);
    assert.equal(game.player.settings.sound, false, 'the settings were lost');
    save();
    assert.equal(store.get('post-time/world'), bad, 'the save was written over before a new meet was asked for');
    assert.equal(store.get('post-time/player'), player);
  }
  store.set('post-time/world', world);
  store.set('post-time/player', '{"bank": 12');
  assert.equal(load(), 'damaged', "a player record that doesn't parse loaded");
  store.set('post-time/player', player);
  assert.equal(load(), true);
  assert.ok(card().races.length);
});
