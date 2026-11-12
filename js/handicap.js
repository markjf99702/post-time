// What the public can see: figures, class, jockeys. Used for the morning line, the betting,
// and the forum's handicappers. None of this peeks at a horse's hidden ability.

import { FURLONG } from './track.js';
import { JOCKEYS, SIRES } from './data.js';

export function lastFigs(h, n = 3) {
  return h.pps.slice(-n).reverse().map(p => p.fig);
}

// Recent figures, weighted toward the latest, adjusted for how the horse ran on this sort of going.
export function formRating(h, race) {
  const pps = h.pps.slice(-4).reverse();
  if (!pps.length) return firstTimerGuess(h, race);
  const w = [0.45, 0.3, 0.17, 0.08];
  let s = 0, ws = 0;
  pps.forEach((p, i) => {
    let f = p.fig;
    // A troubled trip hides a better run.
    if (/Stumbled|Blocked|Checked|Steadied|Broke slowly|Bumped/.test(p.cm)) f += 2;
    if (p.surf !== race.surface[0]) f -= 2;
    s += f * w[i]; ws += w[i];
  });
  return s / ws;
}

// A first-time starter: the public goes on workouts, pedigree and who trains it. One that starts out in a
// maiden claimer is for sale before it has shown anything, and the public expects that much less of it.
export function firstTimerGuess(h, race) {
  const sire = SIRES.find(s => s.name === h.sire);
  const works = h.works.slice(-3);
  const workScore = works.length ? works.reduce((s, w) => s + (w.rank / w.of < 0.2 ? 3 : w.rank / w.of < 0.5 ? 1 : -1), 0) : 0;
  return (race && race.cls === 'MCL' ? race.par - 8 : 64) + (sire ? sire.q * 1.5 : 0) + workScore;
}

export function surfaceRecord(h, surface) {
  const pps = h.pps.filter(p => p.surf === surface[0]);
  return { starts: pps.length, wins: pps.filter(p => p.fin === 1).length, best: pps.length ? Math.max(...pps.map(p => p.fig)) : null };
}

// ------------------------------------------------------------------ what the form says about a horse

const WET = ['sloppy', 'muddy', 'yielding', 'soft'];
// The words a trip note uses for trouble: at the start (Stumbled, Broke slowly, Bumped) and in the running.
export const TROUBLE = /Blocked|Checked|Stumbled|Broke slowly|Bumped/;
// The trouble the Troubled trip chip is for: a stumble, a slow break or a rider having to check. (It was for
// any trouble word, bumps and being blocked too, and sat on about a third of every field: those horses won
// about as often as the rest next time.)
const REAL_TROUBLE = /Stumbled|Broke slowly|Checked/;
// The two kinds of maiden race (their codes in CLASSES, in world.js).
const maidenRace = cls => cls === 'MCL' || cls === 'MSW';
const daysFrom = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5); // between two dates, 2026-10-03

// A horse with no race on its card has either never raced or raced somewhere else: horses arrive with a
// lifetime record, and none of those starts are lines. Returns the chip and the sentence for it, or null for
// a horse with lines. (Both kinds used to be "First-time starter. Has not raced yet", under "Life: 10
// starts, 1 win".)
export function newcomer(h) {
  if (h.pps.length) return null;
  const n = h.life.starts;
  if (!n) return { chip: 'First-time starter', note: 'Has not raced yet. The workouts are all there is to go on.' };
  return { chip: 'First start at Larkspur', note: `Has raced ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} elsewhere. None of it is on the card.` };
}

// The newest bullet work that says something about today: one since the horse last raced or, for a horse
// with no race on its card, one in the last three weeks. (A horse keeps its last five works, so a bullet
// could be months old, with several races run since.)
export function freshBullet(h, race) {
  const last = h.pps[h.pps.length - 1];
  const fresh = w => w.rank === 1 && (last ? w.dt > last.dt : daysFrom(w.dt, race.date) <= 21);
  return h.works.filter(fresh).sort((a, b) => (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0))[0] || null;
}
// The same bullet, if it's from the last three weeks whether or not the horse has raced: what LongshotLou
// quotes with its date. (A horse back from two months off can have a bullet from six weeks ago.)
export function recentBullet(h, race) {
  const w = freshBullet(h, race);
  return w && daysFrom(w.dt, race.date) <= 21 ? w : null;
}

