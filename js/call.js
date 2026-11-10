// The race caller. Reads the recorded race as it unfolds (never ahead of the moment it's calling)
// and produces lines of commentary with the time each one starts. A line is worded from the race as it
// stands at that time and is never moved afterwards, so what it says is true when it comes up.

import { stateAt, RAIL } from './sim.js';
import { segmentAt, LENGTH, FURLONG } from './track.js';
import { rng } from './rng.js';
import { marginText, lengthsText } from './chart.js';

// Numbers in words, since the voice reads the call: "twenty-two", and "oh" for a nought.
const ONES = ['oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${numWords(n % 100)}` : ''}`;
}
const lengthsWords = n => `${numWords(n)} lengths`;

// Paths off the rail (the chart's measure: a horse on the rail is at 0, in the fourth path at 3).
// "On the outside" is the fourth path or wider, "on the inside" and "up the rail" the rail path.
const OUTSIDE = 2.5, INSIDE = 0.8;
// Running calls keep this many seconds clear of a fraction's line, before and after.
const CLEAR = 1.8;

// A caller gives a time in fifths of a second, and a part of a fifth is dropped: 22.59 is "22 and 2".
// The fifths come from the time as the clock shows it, to the hundredth, so the two never disagree
// (22.996 is 23.00 on the clock, and "23 flat").
function fifths(t) {
  const h = Math.round(t * 100);
  return { min: Math.floor(h / 6000), sec: Math.floor((h % 6000) / 100), fifth: Math.floor((h % 100) / 20) };
}
// A fraction as the call box shows it: 22.43 -> "22 and 2"; 47.1 -> "47 flat".
function secsWords(t) {
  const { min, sec, fifth } = fifths(t);
  return `${min * 60 + sec}${fifth ? ` and ${fifth}` : ' flat'}`;
}
// Any time as it's said aloud, the quarter, the half and the final time alike: 22.6 -> "twenty-two and
// three", 77.55 -> "one seventeen and two", 63.37 -> "one oh three and one", 60 -> "one minute flat".
export function timeSay(t) {
  const { min, sec, fifth } = fifths(t);
  const tail = fifth ? ` and ${numWords(fifth)}` : ' flat';
  if (!min) return `${numWords(sec)}${tail}`;
  if (!sec) return `${numWords(min)} minute${min > 1 ? 's' : ''}${tail}`;
  return `${numWords(min)} ${sec < 10 ? 'oh ' : ''}${numWords(sec)}${tail}`;
}
// The final time as the call box shows it, to the hundredth. Rounded before it's split into minutes and
// seconds, so it never says 1:60.00.
export function timeWords(t) {
  const h = Math.round(t * 100);
  const m = Math.floor(h / 6000);
  const s = (h % 6000) / 100;
  return m ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}
// A line as the voice is given it. A title is spelt out, since "Dr." has a full stop that a voice
// takes for the end of a sentence.
export function aloud(text) {
  return text.replace(/\bDr\. /g, 'Doctor ');
}

// A gap during the running, as a caller judges it by eye.
function gapWords(l) {
  if (l < 0.35) return 'a head';
  if (l < 0.8) return 'a half length';
  if (l < 1.3) return 'a length';
  if (l < 1.8) return 'a length and a half';
  return lengthsWords(Math.max(2, Math.round(l)));
}

// The winning margin, in the chart's terms: a nose, a head, a neck, then to the quarter of a length up to
// two lengths (as the running order and the chart show it), and whole lengths from there.
export function finishWords(l) {
  if (l < 0.06) return 'a nose';
  if (l < 0.18) return 'a head';
  const q = Math.round(l * 4) / 4;
  if (q <= 0.25) return 'a neck';
  if (q < 2) {
    return { 0.5: 'a half length', 0.75: 'three quarters of a length', 1: 'a length', 1.25: 'a length and a quarter', 1.5: 'a length and a half', 1.75: 'a length and three quarters' }[q];
  }
  return lengthsWords(Math.round(l));
}

