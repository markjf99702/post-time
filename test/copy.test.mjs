// A copy of the meet in one file (Save a copy, Open a copy, and what Google Drive keeps), in plain Node with
// stand-ins for the browser's storage:  node --test test/copy.test.mjs
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
const { decide } = await import('../js/drive.js');
const { game } = G;

function build(seed) {
  const meet = G.newMeet(seed);
  while (!meet.step()) { /* a week of history at a time */ }
}
const firstRace = () => G.card().races[0];

test('a copy of the meet reads back as the meet, and opens in place of another with this device keeping its settings', () => {
  build('copy-one');
  assert.ok(G.placeBet(firstRace(), { type: 'win', sel: [0], amt: 2 }).ok);
  G.goToGate(firstRace());
  const text = G.meetCopy(), seed = game.world.seed, bank = game.player.bank, ledger = game.player.ledger.length;
  const read = G.readCopy(text);
  assert.ok(read.ok);
  assert.equal(read.world.seed, seed);
  assert.match(read.saved, /^\d{4}-\d\d-\d\dT/);
  // (A finished race's recorded frames aren't kept in a save, and aren't in a copy either.)
  assert.ok(!text.includes('"path"'));

  // Another device, with a meet of its own and its own settings.
  build('copy-two');
  game.player.settings = { sound: false, voice: true, voiceName: 'Chrome OS US English 4' };
  G.save();
  assert.ok(G.adopt(read));
  assert.deepEqual([game.world.seed, game.player.bank, game.player.ledger.length], [seed, bank, ledger]);
  assert.deepEqual(game.player.settings, { sound: false, voice: true, voiceName: 'Chrome OS US English 4' }, "a copy brought another device's settings");
  // It's what's saved here now: the page opened again has it.
  game.world = null;
  assert.equal(G.load(), true);
  assert.deepEqual([game.world.seed, game.player.bank, game.player.settings.voiceName], [seed, bank, 'Chrome OS US English 4']);
});

test("a file that isn't a copy of a meet, or a damaged one, is turned down and changes nothing", () => {
  build('copy-three');
  const before = store.get('post-time/world');
  for (const text of ['', 'not json', '{"a":1}', JSON.stringify({ world: game.world, player: game.player })]) {
    const r = G.readCopy(text);
    assert.equal(r.ok, false, text.slice(0, 20));
    assert.equal(r.why, "That file isn't a copy of a Post Time meet.");
  }
  const copy = JSON.parse(G.meetCopy());
  delete copy.world.cards;
  assert.deepEqual(G.readCopy(JSON.stringify(copy)), { ok: false, why: "That copy of a meet is damaged, so it can't be opened." });
  const noPlayer = JSON.parse(G.meetCopy());
  noPlayer.player = [1, 2];
  assert.equal(G.readCopy(JSON.stringify(noPlayer)).ok, false);
  assert.equal(store.get('post-time/world'), before);
});

test('a copy of a meet saved by the live version, from before meets ended, opens and becomes meet 1', () => {
  build('copy-four');
  const copy = JSON.parse(G.meetCopy());
  delete copy.world.meet;
  delete copy.world.meets;
  delete copy.player.meetStart;
  const read = G.readCopy(JSON.stringify(copy));
  assert.ok(read.ok);
  assert.deepEqual(G.whereIs(read.world, read.player), { meet: 1, raceDay: null, date: read.world.cards[read.world.day].date, run: 0, of: 8, bank: 200 });
  assert.ok(G.adopt(read));
  assert.equal(game.world.meet.no, 1);
  assert.deepEqual(G.whereIs(), { meet: 1, raceDay: 1, date: game.world.cards[game.world.day].date, run: 0, of: 8, bank: 200 });
});

test("a copy the browser won't keep leaves the meet here as it was, both halves of it", () => {
  build('copy-five');
  const other = G.readCopy(G.meetCopy());
  build('copy-six');
  const was = [store.get('post-time/world'), store.get('post-time/player')];
  const real = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === 'post-time/player' && !String(v).includes('"bank":200,"bets":{}')) throw new Error('QuotaExceededError'); real(k, v); };
  try {
    // (The stand-in turns down the player half of the copy's meet; a bet makes it tell the two apart.)
    other.player.bets = { x: [] };
    assert.equal(G.adopt(other), false);
  } finally { localStorage.setItem = real; }
  assert.deepEqual([store.get('post-time/world'), store.get('post-time/player')], was);
});

