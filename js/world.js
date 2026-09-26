// The racing world: a barn of about two hundred horses, each with hidden ability, running style,
// preferred distance and going. The meet starts with a few weeks of races already run, simulated the
// same way as the ones you watch, so every line in the past performances really happened.

import { rng } from './rng.js';
import { runRace, figureFor } from './sim.js';
import { coursePath, FURLONG } from './track.js';
import { runningLine, tripComment } from './chart.js';
import { SIRES, DAMSIRES, JOCKEYS, TRAINERS, OWNERS, SILK_COLORS, PATTERNS, STAKES, BIG_STAKES, makeName, damName } from './data.js';
import { morningLine, publicRating, probsFrom, formRating, oddsText } from './handicap.js';
import { forumPosts, scoreTipsters } from './forum.js';

export const HISTORY_DAYS = 10;
export const BARN = 210;
export const CARD_SIZE = 8;

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

function newHorse(world, R, { age, id }) {
  const taken = world._names || (world._names = new Set(world.horses.map(h => h.name)));
  const female = R.chance(0.42);
  const sire = R.weighted(SIRES.map(s => [s, 1 + s.q]));
  const coat = R.weighted(COATS.map(c => [c, c[2]]));
  const year = dayDate(world, 0).getUTCFullYear();
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
  const world = { v: 1, seed, start, day: -HISTORY_DAYS, horses: [], cards: {}, tipsters: {} };
  const R = rng(`world:${seed}`);
  const ages = [[3, 40], [4, 30], [5, 17], [6, 9], [7, 4]];
  for (let i = 0; i < BARN; i++) world.horses.push(newHorse(world, R, { age: R.weighted(ages), id: i }));
  // Workouts before the first race day.
  for (const h of world.horses) for (let k = 0; k < 2; k++) addWork(world, h, world.day, R);
  for (let d = -HISTORY_DAYS; d < 0; d++) {
    world.day = d;
    const card = buildCard(world, d);
    for (const race of card.races) {
      const run = simulateRace(race, world, { record: false });
      const odds = backgroundOdds(world, race);
      // The forum regulars were betting these too, so they arrive with a record.
      const posts = forumPosts(world, race, { odds, text: odds.map(o => oddsText(Math.max(0.2, o))) });
      applyResult(world, race, run, odds);
      const order = run.results.map(r => r.h);
      scoreTipsters(world.tipsters, posts, order, { win: { [order[0]]: Math.floor((odds[order[0]] + 1) * 20) / 10 } });
    }
    endOfDay(world, d);
    yield (d + HISTORY_DAYS + 1) / (HISTORY_DAYS + 1);
  }
  world.day = 0;
  world.cards = { 0: buildCard(world, 0) };
  delete world._names;
  return world;
}

export function nextDay(world) {
  endOfDay(world, world.day);
  world.day += 1;
  world.cards = { [world.day]: buildCard(world, world.day) };
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
  const active = world.horses.filter(h => !h.retired).length;
  for (let i = active; i < BARN; i++) {
    const h = newHorse(world, R, { age: R.weighted([[3, 70], [4, 20], [5, 10]]), id: world.horses.length });
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
  const stakes = day % 5 === 4 ? BIG_STAKES : STAKES[((day % STAKES.length) + STAKES.length) % STAKES.length];
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
      par: C.par, claim: C.claim || null, purse: cls === 'STK' ? (stakes === BIG_STAKES ? 300000 : R.pick([100000, 125000, 150000, 200000])) : C.purse,
      name: cls === 'STK' ? stakes.name : null, fm, post: postTime(no), seed: `${world.seed}:${day}:${no}`,
      entries: [], status: 'upcoming',
    };
  });
  fillRaces(world, races, R, day);
  for (const race of races) {
    const ml = morningLine(race, world.horses);
    race.entries.forEach((e, i) => { e.ml = ml[i][0]; e.mlText = ml[i][1]; });
  }
  return { day, date, wx, races };
}

function trainerEstimate(h, R) {
  const known = h.ability + h.form * 0.5;
  return h.pps.length ? 0.6 * known + 0.4 * (h.pps.slice(-3).reduce((s, p) => s + p.fig, 0) / Math.min(3, h.pps.length)) + R.gauss() * 1.5 : known + R.gauss() * 3;
}
function aptitude(h, race) {
  const dd = (race.f - h.dist) / h.distW;
  return -4 * dd * dd + (race.surface === 'turf' ? h.turf : 0);
}

