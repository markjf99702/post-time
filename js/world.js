// The racing world: a barn of about two hundred horses, each with hidden ability, running style,
// preferred distance and going. The meet starts with a few weeks of races already run, simulated the
// same way as the ones you watch, so every line in the past performances really happened.

import { rng } from './rng.js';
import { runRace, figureFor, ENGINE } from './sim.js';
import { coursePath, FURLONG } from './track.js';
import { runningLine, tripComment } from './chart.js';
import { SIRES, DAMSIRES, JOCKEYS, TRAINERS, OWNERS, SILK_COLORS, PATTERNS, STAKES, BIG_STAKES, makeName, damName } from './data.js';
import { morningLine, formRating, oddsText } from './handicap.js';
import { forumPosts, scoreTipsters, favouriteAtTheOff } from './forum.js';
import { makeTote, board, settle } from './tote.js';

export const HISTORY_DAYS = 10;
export const BARN = 210;
export const CARD_SIZE = 8;
// A meet is ten race days, and the Larkspur Handicap is the last race of the last one, closing day.
export const MEET_DAYS = 10;
// The fewest maidens the barn is let run down to: enough for two maiden races a week.
const MAIDENS = 44;

export const CLASSES = {
  MCL: { par: 60, purse: 24000, maiden: true, claim: 20000, short: 'MdClm', long: 'Maiden Claiming' },
  MSW: { par: 71, purse: 48000, maiden: true, short: 'MdSpWt', long: 'Maiden Special Weight' },
  C10: { par: 63, purse: 18000, claim: 10000, short: 'Clm10000', long: 'Claiming' },
  C16: { par: 69, purse: 23000, claim: 16000, short: 'Clm16000', long: 'Claiming' },
  C25: { par: 75, purse: 30000, claim: 25000, short: 'Clm25000', long: 'Claiming' },
  C40: { par: 80, purse: 39000, claim: 40000, short: 'Clm40000', long: 'Claiming' },
  ALW: { par: 85, purse: 60000, short: 'Alw', long: 'Allowance' },
  STK: { par: 92, purse: 150000, short: 'Stk', long: 'Stakes' },
};

// ------------------------------------------------------------------ dates