// How long a line may wait to be said, in seconds, when the voice is still on the line before: after
// that it's old news and is left out. "And they're off!" and the call at the wire belong to their moment,
// a lead change nearly so, and the placings and the time can follow whenever the winner's line is done.
const LATE = { off: 0.3, wire: 0.3, change: 1.0, other: 1.5, placings: 6 };

// How a line is delivered: how fast, and how high. The pace is steady until about 33 seconds from the
// wire and climbs from there, the way a call builds through the far turn and the stretch: 1.25 times the
// voice's own speed rising to 1.6, with the pitch a little higher too. Before the start it's slower, and
// after the wire it's back to the steady pace for the placings and the time. (These numbers come from a
// model of how long a voice takes over a line, not from listening.) `toWire` is seconds to the wire.
export function pace(line, toWire) {
  if (line.kind === 'pre') return { rate: 1.15, pitch: 1 };
  if (line.kind === 'finish' && !line.wire) return { rate: 1.25, pitch: 1 };
  const k = line.wire ? 1 : Math.max(0, Math.min(1, 1 - (toWire - 3) / 30));
  return { rate: +(1.25 + 0.35 * k).toFixed(3), pitch: +(1 + 0.12 * k).toFixed(3) };
}

// After a photo, the winner's line that goes with the official sign, as a line of the call.
export function officialLine(text) {
  return { text, say: aloud(text), kind: 'finish', late: LATE.placings, rank: 1 };
}
// A line like the ones in a call, for trying a voice out in the menu.
export const SAMPLE = { text: "Turning for home, it's Copper Detour by a length and a half!", kind: 'call', late: LATE.other, rank: 0 };

