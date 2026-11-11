// The race caller. Reads the recorded race as it unfolds (never ahead of the moment it's calling) and
// produces lines of commentary with the time each one starts. A line is worded from the race as it
// stands at that time and is never moved afterwards, so what it says is true when it comes up.
//
// The call is built as a schedule. What is coming is listed first, as times only: each change of
// leader, the fractions, the leader turning for home, a furlong out, the sixteenth pole, the wire. Then
// the race is walked. Each time the voice is free the caller looks at the race as it stands and says the
// most pressing thing, in the longest of its two or three forms that will be over before the next thing
// on the list. So the voice is seldom idle and never has two things to say at once.

import { stateAt, RAIL } from './sim.js';
import { segmentAt, LENGTH, FURLONG } from './track.js';
import { rng } from './rng.js';
import { marginText, lengthsText } from './chart.js';
import { sayTime } from './audio.js';

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
const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
  'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const nth = n => NTH[n] || `number ${numWords(n)}`;

// Paths off the rail (the chart's measure: a horse on the rail is at 0, in the fourth path at 3).
// "On the outside" is the fourth path or wider, "on the inside" and "on the rail" the rail path.
const OUTSIDE = 2.5, INSIDE = 0.8;
// A lead under a quarter of a length is nobody's: the two are called as a pair, and a change of leader is
// a new horse in front by that much.
const PAIR = 0.25;
// A gap in the field worth a mention, in lengths.
const GAP = 1.8;
// No line is longer than this, in seconds by the estimate: some voices stall on a long one.
const LONGEST = 8;
// The first run through the field comes this long after the off, once they've sorted themselves out, and
// by this long after it the first call has been made.
const FIRST = 4, CALLED = 8;