function fillRaces(world, races, R, day) {
  const pool = world.horses.filter(h => !h.retired && (h.last === null || h.last <= day - 2));
  const est = new Map(pool.map(h => [h, trainerEstimate(h, R)]));
  const used = new Set();
  const order = races.slice().sort((a, b) => b.par - a.par);
  const fill = race => {
    const C = CLASSES[race.cls];
    const target = race.cls === 'STK' ? R.int(7, 10) : R.int(7, 11);
    const cands = pool.filter(h => !used.has(h) && (C.maiden ? h.maiden : !h.maiden) && (!race.fm || h.sex === 'f' || h.sex === 'm'))
      .map(h => {
        const e = est.get(h) + aptitude(h, race) * 0.8;
        const diff = e - race.par;
        // Trainers don't drop a good horse too far in a claiming race, and don't overmatch a bad one.
        const score = -(diff > 0 ? diff * (race.claim ? 1.3 : 0.6) : -diff * 1.1) + R.gauss() * 3;
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);
    let picked = cands.filter(c => c.score > -12).slice(0, target);
    if (picked.length < 7) picked = cands.slice(0, Math.max(7, picked.length));
    for (const c of picked) used.add(c.h);
    race.entries = picked.map(c => ({ hid: c.h.id }));
  };
  order.forEach(fill);
  // A race short of horses is opened up: first to colts and geldings, then to winners of any kind.
  for (const race of order) {
    if (race.entries.length >= 5) continue;
    for (const e of race.entries) used.delete(world.horses[e.hid]);
    if (race.fm) race.fm = false;
    else if (CLASSES[race.cls].maiden) { race.cls = 'C10'; race.par = CLASSES.C10.par; race.claim = CLASSES.C10.claim; race.purse = CLASSES.C10.purse; }
    fill(race);
  }

  for (const race of races) {
    R.shuffle(race.entries);
    race.entries.forEach((e, i) => { e.pp = i + 1; });
    // Better riders get on the better horses, mostly.
    const byChance = race.entries.slice().sort((a, b) => (est.get(world.horses[b.hid]) || 70) - (est.get(world.horses[a.hid]) || 70) + R.gauss() * 4);
    const riders = JOCKEYS.map((j, i) => ({ i, k: j.skill + R.gauss() * 0.45 })).sort((a, b) => b.k - a.k);
    byChance.forEach((e, k) => { e.j = riders[k].i; });
    for (const e of race.entries) {
      const h = world.horses[e.hid];
      e.wt = race.cls === 'STK' ? Math.round(116 + clamp((est.get(h) - race.par) * 0.6, -4, 8)) : R.pick([118, 120, 120, 121, 122, 124]) - (h.sex === 'f' || h.sex === 'm' ? (race.fm ? 0 : 2) : 0);
      e.rating = dayRating(h, race, e, R);
      e.pdk = paddockNote(h, R);
    }
  }
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

// Odds for races run before you arrived: the public's opinion plus some informed money.
function backgroundOdds(world, race) {
  const pub = race.entries.map(e => publicRating(world.horses[e.hid], race, e));
  const p1 = probsFrom(pub, 0.15), p2 = probsFrom(race.entries.map(e => e.rating), 0.12);
  return p1.map((p, i) => Math.max(0.1, 0.83 / (0.75 * p + 0.25 * p2[i]) - 1));
}

const SPLIT = [0.6, 0.2, 0.11, 0.05, 0.02];

export function applyResult(world, race, run, odds) {
  const R = rng(`apply:${race.seed}`);
  const D = race.distance;
  const fs = race.entries.length;
  const names = run.results.slice(0, 3).map((r, k) => [world.horses[race.entries[r.h].hid].name, k < 2 ? +(run.results[k + 1]?.toPrev || 0).toFixed(2) : 0]);
  const fr = run.fractions.map(f => +f.t.toFixed(2));
  race.entries.forEach((e, k) => {
    const h = world.horses[e.hid];
    const r = run.results.find(x => x.h === k);
    const fig = figureFor(r.time, D, race.surface, race.cond);
    const prevBest = h.pps.length ? Math.max(...h.pps.map(p => p.fig)) : null;
    const pp = {
      d: race.day, dt: race.date, no: race.no, f: race.f, surf: race.surface[0], cond: race.cond, cls: race.cls, clm: race.claim,
      nm: race.name, fm: race.fm, fs, pp: e.pp, j: e.j, wt: e.wt, odds: +odds[k].toFixed(2), fin: r.pos, bl: +r.behind.toFixed(2),
      line: runningLine(run, k), fig, t: +r.time.toFixed(2), fr, cm: tripComment(run, k, fs), top: names,
    };
    // Claimed out of the race by another trainer.
    if (race.claim && R.chance(0.08)) {
      const to = (h.trainer + R.int(1, TRAINERS.length - 1)) % TRAINERS.length;
      pp.claimed = { from: h.trainer, price: race.claim };
      h.trainer = to;
      h.owner = R.int(0, OWNERS.length - 1);
    }
    h.pps.push(pp);
    if (h.pps.length > 10) h.pps.shift();
    h.life.starts++;
    if (r.pos === 1) { h.life.w++; h.maiden = false; } else if (r.pos === 2) h.life.p++; else if (r.pos === 3) h.life.s++;
    h.life.earn += Math.round((SPLIT[r.pos - 1] || (r.pos <= fs ? 0.02 / Math.max(1, fs - 5) : 0)) * race.purse);
    // A big effort takes something out of a horse; an easy trip leaves it sharp.
    if (prevBest !== null && fig > prevBest + 3) h.form -= (fig - prevBest - 3) * 0.35;
    h.form -= 0.4;
    h.last = race.day;
  });
  race.status = 'official';
  race.result = {
    order: run.results.map(r => ({ k: r.h, pos: r.pos, behind: +r.behind.toFixed(2), toPrev: +r.toPrev.toFixed(2), time: +r.time.toFixed(2) })),
    fr, time: +run.finalTime.toFixed(2),
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

export function meetStats(world) {
  const j = JOCKEYS.map(() => ({ starts: 0, w: 0 }));
  const t = TRAINERS.map(() => ({ starts: 0, w: 0 }));
  for (const h of world.horses) for (const p of h.pps) {
    j[p.j].starts++; if (p.fin === 1) j[p.j].w++;
  }
  for (const h of world.horses) {
    const tr = t[h.trainer];
    for (const p of h.pps) { tr.starts++; if (p.fin === 1) tr.w++; }
  }
  return { jockeys: j, trainers: t };
}

export { formRating };
