// Turning a recorded race into words: the short comment in a horse's past performances,
// the running line (positions and lengths at each call), and margins like "nk" and "3¼".

import { LENGTH } from './track.js';

export function marginText(l) {
  if (l < 0.06) return 'nose';
  if (l < 0.18) return 'head';
  if (l < 0.32) return 'neck';
  return lengthsText(l);
}
export function marginShort(l) {
  if (l < 0.06) return 'no';
  if (l < 0.18) return 'hd';
  if (l < 0.32) return 'nk';
  return lengthsShort(l);
}
function lengthsShort(l) {
  const q = Math.round(l * 4) / 4;
  const whole = Math.floor(q);
  const frac = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[q - whole];
  return `${whole || ''}${frac}` || '¼';
}
export function lengthsText(l) {
  const s = lengthsShort(l);
  return l > 1.1 ? `${s} lengths` : `${s} length`;
}

// Positions at each call, and lengths behind the horse in front (for the leader: lengths in front).
export function runningLine(run, k) {
  const line = run.calls.map(c => {
    if (!c) return null;
    const idx = c.findIndex(x => x.h === k);
    const pos = idx + 1;
    const margin = idx === 0 ? (c[1] ? c[1].behind : 0) : c[idx].behind - c[idx - 1].behind;
    return [pos, +margin.toFixed(2)];
  });
  const r = run.results.find(x => x.h === k);
  const fin = r.pos === 1 ? (run.results[1] ? run.results[1].toPrev : 0) : r.toPrev;
  line.push([r.pos, +fin.toFixed(2)]);
  return line;
}

export function callText([pos, margin]) {
  return `${pos}${margin > 0.03 ? marginShort(margin) : ''}`;
}

// A few words on the trip, the way a chart caller writes them.
export function tripComment(run, k, fieldSize) {
  const r = run.results.find(x => x.h === k);
  const line = runningLine(run, k);
  const first = line[0] ? line[0][0] : r.pos;
  const str = line[2] ? line[2][0] : r.pos;
  const won = r.pos === 1;
  const margin = won ? (run.results[1] ? run.results[1].toPrev : 0) : r.behind;
  const paths = Math.round(r.wide / 1.0) + 1;
  const bits = [];

  if (r.stumble) bits.push('Stumbled start');
  else if (r.slow) bits.push('Broke slowly');
  else if (r.bumped) bits.push('Bumped start');

  if (r.checked > 0) bits.push(r.pos <= 3 ? 'Checked, rallied' : 'Checked in traffic');
  else if (r.blocked > 3.5) bits.push(r.pos <= 3 ? 'Blocked, finished well' : 'Blocked stretch');

  if (won) {
    if (first === 1 && str === 1) bits.push(margin > 3 ? 'Wire to wire, drew off' : margin < 0.35 ? 'Set pace, just held' : 'Set pace, held sway');
    else if (r.duel > 6) bits.push('Dueled, prevailed');
    else if (first >= Math.max(4, fieldSize / 2)) bits.push(paths >= 4 ? `Rallied ${paths} wide` : margin < 0.4 ? 'Up in time' : 'Rallied, going away');
    else if (margin > 4) bits.push('Much the best');
    else if (margin < 0.35) bits.push('Gamely');
    else bits.push(paths >= 4 ? `Pressed ${paths} wide, clear` : 'Stalked, drew clear');
  } else {
    const gained = first - r.pos;
    if (first === 1 && r.pos >= 4) bits.push(r.duel > 6 ? 'Dueled, gave way' : 'Set pace, faded');
    else if (first === 1) bits.push(r.pos === 2 ? 'Set pace, caught late' : 'Set pace, weakened');
    else if (first <= 3 && r.pos >= fieldSize - 1) bits.push(r.emptied > 150 ? 'Chased, stopped' : 'Chased, tired');
    else if (gained >= 4 && r.pos <= 3) bits.push(paths >= 4 ? `Rallied ${paths} wide` : 'Closed well');
    else if (gained >= 3) bits.push('Late gain');
    else if (r.pos <= 3 && first <= 3) bits.push('Stalked, no rally');
    else if (paths >= 4) bits.push(`${paths} wide, no rally`);
    else if (r.pos >= fieldSize - 1) bits.push(r.behind > 12 ? 'Outrun' : 'No factor');
    else if (r.wide < 0.6 && !bits.length) bits.push('Saved ground, even');
    else bits.push('Even trip');
  }
  // Two short notes if they fit, otherwise the first (trouble comes first, it's what matters).
  const both = bits.slice(0, 2).join('; ');
  return both.length <= 34 ? both : bits[0];
}

// "3-1-0" style helpers
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtTime(t) {
  if (t == null) return '';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `:${s.toFixed(2).padStart(5, '0')}`;
}

export const LENGTH_M = LENGTH;