// A caller gives a time in fifths of a second, and a part of a fifth is dropped: 22.59 is "22 and 2".
// The fifths come from the time as the clock shows it, to the hundredth, so the two never disagree
// (22.996 is 23.00 on the clock, and "23 flat").
function fifths(t) {
  const h = Math.round(t * 100);
  return { min: Math.floor(h / 6000), sec: Math.floor((h % 6000) / 100), fifth: Math.floor((h % 100) / 20) };
}
// A fraction as the call box shows it: 22.43 -> "22 and 2"; 47.1 -> "47 flat"; 72.3 -> "1:12 and 1".
function secsWords(t) {
  const { min, sec, fifth } = fifths(t);
  return `${min ? `${min}:${String(sec).padStart(2, '0')}` : sec}${fifth ? ` and ${fifth}` : ' flat'}`;
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
  if (l < 0.2) return 'a head';
  if (l < 0.4) return 'a neck';
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
// The schedule below means a line seldom has to wait at all; this is for a voice that turns out slower
// than it was taken to be.
const LATE = { off: 0.3, wire: 0.3, change: 1.0, other: 1.5, placings: 6 };

// How a line is delivered: how fast, and how high. A device's own voice gets higher as it's sped up: on
// a Chromebook it was fine at 1.15 times its own speed and "the chipmunks" at 1.4 and up. So the pace stays
// between 1.15 and 1.2 and the pitch is never raised. It's steady until about 33 seconds from the wire and
// climbs the little it can from there, through the far turn and the stretch; before the start, and for
// the placings and the time after the wire, it's the steady pace. `toWire` is seconds to the wire.
export const STEADY = 1.15, FASTEST = 1.2;
export function pace(line, toWire) {
  if (line.kind === 'pre' || (line.kind === 'finish' && !line.wire)) return { rate: STEADY, pitch: 1 };
  const k = line.wire ? 1 : Math.max(0, Math.min(1, 1 - (toWire - 3) / 30));
  return { rate: +(STEADY + (FASTEST - STEADY) * k).toFixed(3), pitch: 1 };
}
// About how long a voice takes over a line, when nothing better is known: the model in audio.js at the
// pace the line is asked for. A voice that has been timed, or sound made ahead with a known length, gives
// its own figure through the `lineSeconds` option of raceCall.
const modelSeconds = (line, toWire) => sayTime(line.say, pace(line, toWire).rate);

// After a photo, the winner's line that goes with the official sign, as a line of the call.
export function officialLine(text) {
  return { text, say: aloud(text), kind: 'finish', slot: 'official', late: LATE.placings, rank: 1 };
}
// A line like the ones in a call, for trying a voice out in the menu.
export const SAMPLE = { text: 'They turn for home! Copper Detour by a length and a half!', kind: 'call', late: LATE.other, rank: 0 };

// A close finish is shown in slow motion: from `before` seconds short of the wire to `after` past it, a
// second on the clock on the wall is `by` of a second of the race. A finish is close when second is within
// `margin` lengths of the winner. Only at normal speed.
export const SLOW = { before: 2.2, after: 0.6, by: 0.4, margin: 0.6 };

// The race's clock against the clock on the wall, at a watching speed of 1, 2 or 4: slow motion at the
// end of a close one, and once the recording has run out (four seconds after the last horse is home)
// the race's clock just keeps time. `wall(c)` is the real seconds from the off to the moment the race's
// clock shows c, and `clock(w)` is the other way round.
export function raceClock(run, speed = 1) {
  const fin = run.finalTime, end = run.frames.length * run.dt - run.t0;
  const close = speed === 1 && !!run.results[1] && run.results[1].toPrev < SLOW.margin;
  const knots = [[0, speed]]; // from this moment on the race's clock, this many of its seconds go by in one real one
  if (close) knots.push([fin - SLOW.before, speed * SLOW.by], [fin + SLOW.after, speed]);
  knots.push([end, 1]);
  let w = 0;
  const tab = knots.map(([c, r], k) => { if (k) w += (c - knots[k - 1][0]) / knots[k - 1][1]; return { c, r, w }; });
  const at = (x, key) => { let k = 0; while (k + 1 < tab.length && x >= tab[k + 1][key]) k++; return tab[k]; };
  return {
    close,
    wall(c) { const k = at(c, 'c'); return k.w + (c - k.c) / k.r; },
    clock(wv) { const k = at(wv, 'w'); return k.c + (wv - k.w) * k.r; },
  };
}

// What's coming in a race, as times on its clock: each change of leader (a new horse in front by a quarter
// of a length), the leader reaching the stretch, a furlong out and the sixteenth pole. Changes of leader
// are listed from eight seconds in, when the first call has been made: before that the field is sorting
// itself out, and who went to the front is what the first call says. When two horses are trading the lead
// stride for stride, only a change that lasts a second and a half is listed: the voice can't be kept free
// for every one of them. Worked out once for a recording.
const SCANS = new WeakMap();
function scan(run) {
  let s = SCANS.get(run);
  if (s) return s;
  const fin = run.finalTime, D = run.distance, top = run.path[run.path.length - 1].start;
  s = { leads: [], tS: fin, tE: fin, tX: fin };
  const st = [];
  let cur = null;
  for (let t = 0; t < fin; t += 0.1) {
    stateAt(run, run.t0 + t, st);
    let a = 0, b = -1;
    for (let i = 1; i < st.length; i++) {
      if (st[i].p > st[a].p) { b = a; a = i; } else if (b < 0 || st[i].p > st[b].p) b = i;
    }
    const lead = st[a].p;
    if (s.tS === fin && lead >= top) s.tS = t;
    if (s.tE === fin && D - lead <= FURLONG) s.tE = t;
    if (s.tX === fin && D - lead <= FURLONG / 2) s.tX = t;
    if (t < FIRST) continue;
    if (cur === null) cur = a;
    else if (a !== cur && b >= 0 && (lead - st[b].p) / LENGTH >= PAIR) { if (t >= CALLED) s.leads.push({ t, to: a }); cur = a; }
  }
  s.leads = s.leads.filter((e, k) => !s.leads[k + 1] || s.leads[k + 1].t - e.t >= 1.5);
  SCANS.set(run, s);
  return s;
}

// ---------------------------------------------------------------- the wordings
//
// Each is a list of [id, ...] so that one can be left out when it wouldn't be true (a horse is only
// "into the far turn" at the start of it) and the rest keep their ids. pick() below chooses among them.

const PRE = [[0, 'The field is in the gate'], [1, "They're in the gate"], [2, "They're all in line"], [3, "They're all in"]];
const OFF = [[0, "And they're off!"], [1, "They're off!"], [2, 'And away they go!'], [3, "They're racing!"], [4, "And they're away!"]];
const STUMBLE = [[0, x => `${x} stumbles at the start!`], [1, x => `${x} stumbles coming out!`], [2, x => `A stumble at the start for ${x}!`], [3, x => `${x} stumbles leaving the gate!`]];
const SLOWLY = [[0, x => `${x} broke a step slow.`], [1, x => `${x} is away a step slow.`], [2, x => `${x} is slow into stride.`], [3, x => `${x} is away slowly.`]];
const BUMP = [[0, (x, y) => `${x} and ${y} bump at the start.`], [1, (x, y) => `${x} and ${y} come out and bump.`], [2, (x, y) => `A bump at the start for ${x} and ${y}.`], [3, (x, y) => `${x} and ${y} come together leaving the gate.`]];
const CLEAN = [[0, 'A clean break for all of them.'], [1, 'They all break cleanly.'], [2, 'A clean start for the whole field.'], [3, 'A clean break all round.']];
// The first call, by what happened: one horse clear, two together, or three in a line.
const FIRST1 = [[0, 'breaks on top'], [1, 'is quickest away'], [2, 'goes right to the front'], [3, 'shoots to the lead'], [4, 'is first to show'], [5, 'takes them along']];
const FIRST2 = [[0, 'go at it early'], [1, 'vie for the early lead'], [2, 'break together'], [3, 'are away together'], [4, 'show the early speed']];
const FIRST3 = [[0, (a, b, c) => `${a}, ${b} and ${c} are three across early`], [1, (a, b, c) => `${a}, ${b} and ${c} all go for the lead`], [2, (a, b, c) => `${a}, ${b} and ${c} break in a line`], [3, (a, b, c) => `${a}, ${b} and ${c} are away together`]];
const NEAR = [[0, 'right there'], [1, 'close up'], [2, 'just behind']];
// Where they are. `into` wordings are for a leader who has only just got there, `mid` for one about halfway.
const WHERE = {
  backstretch: [[0, 'Down the backstretch'], [1, 'Along the backstretch'], [2, 'On the backstretch'], [3, 'Into the backstretch', 'into'], [4, 'Midway down the backstretch', 'mid']],
  'far turn': [[0, 'Around the far turn'], [1, 'On the far turn'], [2, 'Into the far turn', 'into'], [3, 'Around the turn'], [4, 'Midway on the turn', 'mid']],
  'clubhouse turn': [[0, 'Around the clubhouse turn'], [1, 'On the clubhouse turn'], [2, 'Into the clubhouse turn', 'into'], [3, 'Around the first turn'], [4, 'Into the first turn', 'into']],
  stretch: [[0, 'Past the stands'], [1, 'By the stands'], [2, 'Past the stands the first time']],
};
// Who leads: [id, with the margin, without it].
const LEADS = [
  [0, (a, g) => `${a} leads by ${g}`, a => `${a} leads`],
  [1, (a, g) => `it's ${a} by ${g}`, a => `it's ${a}`],
  [2, (a, g) => `${a} shows the way by ${g}`, a => `${a} shows the way`],
  [3, (a, g) => `${a} is in front by ${g}`, a => `${a} is in front`],
  [4, (a, g) => `${a} sets the pace, ${g} clear`, a => `${a} sets the pace`],
  [5, (a, g) => `${a} has the lead by ${g}`, a => `${a} has the lead`],
];
const TOGETHER = [
  [0, (a, b) => `${a} and ${b} are head and head`], [1, (a, b) => `${a} and ${b} are together in front`], [2, (a, b) => `nothing between ${a} and ${b}`],
  [3, (a, b) => `${a} and ${b} share the lead`], [4, (a, b) => `${a} and ${b} race side by side`],
];
const TAIL = [[0, (b, c) => `, ${b} second, ${c} third`], [1, (b, c) => ` over ${b}, then ${c}`], [2, (b, c) => `, then ${b} and ${c}`], [3, (b, c) => `, ${b} is second and ${c} third`]];
// The rest of the field, a few at a time.
const NEXT = [[0, x => `then ${x}`, 'list'], [1, (x, k) => `${x} is ${k}`], [2, x => `${x} next`], [3, x => `behind them, ${x}`, 'list'], [4, x => `then comes ${x}`, 'list'], [5, (x, k) => `${x} runs ${k}`]];
const PLACE = [[0, (x, k) => `${x} is ${k}`], [1, (x, k) => `${x} runs ${k}`], [2, (x, k) => `in ${k}, ${x}`], [3, (x, k) => `${x} sits ${k}`]];
const GAP0 = [[0, (x, g) => `${g} back to ${x}`], [1, (x, g) => `then a gap of ${g} to ${x}`], [2, (x, g) => `${g} further back, ${x}`], [3, (x, g) => `it's ${g} back to ${x}`]];
const GAP1 = [[0, (x, g) => `, ${g} back to ${x}`], [1, (x, g) => `, then ${g} to ${x}`], [2, (x, g) => `, a gap of ${g} to ${x}`]];
const ALONG = [[0, x => `, with ${x} alongside`], [1, x => `, ${x} alongside`]];
const LAST = [[0, 'trails'], [1, 'is last'], [2, 'brings up the rear'], [3, 'is at the back']];
const OFFLEAD = [[0, 'off the lead'], [1, 'off the pace'], [2, 'from the leader'], [3, 'behind the leader']];
const INNER = [[0, 'on the rail'], [1, 'on the inside'], [2, 'along the rail']];
const OUTER = [[0, 'on the outside'], [1, 'out wide'], [2, 'widest of all', 'widest']];
// With the field run through: the leader again, how far they're spread, the third horse.
const UPDATE = [
  [0, (a, g, b) => `${a} continues to lead, ${g} to ${b}.`, a => `${a} continues to lead.`, 'still'],
  [1, (a, g, b) => `Still ${a} by ${g} over ${b}.`, a => `Still ${a}.`, 'still'],
  [2, (a, g, b) => `${a} by ${g}, ${b} next.`, a => `${a} on the lead.`],
  [3, (a, g, b) => `${a} still shows the way, ${g} in front of ${b}.`, a => `${a} still shows the way.`, 'still'],
  [4, (a, g, b) => `${a} keeps the lead, ${g} over ${b}.`, a => `${a} keeps the lead.`, 'still'],
  [5, (a, g, b) => `${a} is still in front by ${g}, ${b} chasing.`, a => `${a} is still in front.`, 'still'],
  [6, (a, g, b) => `Up front it's ${a}, ${g} ahead of ${b}.`, a => `Up front it's ${a}.`],
  [7, (a, g, b) => `${a} has ${g} on ${b}.`, a => `${a} out in front.`],
];
const UPDATE2 = [
  [0, (a, b) => `Nothing between ${a} and ${b}.`], [1, (a, b) => `${a} and ${b}, head and head.`], [2, (a, b) => `${a} and ${b} race together in front.`],
  [3, (a, b) => `${a} and ${b} are side by side.`], [4, (a, b) => `${a} and ${b}, still together up front.`, 'still'],
];
const BUNCHED = [[0, n => `They're bunched up, ${n} covers the field.`], [1, n => `${up(n)} covers them all.`], [2, n => `It's a tight pack, ${n} from first to last.`], [3, n => `Not much between them, ${n} top to bottom.`]];
const STRUNG = [[0, n => `They're strung out, ${n} from first to last.`], [1, n => `The field is spread over ${n}.`], [2, n => `${up(n)} from the leader to the last of them.`], [3, n => `It's a long way back, ${n} to the last of them.`]];
const SPREAD = [[0, n => `${up(n)} from first to last.`], [1, n => `The field covers ${n}.`], [2, n => `From front to back it's ${n}.`], [3, n => `${up(n)} separate first and last.`]];
const THIRD = [
  [0, (c, g) => `${c} is third, ${g} back.`, c => `${c} is third.`], [1, (c, g) => `${c} runs third, ${g} behind them.`, c => `${c} runs third.`],
  [2, (c, g) => `Then ${c}, ${g} away in third.`, c => `Then ${c} in third.`], [3, (c, g) => `${up(g)} back to ${c} in third.`, c => `${c} third.`],
  [4, (c, g) => `${c} sits third, ${g} off them.`, c => `${c} sits third.`],
];
const MOVER = [[0, 'is on the move'], [1, 'is picking them off'], [2, 'starts to roll'], [3, 'is making a run'], [4, 'is moving up'], [5, 'is making up ground']];
const TROUBLE = [[0, x => `${x} has to check, nowhere to go!`], [1, x => `${x} is stuck behind horses!`], [2, x => `No room for ${x}!`], [3, x => `${x} has to steady!`], [4, x => `${x} is blocked!`]];
const FRAC = [
  [[0, t => `The quarter in ${t}`], [1, t => `${up(t)} for the quarter`], [2, t => `They go the quarter in ${t}`], [3, t => `The opening quarter in ${t}`], [4, t => `The first quarter in ${t}`]],
  [[0, t => `The half in ${t}`], [1, t => `${up(t)} for the half`], [2, t => `They reach the half in ${t}`], [3, t => `The half mile in ${t}`], [4, t => `Half a mile in ${t}`]],
  [[0, t => `Three quarters in ${t}`], [1, t => `${up(t)} for three quarters`], [2, t => `Six furlongs in ${t}`], [3, t => `They go three quarters in ${t}`], [4, t => `${up(t)} for six furlongs`]],
];
const QUICK = [[0, ', a fast pace'], [1, ", and that's quick"], [2, ", they're flying early"], [3, ', a sharp pace']];
const EASY = [[0, ', nice and easy up front'], [1, ', an easy pace'], [2, ", they're in no hurry"], [3, ', a soft pace']];
// A new leader: [id, with the horse it took over from, without].
const CHANGE = [
  [0, (x, y) => `${x} takes over from ${y}!`, x => `${x} takes over!`],
  [1, (x, y) => `${x} goes by ${y} and takes the lead!`, x => `${x} takes the lead!`],
  [2, x => `And now it's ${x} in front!`, x => `Now it's ${x}!`],
  [3, (x, y) => `${x} strikes the front, ${y} is headed!`, x => `${x} strikes the front!`],
  [4, x => `${x} goes to the lead!`, x => `${x} leads now!`],
  [5, (x, y) => `${x} is the new leader, past ${y}!`, x => `${x} is the new leader!`],
];
// A horse that led before and has the lead back.
const AGAIN = [[0, x => `${x} is back in front!`], [1, x => `${x} fights back to lead!`], [2, x => `${x} comes again!`], [3, x => `${x} takes it back!`]];
const TURN = [[0, 'They turn for home!'], [1, 'Into the stretch!'], [2, 'They straighten for home!'], [3, 'Turning for home!'], [4, 'They swing into the stretch!'], [5, 'Here they come, into the stretch!']];
const TURN3 = [[0, (a, g, b, c) => `${a} by ${g}, ${b} second, ${c} third.`], [1, (a, g, b, c) => `It's ${a} by ${g}, then ${b} and ${c}.`], [2, (a, g, b, c) => `${a} leads ${b} by ${g}, ${c} is third.`], [3, (a, g, b, c) => `${a} in front by ${g}, from ${b} and ${c}.`]];
// A furlong out. The first three are only true as the leader gets there; "inside the final furlong" for a while after.
const EIGHTH = [[0, 'A furlong to go!', 'at'], [1, 'A furlong out!', 'at'], [2, 'At the eighth pole!', 'at'], [3, 'Inside the final furlong!'], [4, 'One furlong left!', 'at'], [5, 'Into the last furlong!']];
const SIXTEENTH = [[0, 'Down to the sixteenth pole'], [1, 'At the sixteenth pole'], [2, 'A sixteenth to go'], [3, 'To the sixteenth pole'], [4, 'Half a furlong left']];
// The stretch, by what the race shows. [id, the line, a shorter one]. "Stride for stride" is for two inside a quarter of a length, which every pair called this way is.
const HEADS = [
  [0, (a, b) => `${a} and ${b}, head and head!`], [1, (a, b) => `${a}! ${b}! Nothing between them!`], [2, (a, b) => `${a} and ${b}, stride for stride!`],
  [3, (a, b) => `${a} and ${b} are locked together!`], [4, (a, b) => `${a} and ${b}, side by side!`], [5, (a, b) => `${a} and ${b} battle it out!`],
];
const CLOSING = [
  [0, (b, a) => `${b} is closing on ${a}!`, b => `${b} is closing!`],
  [1, (b, a) => `Here comes ${b} after ${a}!`, b => `Here comes ${b}!`],
  [2, (b, a) => `${b} is cutting into ${a}'s lead!`, b => `${b} is cutting into the lead!`],
  [3, (b, a) => `${b} is gaining on ${a}!`, b => `${b} is gaining!`],
  [4, (b, a) => `${b} closing fast, but ${a} still in front!`, b => `${b} closing fast!`, 'fast'],
  [5, (b, a) => `${b} is coming after ${a}!`, b => `${b} is coming!`],
];
const FLYING = [[0, 'is flying late'], [1, 'is finishing fastest of all'], [2, 'is charging'], [3, 'comes with a late run'], [4, 'is coming with a rush']];
const RUNON = [[0, (x, k) => `${x} is running on from ${k}!`], [1, (x, k) => `${x} is finishing well from ${k}!`], [2, (x, k) => `From ${k}, ${x} is running on!`], [3, (x, k) => `${x} makes up ground from ${k}!`]];
const CLEAR = [
  [0, (a, g) => `${a} opens up by ${g}!`, a => `${a} opens up!`], [1, (a, g) => `${a} is ${g} clear!`, a => `${a} is clear!`],
  [2, (a, g) => `${a} widens, ${g} in front!`, a => `${a} widens!`], [3, (a, g) => `${a} kicks away, ${g} clear!`, a => `${a} kicks away!`],
  [4, (a, g) => `${a} goes on by ${g}!`, a => `${a} goes on!`],
];
// Sure of the winner. Only said under the rule in sureOf() below.
const SURE = [[0, a => `${a}, clear and drawing away!`], [1, a => `They won't catch ${a} today!`], [2, a => `${a} is drawing away!`], [3, a => `It's all ${a}!`], [4, a => `Nobody is catching ${a}!`]];
const HOME_FREE = [
  [0, (a, x) => `${a} is home free, ${x} running on for second.`, a => `${a} is home free!`],
  [1, (a, x) => `${a} is long gone, ${x} runs on for second.`, a => `${a} is long gone!`],
  [2, (a, x) => `No catching ${a}, ${x} is running for second.`, a => `No catching ${a}!`],
  [3, (a, x) => `${a} has them all beaten, ${x} best of the rest.`, a => `${a} has them all beaten!`],
];
const STILL = [
  [0, (a, g) => `${a} by ${g}!`, a => `${a} in front!`], [1, (a, g) => `Still ${a}, ${g} in front!`, a => `Still ${a}!`],
  [2, (a, g, b) => `${a} leads ${b} by ${g}!`, a => `${a} leads!`], [3, (a, g) => `${a} still in front by ${g}!`, a => `${a} still in front!`],
  [4, (a, g, b) => `It's ${a} by ${g} over ${b}!`, a => `It's ${a}!`], [5, (a, g, b) => `${a} holds ${b} off, ${g} between them!`, a => `${a} holds on!`, 'holds'],
];
// The second horse, when it isn't gaining.
const CHASE = [
  [0, (b, g) => `${b} is second, ${g} back.`, b => `${b} is second.`],
  [1, (b, g, a) => `${b} chases ${a}, ${g} behind!`, b => `${b} gives chase!`, 'leader'],
  [2, (b, g) => `${b} runs second, ${g} off the leader.`, b => `${b} runs second.`],
  [3, (b, g, a) => `${b} keeps after ${a}!`, b => `${b} keeps on!`, 'leader'],
  [4, (b, g) => `Then ${b}, ${g} away.`, b => `Then ${b}.`],
];
const CRY = [[0, (a, b) => `${a} and ${b}!`], [1, (a, b) => `${a}, ${b}, to the wire!`], [2, (a, b) => `It's ${a} and ${b}!`], [3, (a, b) => `${a}! ${b}!`]];
// The wire. Every one ends with the chart's margin.
const WINS = [[0, (w, m) => `${w} wins it by ${m}!`], [1, (w, m) => `${w} wins by ${m}!`], [2, (w, m) => `${w} is the winner, by ${m}!`], [3, (w, m) => `${w} takes it by ${m}!`], [4, (w, m) => `And ${w} wins it, by ${m}!`]];
const GETS_UP = [[0, (w, m) => `${w} gets up to win it by ${m}!`], [1, (w, m) => `${w} gets up in the last strides, by ${m}!`], [2, (w, m) => `${w} is up in time, by ${m}!`], [3, (w, m) => `${w} gets there, by ${m}!`], [4, (w, m) => `${w} gets up at the wire, by ${m}!`]];
const ROMP = [[0, (w, m) => `${w} wins it in a romp, by ${m}!`], [1, (w, m) => `${w} romps home, by ${m}!`], [2, (w, m) => `${w}, in a romp, by ${m}!`], [3, (w, m) => `${w} is all alone at the wire, by ${m}!`]];
const AWAY = [[0, (w, m) => `${w} wins it by ${m}, going away!`], [1, (w, m) => `${w} wins going away, by ${m}!`], [2, (w, m) => `${w} draws off to win by ${m}!`], [3, (w, m) => `${w} pulls clear to win it by ${m}!`]];
const HOLDS = [[0, (w, m) => `${w} holds on to win it by ${m}!`], [1, (w, m) => `${w} lasts, by ${m}!`], [2, (w, m) => `${w} hangs on by ${m}!`], [3, (w, m) => `${w} holds, by ${m}!`]];
const PHOTO = [
  [0, (a, b) => `${a} and ${b} hit the wire together. It's a photo!`], [1, (a, b) => `${a} and ${b}, on the line together. It's a photo!`],
  [2, (a, b) => `${a} and ${b} at the wire together! Photo finish!`], [3, (a, b) => `Too close to call! ${a} and ${b} in a photo!`],
  [4, (a, b) => `${a}, ${b}, they hit the wire as one. A photo!`],
];
const PHOTO_WAIT = [[0, (a, b) => `They'll need the photo for ${a} and ${b}.`], [1, (a, b) => `It's a photo between ${a} and ${b}.`], [2, (a, b) => `${a} or ${b}, the photo will tell.`], [3, (a, b) => `The camera will split ${a} and ${b}.`]];
const PLACED = [[0, (s, t) => `${s} second, ${t} third.`], [1, (s, t) => `${s} is second, ${t} third.`], [2, (s, t) => `${s} second and ${t} third.`], [3, (s, t) => `Then ${s}, and ${t} third.`], [4, (s, t) => `${s} gets second, ${t} third.`]];
const OFFICIAL = [[0, (w, m) => `It's ${w}, by ${m}!`], [1, (w, m) => `The photo goes to ${w}, by ${m}!`], [2, (w, m) => `${w} gets the nod, by ${m}!`], [3, (w, m) => `${w} wins the photo, by ${m}!`], [4, (w, m) => `${w} got there, by ${m}!`]];

const up = s => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- the call
//
// Each line is { t, text, say, kind, late, rank, slot, d }: `text` is what the call box shows and `say` is
// the same line as the voice is given it, with times in words. `d` is about how long the voice takes over
// it, in seconds. `late` is how long the voice may be behind with it (see LATE) and `rank` is 1 for the
// lines that take the place of another line waiting to be said: the off, a lead change and the call at
// the wire, which is also marked `wire` (the last line, with the time, is marked `placings`). `slot` is
// the kind of line it is, and `picks` the wordings it used. For the tests, and for planning the rest of a
// race again from the middle, a line also has what it claims: `lead` is the horse it names as the
// leader, `change` marks a lead change, `pair` is two horses called together with no word on which is in
// front, `who` is a horse it says something else about (making a move, closing), `sure` is the horse it
// says has the race won, `named` the horses a run through the field got to, and `sides` where it put a
// horse (on the rail, on the outside).
//
// Options: `lineSeconds(line, secondsToWire)` says how long a line takes to say; `speed` is how fast the
// race is being watched (1, 2 or 4: at 2 the shortest wording of each line is taken, at 4 only the
// headlines are called); `bugle` is the length of the bugle call, when the first line is to wait for it.
// To plan the rest of a race again from the middle (the speed changed, the race was skipped ahead, the
// voice turned out slower than thought), `from` is the time on the race's clock to plan from, `wait` the
// real seconds from then until the voice is free, and `said` the lines given so far, which are kept.
export function raceCall(race, run, names, { lineSeconds = modelSeconds, speed = 1, from = null, wait = 0, said = [], bugle = 0 } = {}) {
  const fresh = from === null;
  const R = rng(fresh ? `call:${race.seed}` : `call:${race.seed}:${Math.round(from * 10)}:${speed}`);
  const D = run.distance, t0 = run.t0, fin = run.finalTime, n = names.length;
  const dur = run.frames.length * run.dt - t0;
  const { wall, clock } = raceClock(run, speed);
  const ev = scan(run);
  const nm = i => names[i];
  const ord = t => stateAt(run, t0 + t, []).map((s, i) => ({ i, p: s.p, o: s.o, v: s.v })).sort((a, b) => b.p - a.p);
  const headlines = speed >= 4, brief = speed >= 2;

  // What has been said, which decides what's said next. All of it is read off the lines themselves
  // (note() below), so the rest of a race can be planned again from the lines given so far.
  const S = {
    leader: null, leaderAt: -99, led: new Set(),             // the horse last named in front, and when
    pass: new Set(), passAt: -99, passWhere: null, first: false, lastNamed: null, // the run through the field
    saidWhere: null, frac: {}, broke: false, turn: false, eighth: false, sixteenth: false,
    drive: '', driveAt: new Map(), thirdAt: -99, flown: new Set(), troubled: new Set(), movers: new Set(), moverAt: -99, fill: '',
    texts: new Set(), used: new Map(), last: new Map(), off: false,
  };
  function note(l) {
    S.texts.add(l.text);
    for (const [slot, id, count] of l.picks || []) {
      let seen = S.used.get(slot);
      if (!seen) S.used.set(slot, seen = new Set());
      seen.add(id);
      if (seen.size >= count) { seen.clear(); seen.add(id); } // every wording has had a turn: start round again
      S.last.set(slot, id);
    }
    if (l.lead !== undefined) { S.leader = l.lead; S.leaderAt = l.t; S.led.add(l.lead); S.pass.add(l.lead); }
    else if (l.pair) { if (S.leader === null) S.leader = l.pair[0]; S.leaderAt = l.t; }
    if (l.kind === 'off') S.off = true;
    if (l.slot === 'break') S.broke = true;
    if (l.slot === 'run') {
      if (l.fresh) { S.pass = new Set(); S.passAt = l.t; S.passWhere = l.where; }
      S.first = true;
      if (l.whereSaid) S.saidWhere = l.where;
    }
    if (l.named) { for (const i of l.named) S.pass.add(i); S.lastNamed = l.named[l.named.length - 1]; }
    if (l.slot === 'frac') S.frac[l.frac] = true;
    if (l.slot === 'turn') S.turn = true;
    if (l.slot === 'eighth') S.eighth = true;
    if (l.slot === 'sixteenth') S.sixteenth = true;
    if (l.slot === 'drive') { S.drive = l.drive; S.driveAt.set(l.drive, l.t); if (l.drive === 'third') S.thirdAt = l.t; if (l.drive === 'fly') S.flown.add(l.who); }
    if (l.slot === 'trouble') S.troubled.add(l.who);
    if (l.slot === 'mover') { S.movers.add(l.who); S.moverAt = l.t; }
    if (l.slot === 'fill') { S.fill = l.fill; if (l.fill === 'third') S.thirdAt = l.t; }
  }
  const lines = [];
  for (const l of said) { lines.push(l); note(l); }

  // One wording from a list: one that hasn't been used yet in this race if there is one, and never the
  // one just said. The choice is only counted as used when its line is.
  let picking = [];
  function pick(slot, options) {
    const seen = S.used.get(slot), was = S.last.get(slot);
    const taken = id => picking.some(p => p[0] === slot && p[1] === id);
    let pool = options.filter(o => !(seen && seen.has(o[0])) && !taken(o[0]));
    if (!pool.length) pool = options.filter(o => o[0] !== was && !taken(o[0]));
    if (!pool.length) pool = options;
    const o = pool[Math.floor(R() * pool.length)];
    picking.push([slot, o[0], options.length]);
    return o;
  }
  // A line in the making: { text, say, ...what it claims }.
  const form = (text, claims = null, say = text) => ({ text, say, ...claims });

  // Where a horse is running, when that's worth a word: on the rail, or out wide.
  function sideOf(z, o) {
    const off = z.o - RAIL;
    if (off >= OUTSIDE) {
      const widest = o.every(x => x.o <= z.o);
      return { side: 'outside', words: pick('outer', OUTER.filter(x => !x[2] || widest))[1] };
    }
    if (off < INSIDE) return { side: 'inside', words: pick('inner', INNER)[1] };
    return null;
  }
  const gapOf = (a, b) => (a.p - b.p) / LENGTH;
  const coin = (a, b) => (R.chance(0.5) ? [a, b] : [b, a]); // two horses, in no order that says which leads

  // ------------------------------------------------------------ what there is to say

  function breakForms() {
    const bad = run.results.filter(r => r.stumble).map(r => r.h), slow = run.results.filter(r => r.slow).map(r => r.h);
    const bumped = run.results.filter(r => r.bumped).map(r => r.h).sort((a, b) => a - b);
    if (bad.length) return [form(pick('stumble', STUMBLE)[1](nm(bad[0])), { who: bad[0] })];
    if (slow.length) return [form(pick('slow', SLOWLY)[1](nm(slow[0])), { who: slow[0] })];
    if (bumped.length === 2) return [form(pick('bump', BUMP)[1](nm(bumped[0]), nm(bumped[1])))];
    if (bumped.length) return null;
    return [form(pick('clean', CLEAN)[1], { clean: true })];
  }

  // The first call: who went to the front. One horse clear of the next (by a quarter of a length, four
  // seconds out of the gate) is the leader; two together "vie for the lead", and a third within a
  // quarter of a length of them makes three across. A third horse is "right there" only within a length.
  function firstForms(o) {
    const [a, b, c] = o;
    const g = b ? gapOf(a, b) : Infinity, g2 = c ? gapOf(b, c) : Infinity;
    const say = { fresh: true, where: segmentAt(run.path, a.p).name };
    if (g >= PAIR) {
      const v = `${nm(a.i)} ${pick('first1', FIRST1)[1]}`;
      const out = [];
      if (c) out.push(form(`${v}. ${nm(b.i)} second, ${nm(c.i)} third.`, { ...say, lead: a.i, named: [a.i, b.i, c.i] }));
      if (b) out.push(form(`${v}, ${nm(b.i)} second.`, { ...say, lead: a.i, named: [a.i, b.i] }));
      out.push(form(`${v}.`, { ...say, lead: a.i, named: [a.i] }));
      return out;
    }
    // Two together, or three: nobody is named as the leader.
    const two = `${nm(a.i)} and ${nm(b.i)} ${pick('first2', FIRST2)[1]}`;
    const out = [];
    if (c && g2 < PAIR) out.push(form(`${pick('first3', FIRST3)[1](nm(a.i), nm(b.i), nm(c.i))}.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i, c.i], across: c.i }));
    else if (c && g2 < 1) out.push(form(`${two}, ${nm(c.i)} ${pick('near', NEAR)[1]}.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i, c.i], near: c.i }));
    else if (c) out.push(form(`${two}, ${nm(c.i)} third, ${gapWords(g2)} back.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i, c.i] }));
    out.push(form(`${two}.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i] }));
    return out;
  }

  // The head of a run through the field: where they are, who leads and by how much, second and third.
  function headForms(o, seg) {
    const [a, b, c] = o;
    const g = b ? gapOf(a, b) : Infinity, g2 = c ? gapOf(b, c) : 0;
    const part = seg.name, done = (a.p - seg.start) / Math.max(1, seg.len);
    const places = WHERE[part] && part !== S.saidWhere
      ? WHERE[part].filter(x => !x[2] || (x[2] === 'into' ? a.p - seg.start < 90 : done > 0.38 && done < 0.62)) : null;
    const pre = places ? `${pick(`where:${part}`, places)[1]}, ` : '';
    const say = { fresh: true, where: part, whereSaid: !!pre };
    const out = [];
    if (b && g < PAIR) {
      const [x, y] = coin(a, b);
      const two = up(`${pre}${pick('together', TOGETHER)[1](nm(x.i), nm(y.i))}`);
      if (c) out.push(form(`${two}, ${g2 >= GAP ? `${gapWords(g2)} back to ${nm(c.i)}` : `${nm(c.i)} third`}.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i, c.i] }));
      out.push(form(`${two}.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i] }));
      out.push(form(`${pre}${nm(x.i)} and ${nm(y.i)} together.`, { ...say, pair: [a.i, b.i], named: [a.i, b.i] }));
      return pre ? [out, [form(`${nm(x.i)} and ${nm(y.i)} together.`, { ...say, whereSaid: false, pair: [a.i, b.i], named: [a.i, b.i] })]] : out;
    }
    const v = pick('leads', LEADS);
    const long = up(`${pre}${b ? v[1](nm(a.i), gapWords(g)) : v[2](nm(a.i))}`), short = up(`${pre}${v[2](nm(a.i))}`);
    if (c) out.push(form(`${long}${g2 >= GAP ? `, ${nm(b.i)} second, ${gapWords(g2)} back to ${nm(c.i)}` : pick('tail', TAIL)[1](nm(b.i), nm(c.i))}.`, { ...say, lead: a.i, named: [a.i, b.i, c.i] }));
    if (b) out.push(form(`${long}, ${nm(b.i)} second.`, { ...say, lead: a.i, named: [a.i, b.i] }));
    out.push(form(`${short}.`, { ...say, lead: a.i, named: [a.i] }));
    // With no time to say where they are, who leads.
    return pre ? [out, [form(`${up(v[2](nm(a.i)))}.`, { ...say, whereSaid: false, lead: a.i, named: [a.i] })]] : out;
  }

  // The next piece of it: up to three horses, in order, with a margin where there's a gap in the field
  // and how far the last of them is off the lead.
  function moreForms(o, rest) {
    const at = new Map(o.map((z, k) => [z.i, k]));
    const out = [];
    // The same horse gets the same words whether the line takes three of them, two or one.
    const memo = new Map();
    const once = (slot, j, options) => { const key = `${slot}:${j}`; if (!memo.has(key)) memo.set(key, pick(slot, options)); return memo.get(key); };
    const wide = R.chance(0.4) ? rest.slice(0, 3).find(z => z.o - RAIL >= OUTSIDE || z.o - RAIL < INSIDE) : null; // one horse a line, at most
    const side = wide ? sideOf(wide, o) : null;
    for (const m of [3, 2, 1]) {
      if (rest.length < m) continue;
      const take = rest.slice(0, m), sides = [];
      let text = '', list = false, special = false, beside = false, back = null;
      take.forEach((z, j) => {
        const k = at.get(z.i), ahead = o[k - 1], gp = ahead ? gapOf(ahead, z) : 0;
        const last = k === n - 1 && n > 3, x = nm(z.i);
        const follows = !!ahead && ahead.i === (j ? take[j - 1].i : S.lastNamed);
        const off = gapOf(o[0], z);
        const tail = last && off >= 2.5 ? `, ${lengthsWords(Math.round(off))} ${once('offlead', j, OFFLEAD)[1]}` : '';
        let bit, plain = false;
        if (last) back = { last: z.i, ...(tail ? { off: Math.round(off) } : null) };
        if (j === 0) {
          if (last) bit = `${x} ${once('last', j, LAST)[1]}${tail}`;
          else if (follows && gp >= GAP) bit = once('gap0', j, GAP0)[1](x, gapWords(gp));
          else if (follows) { const w = once('next', j, NEXT); bit = w[1](x, nth(k + 1)); list = w[2] === 'list'; plain = true; }
          else { bit = once('place', j, PLACE)[1](x, nth(k + 1)); plain = true; }
        } else if (last) bit = `, and ${x} ${once('last', j, LAST)[1]}${tail}`;
        else if (!follows) bit = `, ${x} ${nth(k + 1)}`;
        else if (gp >= GAP) bit = once('gap1', j, GAP1)[1](x, gapWords(gp));
        else if (gp < PAIR && !beside) { bit = once('along', j, ALONG)[1](x); beside = true; }
        else { bit = special || (!list && j === 1) ? `, then ${x}` : j === m - 1 ? ` and ${x}` : `, ${x}`; plain = true; }
        if (plain && wide === z) {
          bit += `${/^(out wide|widest)/.test(side.words) ? ',' : ''} ${side.words}`;
          sides.push({ i: z.i, side: side.side });
          plain = false;
        }
        special = j > 0 && !plain;
        text += bit;
      });
      out.push(form(`${up(text)}.`, { named: take.map(z => z.i), ...(sides.length ? { sides } : null), ...back }));
    }
    return out;
  }

  // With the field run through: the leader again, how far they're spread, or the third horse, turn and
  // turn about. All three are offered, the one whose turn it is first, in case it has no wording short
  // enough for the time there is.
  function fillForms(o, t, leaderOnly = false) {
    const [a, b, c] = o;
    const g = b ? gapOf(a, b) : Infinity;
    const spread = gapOf(a, o[n - 1]);
    const order = leaderOnly ? ['upd'] : ['upd', 'spread', 'third'], k = order.indexOf(S.fill);
    const out = [];
    for (let j = 1; j <= order.length; j++) {
      const fill = order[(k + j) % order.length];
      if (fill === 'upd' && b && g < PAIR) {
        const [x, y] = coin(a, b), before = lines[lines.length - 1];
        const still = !!before && !!before.pair && before.pair.includes(a.i) && before.pair.includes(b.i); // "still together" only straight after they were called together
        out.push([form(pick('update2', UPDATE2.filter(w => !w[2] || still))[1](nm(x.i), nm(y.i)), { fill, pair: [a.i, b.i] }), form(`${nm(x.i)} and ${nm(y.i)} together.`, { fill, pair: [a.i, b.i] })]);
      } else if (fill === 'upd' && b) {
        const w = pick('update', UPDATE.filter(x => !x[3] || (S.leader === a.i && S.led.has(a.i)))); // "still" only of a horse already called the leader
        out.push([form(w[1](nm(a.i), gapWords(g), nm(b.i)), { fill, lead: a.i }), form(w[2](nm(a.i)), { fill, lead: a.i })]);
      } else if (fill === 'spread' && n >= 5 && spread >= 1.5) {
        const [key, list] = spread <= n * 0.75 ? ['b', BUNCHED] : spread >= n * 1.6 ? ['s', STRUNG] : ['m', SPREAD];
        out.push([form(pick('spread', list.map(w => [key + w[0], w[1]]))[1](lengthsWords(Math.round(spread))), { fill, spread: Math.round(spread) })]);
      } else if (fill === 'third' && c && t - S.thirdAt > 12) {
        const w = pick('third', THIRD);
        out.push([form(w[1](nm(c.i), gapWords(gapOf(b, c))), { fill, third: c.i }), form(w[2](nm(c.i)), { fill, third: c.i })]);
      }
    }
    return out.length ? out : null;
  }

  // A horse making up ground from behind: only once the race has settled, a horse in the first five or
  // within five lengths of the lead, and before the stretch (the stretch has its own lines).
  function moverForms(o, t) {
    if (t <= 20 || wall(t) - wall(S.moverAt) < 8) return null;
    const was = ord(t - 4).map(x => x.i);
    const z = o.find((x, k) => k > 0 && was.indexOf(x.i) - k >= 2 && x.v > o[0].v + 0.2 && !S.movers.has(x.i) && (k < 5 || gapOf(o[0], x) <= 5));
    if (!z) return null;
    const off = z.o - RAIL;
    const where = off >= OUTSIDE ? `, ${numWords(Math.round(off) + 1)} wide` : off < INSIDE ? ` ${pick('inner', INNER)[1]}` : '';
    return [form(`${nm(z.i)} ${pick('mover', MOVER)[1]}${where}.`, { who: z.i, ...(where ? { sides: [{ i: z.i, side: off >= OUTSIDE ? 'wide' : 'inside' }] } : null) })];
  }

  // A horse that has just had to take a hold with nowhere to go, if it's near enough the front to matter.
  function troubleForms(o, t, near) {
    if (S.troubled.size >= 2) return null;
    const e = run.events.find(x => x.type === 'checked' && x.t <= t0 + t && t0 + t - x.t < 1.2 && !S.troubled.has(x.h));
    if (!e || o.findIndex(x => x.i === e.h) >= near) return null;
    return [form(pick('trouble', TROUBLE)[1](nm(e.h)), { who: e.h })];
  }

  function fracForms(f) {
    const w = pick(`frac${f.k}`, FRAC[f.k]);
    const remark = f.pace ? pick(f.pace, f.pace === 'fast' ? QUICK : EASY)[1] : '';
    const claims = { frac: f.k, remark: f.pace || '' };
    const out = [];
    if (remark) out.push(form(`${w[1](secsWords(f.t))}${remark}.`, claims, `${w[1](timeSay(f.t))}${remark}.`));
    else out.push(form(`${w[1](secsWords(f.t))}.`, claims, `${w[1](timeSay(f.t))}.`));
    return out;
  }

  // A new leader. The horse it took over from is named only when that's the horse running second as the
  // line comes up. The last horse the caller called in front can be an older leader, after a line calling
  // two together or a change the voice was too busy for: by now it may be fifth, and the lead was taken
  // from another horse. Then the wording without it is used, which every one of them has.
  function changeForms(o) {
    const [a, b] = o, was = S.leader;
    const claims = { lead: a.i, change: true };
    if (S.led.has(a.i)) return [form(pick('again', AGAIN)[1](nm(a.i)), claims)];
    const w = pick('change', CHANGE);
    const short = w[2](nm(a.i));
    if (w[1].length < 2) return [form(w[1](nm(a.i)), claims), form(short, claims)];
    return b && b.i === was ? [form(w[1](nm(a.i), nm(was)), { ...claims, passed: was }), form(short, claims)] : [form(short, claims)];
  }

  function turnForms(o) {
    const [a, b, c] = o;
    const g = b ? gapOf(a, b) : Infinity;
    const head = pick('turn', TURN)[1];
    const out = [];
    if (b && g < PAIR) {
      const [x, y] = coin(a, b);
      if (c) out.push(form(`${head} ${nm(x.i)} and ${nm(y.i)} together, ${nm(c.i)} third.`, { pair: [a.i, b.i] }));
      out.push(form(`${head} ${nm(x.i)} and ${nm(y.i)}!`, { pair: [a.i, b.i] }));
      return [out, [form(head)]];
    }
    if (c) out.push(form(`${head} ${pick('turn3', TURN3)[1](nm(a.i), gapWords(g), nm(b.i), nm(c.i))}`, { lead: a.i }));
    if (b) out.push(form(`${head} ${nm(a.i)} by ${gapWords(g)} over ${nm(b.i)}.`, { lead: a.i }));
    out.push(form(`${head} ${nm(a.i)} leads!`, { lead: a.i }));
    return [out, [form(head)]]; // the words alone are the last resort, watching at any speed
  }

  function eighthForms(o, t) {
    const [a, b] = o;
    const g = b ? gapOf(a, b) : Infinity;
    const head = pick('eighth', EIGHTH.filter(w => !w[2] || t - ev.tE <= 1))[1];
    if (b && g < PAIR) {
      const [x, y] = coin(a, b);
      return [[form(`${head} ${nm(x.i)} and ${nm(y.i)}, head and head!`, { pair: [a.i, b.i] }), form(`${head} ${nm(x.i)} and ${nm(y.i)}!`, { pair: [a.i, b.i] })], [form(head)]];
    }
    const out = [];
    if (b) out.push(form(`${head} ${nm(a.i)} by ${gapWords(g)} over ${nm(b.i)}!`, { lead: a.i }), form(`${head} ${nm(a.i)} by ${gapWords(g)}!`, { lead: a.i }));
    out.push(form(`${head} ${nm(a.i)} leads!`, { lead: a.i }));
    return [out, [form(head)]];
  }

  function sixteenthForms(o) {
    const [a, b] = o;
    const g = b ? gapOf(a, b) : Infinity;
    const head = pick('sixteenth', SIXTEENTH)[1];
    if (b && g < PAIR) {
      const [x, y] = coin(a, b);
      return [[form(`${head}, ${nm(x.i)} and ${nm(y.i)} together!`, { pair: [a.i, b.i] }), form(`${head}, ${nm(x.i)} and ${nm(y.i)}!`, { pair: [a.i, b.i] })], [form(`${head}!`)]];
    }
    const out = [];
    if (b) out.push(form(`${head}, ${nm(a.i)} by ${gapWords(g)}!`, { lead: a.i }));
    out.push(form(`${head}, ${nm(a.i)} leads!`, { lead: a.i }));
    return [out, [form(`${head}!`)]];
  }

  // Whether the caller may sound sure of the leader: inside the last 110 metres, a length and a half or
  // more in front, the lead not shrinking over the last second, and none of the next three running half a
  // metre a second faster. Anything less can still end in a photo, or with the leader caught. `free` is
  // for a leader three clear of them all whom nobody gets within a length and a half of by the wire at
  // the speeds they're going now, with one behind running on: that one is running for second.
  function sureOf(o, t) {
    const [a, b] = o;
    const toGo = D - a.p;
    if (!b || toGo >= 110) return null;
    const g = gapOf(a, b), ago = ord(t - 1);
    const was = (ago.find(x => x.i === a.i).p - Math.max(...ago.filter(x => x.i !== a.i).map(x => x.p))) / LENGTH;
    const sure = g >= 1.5 && g >= was;
    const fast = o.slice(1, 4).find(x => x.v > a.v + 0.5);
    const chaser = fast || o.slice(1, 4).filter(x => x.v > a.v).reduce((m, x) => (!m || x.v > m.v ? x : m), null);
    const secs = toGo / Math.max(1, a.v);
    const safe = g >= 3 && o.slice(1).every(x => a.p - x.p - (x.v - a.v) * secs >= 1.5 * LENGTH);
    if (chaser && (fast || !sure) && gapOf(a, chaser) >= 3 && safe) return { free: chaser };
    return sure && !fast ? {} : null;
  }

  // The stretch: a line of two to eight words about the first two or three, chosen by what the race shows
  // and never the same kind twice running. First what's happening (a horse stopped, one flying from
  // behind, two head and head, the second closing, the leader drawing off), then who's where (the
  // leader, the second horse, the third), whichever of those was said longest ago. All of them are
  // offered, in case the first has no wording short enough for the time there is.
  function driveForms(o, t) {
    const [a, b, c] = o;
    if (!b) return [form(`${nm(a.i)} in front!`, { drive: 'still', lead: a.i })];
    const g = gapOf(a, b), ago = ord(t - 1);
    const gAgo = gapOf(ago.find(x => x.i === a.i), ago.find(x => x.i === b.i));
    const trouble = troubleForms(o, t, 4);
    if (trouble) return trouble.map(f => ({ ...f, slot: 'trouble' }));
    const news = [], places = [];
    // One behind the first two that's finishing fastest of them all, and not about to be stopped. Within
    // three lengths it's flying; further back than that it's given its place ("running on from sixth").
    const top = Math.max(...o.map(x => x.v));
    const flyer = o.slice(2, 6).find(x => x.v >= top && x.v > a.v + 0.5 && gapOf(a, x) < 6 && !S.flown.has(x.i)
      && !run.events.some(e => e.type === 'checked' && e.h === x.i && e.t > t0 + t - 1.2 && e.t < t0 + t + 2));
    if (flyer && gapOf(a, flyer) < 3) {
      const off = flyer.o - RAIL;
      const where = off >= OUTSIDE ? ' on the outside' : off < INSIDE ? ' up the rail' : '';
      const w = pick('flying', FLYING)[1];
      const sides = where ? { sides: [{ i: flyer.i, side: off >= OUTSIDE ? 'outside' : 'inside' }] } : null;
      // Where it's running is part of the line when it's on the rail or out wide, in every wording of it.
      news.push(['fly', where ? [form(`${nm(flyer.i)} ${w}${where}!`, { who: flyer.i, ...sides })] : [form(`${nm(flyer.i)} ${w}!`, { who: flyer.i })]]);
    } else if (flyer) news.push(['fly', [form(pick('runon', RUNON)[1](nm(flyer.i), nth(o.indexOf(flyer) + 1)), { who: flyer.i, from: o.indexOf(flyer) + 1 })]]);
    const sure = sureOf(o, t);
    const closing = g >= PAIR && g < 3 && b.v > a.v + 0.2 && gAgo - g > 0.08;
    if (g < PAIR) {
      const [x, y] = coin(a, b);
      news.push(['heads', [form(pick('heads', HEADS)[1](nm(x.i), nm(y.i)), { pair: [a.i, b.i] })]]);
    } else if (closing) {
      const w = pick('closing', CLOSING.filter(x => !x[3] || gAgo - g > 0.25)); // "closing fast" is a quarter of a length a second
      news.push(['close', [form(w[1](nm(b.i), nm(a.i)), { who: b.i, lead: a.i, closing: true }), form(w[2](nm(b.i)), { who: b.i, closing: true })]]);
    } else if (sure && sure.free) {
      const w = pick('homefree', HOME_FREE);
      news.push(['sure', [form(w[1](nm(a.i), nm(sure.free.i)), { lead: a.i, sure: a.i }), form(w[2](nm(a.i)), { lead: a.i, sure: a.i })]]);
    } else if (sure) news.push(['sure', [form(pick('sure', SURE)[1](nm(a.i)), { lead: a.i, sure: a.i })]]);
    else if (g >= 1.5 && g - gAgo > 0.1) {
      const w = pick('clear', CLEAR);
      news.push(['clear', [form(w[1](nm(a.i), gapWords(g)), { lead: a.i }), form(w[2](nm(a.i)), { lead: a.i })]]);
    }
    if (g >= PAIR) {
      const w = pick('still', STILL.filter(x => !x[3] || (g < 2 && g <= gAgo + 0.05))); // "holds off" is of a chaser who isn't being left behind
      places.push(['still', [form(w[1](nm(a.i), gapWords(g), nm(b.i)), { lead: a.i }), form(w[2](nm(a.i)), { lead: a.i })]]);
      if (!closing) {
        const v = pick('chase', CHASE);
        const lead = v[3] ? { lead: a.i } : null;
        places.push(['chase', [form(v[1](nm(b.i), gapWords(g), nm(a.i)), { second: b.i, ...lead }), form(v[2](nm(b.i)), { second: b.i })]]);
      }
    } else {
      const [x, y] = coin(a, b);
      places.push(['pair', [form(pick('cry', CRY)[1](nm(x.i), nm(y.i)), { pair: [a.i, b.i] })]]);
    }
    if (c) {
      const w = pick('third', THIRD);
      places.push(['third', [form(w[1](nm(c.i), gapWords(gapOf(b, c))), { third: c.i }), form(w[2](nm(c.i)), { third: c.i })]]);
    }
    const saidAt = kind => S.driveAt.get(kind) ?? -99;
    places.sort((x, y) => saidAt(x[0]) - saidAt(y[0]));
    const opts = [...news.filter(x => x[0] === 'heads' || x[0] === 'close' || wall(t) - wall(saidAt(x[0])) > 4), ...places];
    const fresh = opts.filter(x => x[0] !== S.drive);
    return (fresh.length ? fresh : opts).map(([kind, forms]) => forms.map(f => ({ ...f, drive: kind })));
  }

  // ------------------------------------------------------------ the walk

  // The fractions the caller gives: the quarter and the half, and the three quarters in a race of a mile
  // or more, when they come up before the stretch. (In a five-furlong race the half comes up at the eighth
  // pole, where the stretch call belongs: the clock shows it, and the caller calls the race.) The opening
  // quarter is fast or slow against a usual one for the distance: sprints go off quicker than routes.
  const furlongs = D / FURLONG;
  const par = furlongs < 6.25 ? 22.9 : furlongs < 7.25 ? 23.2 : 23.7;
  const fracs = run.fractions.filter(f => f.at < D - 1).slice(0, furlongs >= 7.9 ? 3 : 2)
    .map((f, k) => ({ k, t: f.t, at: f.at, pace: k ? '' : f.t < par - 0.6 ? 'fast' : f.t > par + 0.8 ? 'easy' : '' }))
    .filter(f => f.t < ev.tS - 1 && f.t <= fin - 6 && D - f.at >= FURLONG * 1.25);
  // What's coming, as times: a line being said is over before the next of these. A new leader and the turn
  // for home are news, and only give way to each other and the wire; anything else gives way to a fraction
  // and the poles as well.
  const news = [...ev.leads.map(e => e.t), ev.tS, fin].sort((a, b) => a - b);
  const hard = (headlines ? [...news, ev.tE] : [...news, ...fracs.map(f => f.t + 0.2), ev.tE, ev.tX]).sort((a, b) => a - b);

  const lineAt = (f, t, slot, kind = 'call') => {
    const urgent = kind === 'off' ? 'off' : f.wire ? 'wire' : f.change ? 'change' : f.placings ? 'placings' : 'other';
    const line = { t, ...f, say: aloud(f.say), kind, late: LATE[urgent], rank: urgent === 'off' || urgent === 'wire' || urgent === 'change' ? 1 : 0, slot: f.slot || slot };
    line.d = lineSeconds(line, fin - t);
    return line;
  };
  let w = -Infinity; // when the voice is next free, in real seconds from the off
  const give = line => { line.picks = picking; lines.push(line); note(line); w = wall(line.t) + line.d; };

  let gate = 5.2; // how long the horses stand in the gate before the off, in seconds
  if (fresh) {
    // Before the off. A race's name takes the voice a while ("The field is in the gate for the Odds and
    // Ends Handicap." is about three seconds), so that line comes up sooner than the plain one, to be done
    // by the off. With the bugle playing it comes when the bugle is over, and the gates wait for it: the
    // bugle, a moment, the line, a moment more, the bell.
    picking = [];
    const pre = lineAt(form(`${pick('pre', PRE)[1]}${race.name ? ` for the ${race.name}` : ''}.`), 0, 'pre', 'pre');
    const before = bugle ? pre.d + 0.4 : Math.min(5, Math.max(race.name ? 3.4 : 2.6, pre.d + 0.4));
    if (bugle) gate = Math.max(gate, bugle + 0.3 + before);
    pre.t = clock(wall(-t0) - before);
    give(pre);
  }
  if (!S.off && (fresh || from < -t0)) {
    picking = [];
    give(lineAt(form(pick('off', OFF)[1]), -t0, 'off', 'off'));
  }
  if (!fresh) w = Math.max(w, wall(from) + wait);

  const lastEnd = () => (lines.length ? wall(lines[lines.length - 1].t) + lines[lines.length - 1].d : -Infinity);
  const lastCall = wall(fin) - 0.9; // no new line after this, so the winner's line starts on time
  for (let guard = 0; guard < 900 && w <= lastCall; guard++) {
    const t = clock(w);
    if (t < 1.2) { w = wall(1.2); continue; }
    const o = ord(t), a = o[0], b = o[1];
    const g = b ? gapOf(a, b) : Infinity;
    const inStretch = t >= ev.tS;
    let forms = null, slot = '';
    picking = [];

    if (!inStretch && wall(ev.tS) - w <= (speed === 1 ? 2.5 : 1.5)) { w = wall(ev.tS); continue; } // kept clear for the turn for home
    const changed = S.leader !== null && !!b && a.i !== S.leader && g >= PAIR; // a new leader, not yet called
    const turning = inStretch && !S.turn && t - ev.tS <= 1.9; // within two seconds of the leader getting there, or not at all
    if (turning) { slot = 'turn'; forms = turnForms(o); }
    else if (changed) { slot = 'change'; forms = changeForms(o); }
    else if (!S.broke && t < 3.4 && !headlines) { slot = 'break'; forms = breakForms(); if (!forms) { S.broke = true; continue; } }
    else if (!S.first && t < FIRST) { w = wall(FIRST); continue; }
    else if (inStretch) {
      if (!S.eighth && t >= ev.tE - 0.2 && t - ev.tE <= 2.5) { slot = 'eighth'; forms = eighthForms(o, t); }
      else if (!headlines && !S.sixteenth && t >= ev.tX - 0.2 && t - ev.tX <= 1.2 && wall(fin) - w > 2.6) { slot = 'sixteenth'; forms = sixteenthForms(o); }
      else if (!headlines) { slot = 'drive'; forms = driveForms(o, t); }
    } else {
      const fr = !headlines && fracs.find(f => !S.frac[f.k] && t >= f.t + 0.2 - 1e-6 && t - f.t < 4);
      const seg = segmentAt(run.path, a.p), part = seg.name;
      const rest = o.filter(z => !S.pass.has(z.i));
      const again = !S.first || !S.pass.has(a.i) || wall(t) - wall(S.passAt) > 25
        || (part !== S.passWhere && part !== 'chute' && (headlines || !rest.length || S.pass.size >= Math.min(n, 5)));
      if (fr) { slot = 'frac'; forms = fracForms(fr); }
      else if (!headlines && (forms = troubleForms(o, t, 5))) slot = 'trouble';
      else if (again && (!headlines || !S.first || part !== S.passWhere)) { slot = 'run'; forms = S.first || t > 8 ? headForms(o, seg) : firstForms(o); }
      else if (headlines) { if (w - lastEnd() >= 3) { slot = 'fill'; forms = fillForms(o, t, true); } } // only the leader again, after a long quiet
      else if ((forms = moverForms(o, t))) slot = 'mover';
      else if (rest.length) { slot = 'more'; forms = moreForms(o, rest); }
      else if (w - lastEnd() >= 1.2) { slot = 'fill'; forms = fillForms(o, t); } // after a pause
    }
    if (!forms) { w += 0.5; continue; }
    const urgent = slot === 'change' || slot === 'turn';
    const next = (urgent ? news : hard).find(x => x > t + 0.05) ?? fin;
    let room = Math.min(LONGEST, wall(next) - w - (next === fin ? 0.15 : 0.3));
    // A new leader is called while it's news: in a wording that's over within about two and a half seconds
    // of the change, when there is one.
    let soon = room;
    if (changed) {
      const e = ev.leads.filter(x => x.t <= t + 0.05 && x.to === a.i).pop();
      if (e) soon = Math.min(room, 2.6 - (w - wall(e.t)));
    }
    if (!forms) { w += 0.5; continue; }

    // The longest form that's over before the next thing coming (the shortest, watching at speed), and
    // never a sentence that's been said already in this race. Where there's more than one thing that
    // could be said, the first of them with a form that fits.
    let any = false;
    const fit = (as, list, limit, shortest = brief) => {
      for (const group of (Array.isArray(list[0]) ? list : [list])) {
        const made = group.filter(f => !S.texts.has(f.text)).map(f => lineAt(f, t, as, as === 'frac' ? 'frac' : 'call'));
        any = any || made.length > 0;
        const found = (shortest ? made.slice().reverse() : made).find(l => l.d <= limit);
        if (found) return found;
      }
      return null;
    };
    let line;
    if (turning && changed) {
      // Turning for home with a new leader: both at once in a wording that names it, if there's one short
      // enough (or nearly) to be news; otherwise the new leader first, and "they turn for home" after it
      // if there's still time.
      const change = changeForms(o);
      line = fit('turn', forms.slice(0, 1), soon) || fit('turn', forms.slice(0, 1), Math.min(room, soon + 0.8), true)
        || fit('change', change, soon) || fit('change', change, room, true) || fit('turn', forms, room);
    } else line = fit(slot, forms, soon) || (soon < room ? fit(slot, forms, room, true) : null);
    if (!line) {
      // Nothing fits before what's coming. A fraction or the break is let go (the clock shows the
      // fraction); anything else waits for what's coming.
      if (slot === 'frac') { S.frac[forms[0].frac] = true; continue; }
      if (slot === 'break') { S.broke = true; continue; }
      w = any ? Math.max(w + 0.25, wall(next)) : w + 0.5;
      continue;
    }
    give(line);
    w += t >= ev.tS ? 0.15 : 0.3; // a breath
  }

  // The finish. Its wordings have their own draws, so it's called the same way however the race was planned.
  const [first, second, third] = run.results;
  const photo = !!second && second.toPrev < 0.3;
  const F = rng(`finish:${race.seed}`);
  const choose = list => list[Math.floor(F() * list.length)];
  // In a photo the caller doesn't know who won until the picture is read, so no line with a time on it
  // says: the two are named in an order picked by a coin toss, and the winner's line is handed back on
  // its own, for when the official sign goes up.
  const official = photo ? choose(OFFICIAL)[1](nm(first.h), finishWords(second.toPrev)) : null;
  if (!lines.some(l => l.wire)) {
    let wire, rest;
    if (photo) {
      const [x, y] = F.chance(0.5) ? [first, second] : [second, first];
      const waits = choose(PHOTO_WAIT)[1](nm(x.h), nm(y.h));
      wire = form(choose(PHOTO)[1](nm(x.h), nm(y.h)), { wire: true, pair: [x.h, y.h] });
      const tail = time => `${waits}${third ? ` ${nm(third.h)} is third.` : ''} The time, ${time}.`;
      rest = form(tail(timeWords(fin)), { placings: true }, tail(timeSay(fin)));
    } else {
      const m = second ? second.toPrev : 0;
      // A winner who wasn't in front a second before the wire got up in the last strides. "Going away" is
      // for a winner still running at least as fast as the runner-up at the wire, and "holds on" for one
      // who led a second out and had the runner-up, under a length away, finishing the faster.
      const late = !!second && ord(fin - 1)[0].i !== first.h;
      const list = !second ? null : late ? GETS_UP : m > 6 ? ROMP : m > 2.5 && first.finishSpeed >= second.finishSpeed ? AWAY
        : m < 1 && second.finishSpeed > first.finishSpeed ? HOLDS : WINS;
      const text = list ? choose(list)[1](nm(first.h), finishWords(m)) : `${nm(first.h)} wins it all alone!`;
      wire = form(text, { wire: true, ...(late ? { up: true } : null), ...(list === AWAY ? { away: true } : null), ...(list === HOLDS ? { holds: true } : null) });
      const placed = second ? (third ? choose(PLACED)[1](nm(second.h), nm(third.h)) : `${nm(second.h)} second.`) : '';
      const tail = time => `${placed ? `${placed} ` : ''}The time, ${time}.`;
      rest = form(tail(timeWords(fin)), { placings: true }, tail(timeSay(fin)));
    }
    picking = [];
    give(lineAt(wire, fin + 0.05, 'wire', 'finish'));
    // Second, third and the time follow the winner's line directly.
    give(lineAt(rest, clock(w + 0.35), 'placings', 'finish'));
  }
  return { lines, photo, official, dur, gate };
}

