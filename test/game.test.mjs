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
const { game, newMeet, load, save, card, toteFor, placeBet, goToGate, mtpState, currentBoard, advanceDay, callFor, horseOf, runnersFor, photoRecord } = await import('../js/game.js');
const { stateAt, RAIL } = await import('../js/sim.js');
const { LENGTH } = await import('../js/track.js');
const { marginShort } = await import('../js/chart.js');
const { buildWorld, meetStats, ownerSilks } = await import('../js/world.js');
const { TRAINERS, OWNERS } = await import('../js/data.js');

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
      const names = race.entries.map(e => horseOf(e).name);
      races.push({
        day: d + 1, no: race.no, field: race.entries.length, lines: call.lines.map(l => l.text), photo: call.photo,
        winner: horseOf(race.entries[run.results[0].h]).name, reactions: (race.forumAfter || []).map(p => p.text),
        second: run.results[1] ? horseOf(race.entries[run.results[1].h]).name : null, official: call.official,
        ...callAgainstRace(race, run, call, names),
      });
    }
    advanceDay();
  }
  return (longMeet = races);
}

// The race call held against the recorded race, line by line, each at the moment it comes up. `wrong`
// lists what the caller said that the race doesn't show, by kind; `said` counts what he said.
const SAY = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const CHART_SAYS = { nk: 'a neck', '¼': 'a neck', '½': 'a half length', '¾': 'three quarters of a length', 1: 'a length', '1¼': 'a length and a quarter', '1½': 'a length and a half', '1¾': 'a length and three quarters' };
function callAgainstRace(race, run, call, names) {
  const wrong = {}, said = {};
  const bad = (kind, l, why = '') => (wrong[kind] || (wrong[kind] = [])).push(`${l.text}${why && ` (${why})`}`);
  const count = kind => { said[kind] = (said[kind] || 0) + 1; };
  const front = st => st.reduce((a, s, i) => (s.p > st[a].p ? i : a), 0);
  const [w, s] = run.results;
  let lastNamed = null, pace = null;
  call.lines.forEach((l, k) => {
    const st = stateAt(run, run.t0 + l.t);
    const x = l.text, before = call.lines[k - 1];
    // In order, and no line (but the finish) on the heels of the one before.
    if (before && (l.t < before.t || (l.kind !== 'finish' && l.t < before.t + 1.8 - 1e-9))) bad('crowded', l, `${(l.t - before.t).toFixed(2)} s after "${before.text}"`);
    // A horse named as the leader is in front, and a lead change is news.
    const namesLeader = /^Turning for home|leads by|all alone\.|still in front|takes over!|takes the lead!|in front!|head and head|battle to the wire|drawing away|won't catch|home free|vie for the early lead|to the front|to the lead|takes them along/.test(x);
    if (namesLeader !== (l.lead !== undefined)) bad('leader', l, 'names a leader and does not say which, or the other way round');
    if (l.lead !== undefined) {
      count('leader');
      if (!x.includes(names[l.lead])) bad('leader', l, `means ${names[l.lead]}`);
      if (front(st) !== l.lead) bad('leader', l, `${names[front(st)]} is in front`);
      if (/takes over!|takes the lead!|^And now it's /.test(x) !== !!l.change) bad('change', l, 'a lead change not marked as one, or the other way round');
      if (l.change) { count('change'); if (lastNamed === l.lead) bad('change', l, 'already named as the leader'); }
      lastNamed = l.lead;
    }
    // Where a horse is said to be running.
    const place = / wide!$/.test(x) ? 'wide' : /on the outside/.test(x) ? 'outside' : /up the rail|on the inside/.test(x) ? 'inside' : /is making a run!$|is flying!$/.test(x) ? 'between' : null;
    if (place) {
      count(place);
      const paths = st[l.who] ? st[l.who].o - RAIL : NaN; // off the rail, as the chart measures it
      const ok = place === 'wide' ? paths >= 2.5 && x.endsWith(` ${SAY[Math.round(paths) + 1]} wide!`) : place === 'outside' ? paths >= 2.5 : place === 'inside' ? paths < 0.8 : paths >= 0.8 && paths < 2.5;
      if (!ok || !x.includes(names[l.who])) bad('place', l, `${paths.toFixed(2)} paths off the rail`);
    }
    // Closing fast: gaining on the leader, from within three lengths.
    if (/closing fast/.test(x)) {
      count('closing');
      const [a, b] = [st[l.lead], st[l.who]]; // the leader and the closer, if the line says who they are
      const gap = a && b ? (a.p - b.p) / LENGTH : NaN;
      if (!(gap < 3) || !(b.v > a.v) || !x.startsWith(`${names[l.who]} closing fast`)) bad('closing', l, a && b ? `${gap.toFixed(1)} lengths back, ${(b.v - a.v).toFixed(2)} m/s faster` : 'does not say who');
    }
    // Sure of the winner: it wins, and not in a photo.
    if (/drawing away|won't catch|home free/.test(x) !== (l.sure !== undefined)) bad('sure', l, 'sounds sure and is not marked so, or the other way round');
    if (l.sure !== undefined) {
      count(/home free/.test(x) ? 'home free' : 'sure');
      if (call.photo || l.sure !== w.h || !x.includes(names[w.h])) bad('sure', l, `${names[w.h]} won${call.photo ? ' in a photo' : ` by ${s.toPrev.toFixed(2)}`}`);
    }
    if (/still in front by/.test(x)) count('still in front');
    if (/A clean break/.test(x)) { count('clean break'); if (run.results.some(r => r.bumped || r.slow || r.stumble)) bad('break', l, 'somebody bumped, stumbled or broke slowly'); }
    if (/whisker/.test(x) || /\b(1?\d|20) lengths?\b/.test(x)) bad('words', l);
    if (/^The quarter in /.test(x)) pace = { f: race.f, remark: /a fast pace/.test(x) ? 'fast' : /nice and easy/.test(x) ? 'easy' : '' };
    // The finish line of a race that isn't a photo: the margin the chart gives, going away only for a winner
    // not being caught, and a winner who got up in the last second said to have.
    if (!call.photo && l.kind === 'finish' && / wins? it | win it /.test(x)) {
      count('finish');
      const ledLate = front(stateAt(run, run.t0 + run.finalTime - 1)) === w.h;
      if (/gets up to win it/.test(x)) count('gets up');
      if (x.startsWith(`${names[w.h]} gets up to win it `) === ledLate || !x.startsWith(names[w.h])) bad('finish', l, ledLate ? 'led a second out' : 'did not lead a second out');
      if (s) {
        const chart = marginShort(s.toPrev);
        const m = / by (.+?)(, going away)?!$/.exec(x);
        const word = m ? m[1].replace(/ lengths$/, '') : '';
        const whole = SAY.includes(word) ? SAY.indexOf(word) : +word;
        const agrees = m && (CHART_SAYS[chart] ? m[1] === CHART_SAYS[chart] : / lengths$/.test(m[1]) && whole >= 2 && Math.abs(whole - s.toPrev) <= 0.5 + 1e-9);
        if (!agrees) bad('finish', l, `the chart says ${chart}`);
        if (/going away/.test(x)) { count('going away'); if (w.finishSpeed < s.finishSpeed || s.toPrev <= 2.5) bad('finish', l, 'the runner-up was finishing faster, or close'); }
      }
    }
  });
  return { wrong, said, pace };
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

test("a clock put back after a race was opened doesn't leave it hours from post with no odds", () => {
  // The race was opened with the clock an hour ahead (a phone's wrong clock, since put right): it showed
  // "312 MTP", a win pool of $NaN and 1-5 on every horse until the clock caught up.
  build('clock-back');
  const [r1] = card().races;
  game.player.opened['0:1'] = Date.now() + 3600000;
  assert.deepEqual(mtpState(r1), { mtp: 12, frac: 0 });
  assert.ok(game.player.opened['0:1'] <= Date.now(), 'the race is still opened in the future');
  const b = currentBoard(r1);
  assert.ok([...b.odds, ...Object.values(b.pools)].every(Number.isFinite), `the board has ${JSON.stringify(b.pools)}`);
  assert.ok(new Set(b.text).size > 1, 'every horse is at the same odds');
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

// What the long meet's race calls got wrong, of one kind, and how often he said a thing.
const told = (races, kind) => races.flatMap(r => (r.wrong[kind] || []).map(x => `race day ${r.day}, race ${r.no}: ${x}`));
const total = (races, kind) => races.reduce((n, r) => n + (r.said[kind] || 0), 0);

test("the caller doesn't sound sure of a leader who then gets caught or goes to a photo", () => {
  const races = playLongMeet();
  assert.deepEqual(told(races, 'sure'), []);
  assert.ok(total(races, 'sure') > races.length / 10, `the caller is sure of a winner in only ${total(races, 'sure')} races`);
});

test('the caller says a horse is closing fast only when it is gaining on the leader from within three lengths', () => {
  // "X closing fast, but Y still in front!" was said of horses five lengths behind a runaway winner.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'closing'), []);
  assert.ok(total(races, 'closing') > 0, 'nobody is ever called closing');
  assert.ok(total(races, 'still in front') > 0, "the caller never just says who's still in front");
});

test('a horse named as the leader is in front when the line comes up, and no line crowds the one before', () => {
  // Lines were moved up to 1.8 seconds later, after they were worded, to keep them apart: every line that
  // named the wrong leader was a moved one. Now a line is worded for the moment it's given.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'leader'), []);
  assert.deepEqual(told(races, 'crowded'), []);
  assert.ok(total(races, 'leader') > races.length * 3, `only ${total(races, 'leader')} lines name a leader`);
});

test('a lead change is never called for the horse just named as the leader', () => {
  // "Around the far turn, Crimson Detour leads by a head." and then "Crimson Detour goes by and takes the lead!"
  const races = playLongMeet();
  assert.deepEqual(told(races, 'change'), []);
  assert.ok(total(races, 'change') > races.length / 2, `only ${total(races, 'change')} lead changes called`);
});

test('the caller puts a horse on the outside, on the inside or four wide only where it is running', () => {
  // "Is flying on the outside!" was one of three endings picked at random, and was said of horses on the
  // rail; "four wide" was the chart's third path.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'place'), []);
  for (const kind of ['wide', 'inside', 'between']) assert.ok(total(races, kind) > 0, `never says a horse is ${kind}`);
});

test('a clean break is one where nobody bumped, stumbled or broke slowly', () => {
  const races = playLongMeet();
  assert.deepEqual(told(races, 'break'), []);
  assert.ok(total(races, 'clean break') > 10, `a clean break called ${total(races, 'clean break')} times`);
});

test("the finish is called by the chart's margin, and 'going away' only for a winner not being caught", () => {
  // "By a whisker!" covered margins up to six tenths of a length, with "1/2" in the running order above it.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'finish'), []);
  assert.deepEqual(told(races, 'words'), [], 'a whisker, or a number of lengths in figures');
  assert.ok(total(races, 'finish') > races.length / 2);
  assert.ok(total(races, 'going away') > 10, `going away called ${total(races, 'going away')} times`);
});

test('the opening quarter is called fast or slow for its own distance', () => {
  // With one par for everything from six and a half furlongs up, "a fast pace" was said in half the races
  // at six and a half and seven furlongs, and never in a shorter sprint.
  const races = playLongMeet();
  const groups = { 'five to six furlongs': r => r.pace.f <= 6, 'six and a half and seven': r => r.pace.f > 6 && r.pace.f <= 7, routes: r => r.pace.f > 7 };
  for (const [name, inGroup] of Object.entries(groups)) {
    const g = races.filter(r => r.pace && inGroup(r));
    const fast = g.filter(r => r.pace.remark === 'fast').length, easy = g.filter(r => r.pace.remark === 'easy').length;
    assert.ok(g.length >= 30, `only ${g.length} races at ${name}`);
    assert.ok(fast > 0 && fast < g.length / 4, `a fast pace in ${fast} of ${g.length} races at ${name}`);
    assert.ok(easy < g.length / 5, `an easy pace in ${easy} of ${g.length} races at ${name}`);
  }
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

test('a horse claimed out of a race it wins ran it, and is photographed, for the people who entered it', () => {
  // The claim was applied before the race was shown, so the horse ran in its new owner's silks and the
  // winner's circle named the new trainer and owner, after the form had shown the old ones.
  buildOn('claims', '2026-10-03');
  let found = null;
  for (let d = 0; d < 12 && !found; d++) {
    for (const race of card().races) {
      const before = race.entries.map(e => ({ owner: horseOf(e).owner, trainer: horseOf(e).trainer }));
      const silks = runnersFor(race).map(r => r.silks);
      game.player.bank = 200;
      for (let i = 0; i < race.entries.length; i++) placeBet(race, { type: 'win', sel: [i], amt: 2 });
      const { run } = goToGate(race);
      const win = run.results[0].h, horse = horseOf(race.entries[win]);
      if (!horse.pps[horse.pps.length - 1].claimed) continue;
      found = { race, win, horse, was: before[win], silks: silks[win] };
      break;
    }
    if (!found) advanceDay();
  }
  assert.ok(found, 'no winner was claimed in twelve race days');
  const { race, win, horse, was, silks } = found;
  assert.notEqual(horse.trainer, was.trainer, 'the claim changed nothing');
  const check = when => {
    const e = card().races[race.no - 1].entries[win];
    assert.deepEqual(runnersFor(card().races[race.no - 1])[win].silks, silks, `${when}: it runs in other silks`);
    assert.deepEqual(silks, ownerSilks(was.owner));
    const shot = photoRecord(card().races[race.no - 1], win, 0);
    assert.deepEqual([shot.trainer, shot.ownerName, shot.owner], [TRAINERS[was.trainer], OWNERS[was.owner], was.owner], `${when}: the photograph names the new people`);
    assert.deepEqual(e.ran, was);
  };
  check('in the race');
  const kept = game.player.book[game.player.book.length - 1];
  assert.deepEqual([kept.no, kept.trainer, kept.ownerName, kept.owner], [race.no, TRAINERS[was.trainer], OWNERS[was.owner], was.owner], 'the scrapbook has the new people');
  // Watch again, and after the page is opened again.
  assert.equal(goToGate(card().races[race.no - 1]).replay, true);
  check('on Watch again');
  save();
  load();
  goToGate(card().races[race.no - 1]);
  check('on Watch again after a reload');
  // The win counts for the trainer who saddled it, not the one who claimed it; and the same is worked out
  // for a line written before lines said who the trainer was.
  const mine = game.world.horses[horse.id];
  const tally = TRAINERS.map((_, i) => mine.pps.filter(p => p.tr === i).length);
  assert.equal(mine.pps[mine.pps.length - 1].tr, was.trainer);
  assert.deepEqual(meetStats({ horses: [mine] }).trainers.map(t => t.starts), tally, "its earlier races count for the trainer who claimed it");
  const old = structuredClone(mine);
  for (const p of old.pps) delete p.tr;
  assert.deepEqual(meetStats({ horses: [old] }).trainers.map(t => t.starts), tally, "a line with no trainer on it isn't worked back from the claim");
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