export function dayDate(world, day) {
  const d = new Date(world.start + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + day * 7);
  return d;
}
export function dateISO(d) { return d.toISOString().slice(0, 10); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function shortDate(iso) { // 12Sep26
  const [y, m, d] = iso.split('-');
  return `${+d}${MON[m - 1]}${y.slice(2)}`;
}
export function longDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return `${DAYS[d.getUTCDay()]}, ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
// Race days fall on Saturdays: the first one on or after the day you start.
export function firstSaturday(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return dateISO(d);
}

// ------------------------------------------------------------------ horses

const COATS = [
  ['bay', 'b.', 40], ['dark bay', 'dk b.', 18], ['chestnut', 'ch.', 26], ['grey', 'gr.', 9], ['black', 'blk.', 5], ['roan', 'ro.', 2],
];

// `day` is the race day the horse arrives for: its age is counted from that day's year.
function newHorse(world, R, { age, id, day = 0 }) {
  // The names in use, gathered once a day. A save from before they were cleared at the end of the
  // day has them as {}, which is what JSON makes of a Set: gather them again.
  const taken = world._names instanceof Set ? world._names : (world._names = new Set(world.horses.map(h => h.name)));
  const female = R.chance(0.42);
  const sire = R.weighted(SIRES.map(s => [s, 1 + s.q]));
  const coat = R.weighted(COATS.map(c => [c, c[2]]));
  const year = dayDate(world, day).getUTCFullYear();
  const ability = clamp(73 + R.gauss() * 8.5 + sire.q * 1.1, 50, 104);
  const potential = age === 3 ? Math.max(0, R.gauss() * 3 + 5) : age === 4 ? Math.max(0, R.gauss() * 2 + 1.5) : 0;
  const dist = clamp(sire.dist + R.gauss() * 0.9, 5.5, 11);
  const style = clamp(sire.speed * 0.55 + (8.5 - dist) * 0.05 + R() * 0.5 - 0.05, 0.02, 0.98);
  const h = {
    id, name: makeName(R, female, taken),
    sex: female ? (age <= 4 ? 'f' : 'm') : (R.chance(0.55) ? 'g' : age <= 4 ? 'c' : 'h'),
    foaled: year - age,
    coat: coat[0], coatShort: coat[1],
    marks: { face: R.weighted([['none', 45], ['star', 20], ['blaze', 20], ['snip', 8], ['stripe', 7]]), socks: [0, 1, 2, 3].map(() => R.chance(0.22)) },
    sire: sire.name, dam: damName(R), damsire: R.pick(DAMSIRES),
    owner: R.int(0, OWNERS.length - 1), trainer: R.int(0, TRAINERS.length - 1),
    ability: ability - potential * 0.8, potential,
    style, reserve: clamp(112 + (7.5 - dist) * 5 + R.gauss() * 8, 82, 140),
    dist, distW: 1.4 + R() * 1.6,
    turf: clamp(sire.turf * 6 + R.gauss() * 3, -11, 8),
    mud: clamp(sire.mud * 5 + R.gauss() * 3, -9, 8),
    consistency: 2.5 + R() * 4.5,
    gate: R(), heart: R(),
    form: R.gauss() * 1.5,
    pps: [], works: [],
    life: { starts: 0, w: 0, p: 0, s: 0, earn: 0 },
    last: null, retired: false,
  };
  // Starts before this meet: just the record.
  const prior = age === 3 ? (R.chance(0.45) ? 0 : R.int(1, 4)) : R.int(3 + (age - 4) * 4, 8 + (age - 4) * 5);
  const winP = clamp(0.1 + (ability - 72) * 0.012, 0.03, 0.4);
  let w = 0, p = 0, s = 0;
  for (let i = 0; i < prior; i++) {
    const x = R();
    if (x < winP) w++; else if (x < winP * 1.9) p++; else if (x < winP * 2.7) s++;
  }
  // Most older horses have won somewhere; the ones that haven't are mostly slow.
  if (age >= 4) w = ability < 64 && R.chance(0.5) ? 0 : Math.max(1, w);
  else if (prior <= 2 && R.chance(0.6)) w = 0;
  else if (prior > 2 && ability > 72) w = Math.max(1, w);
  // A win handed out here takes the place of a third or a second, so nobody has placed more often than run.
  while (w + p + s > prior) { if (s) s--; else if (p) p--; else w--; }
  h.life = { starts: prior, w, p, s, earn: Math.round((w * 14000 + p * 4500 + s * 2500) * (0.6 + ability / 100) / 10) * 10 };
  h.maiden = w === 0;
  return h;
}

export function ownerSilks(i) {
  const R = rng(`silks:${i}`);
  const names = Object.keys(SILK_COLORS);
  const a = R.pick(names);
  let b = R.pick(names);
  while (b === a || (lum(SILK_COLORS[a]) - lum(SILK_COLORS[b])) ** 2 < 0.02) b = R.pick(names);
  return { body: SILK_COLORS[a], trim: SILK_COLORS[b], pattern: PATTERNS[i % PATTERNS.length], cap: R.chance(0.5) ? SILK_COLORS[b] : SILK_COLORS[a], capTrim: SILK_COLORS[R.chance(0.5) ? a : b], names: [a, b] };
}
// The silks each runner in a race wears. An owner with two or three runners in a race has one set of colours
// for all of them, so the first of them (by program number) wears them as they are, and each one after it a
// different cap: a colour that stands off the jacket, with the jacket's colour for its peak. (In one meet of
// twenty race days, 105 of 160 races had two runners in the same jacket and cap.) `owners` is each runner's
// owner, in program order.
const CAPS = ['white', 'black', 'yellow', 'royal', 'red', 'green', 'orange', 'pink', 'lightblue', 'purple'];
export function fieldSilks(owners) {
  const seen = new Map();
  return owners.map(o => {
    const k = seen.get(o) || 0;
    seen.set(o, k + 1);
    const s = ownerSilks(o);
    return k ? { ...s, cap: otherCap(s, k), capTrim: s.body } : s;
  });
}
// The k-th cap after the owner's own (k from 1): one far enough from the jacket in lightness to be told
// from it at a glance, and none of the colours already in the silks.
export function otherCap(s, k) {
  const used = new Set([s.body, s.trim, s.cap]);
  const ok = CAPS.map(n => SILK_COLORS[n]).filter(c => !used.has(c));
  const far = ok.filter(c => (lum(c) - lum(s.body)) ** 2 >= 0.05);
  const list = far.length >= 2 ? far : ok;
  return list[(k - 1) % list.length];
}
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
}

export function ageOf(world, h, day = world.day) {
  return dayDate(world, day).getUTCFullYear() - h.foaled;
}

// ------------------------------------------------------------------ the world

export function createWorld(seed, start) {
  const steps = buildWorld(seed, start);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

// The same, a day at a time, so a page can show progress: yields the fraction done.
export function* buildWorld(seed, start) {
  const world = { v: 1, seed, start, day: -HISTORY_DAYS, horses: [], cards: {}, tipsters: {}, stats: emptyStats(), meet: newMeetOn(1, 0), meets: [] };
  const R = rng(`world:${seed}`);
  const ages = [[3, 40], [4, 30], [5, 17], [6, 9], [7, 4]];
  for (let i = 0; i < BARN; i++) world.horses.push(newHorse(world, R, { age: R.weighted(ages), id: i }));
  // Workouts before the first race day.
  for (const h of world.horses) for (let k = 0; k < 2; k++) addWork(world, h, world.day, R);
  for (let d = -HISTORY_DAYS; d < 0; d++) {
    world.day = d;
    const card = buildCard(world, d);
    // Bet on the tote like any other race, with the forum regulars posting: they arrive with a record.
    for (const race of card.races) makeOfficial(world, race, simulateRace(race, world, { record: false }));
    endOfDay(world, d);
    yield (d + HISTORY_DAYS + 1) / (HISTORY_DAYS + 1);
  }
  world.day = 0;
  // The forum regulars arrive with a record from those ten weeks: the meet's champion is the one who does
  // best from here.
  world.meet.tips = structuredClone(world.tipsters);
  world.cards = { 0: buildCard(world, 0) };
  delete world._names;
  return world;
}

export function nextDay(world) {
  endOfDay(world, world.day);
  keepDay(world, world.day);
  // Closing day is over: the meet goes down in the record, and the next one opens next Saturday with the
  // same horses.
  if (world.meet && world.day >= world.meet.last) {
    (world.meets || (world.meets = [])).push(meetRecord(world));
    world.meet = newMeetOn(world.meet.no + 1, world.day + 1);
    world.meet.tips = structuredClone(world.tipsters || {});
  }
  // Earlier race days are kept from the first race day of the meet before this one.
  const before = world.meets?.length ? world.meets[world.meets.length - 1].first : -Infinity;
  if (Array.isArray(world.past)) world.past = world.past.filter(d => d.day >= before);
  world.day += 1;
  world.cards = { [world.day]: buildCard(world, world.day) };
  delete world._names; // a Set doesn't survive being saved
}

// ------------------------------------------------------------------ earlier race days

// world.past: a slim record of each race of the race days already run, this meet's and the last meet's, so their
// results can be looked at again and their races watched again. [{ day, date, races }], and each race is what
// its card and its result had, less what a result page doesn't show: { no, cls, claim, name, f, surface, cond,
// purse, fm, e: [[horse id, number, rider, weight, rating, owner, trainer] for each runner], o: [[entry,
// position, lengths behind, to the one ahead, time] in the order of finish], fr, time, eng, odds, pay, multi }.
// The rating and the race's seed (worked out from the meet's) are what the race is run from again; the owner
// and the trainer are the ones it ran for. About 4 KB a race day.
function keepDay(world, day) {
  const c = world.cards[day];
  if (!c || !c.races.every(r => r.status === 'official' && r.result)) return;
  const races = c.races.map(r => {
    const res = r.result;
    return {
      no: r.no, cls: r.cls, claim: r.claim, name: r.name, f: r.f, surface: r.surface, cond: r.cond, purse: r.purse, ...(r.fm ? { fm: true } : {}),
      e: r.entries.map(e => { const ran = e.ran || world.horses[e.hid]; return [e.hid, e.pp, e.j, e.wt, e.rating, ran.owner, ran.trainer]; }),
      o: res.order.map(o => [o.k, o.pos, o.behind, o.toPrev, o.time]),
      fr: res.fr, time: res.time, eng: res.eng, odds: res.odds, pay: res.pay, ...(res.multi ? { multi: res.multi } : {}),
    };
  });
  (Array.isArray(world.past) ? world.past : (world.past = [])).push({ day, date: c.date, races });
}

// An earlier race day's race as a race: the shape the card's races have, made official. The same object each
// time it's asked for (what's worked out from a race is kept by it), or null if it isn't kept.
const madeAgain = new WeakMap();
export function pastRace(world, day, no) {
  const d = (world.past || []).find(x => x.day === day);
  const s = d && d.races.find(r => r.no === no);
  if (!s) return null;
  if (madeAgain.has(s)) return madeAgain.get(s);
  const race = {
    no: s.no, day, date: d.date, cls: s.cls, surface: s.surface, f: s.f, distance: s.f * FURLONG, cond: s.cond, claim: s.claim, purse: s.purse,
    name: s.name, fm: !!s.fm, post: postTime(s.no), seed: `${world.seed}:${day}:${s.no}`, status: 'official', past: true,
    entries: s.e.map(([hid, pp, j, wt, rating, owner, trainer]) => ({ hid, pp, j, wt, rating, ran: { owner, trainer } })),
    result: {
      order: s.o.map(([k, pos, behind, toPrev, time]) => ({ k, pos, behind, toPrev, time })), fr: s.fr, time: s.time, eng: s.eng,
      odds: s.odds, oddsText: s.odds.map(oddsText), pay: s.pay, ...(s.multi ? { multi: s.multi } : {}),
    },
  };
  madeAgain.set(s, race);
  return race;
}
// The earlier race days kept, the newest first.
export const pastDays = world => (world.past || []).slice().reverse();

// ------------------------------------------------------------------ the meet

// world.meet: the meet being run. `no` counts from 1; `first` and `last` are its first race day and closing
// day, counted the way world.day is. `tips` is the forum's records as it opened (null for a meet saved
// before meets ended, whose regulars' records go back to before it). `tally` is the meet's own count of
// each race made official: riders' and trainers' [starts, wins] by index, each horse's [starts, wins,
// earnings] by id, the longest-priced winner, and the first two home in every stakes.
// world.meets: a line for each meet that has closed (meetRecord), with yours added by js/game.js.
function newMeetOn(no, first) {
  return { no, first, last: first + MEET_DAYS - 1, tips: null, tally: emptyTally() };
}
function emptyTally() {
  return { j: {}, t: {}, h: {}, long: null, stk: [] };
}

export const raceDayOf = (world, day = world.day) => day - world.meet.first + 1;
export const meetDays = world => world.meet.last - world.meet.first + 1;
export const isClosingDay = (world, day = world.day) => !!world.meet && day === world.meet.last;
export const isHandicap = race => !!race && race.name === BIG_STAKES.name;

// The stakes on a race day. Each weekly stakes in a meet comes round in turn, all ten of them, and closing
// day has the Handicap. (It used to come every fifth race day, which was always the turn of the Tape
// Measure Sprint or the Matchbook Handicap, so those two never ran.) The ten weeks before the first meet
// keep the stakes they had.
function stakesFor(world, day) {
  const m = world.meet;
  if (!m || day < m.first) return STAKES[((day % STAKES.length) + STAKES.length) % STAKES.length];
  if (day === m.last) return BIG_STAKES;
  return STAKES[((m.no - 1) * (MEET_DAYS - 1) + day - m.first) % STAKES.length];
}

// A meet saved before meets ended is meet 1, from its first race day, and it closes on its next tenth race
// day: race day 10, 20, 30 and so on. (The card on any of those already has the Handicap: it came every
// fifth race day.) A save whose card today has the Handicap (race day 5, 15, 25...) closes today instead:
// that card is kept as it was drawn, and a Handicap that isn't on closing day would be counted down to
// for five more weeks while it ran. Its count is made once from the lines its horses hold for the meet, which is as much as
// can be had back: a horse keeps its last ten lines, and a retired one its last. A purse isn't on a line, so
// a stakes counts as $150,000, the middle of what they're run for.
export function ensureMeet(world) {
  const m = world.meet;
  const ok = m && typeof m === 'object' && [m.no, m.first, m.last].every(Number.isInteger) && m.first <= world.day && world.day <= m.last
    && m.tally && typeof m.tally === 'object' && m.tally.j && m.tally.t && m.tally.h && Array.isArray(m.tally.stk);
  if (ok) { if (!Array.isArray(world.meets)) world.meets = []; return false; }
  const today = world.cards?.[world.day]?.races || [];
  const last = today.some(isHandicap) ? world.day : world.day + (MEET_DAYS - 1 - (((world.day % MEET_DAYS) + MEET_DAYS) % MEET_DAYS));
  world.meet = { no: 1, first: 0, last, tips: null, tally: tallyFromLines(world, 0) };
  if (!Array.isArray(world.meets)) world.meets = [];
  return true;
}

function tallyFromLines(world, first) {
  const tally = emptyTally();
  const stk = new Map();
  for (const h of world.horses) {
    let then = h.trainer; // who trained it for each race, worked back as in statsFromLines
    for (let i = h.pps.length - 1; i >= 0; i--) {
      const p = h.pps[i];
      if (p.claimed) then = p.claimed.from;
      if (!(p.d >= first)) continue;
      const purse = p.cls === 'STK' ? (p.nm === BIG_STAKES.name ? BIG_STAKES.purse : 150000) : CLASSES[p.cls]?.purse || 0;
      countRace(tally, { j: p.j, t: p.tr ?? then, hid: h.id, pos: p.fin, earn: Math.round(share(p.fin, p.fs) * purse), odds: p.odds, day: p.d, no: p.no });
      if (p.cls === 'STK' && p.fin <= 2) {
        const k = `${p.d}:${p.no}`;
        if (!stk.has(k)) stk.set(k, { day: p.d, no: p.no, name: p.nm, top: [] });
        stk.get(k).top[p.fin - 1] = h.id;
      }
    }
  }
  tally.stk = [...stk.values()].sort((a, b) => a.day - b.day).map(s => ({ ...s, top: s.top.filter(x => x !== undefined && x !== null) }));
  return tally;
}

function countRace(tally, { j, t, hid, pos, earn, odds, day, no }) {
  const add = (rec, k) => { const r = rec[k] || (rec[k] = [0, 0]); r[0]++; if (pos === 1) r[1]++; return r; };
  add(tally.j, j);
  add(tally.t, t);
  const r = tally.h[hid] || (tally.h[hid] = [0, 0, 0]);
  r[0]++; if (pos === 1) r[1]++; r[2] += earn;
  if (pos === 1 && (!tally.long || odds > tally.long.odds)) tally.long = { hid, odds, day, no };
}

// The horses pointed to the Handicap: the first two home in each of the meet's weekly stakes, the ones
// still racing, best first as the trainers see them.
export function pointedTo(world) {
  const m = world.meet;
  if (!m) return [];
  const ids = new Set(m.tally.stk.filter(s => s.name !== BIG_STAKES.name && s.day >= m.first).flatMap(s => s.top));
  return [...ids].map(id => world.horses[id]).filter(h => h && !h.retired && !h.maiden);
}

// Which weekly stakes a horse earned its place in the Handicap in, and how: [{ day, name, pos }].
export function prepsOf(world, hid) {
  const m = world.meet;
  if (!m) return [];
  return m.tally.stk.filter(s => s.name !== BIG_STAKES.name && s.top.includes(hid)).map(s => ({ day: s.day, name: s.name, pos: s.top.indexOf(hid) + 1 }));
}

// The meet as it stands, for its closing page, and kept as the meet's line when it closes. Names are kept
// as well as ids: a horse can be gone from the barn by the time a meet long past is looked at.
export function meetRecord(world) {
  const m = world.meet, T = m.tally;
  const best = (rec, n) => Object.entries(rec).map(([k, [starts, w]]) => ({ i: +k, starts, w })).filter(x => x.i >= 0 && x.i < n)
    .sort((a, b) => b.w - a.w || a.starts - b.starts || a.i - b.i)[0] || null;
  const rider = best(T.j, JOCKEYS.length), trainer = best(T.t, TRAINERS.length);
  const horse = Object.entries(T.h).map(([id, [starts, w, earn]]) => ({ hid: +id, starts, w, earn }))
    .sort((a, b) => b.earn - a.earn || b.w - a.w || a.hid - b.hid)[0] || null;
  const nameOf = id => world.horses[id]?.name || '';
  // The forum's champion: the best return on $2 to win on each pick, among the regulars who picked in at
  // least a third of the meet's races.
  const races = Object.values(T.j).reduce((n, [, w]) => n + w, 0);
  const tips = Object.entries(world.tipsters || {}).map(([id, r]) => {
    const was = (m.tips && m.tips[id]) || { picks: 0, wins: 0, back: 0 };
    return { id, picks: r.picks - was.picks, wins: r.wins - was.wins, back: Math.round((r.back - was.back) * 100) / 100 };
  }).filter(x => x.picks > 0 && x.picks >= races / 3).sort((a, b) => b.back / b.picks - a.back / a.picks || b.wins - a.wins)[0] || null;
  const handicap = T.stk.find(s => s.name === BIG_STAKES.name && s.day === m.last) || null;
  // Every rider and trainer who has had a ride or a starter, most wins first: [index, starts, wins]. And the
  // leading horses, the five with the most wins and the five that have earned most: { hid, name, starts, w, earn }.
  const table = (rec, n) => Object.entries(rec).map(([k, [starts, w]]) => [+k, starts, w]).filter(([i, starts]) => i >= 0 && i < n && starts > 0)
    .sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
  const horses = Object.entries(T.h).map(([id, [starts, w, earn]]) => ({ hid: +id, name: nameOf(+id), starts, w, earn }));
  return {
    riders: table(T.j, JOCKEYS.length), trainers: table(T.t, TRAINERS.length),
    wins: horses.filter(x => x.w > 0).sort((a, b) => b.w - a.w || b.earn - a.earn || a.hid - b.hid).slice(0, 5),
    earners: horses.filter(x => x.earn > 0).sort((a, b) => b.earn - a.earn || b.w - a.w || a.hid - b.hid).slice(0, 5),
    no: m.no, first: m.first, last: m.last, races, since: !m.tips,
    rider: rider && { i: rider.i, w: rider.w, starts: rider.starts },
    trainer: trainer && { i: trainer.i, w: trainer.w, starts: trainer.starts },
    horse: horse && { ...horse, name: nameOf(horse.hid) },
    champ: tips,
    long: T.long && { ...T.long, name: nameOf(T.long.hid) },
    stakes: T.stk.map(s => ({ day: s.day, no: s.no, name: s.name, hid: s.top[0], horse: nameOf(s.top[0]) })),
    handicap: handicap && { hid: handicap.top[0], horse: nameOf(handicap.top[0]) },
  };
}

function endOfDay(world, day) {
  const R = rng(`eod:${world.seed}:${day}`);
  for (const h of world.horses) {
    if (h.retired) continue;
    h.form = h.form * 0.8 + R.gauss() * 1.4;
    if (h.potential > 0) { const g = Math.min(h.potential, 0.45); h.ability += g; h.potential -= g; }
    const age = ageOf(world, h, day);
    if (age >= 6) h.ability -= 0.12;
    if (h.last !== day && R.chance(0.5)) addWork(world, h, day + 1, R);
  }
  // Retirements, and new horses shipping in.
  for (const h of world.horses) {
    if (h.retired) continue;
    const age = ageOf(world, h, day);
    if (age >= 8 || h.ability < 50 || R.chance(0.006) || (age >= 6 && h.pps.length >= 4 && h.pps.slice(-3).every(p => p.fin > 6) && R.chance(0.25))) {
      h.retired = true;
      h.pps = h.pps.slice(-1); h.works = []; // keep the save small
    }
  }
  // The two maiden races on every card turn two maidens into winners every week, and horses shipped in only
  // to fill the places of the ones retired: after about twenty race days the barn ran short of horses that
  // had never won, and the maiden races were opened to winners as $10,000 claimers (race 1 was a maiden
  // race on 20% of race days 41 to 60). So when fewer than 44 horses in the barn are maidens, up to three of
  // the slowest winners of five or older that didn't run today go home, and the horses that ship in that
  // day are three-year-olds, most of them maidens.
  const running = world.horses.filter(h => !h.retired);
  const short = Math.max(0, MAIDENS - running.filter(h => h.maiden).length);
  if (short) {
    const old = running.filter(h => !h.maiden && h.last !== day && ageOf(world, h, day) >= 5).sort((a, b) => a.ability - b.ability);
    for (const h of old.slice(0, Math.min(3, Math.ceil(short / 8)))) { h.retired = true; h.pps = h.pps.slice(-1); h.works = []; }
  }
  // They first run on the next race day, and are three, four or five then. (Their foaling year used to
  // be counted from the meet's first race day, so after a New Year they arrived a year older than drawn,
  // and no three-year-old ever came again. Horses already in a barn keep the age they've been shown at.)
  const active = world.horses.filter(h => !h.retired).length;
  for (let i = active; i < BARN; i++) {
    const age = R.weighted([[3, 70], [4, 20], [5, 10]]);
    const h = newHorse(world, R, { age: short ? 3 : age, id: world.horses.length, day: day + 1 });
    world.horses.push(h);
    addWork(world, h, day + 1, R); addWork(world, h, day + 1, R);
  }
}

// A morning workout: its time depends on how the horse is doing right now.
const WORK_BASE = { 3: 36.4, 4: 48.6, 5: 61.0, 6: 73.8 };
function addWork(world, h, day, R) {
  const f = R.pick([3, 4, 4, 5, 5, 5, 6]);
  const sd = 0.45 * f / 4;
  const z = -((h.ability + h.form - 74) * 0.05) + R.gauss() * 0.8;
  const breeze = R.chance(0.7);
  const t = WORK_BASE[f] + z * sd + (breeze ? 0 : -0.3);
  const of = R.int(8, 55);
  const pct = clamp(0.5 + 0.5 * erf(z / Math.SQRT2), 0, 1);
  const rank = Math.max(1, Math.min(of, Math.round(pct * of + 0.5)));
  const d = dayDate(world, day);
  d.setUTCDate(d.getUTCDate() - R.int(2, 6));
  h.works.push({ dt: dateISO(d), f, t: +t.toFixed(1), g: breeze ? 'B' : 'H', rank, of, surf: R.chance(0.85) ? 'd' : 't' });
  if (h.works.length > 5) h.works.shift();
}

// ------------------------------------------------------------------ race cards

function weatherFor(world, day) {
  const R = rng(`wx:${world.seed}:${day}`);
  const sky = R.weighted([['sunny', 42], ['partly cloudy', 25], ['overcast', 15], ['rain', 12], ['showers', 6]]);
  const month = dayDate(world, day).getUTCMonth();
  const temp = Math.round([41, 45, 55, 64, 73, 81, 86, 85, 78, 66, 55, 45][month] + R.gauss() * 5);
  let dirt = 'fast', turf = 'firm';
  if (sky === 'rain') { dirt = R.weighted([['sloppy', 60], ['muddy', 25], ['good', 15]]); turf = R.weighted([['yielding', 55], ['soft', 30], ['good', 15]]); }
  else if (sky === 'showers') { dirt = R.weighted([['good', 50], ['sloppy', 50]]); turf = R.weighted([['good', 60], ['yielding', 40]]); }
  else if (sky === 'overcast' && R.chance(0.3)) { dirt = 'good'; turf = 'good'; }
  else if (R.chance(0.12)) turf = 'good';
  return { sky, temp, dirt, turf };
}

export function postTime(no) { // minutes after noon
  return 150 + (no - 1) * 32;
}
export function clockText(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')}`;
}

