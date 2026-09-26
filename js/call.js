// The race caller. Reads the recorded race as it unfolds (never ahead of the moment it's calling)
// and produces lines of commentary with the time each one starts.

import { stateAt } from './sim.js';
import { segmentAt, LENGTH, FURLONG } from './track.js';
import { rng } from './rng.js';
import { marginText, lengthsText } from './chart.js';

const SAY_NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function secsWords(t) {
  // 22.43 -> "twenty-two and two"; 45.9 -> "forty-five and four"
  const whole = Math.floor(t);
  const fifth = Math.min(4, Math.floor((t - whole) * 5));
  return `${whole}${fifth ? ` and ${fifth}` : ' flat'}`;
}
function timeWords(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${s.toFixed(2).padStart(5, '0')}` : `${s.toFixed(2)}`;
}

function gapWords(l) {
  if (l < 0.35) return 'a head';
  if (l < 0.8) return 'a half length';
  if (l < 1.3) return 'a length';
  if (l < 1.8) return 'a length and a half';
  if (l < 2.4) return 'two lengths';
  if (l < 3.5) return 'three lengths';
  return `${Math.round(l)} lengths`;
}

export function raceCall(race, run, names) {
  const R = rng(`call:${race.seed}`);
  const lines = [];
  const say = (t, text, kind = 'call') => lines.push({ t, text, kind });
  const D = run.distance;
  const t0 = run.t0;
  const at = t => stateAt(run, t0 + t);
  const ordered = st => st.map((s, i) => ({ ...s, i })).sort((a, b) => b.p - a.p);
  const nm = i => names[i];
  const lead = st => ordered(st)[0];
  const behind = (st, a, b) => (st[a].p - st[b].p) / LENGTH;
  const dur = run.frames.length * run.dt - t0;
  const finishT = run.finalTime;

  say(-t0 - 2.6, race.name ? `The field is in the gate for the ${race.name}.` : `The field is in the gate.`, 'pre');
  say(-t0, 'And they\'re off!', 'off');

  // The break.
  const bad = run.results.filter(r => r.stumble).map(r => r.h);
  const slow = run.results.filter(r => r.slow).map(r => r.h);
  if (bad.length) say(1.2, `${nm(bad[0])} stumbles at the start!`);
  else if (slow.length) say(1.2, `${nm(slow[0])} broke a step slow.`);
  else if (R.chance(0.5)) say(1.2, 'A clean break for all of them.');

  // First call: who went to the front.
  const firstT = Math.min(9, finishT * 0.12);
  {
    const st = at(firstT);
    const o = ordered(st);
    const a = o[0], b = o[1], c = o[2];
    const g = (a.p - b.p) / LENGTH;
    const verb = R.pick(['goes right to the front', 'shoots to the lead', 'takes them along']);
    const text = g > 1.2
      ? `${nm(a.i)} ${verb}. ${nm(b.i)} second, ${nm(c.i)} third.`
      : `${nm(a.i)} and ${nm(b.i)} vie for the early lead, ${nm(c.i)} right there.`;
    say(firstT, text);
  }

  // Fractions.
  const par = D < 1300 ? 22.6 : 23.8;
  const frs = run.fractions.filter(f => f.at < D - 1);
  frs.slice(0, 2).forEach((f, k) => {
    if (f.t > finishT - 6) return;
    const label = k === 0 ? 'The quarter' : 'The half';
    const pace = k === 0 ? (f.t < par - 0.6 ? ', a fast pace' : f.t > par + 0.8 ? ', nice and easy up front' : '') : '';
    say(f.t + 0.3, `${label} in ${secsWords(f.t)}${pace}.`, 'frac');
  });

  // Running calls every few seconds until the top of the stretch.
  const path = run.path;
  const stretchStart = path[path.length - 1].start;
  let lastLeader = lead(at(firstT)).i;
  let lastSeg = null;
  let nextFree = firstT + 4.5;
  const moveSeen = new Set();
  let troubleCalls = 0;
  for (let t = firstT + 1; t < finishT - 0.2; t += 0.5) {
    const st = at(t);
    const o = ordered(st);
    const L = o[0];
    const seg = segmentAt(path, L.p);
    const inStretch = L.p >= stretchStart;
    const toGo = D - L.p;
    if (t < nextFree) continue;

    // Lead change.
    if (L.i !== lastLeader && (L.p - o[1].p) / LENGTH > 0.25) {
      say(t, R.pick([`${nm(L.i)} takes over!`, `${nm(L.i)} goes by and takes the lead!`, `And now it's ${nm(L.i)} in front!`]));
      lastLeader = L.i; nextFree = t + 3.2; continue;
    }
    // Someone on the move from the back.
    if (!inStretch || toGo > 120) {
      const past = at(t - 4);
      const po = ordered(past).map(x => x.i);
      const mover = o.find((x, k) => k > 0 && po.indexOf(x.i) - k >= 3 && !moveSeen.has(x.i));
      if (mover) {
        moveSeen.add(mover.i);
        const wide = Math.round(mover.o) + 1;
        say(t, wide >= 4 ? `${nm(mover.i)} is moving, ${SAY_NUM[wide] || wide} wide!` : `${nm(mover.i)} is making a run on the inside!`);
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
      const gap = (L.p - o[1].p) / LENGTH;
      const where = { backstretch: 'Down the backstretch', 'far turn': 'Around the far turn', 'clubhouse turn': 'Into the clubhouse turn', stretch: 'Past the stands' }[seg.name] || 'Up front';
      const tail = o[o.length - 1];
      const extra = R.chance(0.5) ? ` ${nm(o[2].i)} is third, and ${nm(tail.i)} brings up the rear.` : ` ${nm(o[2].i)} sits third.`;
      say(t, `${where}, ${nm(L.i)} leads by ${gapWords(gap)}. ${nm(o[1].i)} second.${extra}`);
      nextFree = t + 4.5; continue;
    }
    if (inStretch && lastSeg !== 'home') {
      lastSeg = 'home';
      const gap = (L.p - o[1].p) / LENGTH;
      const closers = o.slice(1, 5).filter(x => x.v > L.v + 0.3).map(x => x.i);
      const tail = closers.length ? ` ${nm(closers[0])} ${R.pick(['is coming!', 'is flying on the outside!', 'is charging!'])}` : '';
      say(t, `Turning for home, it's ${nm(L.i)} by ${gapWords(gap)}.${tail}`);
      nextFree = t + 3.5; continue;
    }
    if (inStretch && toGo < FURLONG + 20 && toGo > FURLONG - 40 && !moveSeen.has('eighth')) {
      moveSeen.add('eighth');
      const gap = (L.p - o[1].p) / LENGTH;
      say(t, gap < 0.5 ? `At the eighth pole, ${nm(L.i)} and ${nm(o[1].i)} are head and head!` : `A furlong to go, ${nm(L.i)} leads by ${gapWords(gap)}, ${nm(o[1].i)} chasing.`);
      nextFree = t + 3; continue;
    }
    if (inStretch && toGo < 110 && toGo > 45 && !moveSeen.has('late')) {
      moveSeen.add('late');
      const gap = (L.p - o[1].p) / LENGTH;
      const fast = o.slice(1, 4).find(x => x.v > L.v + 0.5);
      say(t, gap < 0.6 ? `${nm(L.i)}, ${nm(o[1].i)}, it's a battle to the wire!` : fast ? `${nm(fast.i)} closing fast, but ${nm(L.i)} still in front!` : R.pick([`${nm(L.i)}, clear and drawing away!`, `They won't catch ${nm(L.i)} today!`]));
      nextFree = t + 2.4; continue;
    }
  }

  // The finish.
  const [w, s, th] = run.results;
  const photo = s && s.toPrev < 0.3;
  if (photo) {
    say(finishT + 0.1, `${nm(w.h)} and ${nm(s.h)} hit the wire together. It's a photo!`, 'finish');
  } else {
    const m = s ? s.toPrev : 0;
    const how = m > 6 ? `in a romp, by ${Math.round(m)} lengths!` : m > 2.5 ? `by ${gapWords(m)}, going away!` : m < 0.6 ? 'by a whisker!' : `by ${gapWords(m)}!`;
    say(finishT + 0.1, `${nm(w.h)} wins it ${how}`, 'finish');
  }
  if (s && th) say(finishT + 3.2, `${nm(s.h)} ${photo ? 'in the photo' : 'second'}, ${nm(th.h)} third. The time, ${timeWords(finishT)}.`, 'finish');
  lines.sort((a, b) => a.t - b.t);
  // Keep lines from crowding each other.
  for (let i = 1; i < lines.length; i++) if (lines[i].t < lines[i - 1].t + 1.8 && lines[i].kind !== 'finish') lines[i].t = lines[i - 1].t + 1.8;
  return { lines, photo: !!photo, dur };
}

export function marginPhrase(l) { return marginText(l); }
export { lengthsText };
