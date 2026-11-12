// A meet that ends: ten race days, the Larkspur Handicap on closing day, the meet's record, and the next
// meet opening with the same horses. In plain Node, with stand-ins for the browser's storage:
//   node --test test/meet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
};
globalThis.window = new EventTarget();
const { game, load, save, card, goToGate, advanceDay, placeBet, atm, yourMeet, START_BANK } = await import('../js/game.js');
const W = await import('../js/world.js');
const { makeTote } = await import('../js/tote.js');
const { STAKES, BIG_STAKES, JOCKEYS } = await import('../js/data.js');

// A meet with a fixed seed and first race day, and a new player.
function buildOn(seed, start = '2026-09-26') {
  game.world = W.createWorld(seed, start);
  game.player = { v: 1, bank: START_BANK, bets: {}, settled: {}, ledger: [], book: [], atm: 0, opened: {}, settings: { sound: true, voice: false }, best: null };
}
// Race days run the quick way, with nobody watching: the world only.
function runDays(world, days, each = () => {}) {
  for (let d = 0; d < days; d++) {
    each(world.cards[world.day]);
    for (const race of world.cards[world.day].races) W.makeOfficial(world, race, W.simulateRace(race, world, { record: false }), { tote: makeTote(race, world) });
    W.nextDay(world);
  }
}

test('a meet is ten race days, with the Larkspur Handicap on closing day only, and all ten stakes have their turn', () => {
  // The Handicap came every fifth race day, which was always the turn of the Tape Measure Sprint or the
  // Matchbook Handicap, so those two never ran. And race day 11 was just race day 11.
  const world = W.createWorld('meet-days', '2026-09-26');
  const seen = [];
  runDays(world, 30, c => seen.push({ day: c.day, meet: world.meet.no, of: W.raceDayOf(world), days: W.meetDays(world), stakes: c.races[7].name }));
  for (const s of seen) {
    assert.equal(s.meet, Math.floor(s.day / 10) + 1, `race day ${s.day + 1}`);
    assert.equal(s.of, (s.day % 10) + 1);
    assert.equal(s.days, 10);
    assert.equal(s.stakes === BIG_STAKES.name, s.of === 10, `race day ${s.of} of meet ${s.meet} has the ${s.stakes}`);
  }
  for (const { name } of STAKES) assert.ok(seen.some(s => s.stakes === name), `the ${name} never ran in three meets`);
  // Each meet's weekly stakes are nine different races.
  for (const no of [1, 2, 3]) {
    const names = seen.filter(s => s.meet === no && s.of < 10).map(s => s.stakes);
    assert.equal(new Set(names).size, 9, `meet ${no}: ${names.join(', ')}`);
  }
  assert.equal(world.meets.length, 3);
});

test('the next meet opens with the same horses, and the last one goes down in the record', () => {
  const world = W.createWorld('meet-next', '2026-09-26');
  runDays(world, 9);
  const barn = world.horses.filter(h => !h.retired).map(h => h.id);
  const opened = structuredClone(world.meet.tips); // the regulars' records as the meet opened
  runDays(world, 1);
  assert.equal(world.meet.no, 2);
  assert.equal(world.meet.first, 10);
  assert.equal(world.meet.last, 19);
  assert.deepEqual(world.meet.tally, { j: {}, t: {}, h: {}, long: null, stk: [] }, 'the new meet starts its own count');
  // The barn carries over: horses retire and ship in from one race day to the next, as on any Saturday.
  const still = world.horses.filter(h => !h.retired).map(h => h.id);
  assert.ok(still.filter(id => barn.includes(id)).length >= barn.length - 6, `${still.filter(id => barn.includes(id)).length} of ${barn.length} horses came back`);
  const [line] = world.meets;
  assert.equal(line.no, 1);
  assert.deepEqual([line.first, line.last, line.races], [0, 9, 80]);
  assert.equal(line.stakes.length, 10);
  assert.equal(line.stakes[9].name, BIG_STAKES.name);
  assert.equal(line.handicap.horse, line.stakes[9].horse);
  // The leaders are the meet's: 80 wins among the riders, and the horse of the meet won the most money.
  assert.ok(line.rider.w >= 80 / JOCKEYS.length && line.rider.starts >= line.rider.w, JSON.stringify(line.rider));
  assert.ok(line.horse.name && line.horse.earn > 0 && line.horse.w >= 1);
  assert.ok(line.long.odds > 5 && line.long.name);
  // The forum's champion is counted from the meet's own races: fewer picks than the regulars' records hold.
  const r = world.tipsters[line.champ.id], was = opened[line.champ.id];
  assert.ok(was.picks > 0, 'the regulars arrive with a record from the ten weeks before the meet');
  assert.deepEqual([line.champ.picks, line.champ.wins], [r.picks - was.picks, r.wins - was.wins]);
  assert.ok(line.champ.picks >= 80 / 3, JSON.stringify(line.champ));
  assert.equal(line.since, false);
});

