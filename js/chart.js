// Turning a recorded race into words: the short comment in a horse's past performances,
// the running line (positions and lengths at each call), and margins like "nk" and "3¼".

import { LENGTH } from './track.js';

// A margin the way a chart prints it: a nose, a head, a neck, then half a length, three quarters, a length,
// a length and a quarter and on by quarters. No chart has a bare quarter of a length: a neck runs up to
// three eighths, where half a length begins. (It used to stop at 0.32, and anything from there to 0.375
// printed as "¼".)
const NOSE = 0.06, HEAD = 0.18, NECK = 0.375;
export function marginText(l) {
  if (l < NOSE) return 'nose';
  if (l < HEAD) return 'head';
  if (l < NECK) return 'neck';
  return lengthsText(l);
}
export function marginShort(l) {
  if (l < NOSE) return 'no';
  if (l < HEAD) return 'hd';
  if (l < NECK) return 'nk';
  return lengthsShort(l);
}
// Lengths to the nearest quarter, and never less than half a length.
const quarters = l => Math.max(0.5, Math.round(l * 4) / 4);
function lengthsShort(l) {
  const q = quarters(l);
  const whole = Math.floor(q);
  return `${whole || ''}${{ 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[q - whole]}`;
}
// "1 length", "1¼ lengths": the plural goes with the number as printed.
export function lengthsText(l) {
  return `${lengthsShort(l)} length${quarters(l) > 1 ? 's' : ''}`;
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

// A few words on the trip, the way a chart caller writes them: any trouble first, then how the horse ran.
// The ratings, the Troubled trip chip and LongshotLou look for the trouble words as written here: Stumbled,
// Broke slowly, Bumped, Checked, Blocked (and Lou for "wide").
export function tripComment(run, k, fieldSize) {
  const r = run.results.find(x => x.h === k);
  const line = runningLine(run, k);
  const first = line[0] ? line[0][0] : r.pos;
  const str = line[2] ? line[2][0] : r.pos;
  const won = r.pos === 1;
  const margin = won ? (run.results[1] ? run.results[1].toPrev : 0) : r.behind;
  const paths = Math.round(r.wide / 1.0) + 1;
  // Second or third and within a neck of the winner: it nearly won, whatever else is true of its trip.
  // (More than half of those were written off as "Even trip" or "Stalked, no rally".)
  const near = !won && r.pos <= 3 && r.behind < NECK ? (r.behind < NOSE ? 'missed by a nose' : 'just missed') : null;
  const bits = [];

  if (r.stumble) bits.push('Stumbled start');
  else if (r.slow) bits.push('Broke slowly');
  else if (r.bumped) bits.push('Bumped start');

  if (r.checked > 0) bits.push(r.pos <= 3 ? `Checked, ${near || 'rallied'}` : 'Checked in traffic');
  else if (r.blocked > 3.5) bits.push(r.pos <= 3 ? `Blocked, ${near || 'finished well'}` : 'Blocked stretch');
  // For a horse placed second or third that note has said how it finished, and nothing after it says it
  // again or takes it back ("Checked, rallied; Even trip" was on a dozen lines a meet).
  const told = !won && r.pos <= 3 && (r.checked > 0 || r.blocked > 3.5);

  if (won) {
    if (first === 1 && str === 1) bits.push(margin > 3 ? 'Wire to wire, drew off' : margin < 0.35 ? 'Set pace, just held' : 'Set pace, held sway');
    else if (r.duel > 6) bits.push('Dueled, prevailed');
    else if (first >= Math.max(4, fieldSize / 2)) bits.push(paths >= 4 ? `Rallied ${paths} wide` : margin < 0.4 ? 'Up in time' : 'Rallied, going away');
    else if (margin > 4) bits.push('Much the best');
    else if (margin < 0.35) bits.push('Gamely');
    else bits.push(paths >= 4 ? `Pressed ${paths} wide, clear` : 'Stalked, drew clear');
  } else if (!told) {
    const gained = first - r.pos; // places made up between the first call and the wire
    const third = run.results[2];
    const place = r.pos === 2 ? 'place' : 'show';
    if (first === 1 && r.pos >= 4) bits.push(r.duel > 6 ? 'Dueled, gave way' : 'Set pace, faded');
    else if (first === 1) bits.push(near ? `Set pace, ${near}` : r.pos === 3 ? 'Set pace, weakened' : str === 1 ? 'Set pace, caught late' : 'Set pace, held place');
    else if (first <= 3 && r.pos >= fieldSize - 1) bits.push(r.emptied > 150 ? 'Chased, stopped' : 'Chased, tired');
    else if (gained >= 4 && r.pos <= 3 && paths >= 4) bits.push(`Rallied ${paths} wide`);
    else if (near) bits.push(sentence(near));
    else if (gained >= 4 && r.pos <= 3) bits.push('Closed well');
    else if (gained >= 3) bits.push('Late gain');
    // A clear second: no match for the winner, and a length or more in front of the third.
    else if (r.pos === 2 && r.behind >= 1 && (!third || third.toPrev >= 1)) bits.push('Second best');
    // The rest of the placed horses, by the last furlong: passed one for the place, lost a place, or held it.
    else if (r.pos <= 3 && str > r.pos) bits.push(`Up for ${place}`);
    else if (r.pos <= 3 && gained < 0) bits.push('Stalked, weakened');
    else if (r.pos <= 3) bits.push(sentence(`${first <= 3 ? 'stalked, ' : ''}${str < r.pos ? 'outfinished' : gained > 0 || r.pos === 2 ? `held ${place}` : 'no rally'}`));
    else if (paths >= 4) bits.push(`${paths} wide, ${gained > 0 ? 'mild rally' : 'no rally'}`);
    else if (r.pos >= fieldSize - 1) bits.push(r.behind > 12 ? 'Outrun' : 'No factor');
    else {
      // The rest finished in mid-field. What's said is what happened between the first call and the wire:
      // passed a horse or two, lost a place or two, lost more, or neither (in the front half that's running
      // evenly; further back it's no rally). This used to be "Even trip" for all of them, a third of all lines.
      const how = gained > 0 ? 'Improved position' : gained <= -3 ? 'Faded' : gained < 0 ? 'Weakened' : r.pos <= fieldSize / 2 ? 'Evenly' : 'No rally';
      bits.push(r.wide < 0.6 && !bits.length ? `Saved ground, ${how.toLowerCase()}` : how);
    }
  }
  // Two short notes if they fit, otherwise the first (trouble comes first, it's what matters).
  const both = bits.slice(0, 2).join('; ');
  return both.length <= 34 ? both : bits[0];
}
const sentence = s => s[0].toUpperCase() + s.slice(1);

// "3-1-0" style helpers
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Times are rounded before they're split into minutes and seconds, so 59.996 reads 1:00.00, not :60.00.
export function fmtTime(t) {
  if (t == null) return '';
  const h = Math.round(t * 100);
  const m = Math.floor(h / 6000);
  const s = ((h % 6000) / 100).toFixed(2).padStart(5, '0');
  return m ? `${m}:${s}` : `:${s}`;
}
// The race clock, to a tenth: 1:12.4.
export function fmtClock(t) {
  const d = Math.round(t * 10);
  return `${Math.floor(d / 600)}:${((d % 600) / 10).toFixed(1).padStart(4, '0')}`;
}

// A workout's time, to the fifth of a second the way clockers give them: :36.4, 1:01.0. The time is kept to
// the tenth, and one that falls between two fifths is given the slower.
export function fmtWork(t) {
  const tenths = Math.round(Math.round(t * 10) / 2) * 2;
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return tenths >= 600 ? `${Math.floor(tenths / 600)}:${s}` : `:${s}`;
}

export const LENGTH_M = LENGTH;