// The call while a race is being watched: the plan made at the gate, the line that's up, and planning
// the rest again when something changes. `factor()` is how the voice's real pace compares with what the
// plan took it to be (1 until it has been timed): when that moves by more than 8%, the rest of the race
// is planned again. All times given to it are the race's clock and real seconds.
export function liveCall(race, run, names, { lineSeconds, factor = () => 1, bugle = 0 } = {}) {
  let speed = 1;
  let madeFor = factor();
  let upLine = null, upAt = 0;  // the line that's up, and when it came up
  let seen = -Infinity;         // the race's clock, the last time anyone asked
  const first = raceCall(race, run, names, { lineSeconds, bugle });
  const live = { lines: first.lines, photo: first.photo, official: first.official, dur: first.dur, gate: first.gate, plans: 1 };
  // Plans the rest of the race again from `clock`. The line being said is let finish (by the estimate),
  // unless `wait` says how long the voice needs, as after a cancel.
  function again(clock, now, wait = null) {
    const said = live.lines.filter(l => l.t <= seen);
    if (said.some(l => l.wire)) return; // the call at the wire has been made: what's left follows it
    madeFor = factor();
    const left = wait ?? (upLine ? Math.max(0, upLine.d - (now - upAt)) : 0);
    live.lines = raceCall(race, run, names, { lineSeconds, speed, from: clock, wait: left, said }).lines;
    live.plans++;
  }
  // The line that has come up by `clock`, if it's a new one. `now` is the time in real seconds.
  live.next = (clock, now) => {
    if (Math.abs(factor() / madeFor - 1) > 0.08) again(clock, now);
    seen = clock;
    let line = null;
    for (const l of live.lines) { if (l.t <= clock) line = l; else break; }
    if (!line || line === upLine) return null;
    upLine = line; upAt = now;
    return line;
  };
  // The watching speed has changed: no line is cut off for it, and the rest is planned for the new speed.
  live.setSpeed = (s, clock, now) => { if (s !== speed) { speed = s; again(clock, now); } };
  // The race has been skipped ahead to `clock`, and the voice cancelled: plan from there.
  live.skip = (clock, now) => again(clock, now, 0.3);
  return live;
}

export function marginPhrase(l) { return marginText(l); }
export { lengthsText };