test("the first two home in each weekly stakes are entered in the Handicap first, whether or not they ran last week", () => {
  const world = W.createWorld('meet-preps', '2026-09-26');
  runDays(world, 9);
  const handicap = world.cards[world.day].races[7];
  assert.equal(handicap.name, BIG_STAKES.name);
  const pointed = W.pointedTo(world);
  assert.ok(pointed.length >= 6, `${pointed.length} horses pointed to the Handicap`);
  const inIt = new Set(handicap.entries.map(e => e.hid));
  const field = handicap.entries.length;
  assert.ok(field >= 9 && field <= 11, `${field} in the Handicap`);
  // All of them, or as many as the race takes.
  const entered = pointed.filter(h => inIt.has(h.id)).length;
  assert.equal(entered, Math.min(pointed.length, field), `${entered} of ${pointed.length} pointed horses in a field of ${field}`);
  // Last week's stakes too: its first two ran seven days ago.
  const last = world.meet.tally.stk.find(s => s.day === world.day - 1);
  if (pointed.length <= field) for (const id of last.top) assert.ok(inIt.has(id), `${world.horses[id].name}, in the first two last week, isn't in the Handicap`);
  // And no horse runs twice on the day.
  const all = world.cards[world.day].races.flatMap(r => r.entries.map(e => e.hid));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(W.prepsOf(world, last.top[0]).at(-1), { day: world.day - 1, name: last.name, pos: 1 });
});

// The live version's save has no meet. It's meet 1 from its first race day, and closes on its next tenth
// race day; what has been run of it is counted from the lines its horses hold.
function oldSave(seed, days, { midday = 0 } = {}) {
  buildOn(seed);
  for (let d = 0; d < days; d++) {
    for (const race of card().races) { placeBet(race, { type: 'win', sel: [0], amt: 2 }); goToGate(race); }
    advanceDay();
  }
  for (const race of card().races.slice(0, midday)) { placeBet(race, { type: 'show', sel: [1], amt: 2 }); goToGate(race); }
  save();
  const world = JSON.parse(store.get('post-time/world')), player = JSON.parse(store.get('post-time/player'));
  delete world.meet; delete world.meets; delete player.meetStart;
  // The live version ran the Handicap every fifth race day, so a card saved on race day 5, 15, 25... has it.
  if (world.day % 5 === 4) Object.assign(world.cards[world.day].races[7], { name: BIG_STAKES.name, purse: BIG_STAKES.purse });
  store.set('post-time/world', JSON.stringify(world));
  store.set('post-time/player', JSON.stringify(player));
  return { world, player };
}