// A horse that broke its maiden last time and meets winners today. A maiden claimer's price isn't a class
// to drop from: by the pars a $20,000 maiden claimer is an easier race than a $10,000 claimer for winners.
export function firstAgainstWinners(h, race) {
  const last = h.pps[h.pps.length - 1];
  return !!last && maidenRace(last.cls) && !maidenRace(race.cls) && h.pps.every(p => maidenRace(p.cls));
}
// The claiming price a horse ran for last time, if that was a race for winners: the price it drops from or
// steps up from today. Null after a maiden claimer or a race that wasn't a claimer.
export function lastPrice(h) {
  const last = h.pps[h.pps.length - 1];
  return last && last.clm && !maidenRace(last.cls) ? last.clm : null;
}

// Angles a handicapper would notice, as chips: [text, 'good' or ''], for a horse in a race on race day `day`.
// Each says only what the lines on the card show. A horse with starts the card doesn't show (it came with
// a record, or has run more than the ten races a card keeps) may have done a thing before.
export function angles(race, h, day = race.day) {
  const out = [];
  const last = h.pps[h.pps.length - 1];
  const unseen = h.life.starts > h.pps.length;
  const turf = h.pps.filter(p => p.surf === 't').length;
  if (race.surface === 'turf' && h.pps.length && !turf) out.push([unseen ? 'No turf race on the card' : 'First time on turf', '']);
  if (race.surface === 'dirt' && turf >= 2 && turf === h.pps.length) out.push(['Turf horse on dirt', '']);
  const f = race.distance / FURLONG;
  if (h.pps.length && f >= 8 && h.pps.every(p => p.f < 8)) out.push(['First time going long', '']);
  if (h.pps.length && f < 8 && h.pps.every(p => p.f >= 8)) out.push(['Cutting back to a sprint', '']);
  if (last && last.claimed) out.push(['New barn: claimed last out', 'good']);
  if (firstAgainstWinners(h, race)) out.push(['First time against winners', '']);
  const price = lastPrice(h);
  if (price && race.claim && race.claim < price) out.push([`Drops from $${price / 1000}k`, 'good']);
  if (price && race.claim && race.claim > price) out.push([`Up from $${price / 1000}k`, '']);
  if (last && !last.clm && race.claim && last.cls !== 'MCL') out.push(['Drops into a claimer', 'good']);
  if (freshBullet(h, race)) out.push(['Bullet work', 'good']);
  if (last && day - last.d >= 5) out.push([`Back from ${day - last.d} weeks off`, '']);
  if (last && REAL_TROUBLE.test(last.cm)) out.push(['Troubled trip last time', 'good']);
  // On the same surface: mud on the dirt says nothing about soft turf.
  if (WET.includes(race.cond) && h.pps.some(p => WET.includes(p.cond) && p.surf === race.surface[0] && p.fin <= 2)) out.push(['Has run well on a wet track', 'good']);
  return out;
}

// What the betting public, the line maker and the late money think a post is worth, in points of rating.
// In a race of a mile or more the field comes over for a first turn that's close: posts 2 and 3 do best, the
// rail horse is often squeezed at the break, and from post 7 out a horse loses ground or position. In a
// sprint it matters less, and the rail is the post riders dread. These follow how the posts win at
// Larkspur (npm run sim), which follow the published figures for one-mile tracks; they used to be priced at
// nothing, and $2 on post 1 in every race made a profit.
const POST_EDGE = {
  sprint: [-0.6, 0.3, 0.8, 0.8, 0.3, -0.2, -0.3, -0.6, -1, -1.6, -2.2, -2.8],
  route: [0.6, 1.6, 1.5, 0.4, -0.2, -0.5, -1.1, -1.8, -2, -2.6, -3.2, -3.8],
};
export function postEdge(race, pp) {
  const t = POST_EDGE[race.distance >= 8 * FURLONG - 1 ? 'route' : 'sprint'];
  return t[Math.min(t.length, Math.max(1, pp)) - 1];
}

// How a horse usually runs, read from its past performances: E (need the lead) .. S (closer). A horse
// that's first or second at the first call, on average, is one that needs the lead.
export function runStyle(h) {
  const lines = h.pps.slice(-4).map(p => p.line[0] && p.line[0][0]).filter(Boolean);
  if (!lines.length) return null;
  const avg = lines.reduce((a, b) => a + b, 0) / lines.length;
  return avg <= 2 ? 'E' : avg <= 3.2 ? 'E/P' : avg <= 5 ? 'P' : 'S';
}

