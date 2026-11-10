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
const { stateAt } = await import('../js/sim.js');
const { buildWorld } = await import('../js/world.js');

function build(seed) {
  const meet = newMeet(seed);
  while (!meet.step()) { /* a week of history at a time */ }
}

// A meet with a fixed seed and first race day (newMeet takes today's date), and a new player.
function buildOn(seed, start) {
  const steps = buildWorld(seed, start);
  let r = steps.next();
  while (!r.done) r = steps.next();
  game.world = r.value;
  game.player = { v: 1, bank: 200, bets: {}, settled: {}, ledger: [], book: [], atm: 0, opened: {}, settings: { sound: true, voice: false }, best: null };
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
      // Each horse the caller says is closing fast, and whether it was running faster than the leader then.
      const names = race.entries.map(e => horseOf(e).name);
      const closing = call.lines.flatMap(l => {
        const m = /^(.+) closing fast, but (.+) still in front!$/.exec(l.text);
        if (!m) return [];
        const st = stateAt(run, run.t0 + l.t);
        return [{ text: l.text, gaining: st[names.indexOf(m[1])].v > st[names.indexOf(m[2])].v }];
      });
      races.push({
        day: d + 1, no: race.no, field: race.entries.length, lines: call.lines.map(l => l.text), photo: call.photo,
        winner: horseOf(race.entries[run.results[0].h]).name, reactions: (race.forumAfter || []).map(p => p.text), closing,
        second: run.results[1] ? horseOf(race.entries[run.results[1].h]).name : null, official: call.official,
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

test('the caller says a horse is closing only when it is gaining on the leader', () => {
  const races = playLongMeet();
  const wrong = races.filter(r => r.closing.some(c => !c.gaining));
  assert.deepEqual(wrong.map(r => `race day ${r.day}, race ${r.no}: ${r.closing.map(c => c.text).join(' / ')}`), []);
  assert.ok(races.some(r => r.closing.length), 'nobody is ever called closing');
  assert.ok(races.some(r => r.lines.some(l => / still in front by /.test(l))), "the caller never just says who's still in front");
});

test("in a photo finish the caller doesn't say who won until the official sign", () => {
  // The winner was always the first of the two named at the wire, and the next line had the other one
  // 'in the photo'. Now a coin toss orders the two names, and the winner's line comes with the sign.
  const races = playLongMeet();
  const photos = races.filter(r => r.photo);
  assert.ok(photos.length > 20, `only ${photos.length} photo finishes in ${races.length} races`);
  let winnerFirst = 0;
  for (const r of photos) {
    const where = `race day ${r.day}, race ${r.no}: ${r.lines.slice(-2).join(' / ')}`;
    const [wire, placings] = r.lines.slice(-2);
    const two = [`${r.winner} and ${r.second}`, `${r.second} and ${r.winner}`];
    const order = two.findIndex(x => wire === `${x} hit the wire together. It's a photo!`);
    assert.ok(order >= 0, where);
    assert.ok(placings.startsWith(`They'll need the photo for ${two[order]}.`) && / The time, [\d:.]+\.$/.test(placings), where);
    if (order === 0) winnerFirst++;
    assert.deepEqual(r.lines.filter(l => /\bwins?\b|\bwon\b|gets up|gets the nod|^It's .+, by /.test(l)), [], where);
    assert.ok(!/by a (nose|head|neck)/.test(wire + placings), where);
    assert.match(r.official, /^It's .+, by a (nose|head|neck)!$/);
    assert.ok(r.official.startsWith(`It's ${r.winner}, by a `), `${where} / ${r.official}`);
  }
  const share = winnerFirst / photos.length;
  assert.ok(share > 0.3 && share < 0.7, `the winner is named first in ${winnerFirst} of ${photos.length} photo finishes`);
  assert.deepEqual(races.filter(r => !r.photo && r.official !== null).map(r => `race day ${r.day}, race ${r.no}`), [], 'a race that is not a photo has a line for the sign');
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

// What the meet with the seed 'pinned', begun on 3 October 2026, comes to over its first three race days,
// with a $2 win ticket on number 1 in every race: the first three home by number, the time, the $2 win
// price, and the bankroll after each day. A race's result comes only from its seed and its entries, and
// a meet from its seed, so any change that moves a random draw in the race, the world, the handicapping
// or the tote changes these lines, and with them the rest of every meet in progress. If that's meant,
// set the new lines in the same commit and say in its message that meets in progress will run
// differently from there.
const PINNED = [
  { bank: 274.8, races: ['R1 7-9-8 71.29 $5.80', 'R2 1-3-9 64.88 $70.20', 'R3 6-4-2 82.56 $5.80', 'R4 4-6-5 70.20 $4.00', 'R5 4-2-7 64.17 $4.20', 'R6 1-7-6 64.48 $6.60', 'R7 1-7-6 63.45 $14.00', 'R8 3-1-4 101.81 $3.20'] },
  { bank: 300.8, races: ['R1 4-1-7 110.53 $10.00', 'R2 6-4-8 64.67 $12.40', 'R3 1-2-9 103.40 $10.20', 'R4 1-3-5 102.67 $10.60', 'R5 6-3-5 76.77 $6.00', 'R6 1-10-7 63.78 $21.20', 'R7 5-6-7 107.56 $4.20', 'R8 2-6-5 94.18 $19.00'] },
  { bank: 305.8, races: ['R1 7-6-8 84.34 $15.60', 'R2 1-4-3 97.34 $14.60', 'R3 5-4-1 63.77 $4.40', 'R4 2-7-4 64.33 $5.80', 'R5 3-2-1 82.79 $7.00', 'R6 4-1-3 109.41 $6.40', 'R7 3-1-2 103.44 $6.00', 'R8 1-6-5 107.85 $6.40'] },
];

test('a meet in progress runs the way it did: three race days of a fixed meet come out the same', () => {
  buildOn('pinned', '2026-10-03');
  const played = [];
  for (let d = 0; d < PINNED.length; d++) {
    const races = [];
    for (const race of card().races) {
      assert.ok(placeBet(race, { type: 'win', sel: [0], amt: 2 }).ok);
      const { run, pay } = goToGate(race);
      races.push(`R${race.no} ${run.results.slice(0, 3).map(r => race.entries[r.h].pp).join('-')} ${run.finalTime.toFixed(2)} $${pay.win[run.results[0].h].toFixed(2)}`);
    }
    advanceDay();
    played.push({ bank: game.player.bank, races });
  }
  assert.deepEqual(played, PINNED);
});