export function buildCard(world, day) {
  const R = rng(`card:${world.seed}:${day}`);
  const wx = weatherFor(world, day);
  const date = dateISO(dayDate(world, day));
  const plan = [
    ['MCL', R.pick(['d', 'd', 't'])],
    [R.pick(['C10', 'C16']), 'd'],
    ['MSW', R.pick(['t', 'd'])],
    [R.pick(['C16', 'C25']), R.pick(['d', 't'])],
    [R.pick(['ALW', 'C40']), 'd'],
    [R.pick(['C25', 'C10', 'C40']), 't'],
    ['ALW', R.pick(['t', 'd'])],
    ['STK', null],
  ];
  const stakes = stakesFor(world, day);
  const races = plan.map(([cls, s], i) => {
    const no = i + 1;
    let surface = s === 't' ? 'turf' : 'dirt';
    let f;
    if (cls === 'STK') { surface = stakes.surface; f = stakes.f; }
    else if (surface === 'turf') f = R.pick([5, 5.5, 5.5, 8, 8, 8.5, 9]);
    else f = R.pick([5.5, 6, 6, 6, 6.5, 7, 7, 8, 8.5, 8.5, 9]);
    const distance = f * FURLONG;
    const C = CLASSES[cls];
    const fm = cls !== 'STK' && R.chance(0.3);
    return {
      no, day, date, cls, surface, f, distance, cond: surface === 'dirt' ? wx.dirt : wx.turf,
      par: C.par, claim: C.claim || null, purse: cls === 'STK' ? (stakes === BIG_STAKES ? BIG_STAKES.purse : R.pick([100000, 125000, 150000, 200000])) : C.purse,
      name: cls === 'STK' ? stakes.name : null, fm, post: postTime(no), seed: `${world.seed}:${day}:${no}`,
      entries: [], status: 'upcoming',
    };
  });
  fillRaces(world, races, R, day);
  for (const race of races) setMorningLine(world, race);
  return { day, date, wx, races };
}