// What the betting public, the line maker and the late money think the pace of a race is worth to a horse,
// in points of rating: the only horse in the field that needs the lead is likely to get it to itself. (They
// thought it worth nothing, and $2 to win on that horse in every race made a profit with no handicapping
// beyond counting the speed horses in the form.) `horses` is where the runners are looked up by id.
const LONE_SPEED = 1.5;
export function paceEdge(race, horses, entry) {
  if (!horses || runStyle(horses[entry.hid]) !== 'E') return 0;
  return race.entries.filter(e => e !== entry && runStyle(horses[e.hid]) === 'E').length ? 0 : LONE_SPEED;
}

// How the public rates a horse in a race. With `horses` (where the runners are looked up by id) it knows
// the pace of the race too: paceEdge.
export function publicRating(h, race, entry, horses = null) {
  let r = formRating(h, race);
  if (entry.pp) r += postEdge(race, entry.pp);
  r += paceEdge(race, horses, entry);
  r += (JOCKEYS[entry.j]?.skill || 0) * 1.4;
  const f = race.distance / FURLONG;
  // Never tried the distance or surface: the public is wary.
  const tried = h.pps.filter(p => Math.abs(p.f - f) <= 1 && p.surf === race.surface[0]);
  if (h.pps.length && !tried.length) r -= 1.5;
  return r;
}

export function probsFrom(ratings, beta = 0.16) {
  const m = Math.max(...ratings);
  const e = ratings.map(r => Math.exp((r - m) * beta));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / s);
}

// Odds as a track shows them: 3-5, 2-1, 7-2, 12-1. These are the steps a morning line is made in.
const LADDER = [
  [0.2, '1-5'], [0.4, '2-5'], [0.5, '1-2'], [0.6, '3-5'], [0.8, '4-5'], [1, '1-1'], [1.2, '6-5'], [1.4, '7-5'],
  [1.5, '3-2'], [1.6, '8-5'], [1.8, '9-5'], [2, '2-1'], [2.5, '5-2'], [3, '3-1'], [3.5, '7-2'], [4, '4-1'],
  [4.5, '9-2'], [5, '5-1'], [6, '6-1'], [7, '7-1'], [8, '8-1'], [9, '9-1'], [10, '10-1'], [12, '12-1'],
  [15, '15-1'], [20, '20-1'], [30, '30-1'], [50, '50-1'], [99, '99-1'],
];
// The board has steps of its own: 1-9 for anything shorter than 1-5, the same steps up to 10-1, then every
// whole number to 99-1. It used to share the morning line's, which above 10-1 go 12, 15, 20, 30, 50, 99, so
// "30-1" stood over "$2 pays ~$97", and one board had two horses at 20-1 paying about $43 and about $60.
const BOARD = [[1 / 9, '1-9'], ...LADDER.filter(s => s[0] <= 10), ...Array.from({ length: 89 }, (_, k) => [k + 11, `${k + 11}-1`])];
// The board's wording of the odds: the step at or below them, so a ticket never pays less than the board
// says (but for a price shorter than 1-9, the least a board shows).
export function oddsText(o) {
  let best = BOARD[0];
  for (const step of BOARD) if (step[0] <= o + 1e-9) best = step;
  return best[1];
}
// Morning-line odds snap to the nearest step.
export function snapOdds(o) {
  let best = LADDER[0], d = Infinity;
  for (const step of LADDER) { const dd = Math.abs(Math.log((step[0] + 1) / (o + 1))); if (dd < d) { d = dd; best = step; } }
  return best;
}
export function oddsValue(text) {
  const [a, b] = text.split('-').map(Number);
  return a / b;
}

// A morning line prints nothing longer than 50-1: a line maker's prices stop about there, and "99-1" on a
// program is a typo. The price itself stays as it was worked out, since the early money reads it.
const LINE_LONGEST = 50;
export function lineText(price, text) {
  return price > LINE_LONGEST ? `${LINE_LONGEST}-1` : text;
}

// The track handicapper's morning line: a fair book plus about 20%. For each horse, [the price, as printed].
export function morningLine(race, horses) {
  const ratings = race.entries.map(e => publicRating(horses[e.hid], race, e, horses));
  const p = probsFrom(ratings, 0.15);
  return p.map(x => { const [price, text] = snapOdds(1 / (x * 1.2) - 1); return [price, lineText(price, text)]; });
}