test("how far on a meet is: a ticket, a race or the next race day moves it on, and looking at a race doesn't", () => {
  build('copy-seven');
  assert.ok(G.untouched());
  const at = G.progressMark();
  const race = firstRace();
  G.forumFor(race);
  G.mtpState(race);
  assert.equal(G.progressMark(), at, 'opening a race moved the meet on');
  assert.ok(G.placeBet(race, { type: 'win', sel: [1], amt: 2 }).ok);
  const bet = G.progressMark();
  assert.notEqual(bet, at);
  assert.equal(G.untouched(), false);
  G.goToGate(race);
  const ran = G.progressMark();
  assert.notEqual(ran, bet);
  for (const r of G.card().races) G.goToGate(r);
  G.advanceDay();
  assert.notEqual(G.progressMark(), ran);
  assert.equal(G.untouched(), false);
  assert.equal(G.untouched(null, null), true, 'no meet at all is as good as an untouched one');
});

test('two devices that each bought a different $2 ticket on the same race are not at the same place', () => {
  build('copy-eight');
  const race = firstRace();
  const copy = G.readCopy(G.meetCopy());
  G.placeBet(race, { type: 'win', sel: [1], amt: 2 });
  const one = G.progressMark();
  G.cancelBet(race, 0);
  G.placeBet(race, { type: 'win', sel: [2], amt: 2 });
  assert.notEqual(G.progressMark(), one);
  assert.notEqual(G.progressMark(copy.world, copy.player), one);
});

test('what a sync with Google Drive does, from where this device last matched it', () => {
  const file = { id: 'f2', version: '7' };
  const base = { fileId: 'f2', version: '7', rev: 'r1', mark: 'm1' };
  const here = (mark, more) => ({ mark, seed: 's', untouched: false, ...more });
  const remote = (rev, mark, seed = 's') => ({ rev, mark, world: { seed } });
  // No file: the meet here makes it (if there's a meet here).
  assert.equal(decide({ file: null, base: null, here: here('m1') }), 'make');
  assert.equal(decide({ file: null, base, here: here('m1') }), 'make', "a file deleted from Drive isn't made again");
  assert.equal(decide({ file: null, base: null, here: { mark: '', seed: '' } }), 'same');
  // Drive as this device left it: send the meet if it has moved on.
  assert.equal(decide({ file, base, here: here('m1') }), 'same');
  assert.equal(decide({ file, base, here: here('m2') }), 'push');
  // Drive has changed: read it first.
  const moved = { id: 'f2', version: '9' };
  assert.equal(decide({ file: moved, base, here: here('m1') }), 'read');
  // ...and it's this device's own copy (only the file changed), or one it sent and didn't see land.
  assert.equal(decide({ file: moved, base, here: here('m2'), remote: remote('r1', 'm1') }), 'ours');
  assert.equal(decide({ file: moved, base, sent: { rev: 'r2' }, here: here('m2'), remote: remote('r2', 'm2') }), 'ours');
  // Another device's: taken if this one hasn't moved on, a choice if it has.
  assert.equal(decide({ file: moved, base, here: here('m1'), remote: remote('r3', 'm3') }), 'take');
  assert.equal(decide({ file: moved, base, here: here('m2'), remote: remote('r3', 'm3') }), 'choose');
  assert.equal(decide({ file: moved, base, here: here('m3'), remote: remote('r3', 'm3') }), 'match');
  // A device's first sync: a meet nobody has played, or none that can be read, takes Drive's; a played one
  // is a choice, unless it's the same meet at the same place.
  assert.equal(decide({ file, base: null, here: here('m5', { untouched: true }), remote: remote('r3', 'm3') }), 'take');
  assert.equal(decide({ file, base: null, here: { mark: '', seed: '' }, remote: remote('r3', 'm3') }), 'take');
  assert.equal(decide({ file, base: null, here: here('m5'), remote: remote('r3', 'm3') }), 'choose');
  assert.equal(decide({ file, base: null, here: here('m3'), remote: remote('r3', 'm3') }), 'match');
  assert.equal(decide({ file, base: null, here: here('m3'), remote: remote('r3', 'm3', 'other') }), 'choose');
  // A file made again by another device, after this one's was deleted.
  assert.equal(decide({ file: { id: 'f9', version: '1' }, base, here: here('m1') }), 'read');
  assert.equal(decide({ file: { id: 'f9', version: '1' }, base, here: here('m1'), remote: remote('r9', 'm9') }), 'take');
});