function setMorningLine(world, race) {
  const ml = morningLine(race, world.horses);
  race.entries.forEach((e, i) => { e.ml = ml[i][0]; e.mlText = ml[i][1]; });
}

// A race with one horse in it, or none, couldn't be run, and the day can't end without it; two horses
// make a match race, not a betting race. A card drawn before short maiden races were opened all the way
// up could have one: draw it again from the horses that are free that day. Returns the races it drew again.
export function redrawShortRaces(world) {
  const card = world.cards[world.day];
  const short = card ? card.races.filter(r => r.status !== 'official' && r.entries.length < 3) : [];
  if (!short.length) return short;
  const busy = new Set(card.races.filter(r => !short.includes(r)).flatMap(r => r.entries.map(e => e.hid)));
  for (const race of short) race.entries = [];
  fillRaces(world, short, rng(`redraw:${world.seed}:${world.day}`), world.day, busy);
  for (const race of short) setMorningLine(world, race);
  return short;
}

function trainerEstimate(h, R) {
  const known = h.ability + h.form * 0.5;
  return h.pps.length ? 0.6 * known + 0.4 * (h.pps.slice(-3).reduce((s, p) => s + p.fig, 0) / Math.min(3, h.pps.length)) + R.gauss() * 1.5 : known + R.gauss() * 3;
}
function aptitude(h, race) {
  const dd = (race.f - h.dist) / h.distW;
  return -4 * dd * dd + (race.surface === 'turf' ? h.turf : 0);
}

