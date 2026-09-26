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
  if (!pps.length) return firstTimerGuess(h);
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

// A first-time starter: the public goes on workouts, pedigree and who trains it.
export function firstTimerGuess(h) {
  const sire = SIRES.find(s => s.name === h.sire);
  const works = h.works.slice(-3);
  const workScore = works.length ? works.reduce((s, w) => s + (w.rank / w.of < 0.2 ? 3 : w.rank / w.of < 0.5 ? 1 : -1), 0) : 0;
  return 64 + (sire ? sire.q * 1.5 : 0) + workScore;
}

export function surfaceRecord(h, surface) {
  const pps = h.pps.filter(p => p.surf === surface[0]);
  return { starts: pps.length, wins: pps.filter(p => p.fin === 1).length, best: pps.length ? Math.max(...pps.map(p => p.fig)) : null };
}

export function publicRating(h, race, entry) {
  let r = formRating(h, race);
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

// Odds as a track shows them: 3-5, 2-1, 7-2, 12-1.
const LADDER = [
  [0.2, '1-5'], [0.4, '2-5'], [0.5, '1-2'], [0.6, '3-5'], [0.8, '4-5'], [1, '1-1'], [1.2, '6-5'], [1.4, '7-5'],
  [1.5, '3-2'], [1.6, '8-5'], [1.8, '9-5'], [2, '2-1'], [2.5, '5-2'], [3, '3-1'], [3.5, '7-2'], [4, '4-1'],
  [4.5, '9-2'], [5, '5-1'], [6, '6-1'], [7, '7-1'], [8, '8-1'], [9, '9-1'], [10, '10-1'], [12, '12-1'],
  [15, '15-1'], [20, '20-1'], [30, '30-1'], [50, '50-1'], [99, '99-1'],
];
export function oddsText(o) {
  let best = LADDER[0];
  for (const step of LADDER) if (step[0] <= o + 1e-9) best = step;
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

// The track handicapper's morning line: a fair book plus about 20%.
export function morningLine(race, horses) {
  const ratings = race.entries.map(e => publicRating(horses[e.hid], race, e));
  const p = probsFrom(ratings, 0.15);
  return p.map(x => snapOdds(1 / (x * 1.2) - 1));
}