test('a meet saved before meets ended is meet 1, and closes on its next tenth race day', () => {
  // Race day 5's card already has the Handicap (it came every fifth race day): that save closes today.
  for (const [days, last] of [[4, 4], [9, 9], [12, 19]]) {
    const was = oldSave(`old-${days}`, days, { midday: 3 });
    assert.equal(load(), true);
    const w = game.world;
    assert.deepEqual([w.meet.no, w.meet.first, w.meet.last], [1, 0, last], `saved on race day ${days + 1}`);
    assert.deepEqual(w.meets, []);
    // Today's card is the card that was saved: nothing on it is drawn again.
    assert.deepEqual(w.cards[w.day].races.map(r => [r.name, r.entries.map(e => e.hid)]), was.world.cards[was.world.day].races.map(r => [r.name, r.entries.map(e => e.hid)]));
    // The meet's count, from the lines: every race run so far has a winning rider, unless its winner has
    // since retired with a later line (a retired horse keeps only its last), or run ten times since (a meet
    // carried over from a long one). A retirement can come at any time: allow three races either way.
    const record = W.meetRecord(w), run = days * 8 + 3;
    assert.ok(record.races <= run && record.races >= run - 3, `saved on race day ${days + 1}: ${record.races} of ${run} races counted`);
    assert.equal(record.since, true, "the regulars' records go back before the meet");
    assert.ok(record.rider && record.horse && record.long);
    // Your meet: $200 to start, and every ticket so far.
    const you = yourMeet();
    assert.equal(you.start, START_BANK);
    assert.equal(you.races, days * 8 + 3);
    assert.equal(you.end, was.player.bank);
    // It keeps loading as it is once it has been saved again.
    save();
    assert.equal(load(), true);
    assert.deepEqual([game.world.meet.first, game.world.meet.last], [0, last]);
  }
});

test('a save from before meets ended, on race day 13, has the Handicap on race day 20 and nowhere before it', () => {
  oldSave('old-13', 12);
  assert.equal(load(), true);
  const names = [];
  while (game.world.day <= 19) {
    names.push(card().races[7].name);
    for (const race of card().races) goToGate(race);
    advanceDay();
  }
  // Race days 13 to 20: the Tape Measure Sprint (race day 15) runs where the Handicap was.
  assert.deepEqual(names.map(n => n === BIG_STAKES.name), [false, false, false, false, false, false, false, true]);
  assert.ok(names.includes(STAKES[4].name), names.join(', '));
  assert.equal(game.world.meet.no, 2);
  assert.equal(game.world.meets[0].last, 19);
});

test('your bankroll and the ATM carry over to the next meet, and each meet keeps its own record', () => {
  buildOn('meet-you');
  let photos = 0;
  for (let d = 0; d < 10; d++) {
    for (const race of card().races) {
      // The favourite on the morning line, to win: a photo now and then.
      const fav = race.entries.reduce((b, e, i) => (e.ml < race.entries[b].ml ? i : b), 0);
      if (game.player.bank < 2) atm();
      placeBet(race, { type: 'win', sel: [fav], amt: 2 });
      if (goToGate(race).cashedWinner) photos++;
    }
    if (d < 9) advanceDay();
  }
  assert.equal(W.isClosingDay(game.world), true);
  const closing = yourMeet();
  assert.deepEqual([closing.races, closing.photos, closing.start], [80, photos, START_BANK]);
  const bank = game.player.bank, atmWas = game.player.atm;
  advanceDay();
  assert.equal(game.player.bank, bank, 'the bankroll carries over');
  assert.equal(game.player.atm, atmWas, 'so does the ATM count');
  assert.deepEqual(game.player.meetStart, { no: 2, bank, atm: atmWas });
  const [line] = game.world.meets;
  assert.deepEqual(line.you, closing, "meet 1's record is kept with it");
  // Meet 2 starts from the bankroll it opened with, and counts only its own races.
  const fresh = yourMeet();
  assert.deepEqual([fresh.start, fresh.atm, fresh.bet, fresh.races, fresh.photos], [bank, 0, 0, 0, 0]);
  const race = card().races[0];
  placeBet(race, { type: 'win', sel: [0], amt: 2 });
  goToGate(race);
  assert.equal(yourMeet().races, 1);
  assert.equal(yourMeet().bet, 2);
  // Saved and opened again, both meets read the same.
  save();
  assert.equal(load(), true);
  assert.deepEqual(game.world.meets[0].you, closing);
  assert.equal(yourMeet().start, bank);
});