// `busy` has the ids of horses already entered in another race that day.
function fillRaces(world, races, R, day, busy = new Set()) {
  const free = h => !h.retired && !busy.has(h.id);
  const pool = world.horses.filter(h => free(h) && (h.last === null || h.last <= day - 2));
  const est = new Map(pool.map(h => [h, trainerEstimate(h, R)]));
  // Horses that ran last week, called on only when a race can't be filled any other way.
  let tired = null;
  const tiredPool = () => tired || (tired = world.horses.filter(h => free(h) && h.last !== null && h.last > day - 2 && h.last < day)
    .map(h => { est.set(h, trainerEstimate(h, R)); return h; }));
  const used = new Set();
  const order = races.slice().sort((a, b) => b.par - a.par);
  // On closing day the horses pointed to the Handicap are entered in it first (the best of them, if there
  // are more than it takes) whether or not they ran last week: it's the race they were aimed at. It takes
  // a field of nine to eleven.
  const pointed = races.some(isHandicap) ? pointedTo(world).filter(free) : [];
  for (const h of pointed) if (!est.has(h)) est.set(h, trainerEstimate(h, R));
  // `open` is how far the race has been opened up: 0 as written, 1 to any horse that's had a week off,
  // 2 to any horse at all.
  const fill = (race, open = 0) => {
    const target = isHandicap(race) ? R.int(9, 11) : race.cls === 'STK' ? R.int(7, 10) : R.int(7, 11);
    const first = isHandicap(race) && !open ? pointed.filter(h => !used.has(h)).sort((a, b) => est.get(b) - est.get(a)).slice(0, target) : [];
    for (const h of first) used.add(h);
    fillFrom(race, open, target - first.length, 7 - first.length);
    race.entries = first.map(h => ({ hid: h.id })).concat(race.entries);
  };
  // Up to `target` more, and no fewer than `least` if there are that many to be had.
  const fillFrom = (race, open, target, least) => {
    const C = CLASSES[race.cls];
    const from = open >= 2 ? pool.concat(tiredPool()) : pool;
    const cands = from.filter(h => !used.has(h) && (open >= 1 || (C.maiden ? h.maiden : !h.maiden)) && (!race.fm || h.sex === 'f' || h.sex === 'm'))
      .map(h => {
        const e = est.get(h) + aptitude(h, race) * 0.8;
        const diff = e - race.par;
        // Trainers don't drop a good horse too far in a claiming race, and don't overmatch a bad one.
        const score = -(diff > 0 ? diff * (race.claim ? 1.3 : 0.6) : -diff * 1.1) + R.gauss() * 3;
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);
    let picked = cands.filter(c => c.score > -12).slice(0, Math.max(0, target));
    if (picked.length < least) picked = cands.slice(0, Math.max(least, picked.length));
    for (const c of picked) used.add(c.h);
    race.entries = picked.map(c => ({ hid: c.h.id }));
  };
  order.forEach(race => fill(race));
  // A race short of horses is opened up a step at a time until it has five: to colts and geldings, then
  // (a maiden race; late in a long meet most of the maidens have won) to winners as a $10,000 claimer,
  // then to any horse that's had a week off, then to any horse at all. Still none runs twice in a day.
  const toWinners = race => { race.cls = 'C10'; race.par = CLASSES.C10.par; race.claim = CLASSES.C10.claim; race.purse = CLASSES.C10.purse; };
  for (const race of order) {
    let open = 0;
    while (race.entries.length < 5) {
      if (race.fm) race.fm = false;
      else if (CLASSES[race.cls].maiden) toWinners(race);
      else if (open < 2) open++;
      else break; // with two hundred horses in the barn it never comes to this
      for (const e of race.entries) used.delete(world.horses[e.hid]);
      fill(race, open);
    }
  }

  for (const race of races) {
    R.shuffle(race.entries);
    race.entries.forEach((e, i) => { e.pp = i + 1; });
    // Better riders get on the better horses, mostly. One draw a horse, then a plain sort: a sort that
    // draws inside its comparison makes as many draws as the browser's sort makes comparisons, which
    // varies from one run to the next, and every draw after it on the card shifted with it. (2.83 spreads
    // the difference between two horses the way the old draw of 4 for each comparison did.)
    const byChance = race.entries.map(e => ({ e, k: (est.get(world.horses[e.hid]) || 70) + R.gauss() * 2.83 })).sort((a, b) => b.k - a.k).map(x => x.e);
    const riders = JOCKEYS.map((j, i) => ({ i, k: j.skill + R.gauss() * 0.45 })).sort((a, b) => b.k - a.k);
    byChance.forEach((e, k) => { e.j = riders[k].i; });
    const top = race.cls === 'STK' ? Math.max(...race.entries.map(e => est.get(world.horses[e.hid]) ?? 70)) : 0;
    for (const e of race.entries) {
      const h = world.horses[e.hid];
      e.wt = race.cls === 'STK' ? stakesWeight(race, top - (est.get(h) ?? 70)) : R.pick([118, 120, 120, 121, 122, 124]) - (h.sex === 'f' || h.sex === 'm' ? (race.fm ? 0 : 2) : 0);
      e.rating = dayRating(h, race, e, R);
      e.pdk = paddockNote(h, R);
    }
  }
}

// A stakes is weighted from the top down: the best horse in it, as the trainers see it, carries 124 pounds
// (126 in a race named a Handicap), and the rest come down from there, three fifths of a pound for each
// point they're thought to be worse, to no less than 114. (It was worked out from 116, up or down from the
// race's par with a floor of 112, so more than half of every stakes field carried 112 and the top weight
// was 116 or 117: a handicap's top weight at a track is 126 or more, and 112 is an everyday race's floor.)
// `below` is how many points the horse is thought to be below the best in the race.
export function stakesWeight(race, below) {
  const top = /Handicap/.test(race.name || '') ? 126 : 124;
  return Math.max(114, Math.round(top - Math.max(0, below) * 0.6));
}

function dayRating(h, race, entry, R) {
  const dd = (race.f - h.dist) / h.distW;
  let r = h.ability + h.form;
  r -= Math.min(18, 4 * dd * dd);
  if (race.surface === 'turf') r += h.turf;
  if (['sloppy', 'muddy', 'yielding', 'soft'].includes(race.cond)) r += h.mud * (race.surface === 'turf' ? 0.7 : 1);
  r += JOCKEYS[entry.j].skill * 1.5;
  r -= (entry.wt - 120) * 0.2;
  r += R.gauss() * h.consistency * 0.6;
  return r;
}

const PADDOCK = {
  good: ['Dappled and on the muscle', 'Walking like a winner', 'Coat gleaming, ears pricked', 'Full of himself, kicking up', 'Bright-eyed and relaxed', 'Looks a picture'],
  fair: ['Calm, all business', 'Nothing to say either way', 'Sleepy but fine', 'A bit plain', 'Quiet in the ring', 'Workmanlike'],
  poor: ['Washed out, sweating between the legs', 'Dull coat', 'Fractious, fighting the groom', 'On edge in the ring', 'Looks light', 'Bandaged up front, walking short'],
};
function paddockNote(h, R) {
  const x = h.form + R.gauss() * 2.2;
  const kind = x > 2.4 ? 'good' : x < -3.2 ? 'poor' : 'fair';
  const note = R.pick(PADDOCK[kind]);
  const fem = h.sex === 'f' || h.sex === 'm';
  return { kind, text: fem ? note.replace('himself', 'herself') : note };
}

// ------------------------------------------------------------------ running a race

export function raceSetup(race) {
  if (!race.path) Object.defineProperty(race, 'path', { value: coursePath(race.surface, race.distance), enumerable: false, writable: true });
  return race;
}

export function simulateRace(race, world, opts = {}) {
  raceSetup(race);
  const entrants = race.entries.map(e => {
    const h = world.horses[e.hid];
    return { rating: e.rating, style: h.style, reserve: h.reserve, gate: h.gate, jockey: (JOCKEYS[e.j].skill + 0.4) / 1.3, heart: h.heart };
  });
  return runRace(race, entrants, opts);
}

// The forum's thread on a race: the regulars post with the betting about half done, and quote the board
// as it stands then.
export function forumThread(world, race, tote) {
  const b = board(tote, 0.45);
  return forumPosts(world, race, { odds: b.odds, text: b.text });
}

// A race that has been run is made official: the tote pays out at the final odds, your tickets among the
// public's (`bets`), those odds go on every runner's line, and each forum regular's pick goes on his record.
// Every race at Larkspur comes through here, the ones run in the ten weeks before the meet and the ones you
// watch. (The weeks before the meet had odds from a stand-in book of their own, which made the favourite a
// median 2.49-1 where the tote makes it 1.70-1 and scored the regulars against those prices, so they opened
// the meet with records from another game: ChalkEater near the top, where over a meet he's last but one.)
// `tote` and `posts` are the race's own when it already has them.
export function makeOfficial(world, race, run, { tote = makeTote(race, world), bets = [], posts = forumThread(world, race, tote) } = {}) {
  const final = board(tote, 1, bets);
  const order = run.results.map(r => r.h);
  const pay = settle(tote, order, bets);
  // ChalkEater has whoever is favourite on the final board, whatever it was when he posted.
  favouriteAtTheOff(posts, final.odds);
  applyResult(world, race, run, final.odds);
  race.result.pay = pay;
  race.result.odds = final.odds.map(o => +o.toFixed(2));
  race.result.oddsText = final.text;
  world.tipsters = scoreTipsters(world.tipsters || {}, posts, order, pay);
  return { order, pay, posts };
}

const SPLIT = [0.6, 0.2, 0.11, 0.05, 0.02];
// The share of the purse a finishing place earns, in a field of `fs`.
const share = (pos, fs) => SPLIT[pos - 1] || (pos <= fs ? 0.02 / Math.max(1, fs - 5) : 0);
// What a horse earned for finishing `pos` in `race`, as it went on its record.
export const earnedIn = (race, pos) => Math.round(share(pos, race.entries.length) * race.purse);

export function applyResult(world, race, run, odds) {
  const R = rng(`apply:${race.seed}`);
  const D = race.distance;
  const fs = race.entries.length;
  const names = run.results.slice(0, 3).map((r, k) => [world.horses[race.entries[r.h].hid].name, k < 2 ? +(run.results[k + 1]?.toPrev || 0).toFixed(2) : 0]);
  const fr = run.fractions.map(f => +f.t.toFixed(2));
  const stats = ensureStats(world);
  const meet = world.meet && race.day >= world.meet.first && race.day <= world.meet.last ? world.meet : null;
  race.entries.forEach((e, k) => {
    const h = world.horses[e.hid];
    const r = run.results.find(x => x.h === k);
    const fig = figureFor(r.time, D, race.surface, race.cond);
    const prevBest = h.pps.length ? Math.max(...h.pps.map(p => p.fig)) : null;
    const pp = {
      d: race.day, dt: race.date, no: race.no, f: race.f, surf: race.surface[0], cond: race.cond, cls: race.cls, clm: race.claim,
      nm: race.name, fm: race.fm, fs, pp: e.pp, j: e.j, wt: e.wt, odds: +odds[k].toFixed(2), fin: r.pos, bl: +r.behind.toFixed(2),
      line: runningLine(run, k), fig, t: +r.time.toFixed(2), fr, cm: tripComment(run, k, fs), top: names,
      tr: h.trainer, // who trained it that day, for the trainers' records
    };
    // Claimed out of the race by another trainer. It ran for the people who entered it, so the race keeps
    // who they were: the silks it ran in, and the trainer and owner in the winner's circle, are theirs.
    if (race.claim && R.chance(0.08)) {
      const to = (h.trainer + R.int(1, TRAINERS.length - 1)) % TRAINERS.length;
      pp.claimed = { from: h.trainer, price: race.claim };
      e.ran = { owner: h.owner, trainer: h.trainer };
      h.trainer = to;
      // A new owner too: any of them but the one it has. (One draw from all thirty, the present owner among
      // them, left one claimed horse in thirty with the people it was claimed from, in the same silks. A
      // draw that lands on them takes the next owner in the list, so it's still one draw and every other
      // claim goes where it went.)
      const owner = R.int(0, OWNERS.length - 1);
      h.owner = owner === h.owner ? (owner + 1) % OWNERS.length : owner;
    }
    h.pps.push(pp);
    if (h.pps.length > 10) h.pps.shift();
    // The race goes on the rider's record, and on the record of the trainer it ran for.
    for (const rec of [pair(stats.j, e.j), pair(stats.t, pp.tr)]) { rec[0]++; if (r.pos === 1) rec[1]++; }
    h.life.starts++;
    if (r.pos === 1) { h.life.w++; h.maiden = false; } else if (r.pos === 2) h.life.p++; else if (r.pos === 3) h.life.s++;
    const earn = Math.round(share(r.pos, fs) * race.purse);
    h.life.earn += earn;
    // And on the meet's own count.
    if (meet) countRace(meet.tally, { j: e.j, t: pp.tr, hid: h.id, pos: r.pos, earn, odds: pp.odds, day: race.day, no: race.no });
    // A big effort takes something out of a horse; an easy trip leaves it sharp.
    if (prevBest !== null && fig > prevBest + 3) h.form -= (fig - prevBest - 3) * 0.35;
    h.form -= 0.4;
    h.last = race.day;
  });
  if (meet && race.cls === 'STK') meet.tally.stk.push({ day: race.day, no: race.no, name: race.name, top: run.results.slice(0, 2).map(x => race.entries[x.h].hid) });
  race.status = 'official';
  race.result = {
    order: run.results.map(r => ({ k: r.h, pos: r.pos, behind: +r.behind.toFixed(2), toPrev: +r.toPrev.toFixed(2), time: +r.time.toFixed(2) })),
    fr, time: +run.finalTime.toFixed(2), eng: ENGINE,
  };
  return race.result;
}

// ------------------------------------------------------------------ small things

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function erf(x) { // Abramowitz and Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// Riders' and trainers' records: starts and wins, from ten weeks before the meet opened. They're kept as
// a running count on the world, `stats`: { j: [[starts, wins], ...], t: [...] }, one pair for each rider
// and each trainer, added to as each race is made official. They used to be counted from the lines horses
// still hold, and a horse keeps ten lines and a retired one a single line, so a record lost races as the
// meet went on: over 20 race days the wins shown rose by 96 while 160 races were run, and a rider's record
// went down overnight 46 times.
export function meetStats(world) {
  const st = world.stats || statsFromLines(world);
  const rows = list => list.map(([starts, w]) => ({ starts, w }));
  return { jockeys: rows(JOCKEYS.map((_, i) => pair(st.j, i))), trainers: rows(TRAINERS.map((_, i) => pair(st.t, i))) };
}

function emptyStats() {
  return { j: JOCKEYS.map(() => [0, 0]), t: TRAINERS.map(() => [0, 0]) };
}
function pair(list, i) { return list[i] || (list[i] = [0, 0]); }

// A meet saved before the count was kept gets it once, from the lines as they stand: the most that can be
// had back. From then on it's exact.
export function ensureStats(world) {
  const ok = list => Array.isArray(list) && list.every(x => Array.isArray(x) && x.length === 2 && x.every(Number.isFinite));
  if (!world.stats || !ok(world.stats.j) || !ok(world.stats.t)) world.stats = statsFromLines(world);
  return world.stats;
}

function statsFromLines(world) {
  const st = emptyStats();
  const add = (rec, p) => { rec[0]++; if (p.fin === 1) rec[1]++; };
  for (const h of world.horses) {
    // A race counts for whoever trained the horse that day. A line from before that was written on it says
    // only who the horse was claimed from, so those are worked back from the trainer it has now.
    let then = h.trainer;
    for (let i = h.pps.length - 1; i >= 0; i--) {
      const p = h.pps[i];
      if (p.claimed) then = p.claimed.from;
      add(pair(st.j, p.j), p);
      add(pair(st.t, p.tr ?? then), p);
    }
  }
  return st;
}

export { formRating };