// Each line is { t, text, say, kind, late, rank }: `text` is what the call box shows and `say` is the same
// line as the voice is given it, with times in words. `late` is how long the voice may be behind with it
// (see LATE) and `rank` is 1 for the lines that take the place of another line waiting to be said: the
// off, a lead change and the call at the wire, which is also marked `wire` (the last line, with the time,
// is marked `placings`). For the tests, a line also
// has what it claims: `lead` is the horse it names as the leader, `change` marks a lead change, `who` is
// a horse it says something else about (making a move, closing), and `sure` is the horse it says has the
// race won.
export function raceCall(race, run, names) {
  const R = rng(`call:${race.seed}`);
  const lines = [];
  const say = (t, text, kind = 'call', claims = null, spoken = text) => {
    const urgent = kind === 'off' ? 'off' : claims?.wire ? 'wire' : claims?.change ? 'change' : null;
    lines.push({ t, text, say: aloud(spoken), kind, late: LATE[urgent || (claims?.placings ? 'placings' : 'other')], rank: urgent ? 1 : 0, ...claims });
  };
  const D = run.distance;
  const t0 = run.t0;
  const at = t => stateAt(run, t0 + t);
  const ordered = st => st.map((s, i) => ({ ...s, i })).sort((a, b) => b.p - a.p);
  const nm = i => names[i];
  const lead = st => ordered(st)[0];
  const dur = run.frames.length * run.dt - t0;
  const finishT = run.finalTime;

  // A race's name takes the voice a while ("The field is in the gate for the Odds and Ends Handicap." is
  // about three seconds), so that line comes up sooner than the plain one, to be done by the off.
  say(-t0 - (race.name ? 3.4 : 2.6), race.name ? `The field is in the gate for the ${race.name}.` : `The field is in the gate.`, 'pre');
  say(-t0, 'And they\'re off!', 'off');

  // The break. It's a clean one only if nobody stumbled, broke slowly or was bumped.
  const bad = run.results.filter(r => r.stumble).map(r => r.h);
  const slow = run.results.filter(r => r.slow).map(r => r.h);
  const bumped = run.results.some(r => r.bumped);
  if (bad.length) say(1.2, `${nm(bad[0])} stumbles at the start!`);
  else if (slow.length) say(1.2, `${nm(slow[0])} broke a step slow.`);
  else if (R.chance(0.5) && !bumped) say(1.2, 'A clean break for all of them.');

  // First call: who went to the front.
  const firstT = Math.min(9, finishT * 0.12);
  let lastLeader; // the horse the caller last named as the leader
  {
    const st = at(firstT);
    const o = ordered(st);
    const a = o[0], b = o[1], c = o[2]; // a field of one or two has no b or c
    const g = b ? (a.p - b.p) / LENGTH : Infinity;
    const verb = R.pick(['goes right to the front', 'shoots to the lead', 'takes them along']);
    const text = g > 1.2
      ? `${nm(a.i)} ${verb}.${b ? ` ${nm(b.i)} second${c ? `, ${nm(c.i)} third` : ''}.` : ''}`
      : `${nm(a.i)} and ${nm(b.i)} vie for the early lead${c ? `, ${nm(c.i)} right there` : ''}.`;
    say(firstT, text, 'call', { lead: a.i });
    lastLeader = a.i;
  }

  // Fractions. The opening quarter is fast or slow against a usual one for the distance: sprints go off
  // quicker than routes.
  const furlongs = D / FURLONG;
  const par = furlongs < 6.25 ? 22.9 : furlongs < 7.25 ? 23.2 : 23.7;
  const frs = run.fractions.filter(f => f.at < D - 1);
  const fracAt = [];
  frs.slice(0, 2).forEach((f, k) => {
    // In a five-furlong race the half comes up at the eighth pole, where the stretch call belongs: the
    // clock shows it, and the caller calls the race.
    if (f.t > finishT - 6 || D - f.at < FURLONG * 1.25) return;
    const label = k === 0 ? 'The quarter' : 'The half';
    const pace = k === 0 ? (f.t < par - 0.6 ? ', a fast pace' : f.t > par + 0.8 ? ', nice and easy up front' : '') : '';
    fracAt.push(f.t + 0.3);
    const line = time => `${label} in ${time}${pace}.`;
    say(f.t + 0.3, line(secsWords(f.t)), 'frac', null, line(timeSay(f.t)));
  });

  // Running calls every few seconds until the wire. Each is made from the race as it stands at its own
  // time, in a moment that's clear of the line before and of the fractions.
  const path = run.path;
  const stretchStart = path[path.length - 1].start;
  let lastSeg = null;
  let nextFree = firstT + 4.5;
  const moveSeen = new Set();
  let troubleCalls = 0;
  for (let t = firstT + 1; t < finishT - 0.2; t += 0.5) {
    if (t < nextFree || fracAt.some(ft => Math.abs(t - ft) < CLEAR)) continue;
    const st = at(t);
    const o = ordered(st);
    const L = o[0];
    const seg = segmentAt(path, L.p);
    const inStretch = L.p >= stretchStart;
    const toGo = D - L.p;

    // Lead change: a new horse in front of the one last named as the leader.
    if (L.i !== lastLeader && (L.p - o[1].p) / LENGTH > 0.25) {
      say(t, R.pick([`${nm(L.i)} takes over!`, `${nm(L.i)} goes by and takes the lead!`, `And now it's ${nm(L.i)} in front!`]), 'call', { lead: L.i, change: true });
      lastLeader = L.i; nextFree = t + 3.2; continue;
    }
    // Someone on the move from the back.
    if (!inStretch || toGo > 120) {
      const past = at(t - 4);
      const po = ordered(past).map(x => x.i);
      const mover = o.find((x, k) => k > 0 && po.indexOf(x.i) - k >= 3 && !moveSeen.has(x.i));
      if (mover) {
        moveSeen.add(mover.i);
        const off = mover.o - RAIL;
        const wide = Math.round(off) + 1; // its path, counted the way the chart counts it
        say(t, off >= OUTSIDE ? `${nm(mover.i)} is moving, ${numWords(wide)} wide!`
          : off < INSIDE ? `${nm(mover.i)} is making a run on the inside!`
          : `${nm(mover.i)} is making a run!`, 'call', { who: mover.i });
        nextFree = t + 3.2; continue;
      }
    }
    // Trouble.
    const blocked = troubleCalls < 2 && run.events.find(e => e.type === 'checked' && Math.abs(e.t - (t0 + t)) < 0.6);
    if (blocked && o.findIndex(x => x.i === blocked.h) < (inStretch ? 4 : 5)) {
      troubleCalls++;
      say(t, R.pick([`${nm(blocked.h)} has to check, nowhere to go!`, `${nm(blocked.h)} is stuck behind horses!`]));
      nextFree = t + 3; continue;
    }

    if (!inStretch && seg.name !== lastSeg && seg.name !== 'chute') {
      lastSeg = seg.name;
      const where = { backstretch: 'Down the backstretch', 'far turn': 'Around the far turn', 'clubhouse turn': 'Into the clubhouse turn', stretch: 'Past the stands' }[seg.name] || 'Up front';
      const tail = o[o.length - 1];
      const rear = R.chance(0.5) && o.length > 3;
      const extra = !o[2] ? '' : rear ? ` ${nm(o[2].i)} is third, and ${nm(tail.i)} brings up the rear.` : ` ${nm(o[2].i)} sits third.`;
      say(t, o[1] ? `${where}, ${nm(L.i)} leads by ${gapWords((L.p - o[1].p) / LENGTH)}. ${nm(o[1].i)} second.${extra}` : `${where}, ${nm(L.i)} all alone.`, 'call', { lead: L.i });
      lastLeader = L.i; nextFree = t + 4.5; continue;
    }
    if (inStretch && lastSeg !== 'home') {
      lastSeg = 'home';
      // The first of the next four that's running faster than the leader, and where it's doing it.
      const c = o.slice(1, 5).find(x => x.v > L.v + 0.3);
      const off = c ? c.o - RAIL : 0;
      const how = c && R.pick(off >= OUTSIDE ? ['is coming!', 'is flying on the outside!', 'is charging!']
        : off < INSIDE ? ['is coming!', 'is coming up the rail!', 'is charging!']
        : ['is coming!', 'is flying!', 'is charging!']);
      const tail = c ? ` ${nm(c.i)} ${how}` : '';
      say(t, o[1] ? `Turning for home, it's ${nm(L.i)} by ${gapWords((L.p - o[1].p) / LENGTH)}.${tail}` : `Turning for home, it's ${nm(L.i)} all alone.`, 'call', c ? { lead: L.i, who: c.i } : { lead: L.i });
      lastLeader = L.i; nextFree = t + 3.5; continue;
    }
    if (!o[1]) continue; // the rest of the stretch calls are about who's chasing
    if (inStretch && toGo < FURLONG + 20 && toGo > FURLONG - 40 && !moveSeen.has('eighth')) {
      moveSeen.add('eighth');
      const gap = (L.p - o[1].p) / LENGTH;
      say(t, gap < 0.5 ? `At the eighth pole, ${nm(L.i)} and ${nm(o[1].i)} are head and head!` : `A furlong to go, ${nm(L.i)} leads by ${gapWords(gap)}, ${nm(o[1].i)} chasing.`, 'call', { lead: L.i });
      lastLeader = L.i; nextFree = t + 3; continue;
    }
    if (inStretch && toGo < 110 && toGo > 45 && !moveSeen.has('late')) {
      moveSeen.add('late');
      const gap = (L.p - o[1].p) / LENGTH;
      // The caller only sounds sure of a lead of a length and a half or more that hasn't shrunk in the
      // last second; anything less can still end in a photo, or with the leader caught.
      const ago = at(t - 1);
      const was = (ago[L.i].p - Math.max(...ago.filter((x, i) => i !== L.i).map(x => x.p))) / LENGTH;
      const sure = gap >= 1.5 && gap >= was;
      // Short of that, a horse is called closing only if it's running faster than the leader right now;
      // when none of the next three is, the caller says the leader is still in front, and by how much.
      const fast = o.slice(1, 4).find(x => x.v > L.v + 0.5);
      const chaser = fast || o.slice(1, 4).filter(x => x.v > L.v).reduce((a, b) => (!a || b.v > a.v ? b : a), null);
      // "Closing fast" is for a horse within three lengths. One further back than that isn't going to
      // get there: if the leader is three clear of them all and, at the speeds they're going now, nobody
      // gets within a length and a half by the wire, the leader is home free and the closer is running
      // for second.
      const back = chaser ? (L.p - chaser.p) / LENGTH : 0;
      const secs = toGo / Math.max(1, L.v);
      const safe = gap >= 3 && o.slice(1).every(x => L.p - x.p - (x.v - L.v) * secs >= 1.5 * LENGTH);
      const claims = { lead: L.i };
      let text;
      if (gap < 0.6) text = `${nm(L.i)}, ${nm(o[1].i)}, it's a battle to the wire!`;
      else if (chaser && (fast || !sure) && back < 3) { text = `${nm(chaser.i)} closing fast, but ${nm(L.i)} still in front!`; claims.who = chaser.i; }
      else if (chaser && (fast || !sure) && safe) { text = `${nm(L.i)} is home free, ${nm(chaser.i)} running on for second.`; claims.sure = L.i; }
      else if (!sure || chaser && fast) text = `${nm(L.i)} still in front by ${gapWords(gap)}!`;
      else { text = R.pick([`${nm(L.i)}, clear and drawing away!`, `They won't catch ${nm(L.i)} today!`]); claims.sure = L.i; }
      say(t, text, 'call', claims);
      lastLeader = L.i; nextFree = t + 2.4; continue;
    }
  }

  // The finish.
  const [w, s, th] = run.results;
  const photo = s && s.toPrev < 0.3;
  // In a photo the caller doesn't know who won until the picture is read, so no line with a time on it
  // says: the two are named in an order picked by a coin toss, and the winner's line is handed back on
  // its own, for when the official sign goes up.
  let official = null;
  if (photo) {
    const [a, b] = R.chance(0.5) ? [w, s] : [s, w];
    say(finishT + 0.1, `${nm(a.h)} and ${nm(b.h)} hit the wire together. It's a photo!`, 'finish', { wire: true });
    const line = time => `They'll need the photo for ${nm(a.h)} and ${nm(b.h)}.${th ? ` ${nm(th.h)} is third.` : ''} The time, ${time}.`;
    say(finishT + 3.2, line(timeWords(finishT)), 'finish', { placings: true }, line(timeSay(finishT)));
    official = `It's ${nm(w.h)}, by ${finishWords(s.toPrev)}!`;
  } else {
    const m = s ? s.toPrev : 0;
    // "Going away" is for a winner still running at least as fast as the runner-up at the wire.
    const how = !s ? 'all alone!' : m > 6 ? `in a romp, by ${finishWords(m)}!` : m > 2.5 && w.finishSpeed >= s.finishSpeed ? `by ${finishWords(m)}, going away!` : `by ${finishWords(m)}!`;
    // A winner who wasn't in front a second before the wire got up in the last strides.
    const late = s && lead(at(finishT - 1)).i !== w.h;
    say(finishT + 0.1, `${nm(w.h)} ${late ? 'gets up to win it' : 'wins it'} ${how}`, 'finish', { wire: true });
    const placed = [s && `${nm(s.h)} second`, th && `${nm(th.h)} third`].filter(Boolean).join(', ');
    const line = time => `${placed ? `${placed}. ` : ''}The time, ${time}.`;
    say(finishT + 3.2, line(timeWords(finishT)), 'finish', { placings: true }, line(timeSay(finishT)));
  }
  lines.sort((a, b) => a.t - b.t);
  return { lines, photo: !!photo, official, dur };
}

export function marginPhrase(l) { return marginText(l); }
export { lengthsText };
