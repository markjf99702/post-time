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
const { game, newMeet, load, save, notSaved, card, toteFor, placeBet, goToGate, mtpState, currentBoard, advanceDay, callFor, horseOf, runnersFor, photoRecord, forumFor, bestDay } = await import('../js/game.js');
const { stateAt, RAIL } = await import('../js/sim.js');
const { LENGTH, FURLONG, segmentAt } = await import('../js/track.js');
const { raceCall, raceClock } = await import('../js/call.js');
const { marginShort } = await import('../js/chart.js');
const { buildWorld, meetStats, ownerSilks, simulateRace } = await import('../js/world.js');
const { TRAINERS, OWNERS, SIRES } = await import('../js/data.js');
const { runStyle } = await import('../js/forum.js');
const { makeTote, board } = await import('../js/tote.js');

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
// came to is kept for the tests below, so the meet is played once. The call is the one made at the gate
// for watching at normal speed, by a voice as quick as the model in js/audio.js takes one to be. Every
// fourth race is called again for watching at 2x and at 4x, and those calls are kept too.
let longMeet = null;
function playLongMeet(days = 60) {
  if (longMeet) return longMeet;
  build('long-meet');
  const races = [];
  // Riders' and trainers' records, held against a count made here from each result: `off` lists the races
  // after which they differ, and `overnight` the race days after which a record changed with no race run.
  const records = { off: [], overnight: [], opening: meetStats(game.world) };
  let was = records.opening;
  for (let d = 0; d < days; d++) {
    for (const race of card().races) {
      const posted = forumBefore(race);
      const { run } = goToGate(race);
      const want = structuredClone(was);
      race.entries.forEach((e, k) => {
        const rows = [want.jockeys[e.j], want.trainers[(e.ran || horseOf(e)).trainer]];
        for (const row of rows) { row.starts++; if (k === run.results[0].h) row.w++; }
      });
      was = meetStats(game.world);
      if (JSON.stringify(was) !== JSON.stringify(want)) records.off.push(`race day ${d + 1}, race ${race.no}`);
      const call = callFor(race, run);
      const names = race.entries.map(e => horseOf(e).name);
      const at = { day: d + 1, no: race.no };
      races.push({
        ...at, field: race.entries.length, lines: call.lines.map(l => l.text), photo: call.photo, f: race.f,
        winner: horseOf(race.entries[run.results[0].h]).name, reactions: (race.forumAfter || []).map(p => p.text),
        second: run.results[1] ? horseOf(race.entries[run.results[1].h]).name : null, official: call.official,
        // Each runner's line for this race: its trip note, where it was at the first call, a furlong out and
        // at the finish, and how far behind the winner.
        notes: race.entries.map(e => { const p = horseOf(e).pps.at(-1); return { cm: p.cm, first: p.line[0][0], str: p.line[2][0], fin: p.fin, bl: p.bl }; }),
        forum: { ...posted, ...forumAfter(race, run) },
        ...callAgainstRace(race, run, call, names),
        fast: races.length % 4 ? null : [2, 4].map(speed => ({ speed, ...at, ...callAgainstRace(race, run, raceCall(race, run, names, { speed }), names, speed) })),
        skip: afterSkip(race, run, names),
        skipFast: [2, 4].map(speed => afterSkip(race, run, names, speed)),
      });
    }
    advanceDay();
    const next = meetStats(game.world);
    if (JSON.stringify(next) !== JSON.stringify(was)) records.overnight.push(`after race day ${d + 1}`);
    was = next;
  }
  records.closing = was;
  races.records = records;
  return (longMeet = races);
}

// The race watched for 22 seconds and then skipped, the way the Skip button does it (to twelve seconds
// before the wire): the first line the caller gives from there, and, when it calls a new leader, how long
// that horse had had its head in front by then.
function afterSkip(race, run, names, speed = 1) {
  const fin = run.finalTime, to = fin - 12;
  if (to <= 23) return null;
  const live = callFor(race, run);
  let now = 0;
  if (speed !== 1) live.setSpeed(speed, -run.t0, now);
  for (let t = -run.t0; t <= 22; t += 0.1 * speed) { live.next(t, now); now += 0.1; }
  live.skip(to, now);
  const first = live.lines.find(l => l.t >= to);
  if (!first) return null;
  const front = t => stateAt(run, run.t0 + t, []).reduce((a, x, i, st) => (x.p > st[a].p ? i : a), 0);
  let old = 0;
  if (first.change) while (old < first.t && front(first.t - old - 0.1) === first.lead) old += 0.1;
  return { speed, text: first.text, t: first.t, change: !!first.change, lead: first.lead !== undefined || !!first.pair, old };
}

// The forum thread for a race, taken down before it's run: what each regular posted, and what the card
// says about the horse he put on top (the card changes once the race is run).
function forumBefore(race) {
  const lines = h => h.pps.map(l => ({ fig: l.fig, surf: l.surf, cm: l.cm, cls: l.cls, clm: l.clm, dt: l.dt }));
  return {
    date: race.date, f: race.f, surface: race.surface[0], claim: race.claim, greys: race.entries.filter(e => horseOf(e).coat === 'grey').length,
    figs: Object.fromEntries(race.entries.map(e => [e.pp, horseOf(e).pps.slice(-3).map(l => [l.fig, l.surf])])),
    posts: forumFor(race).map(p => {
      const e = race.entries[p.pick[0]], h = e && horseOf(e);
      return {
        who: p.who, text: p.text, pp: e ? e.pp : null,
        top: h ? { style: runStyle(h), sire: SIRES.find(x => x.name === h.sire).dist, paddock: e.pdk.kind, starts: h.life.starts, lines: lines(h), works: h.works.map(w => ({ dt: w.dt, rank: w.rank, f: w.f })) } : null,
      };
    }),
  };
}
// And after it: who ChalkEater had when the gate opened against the favourite on the final board, his
// wins as the game keeps them, and each regular's reaction with the trip note of the horse he was on.
function forumAfter(race, run) {
  const odds = race.result.odds, chalk = race.forum.find(p => p.who === 'chalk');
  return {
    chalk: { pick: chalk.pick[0], odds, win: run.results[0].h, wins: game.world.tipsters.chalk.wins },
    after: (race.forumAfter || []).map(a => ({ who: a.who, text: a.text, won: a.won, note: horseOf(race.entries[race.forum.find(p => p.who === a.who).pick[0]]).pps.at(-1).cm })),
  };
}

// A line with the horses' names, the margins and the times taken out, so two lines made the same way read
// the same: "N leads by G, N second, N third."
const GAPS = /\b(a nose|a head|a neck|a half length|three quarters of a length|a length and a quarter|a length and a half|a length and three quarters|a length|[a-z]+(-[a-z]+)? lengths)\b/g;
const PLACES = /\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/g;
function shapeOf(text, names) {
  let x = text;
  for (const n of names.slice().sort((a, b) => b.length - a.length)) x = x.split(n).join('N');
  return x.replace(/the eighth pole/, 'the 8 pole').replace(GAPS, 'G').replace(/\b\d+(:\d\d)?( and \d| flat)|\d*:?\d\d\.\d\d/g, 'T').replace(PLACES, 'Kth');
}
// The wordings that put a horse in front, as they read once the names are taken out.
const LEADS = [/N leads\b/, /[Ii]t's N( by|[.!]| in front)/, /N shows the way/, /N is in front/, /N sets the pace/, /N has the lead/,
  /N (breaks on top|is quickest away|goes right to the front|shoots to the lead|is first to show|takes them along)/,
  /N (recovers|has recovered)( quickly)? (to lead|and leads)/, /N from N!/, /N leads N!/, /^N, then N!$/, /N takes over/, /takes the lead!/, /N strikes the front/, /N goes to the lead/, /N is the new leader/, /Now it's N/,
  /N is back in front/, /N fights back to lead/, /N comes again/, /N takes it back/, /N by G/, /N continues to lead/, /Still N/,
  /N on the lead/, /N still shows the way/, /N keeps the lead/, /N (is )?still in front/, /Up front it's N/, /N has G on N/,
  /N out in front/, /N in front/, /N opens up/, /N is (G )?clear/, /N widens/, /N kicks away/, /N goes on/, /N holds (N off|on!)/,
  /drawing away/, /won't catch N/, /It's all N/, /Nobody is catching N/, /N is home free/, /N is long gone/, /No catching N/,
  /N has them all beaten/, /closing on N/, /after N!/, /into N's lead/, /gaining on N/, /but N still/, /chases N/];
const CHANGES = /takes over|takes the lead!|strikes the front|goes to the lead|is the new leader|leads now|[Nn]ow it's N|back in front|fights back to lead|comes again|takes it back/;
const AGAIN = /back in front|fights back to lead|comes again|takes it back/;
const PASSED = /takes over from N|goes by N and|N is headed|, past N!/;
const SURE = /drawing away|won't catch|It's all N|Nobody is catching|home free|long gone|No catching|all beaten/;
const SIDES = /on the outside|widest of all|\b[a-z]+ wide\b|on the rail|on the inside|along the rail|up the rail/g;
const WHERE = {
  backstretch: /^(Down|Along|On|Into|Midway down) the backstretch, /, 'far turn': /^(Around|On|Into) the (far )?turn, |^Midway on the turn, /,
  'clubhouse turn': /^(Around|On|Into) the (clubhouse|first) turn, /, stretch: /^(Past|By) the stands( the first time)?, /,
};

// The race call held against the recorded race, line by line, each at the moment it comes up. `wrong`
// lists what the caller said that the race doesn't show, by kind; `said` counts what he said; the rest
// is how the call fills the race (how much of it is silence, who gets named, how soon a new leader is
// called), for the tests on the whole meet. `speed` is the speed the call was made for watching at.
const SAY = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const CHART_SAYS = { nk: 'a neck', '½': 'a half length', '¾': 'three quarters of a length', 1: 'a length', '1¼': 'a length and a quarter', '1½': 'a length and a half', '1¾': 'a length and three quarters' };
const lengthsSaid = n => `${n < 21 ? SAY[n] : `${['', '', 'twenty', 'thirty', 'forty', 'fifty'][Math.floor(n / 10)]}${n % 10 ? `-${SAY[n % 10]}` : ''}`} lengths`;
function callAgainstRace(race, run, call, names, speed = 1) {
  const wrong = {}, said = {};
  const bad = (kind, l, why = '') => (wrong[kind] || (wrong[kind] = [])).push(`${l.text}${why && ` (${why})`}`);
  const count = kind => { said[kind] = (said[kind] || 0) + 1; };
  const fin = run.finalTime, D = run.distance, top = run.path[run.path.length - 1].start;
  const { wall, clock } = raceClock(run, speed);
  const order = t => stateAt(run, run.t0 + t, []).map((x, i) => ({ ...x, i })).sort((a, b) => b.p - a.p);
  const front = st => st.reduce((a, x, i) => (x.p > st[a].p ? i : a), 0);
  const [w, s] = run.results;
  // What happens in the race, to the tenth of a second: the leader reaching the stretch and the furlong
  // pole, and each time a new horse gets a quarter of a length in front. A change of leader counts from
  // eight seconds in, when the first call has been made: before that the field is sorting itself out.
  let tS = fin, tE = fin, cur = null;
  const changes = [];
  for (let t = 0; t < fin; t += 0.1) {
    const o = order(t);
    if (tS === fin && o[0].p >= top) tS = t;
    if (tE === fin && D - o[0].p <= FURLONG) tE = t;
    if (t < 4) continue;
    if (cur === null) cur = o[0].i;
    else if (o[0].i !== cur && (o[0].p - o[1].p) / LENGTH >= 0.25) { cur = o[0].i; if (t >= 8) changes.push({ t, to: cur }); }
  }
  const troubles = run.events.filter(e => e.type === 'checked');
  const texts = new Set(), led = new Set(), movers = new Set(), tired = new Set(), drives = [];
  const shapes = [];
  let lastNamed = null, pace = null, firstRun = null, threeQuarters = false, slowAway = null;
  call.lines.forEach((l, k) => {
    const st = stateAt(run, run.t0 + l.t);
    const o = order(l.t);
    const x = l.text, before = call.lines[k - 1], shape = shapeOf(x, names);
    const running = l.t > 0 && l.t < fin;
    shapes.push([l.slot, shape]);
    const gap = (a, b) => (st[a].p - st[b].p) / LENGTH;
    // In order, each when the one before is over (by the estimate it was planned with), and none too long.
    if (before && wall(l.t) < wall(before.t) + before.d - 1e-6) bad('crowded', l, `${(wall(l.t) - wall(before.t)).toFixed(2)} s after "${before.text}", which takes ${before.d.toFixed(2)}`);
    if (!(l.d > 0.3 && l.d <= 8)) bad('long', l, `${l.d.toFixed(2)} s`);
    if (texts.has(x)) bad('twice', l);
    texts.add(x);
    // A horse named as the leader is in front, clear by a quarter of a length (anything less is a pair,
    // with no word on which of them leads), and a lead change is news.
    const finish = l.kind === 'finish';
    if (!finish && LEADS.some(re => re.test(shape)) !== (l.lead !== undefined)) bad('leader', l, 'names a leader and does not say which, or the other way round');
    if (l.lead !== undefined) {
      count('leader');
      if (!x.includes(names[l.lead])) bad('leader', l, `means ${names[l.lead]}`);
      if (front(st) !== l.lead) bad('leader', l, `${names[front(st)]} is in front`);
      else if (o[1] && gap(o[0].i, o[1].i) < 0.25 - 1e-9) bad('pair', l, `only ${gap(o[0].i, o[1].i).toFixed(2)} in front`);
      if (CHANGES.test(shape) !== !!l.change || !!l.change !== (l.slot === 'change')) bad('change', l, 'a lead change not marked as one, or the other way round');
      if (l.change) {
        count('change');
        if (lastNamed === l.lead) bad('change', l, 'already named as the leader');
        if (AGAIN.test(shape) !== led.has(l.lead)) bad('change', l, led.has(l.lead) ? 'led before, and is called as new to the lead' : 'has not led before');
        // The horse it took over from, when the line names one, is the horse running second just then.
        if (PASSED.test(shape) !== (l.passed !== undefined)) bad('passed', l, 'names the horse passed and is not marked so, or the other way round');
        if (l.passed !== undefined) {
          count('passed');
          if (o[1].i !== l.passed || !x.includes(names[l.passed])) bad('passed', l, `${names[l.passed]} is ${NTH[o.findIndex(z => z.i === l.passed) + 1]}, ${gap(o[0].i, l.passed).toFixed(1)} lengths back`);
        }
      }
      lastNamed = l.lead;
      led.add(l.lead);
    }
    if (l.pair && running) {
      count('pair');
      const two = [o[0].i, o[1].i];
      if (!l.pair.every(i => two.includes(i) && x.includes(names[i])) || gap(o[0].i, o[1].i) >= (l.slot === 'run' && !firstRun ? 0.5 : 0.25)) bad('pair', l, `${names[o[0].i]} leads ${names[o[1].i]} by ${gap(o[0].i, o[1].i).toFixed(2)}`);
    }
    if (/stride for stride/.test(x) && !(l.pair && gap(o[0].i, o[1].i) < 0.25)) bad('pair', l, 'not inside a quarter of a length');
    // The first call: "right there" is within a length, three across is three within a quarter of a length each.
    if (/right there|close up|just behind/.test(x) !== (l.near !== undefined)) bad('near', l, 'not marked');
    if (l.near !== undefined) { count('near'); if (o[2].i !== l.near || gap(o[1].i, o[2].i) >= 1) bad('near', l, `${gap(o[1].i, o[2].i).toFixed(2)} lengths behind the pair`); }
    if (/three across|all go for the lead|break in a line|, N and N are away together/.test(shape) !== (l.across !== undefined)) bad('near', l, 'three together, not marked');
    if (l.across !== undefined) { count('three across'); if (gap(o[0].i, o[1].i) >= 0.25 || gap(o[1].i, o[2].i) >= 0.25) bad('near', l, 'not three across'); }
    // A horse called for stumbling or breaking slowly, and then named in the first call: it "recovers" to
    // be there, and no wording has it breaking with the rest.
    if (/recover/.test(x) !== (l.recovered !== undefined)) bad('recovered', l, 'not marked');
    if (l.slot === 'run' && !firstRun && slowAway && l.t - slowAway.t < 6) {
      const z = slowAway.who, n = names[z];
      if (x.includes(n)) {
        count('recovered');
        const even = shape.replace(n, 'N') !== shape && (/three across|all go for the lead|break in a line|, N and N are away together/.test(shape) || new RegExp(`${n} (breaks on top|is quickest away|goes right to the front|shoots to the lead|is first to show|takes them along|and [^,.]+ (go at it early|vie for the early lead|break together|are away together|show the early speed))|and ${n} (go at it early|vie for the early lead|break together|are away together|show the early speed)`).test(x));
        if (l.recovered !== z || even || !new RegExp(`${n} (recovers|has recovered)`).test(x) || o.findIndex(y => y.i === z) > 2) bad('recovered', l, `after "${slowAway.text}"`);
      }
    }
    if (l.slot === 'run' && !firstRun) { firstRun = l; if (l.lead === undefined && !(gap(o[0].i, o[1].i) < 0.5)) bad('near', l, 'vying for the lead from more than half a length apart'); }
    // Where a horse is said to be running: on the rail, on the outside, so many wide. A horse making a
    // move, or flying, with no word on where, is between horses.
    const sides = l.sides || [];
    if ((x.match(SIDES) || []).length !== sides.length) bad('place', l, 'says where a horse is and is not marked so, or the other way round');
    for (const { i, side } of sides) {
      count(side);
      const paths = st[i].o - RAIL; // off the rail, as the chart measures it
      const ok = side === 'wide' ? paths >= 2.5 && x.endsWith(` ${SAY[Math.round(paths) + 1]} wide.`) : side === 'outside' ? paths >= 2.5 : paths < 0.8;
      if (!ok || !x.includes(names[i]) || (/widest of all/.test(x) && st.some(z => z.o > st[i].o))) bad('place', l, `${names[i]} is ${paths.toFixed(2)} paths off the rail`);
    }
    if ((l.slot === 'mover' || (l.drive === 'fly' && l.from === undefined)) && !sides.length) {
      count('between');
      const paths = st[l.who].o - RAIL;
      if (!(paths >= 0.8 && paths < 2.5)) bad('place', l, `${paths.toFixed(2)} paths off the rail, and not said to be`);
    }
    // A horse making a move: after the first twenty seconds, before the stretch, in the first five or
    // within five lengths of the lead, and gaining on the leader. Each horse once.
    if (/is on the move|picking them off|starts to roll|making a run|is moving up|making up ground/.test(x) !== (l.slot === 'mover')) bad('mover', l, 'not marked');
    if (l.slot === 'mover') {
      count('mover');
      const k2 = o.findIndex(z => z.i === l.who), back = gap(o[0].i, l.who);
      if (!(l.t > 20) || !(l.t < tS) || !(k2 < 5 || back <= 5) || !(st[l.who].v > o[0].v) || movers.has(l.who) || !x.startsWith(names[l.who])) bad('mover', l, `${l.t.toFixed(1)} s in, ${NTH[k2 + 1]}, ${back.toFixed(1)} lengths back`);
      movers.add(l.who);
    }
    // A horse flying in the stretch is within three lengths of the leader, or is given its place; it's
    // the fastest horse in the race just then, and isn't stopped in the next two seconds.
    if (l.drive === 'fly') {
      count('flying');
      const k2 = o.findIndex(z => z.i === l.who), back = gap(o[0].i, l.who);
      if (l.from === undefined ? back >= 3 : (l.from !== k2 + 1 || !x.includes(`from ${NTH[k2 + 1]}`) && !x.startsWith(`From ${NTH[k2 + 1]}`))) bad('flying', l, `${NTH[k2 + 1]}, ${back.toFixed(1)} lengths back`);
      if (st.some(z => z.v > st[l.who].v) || troubles.some(e => e.h === l.who && e.t > run.t0 + l.t && e.t < run.t0 + l.t + 2)) bad('flying', l, 'not the fastest, or about to be stopped');
    }
    // ...and it's a horse with a say in the finish: within three lengths of the leader or in the first four,
    // nearer the leader than two seconds ago, and not one that was itself in front in the last twenty.
    if (l.drive === 'fly') {
      const k2 = o.findIndex(z => z.i === l.who), back = gap(o[0].i, l.who);
      const ago = order(l.t - 2), was = (ago[0].p - ago.find(z => z.i === l.who).p) / LENGTH;
      let led = false;
      for (let b = 0; b <= 20 && !led; b += 0.25) led = l.t - b > 0 && order(l.t - b)[0].i === l.who;
      if (!(back < 3 || k2 < 4)) bad('running on', l, `${NTH[k2 + 1]}, ${back.toFixed(1)} lengths back`);
      if (back > was) bad('running on', l, `${was.toFixed(1)} lengths back two seconds before, ${back.toFixed(1)} now`);
      if (led) bad('running on', l, 'led in the last twenty seconds');
    }
    // A horse coming for second is going faster than the second horse: the third horse, within two lengths
    // of it, or one from further back that gets to it by the wire at the speeds the two are going.
    if (/for second!$/.test(x) !== (l.forSecond !== undefined || l.minor !== undefined)) bad('for second', l, 'not marked');
    // Two at it for second, behind a leader a length clear or more: the second and third, within
    // half a length of each other, and inside a quarter of a length when they're "together" or "side by side".
    if (l.minor) { count('two for second'); if (!l.minor.every(i => (i === o[1].i || i === o[2].i) && x.includes(names[i])) || gap(o[1].i, o[2].i) >= (/together|side by side/.test(x) ? 0.25 : 0.5) || gap(o[0].i, o[1].i) < 1) bad('for second', l, `${names[o[1].i]} leads ${names[o[2].i]} by ${gap(o[1].i, o[2].i).toFixed(2)}, ${gap(o[0].i, o[1].i).toFixed(1)} behind the leader`); }
    if (l.forSecond !== undefined) {
      count('for second');
      const second = st[o[1].i], me = st[l.forSecond], k2 = o.findIndex(z => z.i === l.forSecond);
      const gets = (me.v - second.v) * (D - second.p) / Math.max(1, second.v) >= second.p - me.p - 1e-6;
      if (k2 < 2 || !(me.v > second.v) || !((k2 === 2 && gap(o[1].i, l.forSecond) < 2) || gets) || !x.includes(names[l.forSecond])) bad('for second', l, `${names[l.forSecond]} is ${NTH[k2 + 1]}, ${gap(o[1].i, l.forSecond).toFixed(1)} lengths behind the second horse`);
    }
    // A horse that "moves up to second" is second, and was third or worse three seconds before.
    if (/moves up to second!|is second now!|^Now .+ is second!|is into second!/.test(x) !== (l.moved !== undefined)) bad('for second', l, 'a move to second, not marked');
    if (l.moved !== undefined) {
      count('up to second');
      const was = order(l.t - 3).findIndex(z => z.i === l.second);
      if (o[1].i !== l.second || was < 2 || !x.includes(names[l.second])) bad('for second', l, `${NTH[was + 1]} three seconds before`);
    }
    // "Then ..." and "Behind them ..." carry on from the horse before: only after a line of the run through the field.
    if (running && /^(Then|Behind them)\b/.test(x) && before && !['run', 'more'].includes(before.slot)) bad('then', l, `after "${before.text}"`);
    // The second horse isn't given again straight after a line that named it.
    if (l.drive === 'chase' && before && before.text.includes(names[l.second])) bad('repeated', l, `after "${before.text}"`);
    // A horse that's tiring was called the leader in the last twenty seconds, is third or worse or two lengths
    // behind by now, and is going slower than the horse in front. Once for each horse.
    if (/ is tiring[,.]| drops back[ .]| gives way[,.]| has had enough[,.]/.test(x) !== (l.tired !== undefined)) bad('tiring', l, 'not marked');
    if (l.tired !== undefined) {
      count('tiring');
      const k2 = o.findIndex(z => z.i === l.tired), back = gap(o[0].i, l.tired);
      const ledAt = call.lines.slice(0, k).filter(z => z.lead === l.tired).map(z => z.t).pop();
      if (!(l.t - ledAt <= 20) || !(k2 >= 2 || back >= 2) || !(st[l.tired].v < o[0].v) || tired.has(l.tired) || !x.startsWith(names[l.tired]) || (/back in|back to|now\./.test(x) && !x.includes(NTH[k2 + 1]))) bad('tiring', l, `${NTH[k2 + 1]}, ${back.toFixed(1)} lengths back, called the leader ${(l.t - ledAt).toFixed(1)} s before`);
      tired.add(l.tired);
    }
    if (l.slot === 'trouble') { count('trouble'); if (!troubles.some(e => e.h === l.who && e.t <= run.t0 + l.t && run.t0 + l.t - e.t < 1.2) || !x.includes(names[l.who])) bad('trouble', l, 'nobody was stopped'); }
    // Closing: gaining on the leader, from within three lengths; closing fast, a quarter of a length a second.
    if (l.closing) {
      count('gaining');
      const a = st[o[0].i], b = st[l.who];
      const gapNow = (a.p - b.p) / LENGTH;
      if (o[1].i !== l.who || !(gapNow < 3) || !(b.v > a.v) || !x.includes(names[l.who])) bad('closing', l, `${gapNow.toFixed(1)} lengths back, ${(b.v - a.v).toFixed(2)} m/s faster`);
    }
    if (/closing fast/.test(x)) {
      count('closing');
      const ago = stateAt(run, run.t0 + l.t - 1);
      const was = l.closing ? (ago[o[0].i].p - ago[l.who].p) / LENGTH - gap(o[0].i, l.who) : NaN;
      if (!(was > 0.25) || !x.startsWith(`${names[l.who]} closing fast`)) bad('closing', l, `gained ${was.toFixed(2)} lengths in the last second`);
    }
    // Sure of the winner: it wins, and not in a photo.
    if (!finish && SURE.test(shape) !== (l.sure !== undefined)) bad('sure', l, 'sounds sure and is not marked so, or the other way round');
    if (l.sure !== undefined) {
      count(/home free|long gone|No catching|all beaten/.test(x) ? 'home free' : 'sure');
      if (call.photo || l.sure !== w.h || !x.includes(names[w.h])) bad('sure', l, `${names[w.h]} won${call.photo ? ' in a photo' : ` by ${s.toPrev.toFixed(2)}`}`);
    }
    if (/still in front by/.test(x)) count('still in front');
    // The second and third horses, the last one and how far it is off the lead, and how far the field is spread.
    if (l.second !== undefined && (o[1].i !== l.second || !x.includes(names[l.second]))) bad('places', l, `${names[o[1].i]} is second`);
    if (l.third !== undefined && (o[2].i !== l.third || !x.includes(names[l.third]))) bad('places', l, `${names[o[2].i]} is third`);
    if (/ trails| is last| brings up the rear| is at the back/.test(x) !== (l.last !== undefined)) bad('places', l, 'the last horse, not marked');
    if (l.last !== undefined) {
      count('last');
      const off = Math.round(gap(o[0].i, l.last));
      if (o[o.length - 1].i !== l.last || (l.off !== undefined) !== / off the lead| off the pace| from the leader| behind the leader/.test(x) || (l.off !== undefined && (l.off !== off || !x.includes(lengthsSaid(off))))) bad('places', l, `${names[o[o.length - 1].i]} is last, ${off} lengths back`);
    }
    if (l.spread !== undefined) { count('spread'); const all = Math.round(gap(o[0].i, o[o.length - 1].i)); if (l.spread !== all || !x.toLowerCase().includes(lengthsSaid(all))) bad('places', l, `${all} lengths from first to last`); }
    // The horses a run through the field names are named, and the part of the track is the one the leader is on.
    for (const i of l.named || []) if (!x.includes(names[i])) bad('places', l, `${names[i]} is not in it`);
    if (Object.values(WHERE).some(re => re.test(x)) !== !!l.whereSaid) bad('where', l, 'not marked');
    if (l.whereSaid) {
      count('where');
      const seg = segmentAt(run.path, o[0].p), into = o[0].p - seg.start, part = into / Math.max(1, seg.len);
      if (seg.name !== l.where || !WHERE[l.where].test(x) || (/^Into /.test(x) && into >= 90) || (/^Midway /.test(x) && !(part > 0.38 && part < 0.62))) bad('where', l, `the leader is ${Math.round(into)} m into the ${seg.name}`);
    }
    // The break. It's a clean one only if nobody stumbled, broke slowly or was bumped.
    if (/clean (break|start)|break cleanly/.test(x) !== !!l.clean) bad('break', l, 'not marked');
    if (l.clean) { count('clean break'); if (run.results.some(r => r.bumped || r.slow || r.stumble)) bad('break', l, 'somebody bumped, stumbled or broke slowly'); }
    if (l.slot === 'break' && !l.clean) {
      count('break');
      if (l.who !== undefined) slowAway = l;
      const r = i => run.results.find(z => z.h === i);
      const ok = /stumble/.test(x) ? r(l.who).stumble && x.includes(names[l.who]) : /slow/.test(x) ? r(l.who).slow && x.includes(names[l.who])
        : /bump|come together/.test(x) && run.results.filter(z => z.bumped).every(z => x.includes(names[z.h]));
      if (!ok) bad('break', l, 'not what happened at the start');
    }
    if (/whisker/.test(x) || /\b(1?\d|20) lengths?\b/.test(x)) bad('words', l);
    // The fractions: the quarter is fast or slow for the distance, and the three quarters is called in a route.
    if (l.kind === 'frac') {
      count('fraction');
      if (l.frac === 0) pace = { f: race.f, remark: l.remark };
      if (l.frac === 2) threeQuarters = true;
      const f = run.fractions[l.frac];
      const remark = /fast pace|that's quick|flying early|sharp pace/.test(x) ? 'fast' : /nice and easy|easy pace|no hurry|soft pace/.test(x) ? 'easy' : '';
      if (remark !== l.remark || !/quarter|half|furlongs/i.test(x) || !(l.t >= f.t && l.t - f.t < 4.5) || !(f.t < tS)) bad('fraction', l, `${(l.t - f.t).toFixed(1)} s after it`);
    }
    // Turning for home, a furlong out and the sixteenth pole are said as the leader gets there.
    if (/turn for home|[Ii]nto the stretch|straighten for home|Turning for home/.test(x) !== (l.slot === 'turn')) bad('poles', l, 'not marked');
    if (l.slot === 'turn' && !(l.t >= tS - 1e-6 && l.t - tS <= 2)) bad('poles', l, `${(l.t - tS).toFixed(2)} s after the leader reached the stretch`);
    if (l.t > tS - 2.5 + 1e-6 && l.t < tS - 1e-6 && speed === 1) bad('poles', l, `starts ${(tS - l.t).toFixed(2)} s before the turn for home, which is kept clear`);
    if (l.slot === 'eighth') { const toGo = D - o[0].p; if (!(toGo <= FURLONG + 5) || (/A furlong (to go|out)|At the eighth pole|One furlong left/.test(x) && l.t - tE > 1.05)) bad('poles', l, `${Math.round(toGo)} m to go`); }
    if (l.slot === 'sixteenth') { const toGo = D - o[0].p; if (!(toGo <= FURLONG / 2 + 5 && toGo > FURLONG / 2 - 25)) bad('poles', l, `${Math.round(toGo)} m to go`); }
    // The stretch: never the same kind of line twice running.
    if (l.slot === 'drive') { if (drives.length && drives[drives.length - 1] === l.drive) bad('stretch', l, `${l.drive} twice running`); drives.push(l.drive); if (!(l.t >= tS)) bad('stretch', l, 'before the stretch'); }
    // The finish line of a race that isn't a photo: the margin the chart gives, going away only for a winner
    // not being caught, and a winner who got up in the last second said to have.
    if (l.wire && !(wall(l.t) - wall(fin) >= 0 && wall(l.t) - wall(fin) <= 0.3)) bad('finish', l, `${(wall(l.t) - wall(fin)).toFixed(2)} s after the wire`);
    if (!call.photo && l.wire) {
      count('finish');
      const ledLate = front(stateAt(run, run.t0 + run.finalTime - 1)) === w.h;
      if (l.up) count('gets up');
      if (/gets up|is up in time|gets there/.test(x) !== !!l.up || !!l.up === ledLate || !(x.startsWith(names[w.h]) || x.startsWith(`And ${names[w.h]}`))) bad('finish', l, ledLate ? 'led a second out' : 'did not lead a second out');
      if (s) {
        const chart = marginShort(s.toPrev);
        const whole = Math.round(s.toPrev);
        const margin = CHART_SAYS[chart] || lengthsSaid(whole);
        if (!x.includes(`by ${margin}`) || (!CHART_SAYS[chart] && !(whole >= 2 && Math.abs(whole - s.toPrev) <= 0.5 + 1e-9))) bad('finish', l, `the chart says ${chart}`);
        if (/going away|draws off|pulls clear/.test(x) !== !!l.away) bad('finish', l, 'going away, not marked');
        if (l.away) { count('going away'); if (w.finishSpeed < s.finishSpeed || s.toPrev <= 2.5) bad('finish', l, 'the runner-up was finishing faster, or close'); }
        if (/holds on|lasts|hangs on|holds,/.test(x) !== !!l.holds) bad('finish', l, 'holding on, not marked');
        if (l.holds) { count('holds on'); if (!ledLate || !(s.finishSpeed > w.finishSpeed) || s.toPrev >= 1) bad('finish', l, 'was not being caught'); }
      }
    }
  });
  // How the call fills the race: the silences from the off to the wire (and the longest once the first
  // run through the field has begun), who was named before the wire, and how soon each new leader was
  // called. A lead change here is one that lasts two seconds and comes two seconds or more before the wire
  // (two horses trading the lead stride for stride can't each be called, and the last strides are the
  // winner's line); it's called when a line naming the new leader in front ends within three seconds.
  const off = wall(0), wire = wall(fin);
  let free = off, quiet = 0, longest = 0;
  const pause = (from, to, after) => { if (to > from) { quiet += to - from; if (after) longest = Math.max(longest, to - from); } };
  for (const l of call.lines) {
    const from = wall(l.t), to = from + l.d;
    if (from >= wire || to <= off) continue;
    pause(free, Math.min(from, wire), firstRun && l.t > firstRun.t);
    free = Math.max(free, Math.min(to, wire));
  }
  pause(free, wire, true);
  const lasting = changes.filter((e, k) => e.t < fin - 2 && (!changes[k + 1] || changes[k + 1].t - e.t >= 2));
  const called = lasting.filter(e => call.lines.some(l => l.lead === e.to && l.t >= e.t - 0.3 && wall(l.t) + l.d <= wall(e.t) + 3 + 1e-6));
  const namedBy = names.filter(n => call.lines.some(l => l.t < fin && l.text.includes(n))).length;
  const slots = new Set(call.lines.map(l => l.slot));
  // The end of it: whether the last line before the wire names one of the first two home, and whether
  // the runner-up is named at all from the furlong pole on.
  const says = (l, i) => new RegExp(`(^|[^A-Za-z'])${names[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z'])`).test(l.text);
  const lastLine = call.lines.filter(l => l.t < fin && !l.wire).pop();
  const end = {
    margin: s ? s.toPrev : 99, last: lastLine ? lastLine.text : '', lastTwo: !!lastLine && !!s && (says(lastLine, w.h) || says(lastLine, s.h)),
    second: !s || call.lines.some(l => l.t >= tE - 0.5 && l.t < fin && says(l, s.h)),
  };
  return {
    end,
    wrong, said, pace, shapes, slots: [...slots], threeQuarters, quiet, secs: wire - off, longest, named: namedBy, changes: lasting.length, called: called.length,
    words: call.lines.filter(l => l.t >= 0 && l.t < fin).reduce((n, l) => n + l.say.split(/\s+/).length, 0), count: call.lines.length,
    turn: call.lines.some(l => l.slot === 'turn'), firstShape: firstRun ? shapeOf(firstRun.text, names) : '',
  };
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

test("riders' and trainers' records add up: one win a race, for the rider and the trainer it ran for, and none goes down", () => {
  // The records beside every rider and trainer on the form were counted from the lines horses still hold.
  // A horse keeps ten and a retired one a single line, so they lost races: in a meet of 20 race days the
  // wins shown rose by 96 while 160 races were run, and a record went down overnight 46 times.
  const races = playLongMeet();
  const { off, overnight, opening, closing } = races.records;
  assert.deepEqual(off, [], 'records that differ from a count of the results');
  assert.deepEqual(overnight, [], 'records that changed between race days');
  const wins = rows => rows.reduce((n, r) => n + r.w, 0), starts = rows => rows.reduce((n, r) => n + r.starts, 0);
  // Ten weeks of eight races were run before the meet opened.
  for (const who of ['jockeys', 'trainers']) {
    assert.equal(wins(opening[who]), 80, `the ${who} have ${wins(opening[who])} wins from the 80 races before the meet`);
    assert.equal(wins(closing[who]), 80 + races.length);
    assert.equal(starts(closing[who]) - starts(opening[who]), races.reduce((n, r) => n + r.field, 0));
  }
});

test('a meet saved before records were counted gets them from the lines its horses hold, and counts up from there', () => {
  // The live version's save has no count. It's made once when the save loads, and kept from then on.
  buildOn('records', '2026-10-03');
  for (const race of card().races) goToGate(race);
  advanceDay();
  save();
  const old = JSON.parse(store.get('post-time/world'));
  delete old.stats;
  store.set('post-time/world', JSON.stringify(old));
  assert.equal(load(), true);
  const lines = meetStats({ horses: game.world.horses }); // a world with no count is counted from its lines
  assert.deepEqual(meetStats(game.world), lines);
  save();
  assert.deepEqual(Object.keys(JSON.parse(store.get('post-time/world')).stats), ['j', 't'], 'the count is not kept with the meet');
  // Two race days on, with the page opened again in between: a win a race, and nothing lost overnight.
  const wins = () => meetStats(game.world).jockeys.reduce((n, r) => n + r.w, 0);
  const before = wins();
  let run = 0;
  for (let d = 0; d < 2; d++) {
    for (const race of card().races) {
      goToGate(race);
      assert.equal(wins(), before + ++run, `race day ${game.world.day + 1}, race ${race.no}`);
    }
    const end = meetStats(game.world);
    advanceDay();
    assert.deepEqual(meetStats(game.world), end, 'a record changed overnight');
    load();
    assert.deepEqual(meetStats(game.world), end, 'a record changed when the page was opened again');
  }
  // By now horses have retired and their lines have gone, and the records still have those rides.
  const rides = stats => stats.jockeys.reduce((n, r) => n + r.starts, 0);
  assert.ok(rides(meetStats(game.world)) > rides(meetStats({ horses: game.world.horses })), 'no line has gone from a card, so this meet shows nothing');
});

test('a card saved with a 99-1 morning line reads 50-1, at the same price', () => {
  // The live version's cards can have one. What's printed changes; the price the early money goes by doesn't.
  buildOn('long-lines', '2026-10-03');
  const [r1] = card().races;
  const before = r1.entries.map(e => [e.ml, e.mlText]);
  Object.assign(r1.entries[0], { ml: 99, mlText: '99-1' });
  const early = makeTote(r1, game.world).early;
  save();
  assert.equal(load(), true);
  const now = card().races[0].entries.map(e => [e.ml, e.mlText]);
  assert.deepEqual(now, [[99, '50-1'], ...before.slice(1)]);
  assert.deepEqual(makeTote(card().races[0], game.world).early, early, 'the early money moved');
});

// The regulars' posts over the long meet, each with its race: `of(who)` gives one regular's.
function threads() {
  const races = playLongMeet();
  const all = races.flatMap(r => r.forum.posts.map(p => ({ ...p, race: r.forum, where: `race day ${r.day}, race ${r.no}: ${p.text}` })));
  return { races, of: who => all.filter(p => p.who === who) };
}
const TROUBLE = /Blocked|Checked|Stumbled|Broke slowly|Bumped|wide/;

test('SheetsAndSheets quotes figures that are on the card, and says when he has marked one down', () => {
  // He printed his own number, the figure less 3 when it was earned on the other surface, as the figure:
  // 60 of the 263 he quoted in one meet were on nobody's card.
  const posts = threads().of('sheets');
  let quoted = 0, marked = 0;
  for (const p of posts) {
    for (const [, pp, fig, surf, his] of p.text.matchAll(/#(\d+)(?: [^#:(]+:| \()\s?(\d+)(?: on the (turf|dirt), call it (\d+) here)?/g)) {
      quoted++;
      const lines = p.race.figs[pp];
      if (surf) {
        marked++;
        assert.ok(surf[0] !== p.race.surface && lines.some(l => l[0] === +fig && l[1] === surf[0]) && +his === +fig - 3, `${p.where} (its last three: ${JSON.stringify(lines)})`);
      } else assert.ok(lines.some(l => l[0] === +fig && l[1] === p.race.surface), `${p.where} (its last three: ${JSON.stringify(lines)})`);
    }
  }
  assert.ok(quoted > 400 && marked > 40, `he quoted ${quoted} figures and marked ${marked} down`);
  assert.deepEqual(posts.filter(p => /first-timers/.test(p.text)).map(p => p.where), [], "a horse with no figure isn't always a first-time starter");
});

test('PaceMakesTheRace names a horse as the one to go only if it runs close to the pace', () => {
  // "No speed at all... Somebody has to go, and #N is the likeliest" named a horse wearing the Closer chip
  // 24 times in 59, and a Stalker 22 times.
  const posts = threads().of('pace');
  const likeliest = posts.filter(p => /is the likeliest/.test(p.text)), easy = posts.filter(p => /easy trip/.test(p.text));
  assert.deepEqual(likeliest.filter(p => p.top.style !== 'E/P').map(p => `${p.where} (its style: ${p.top.style})`), []);
  assert.deepEqual(easy.filter(p => p.top.style === 'E/P').map(p => p.where), []);
  assert.ok(likeliest.length > 10 && easy.length > 10, `${likeliest.length} likeliest, ${easy.length} easy trips`);
  assert.deepEqual(posts.filter(p => /No speed/.test(p.text) && !likeliest.includes(p) && !easy.includes(p)).map(p => p.where), []);
});

test('ChalkEater backs the favourite at the off, says so, and is scored on it', () => {
  // His pick was the favourite when he posted, with the betting half done: it wasn't the favourite at the
  // off in 92 races of 160, and "Chalk holds" greeted 12 of 33 winners that weren't.
  const { races, of } = threads();
  const least = c => Math.min(...c.odds);
  assert.deepEqual(races.filter(r => r.forum.chalk.odds[r.forum.chalk.pick] !== least(r.forum.chalk)).map(r => `race day ${r.day}, race ${r.no}: he has #${r.forum.chalk.pick + 1} at ${r.forum.chalk.odds[r.forum.chalk.pick]}, and the favourite is ${least(r.forum.chalk)}`), []);
  assert.deepEqual(of('chalk').filter(p => !/favorite (at the bell|when the gate opens)/.test(p.text) || !new RegExp(`Right now (that's )?#${p.pp}\\b`).test(p.text)).map(p => p.where), []);
  // His wins, as the game keeps them, go up when the favourite at the off wins and not otherwise.
  let wins = races[0].forum.chalk.wins - (races[0].forum.chalk.win === races[0].forum.chalk.pick ? 1 : 0), held = 0;
  for (const r of races) {
    const c = r.forum.chalk, won = c.odds[c.win] === least(c) && c.win === c.pick;
    assert.equal(c.wins, wins += won ? 1 : 0, `race day ${r.day}, race ${r.no}`);
    const says = r.forum.after.find(a => a.who === 'chalk');
    if (says && /Chalk holds/.test(says.text)) { held++; assert.ok(won, `race day ${r.day}, race ${r.no}: "${says.text}" for a winner at ${c.odds[c.win]} with the favourite at ${least(c)}`); }
    if (won) assert.ok(says && says.won, `race day ${r.day}, race ${r.no}: the favourite won and he said nothing`);
  }
  assert.ok(held > races.length / 5, `the favourite won only ${held} of ${races.length}`);
});

test('a ChalkEater post saved by the live version keeps the horse it named', () => {
  // "It's #4 Early Refund. 9-2. Don't overthink it." named one horse. A thread already posted when the
  // game is updated is scored, and answered, on that horse, whatever is favourite at the off.
  buildOn('chalk-old', '2026-10-03');
  let checked = 0;
  for (let k = 0; k < 8; k++) {
    const race = card().races[k]; // (the meet is loaded again each time round)
    const chalk = forumFor(race).find(p => p.who === 'chalk');
    const off = currentBoardAtTheOff(race), other = off.indexOf(Math.max(...off));
    // The post as the live version saved it: no word about the bell, and (to tell the two apart) on the
    // longest price in the race.
    delete chalk.atTheOff;
    chalk.pick = [other];
    chalk.text = `It's #${race.entries[other].pp} ${horseOf(race.entries[other]).name}. 9-2. Don't overthink it.`;
    save();
    assert.equal(load(), true);
    const again = card().races[race.no - 1], wins = game.world.tipsters.chalk.wins;
    const { run } = goToGate(again);
    assert.deepEqual(again.forum.find(p => p.who === 'chalk').pick, [other], `race ${race.no}: his pick was moved off the horse he named`);
    assert.equal(game.world.tipsters.chalk.wins - wins, run.results[0].h === other ? 1 : 0);
    assert.ok(!again.forumAfter.some(a => /Chalk holds/.test(a.text)) || run.results[0].h === other);
    checked++;
  }
  assert.equal(checked, 8);
});
// The final odds a race will go off at with no tickets of your own in the pools.
function currentBoardAtTheOff(race) { return board(toteFor(race), 1, []).odds; }

test("PedigreePam's line on the distance comes from the sire's own, and she claims no fit that isn't there", () => {
  // "Bred for speed" or "a route of ground. The distance fits" went by the race, not the sire: 10 of 37
  // were wrong (Tapit, whose runners want nine furlongs, "bred for speed" at five).
  const posts = threads().of('pam');
  const fits = p => (p.top.sire <= 7 ? p.race.f <= 7 : p.top.sire >= 8 ? p.race.f >= 8 : Math.abs(p.race.f - p.top.sire) <= 1);
  const says = re => posts.filter(p => re.test(p.text));
  assert.deepEqual(says(/The distance fits/).filter(p => !fits(p)).map(p => `${p.where} (${p.top.sire}f sire, ${p.race.f}f race)`), []);
  assert.deepEqual(says(/bred for speed/).filter(p => p.top.sire > 7).map(p => p.where), []);
  assert.deepEqual(says(/route of ground/).filter(p => p.top.sire < 8).map(p => p.where), []);
  assert.deepEqual(says(/more ground than this/).filter(p => !(p.top.sire > p.race.f) || fits(p)).map(p => p.where), []);
  assert.deepEqual(says(/less ground than this/).filter(p => !(p.top.sire < p.race.f) || fits(p)).map(p => p.where), []);
  // Each is said in the meet. (How often depends on the horses the meet draws: "less ground than this", a
  // horse bred to sprint in a route, came up twice in one.)
  for (const re of [/The distance fits/, /bred for speed/, /route of ground/, /more ground than this/]) assert.ok(says(re).length > 3, `she said ${re} ${says(re).length} times`);
  assert.ok(says(/less ground than this/).length > 1, `she said /less ground than this/ ${says(/less ground than this/).length} times`);
  // "Trying grass for the first time" only of a horse whose every start is on its card, none on turf.
  const firstTurf = says(/grass for the first time/);
  assert.deepEqual(firstTurf.filter(p => p.top.starts > p.top.lines.length || p.top.lines.some(l => l.surf === 't')).map(p => p.where), []);
});

test('RailbirdRuth says it looked good in the ring only of a horse she said looked good', () => {
  // After writing only "no fuss in the paddock": 4 of her 17 winners in one meet.
  const { races } = threads();
  const wins = races.flatMap(r => r.forum.after.filter(a => a.who === 'ruth' && a.won).map(a => ({ ...a, post: r.forum.posts.find(p => p.who === 'ruth'), where: `race day ${r.day}, race ${r.no}` })));
  const good = wins.filter(a => /looked good in the ring/.test(a.text));
  assert.deepEqual(good.filter(a => a.post.top.paddock !== 'good' || /no fuss/.test(a.post.text)).map(a => `${a.where}: "${a.text}" after "${a.post.text}"`), []);
  assert.deepEqual(wins.filter(a => !good.includes(a) && a.post.top.paddock === 'good').map(a => `${a.where}: "${a.text}" after "${a.post.text}"`), []);
  assert.ok(good.length > 5 && wins.length - good.length > 5, `${good.length} of her ${wins.length} winners looked good in the ring`);
});

test('GreyHorseGreg counts his greys', () => {
  // "TWO greys. Christmas came early." with three or four in the race: 16 times in 44.
  const posts = threads().of('greg');
  const WORDS = { TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6 };
  const several = posts.filter(p => / greys\./.test(p.text));
  assert.deepEqual(several.filter(p => WORDS[p.text.match(/^(\w+) greys\./)?.[1]] !== p.race.greys).map(p => `${p.where} (${p.race.greys} greys in the race)`), []);
  assert.deepEqual(posts.filter(p => /a grey in here/.test(p.text) && p.race.greys !== 1).map(p => p.where), []);
  assert.deepEqual(posts.filter(p => /No grey/.test(p.text) && p.race.greys !== 0).map(p => p.where), []);
  assert.ok(several.some(p => p.race.greys === 2) && several.some(p => p.race.greys >= 3), 'no race with two greys, or none with three');
});

test("LongshotLou's bullet is the newest and a recent one, his trouble is the trouble on the card, and a maiden claimer's winner isn't dropping", () => {
  // He quoted the oldest bullet among a horse's last five works (22 of 26 were over three weeks old), the
  // whole trip note ("checked in traffic; even trip last time and still ran a 51"), and called a horse out
  // of a $20,000 maiden claimer into a $10,000 claimer for winners a dropper.
  const posts = threads().of('lou').filter(p => p.top);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  let bullets = 0, troubles = 0, drops = 0;
  for (const p of posts) {
    const last = p.top.lines.at(-1);
    const bullet = p.text.match(/worked the fastest (\d) furlongs of the morning on (\d\d)\/(\d\d)/);
    if (bullet) {
      bullets++;
      const best = p.top.works.filter(w => w.rank === 1).sort((a, b) => (a.dt < b.dt ? 1 : -1))[0];
      assert.ok(best && best.dt.slice(5) === `${bullet[2]}-${bullet[3]}` && best.f === +bullet[1], `${p.where} (its works: ${JSON.stringify(p.top.works)})`);
      assert.ok(days(best.dt, p.race.date) <= 21 && (!last || best.dt > last.dt), `${p.where} (worked ${best.dt}, last raced ${last?.dt}, runs ${p.race.date})`);
    }
    const trouble = p.text.match(/\. (?:Also )?([^.]+?) last time and still ran (an?) (\d+)\./);
    if (trouble) {
      troubles++;
      const parts = last.cm.split('; ').filter(x => TROUBLE.test(x));
      assert.equal(trouble[1].toLowerCase(), parts.join(', ').toLowerCase(), `${p.where} (the note: "${last.cm}")`);
      assert.equal(+trouble[3], last.fig, p.where);
      assert.equal(trouble[2], /^(8|11|18)/.test(last.fig) ? 'an' : 'a', p.where); // "ran an 82"
    }
    const drop = p.text.match(/dropping from \$(\d+)k to \$(\d+)k/);
    if (drop) {
      drops++;
      assert.ok(!['MCL', 'MSW'].includes(last.cls) && last.clm === drop[1] * 1000 && p.race.claim === drop[2] * 1000 && last.clm > p.race.claim, `${p.where} (last ran in ${last.cls} for ${last.clm})`);
    }
    if (/lightly raced/.test(p.text)) assert.ok(p.top.starts <= 2, `${p.where} (it has ${p.top.starts} starts)`);
  }
  assert.ok(bullets > 3 && troubles > 30 && drops > 10, `${bullets} bullets, ${troubles} troubled trips, ${drops} drops`);
  assert.ok(posts.some(p => /; /.test(p.top.lines.at(-1)?.cm || '') && / last time and still ran/.test(p.text)), 'no note of two parts to quote from');
});

test("a regular's losing line is what the trip note says happened to his horse", () => {
  // "Cooked in a speed duel. Classic." was the commonest: in 63 of 77 the horse's own note had no duel in it.
  const { races } = threads();
  const lost = races.flatMap(r => r.forum.after.filter(a => !a.won).map(a => ({ ...a, where: `race day ${r.day}, race ${r.no}: "${a.text}" of a horse whose note is "${a.note}"` })));
  const check = (said, note) => {
    const lines = lost.filter(a => said.test(a.text));
    assert.deepEqual(lines.filter(a => !note.test(a.note)).map(a => a.where), []);
    assert.ok(lines.length > 5, `${said} was said ${lines.length} times`);
  };
  check(/speed duel/, /Dueled/);
  check(/break|the start|gate/, /Stumbled|Broke slowly|Bumped/);
  check(/no room|Nowhere to go|Blocked|check in traffic|wall of horses/, /Checked|Blocked/);
  check(/Too late|too late/, /Late gain|Improved position|improved position|mild rally/);
  const wide = lost.filter(a => /Parked/.test(a.text));
  assert.deepEqual(wide.filter(a => !a.note.includes(`${a.text.match(/Parked (\d) wide/)[1]} wide`)).map(a => a.where), []);
  assert.ok(wide.length > 5);
  // And a horse with trouble in its note isn't said to have done nothing.
  assert.deepEqual(lost.filter(a => /Never fired|Nothing\. Tossing/.test(a.text) && /Checked|Blocked|Stumbled|Broke slowly|Bumped|Dueled|Late gain/.test(a.note)).map(a => a.where), []);
});

test("two regulars don't post the same reaction after a race", () => {
  const races = playLongMeet();
  const twice = races.filter(r => new Set(r.reactions).size !== r.reactions.length);
  assert.deepEqual(twice.map(r => `race day ${r.day}, race ${r.no}: ${r.reactions.join(' / ')}`), []);
  assert.ok(races.reduce((n, r) => n + r.reactions.length, 0) > races.length * 3, 'the regulars have gone quiet');
});

// What the long meet's race calls got wrong, of one kind, and how often he said a thing. With NUMBERS=1 in
// the environment the tests below also print what they measured.
const note = (...what) => { if (process.env.NUMBERS) console.log(...what); };
const told = (races, kind) => races.flatMap(r => (r.wrong[kind] || []).map(x => `race day ${r.day}, race ${r.no}${r.speed ? ` at ${r.speed}x` : ''}: ${x}`));
const total = (races, kind) => races.reduce((n, r) => n + (r.said[kind] || 0), 0);
const sum = (races, key) => races.reduce((n, r) => n + r[key], 0);

test("a trip note doesn't contradict itself or the result, and no note is on every other line", () => {
  // "Even trip" or "Saved ground, even" was on a third of all lines (468 of 1,411 in one meet), 13 times
  // after "Checked, rallied" or "Blocked, finished well", and 13 of 24 runners-up beaten a neck or less were
  // written off with it or with "Stalked, no rally".
  const races = playLongMeet();
  const notes = races.flatMap(r => r.notes.map(n => ({ ...n, field: r.field, where: `race day ${r.day}, race ${r.no}: "${n.cm}" (finished ${n.fin}, beaten ${n.bl})` })));
  const told = n => n.where;
  assert.deepEqual(notes.filter(n => n.cm.length > 34 || !n.cm || /undefined/.test(n.cm)).map(told), [], 'a note longer than 34 characters, or empty');
  assert.deepEqual(notes.filter(n => /Even trip|even$/.test(n.cm)).map(told), [], '"Even trip" is not a chart phrase: "Evenly"');
  // A trouble note that says how the horse finished is followed by nothing that says it again, or unsays
  // it. (After a winner's it's how it won: "Checked, rallied; Up in time".)
  const finished = /(Checked|Blocked), (rallied|finished well|just missed|missed by a nose)/;
  assert.deepEqual(notes.filter(n => n.fin > 1 && new RegExp(`${finished.source}; `).test(n.cm)).map(told), []);
  assert.deepEqual(notes.filter(n => /rallied|finished well/.test(n.cm) && /Evenly|evenly|No rally|no rally|Weakened|Faded/.test(n.cm)).map(told), []);
  // Second or third within a neck of the winner nearly won, and its note doesn't say otherwise.
  const near = notes.filter(n => (n.fin === 2 || n.fin === 3) && n.bl < 0.375);
  const missed = /[Jj]ust missed|[Mm]issed by a nose/;
  assert.ok(near.length > 60, `only ${near.length} horses were second or third within a neck of the winner`);
  assert.deepEqual(near.filter(n => /no rally|evenly|weakened|held|second best|caught late|finished well|, rallied/i.test(n.cm)).map(told), []);
  const said = near.filter(n => missed.test(n.cm)).length;
  assert.ok(said > near.length * 0.85, `${said} of ${near.length} are said to have just missed`);
  // (A line keeps the margin to the hundredth, so a nose can read 0.06.)
  assert.deepEqual(notes.filter(n => /[Mm]issed by a nose/.test(n.cm) && !(n.bl <= 0.06)).map(told), []);
  assert.deepEqual(notes.filter(n => missed.test(n.cm) && !(n.fin <= 3 && n.bl < 0.375)).map(told), []);
  // What a note says of the places a horse made up or lost is what its running line shows: from the first
  // call to the wire, and for a place taken or lost late, from a furlong out.
  // (A horse is held to the better of its two calls: one that led a furlong out and finished fourth
  // weakened, wherever it was early.)
  const best = n => Math.min(n.first, n.str);
  assert.deepEqual(notes.filter(n => /Improved position|improved position|mild rally/.test(n.cm) && !(n.fin < n.first && n.fin - best(n) < 2)).map(told), []);
  assert.deepEqual(notes.filter(n => /Late gain|Closed well/.test(n.cm) && !(n.first - n.fin >= 3 && n.str >= n.fin)).map(told), []);
  assert.deepEqual(notes.filter(n => /Weakened|Faded|weakened|faded/.test(n.cm) && !(n.fin > best(n))).map(told), []);
  assert.deepEqual(notes.filter(n => /Evenly|evenly/.test(n.cm) && !(n.fin === n.first && n.fin - best(n) < 2)).map(told), []);
  assert.deepEqual(notes.filter(n => /Up for (place|show)/.test(n.cm) && !(n.str > n.fin)).map(told), []);
  assert.deepEqual(notes.filter(n => /[Oo]utfinished/.test(n.cm) && !(n.str < n.fin)).map(told), []);
  assert.deepEqual(notes.filter(n => /Second best/.test(n.cm) && !(n.fin === 2 && n.bl >= 1)).map(told), []);
  // The words the ratings, the Troubled trip chip and LongshotLou go by are still written, as they were.
  const parts = new Map();
  for (const n of notes) for (const p of n.cm.split('; ')) parts.set(p, (parts.get(p) || 0) + 1);
  for (const p of ['Stumbled start', 'Broke slowly', 'Bumped start', 'Checked in traffic', 'Checked, rallied', 'Blocked stretch', 'Blocked, finished well', 'Checked, just missed', 'Blocked, just missed']) assert.ok(parts.get(p) > 0, `"${p}" is never written`);
  for (const p of ['Evenly', 'No rally', 'Weakened', 'Improved position', 'Just missed', 'Missed by a nose', 'Second best', 'Saved ground, evenly']) assert.ok(parts.get(p) > 0, `"${p}" is never written`);
  const [most, n] = [...parts].sort((a, b) => b[1] - a[1])[0];
  assert.ok(n / notes.length <= 0.15, `"${most}" is on ${n} of ${notes.length} lines`);
  note(`${notes.length} trip notes in ${parts.size} wordings; the commonest is "${most}", on ${(100 * n / notes.length).toFixed(1)}% of lines; ${said} of ${near.length} second or third within a neck just missed`);
});

test("the caller doesn't sound sure of a leader who then gets caught or goes to a photo", () => {
  const races = playLongMeet();
  assert.deepEqual(told(races, 'sure'), []);
  assert.ok(total(races, 'sure') + total(races, 'home free') > races.length / 10, `the caller is sure of a winner in only ${total(races, 'sure')} races`);
  assert.ok(total(races, 'home free') > 0, 'nobody is ever home free');
});

test('the caller says a horse is closing only when it is gaining on the leader from within three lengths', () => {
  // "X closing fast, but Y still in front!" was said of horses five lengths behind a runaway winner.
  // "Closing fast" is a quarter of a length gained in the last second.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'closing'), []);
  assert.ok(total(races, 'gaining') > races.length / 4, `a horse is called closing in only ${total(races, 'gaining')} races`);
  assert.ok(total(races, 'closing') > 0, 'nobody is ever called closing fast');
  assert.ok(total(races, 'still in front') > 0, "the caller never just says who's still in front");
});

test('a horse named as the leader is in front when the line comes up, and no line starts before the last is over', () => {
  // Lines were moved up to 1.8 seconds later, after they were worded, to keep them apart: every line that
  // named the wrong leader was a moved one. Now a line is worded for the moment it's given, and given when
  // the voice is free. A lead of less than a quarter of a length is nobody's: the two are called together.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'leader'), []);
  assert.deepEqual(told(races, 'pair'), [], 'a leader named from inside a quarter of a length, or two called together who are not');
  assert.deepEqual(told(races, 'crowded'), []);
  assert.deepEqual(told(races, 'long'), [], 'a line longer than eight seconds');
  assert.ok(total(races, 'leader') > races.length * 6, `only ${total(races, 'leader')} lines name a leader`);
  assert.ok(total(races, 'pair') > races.length / 4, `only ${total(races, 'pair')} lines call two together`);
});

test('a lead change is never called for the horse just named as the leader', () => {
  // "Around the far turn, Crimson Detour leads by a head." and then "Crimson Detour goes by and takes the lead!"
  // A horse that led before is "back in front"; one that hasn't "takes over".
  const races = playLongMeet();
  assert.deepEqual(told(races, 'change'), []);
  assert.ok(total(races, 'change') > races.length, `only ${total(races, 'change')} lead changes called`);
});

test('a new leader "takes over from" the horse running second, or from nobody', () => {
  // The horse named was the last one the caller had called in front, which could be an older leader: after
  // a line calling two together, or a change the voice was too busy for. "Stubborn Ballad takes over from
  // Stormy Verdict!" came with Stormy Verdict fifth, two and a half lengths back.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'passed'), []);
  assert.ok(total(races, 'passed') > races.length / 10, `only ${total(races, 'passed')} lead changes name the horse passed`);
  note(`lead changes that name the horse passed: ${total(races, 'passed')} of ${total(races, 'change')}`);
});

test('a new leader is called within three seconds, nine times in ten', () => {
  // About one lead change in nine was never said (the voice was on another line), and one that was said
  // ended a median 1.9 seconds after the change.
  const races = playLongMeet();
  const changes = sum(races, 'changes'), called = sum(races, 'called');
  assert.ok(changes > races.length, `only ${changes} lead changes in ${races.length} races`);
  assert.ok(called / changes >= 0.9, `${called} of ${changes} lead changes were called within three seconds`);
  note(`lead changes called within three seconds: ${called} of ${changes}`);
});

test('after Skip the caller picks the race up with who leads, and calls a new leader only if the change is news', () => {
  // The plan after a skip is made from the lines said before it, so the caller still had the leader of
  // forty seconds ago in mind: "Stormy Dancer is the new leader!" came with Stormy Dancer 28 seconds in
  // front. A change more than three seconds old isn't called as one: he says where they are and who leads.
  const skips = playLongMeet().filter(r => r.skip);
  assert.ok(skips.length > 400, `only ${skips.length} races were skipped`);
  const stale = skips.filter(r => r.skip.change && r.skip.old > 3.05);
  assert.deepEqual(stale.map(r => `race day ${r.day}, race ${r.no}: "${r.skip.text}" at ${r.skip.t.toFixed(1)} s, in front for ${r.skip.old.toFixed(1)} s by then`), []);
  // And the same watching at 2x and 4x, by the race's clock: none of what was skipped was seen, so the speed
  // doesn't make a change any newer. (The three seconds were real ones, and at 2x a horse six seconds in
  // front was "the new leader" as the first words after Skip in about one race in twelve.)
  const fast = playLongMeet().flatMap(r => (r.skipFast || []).filter(Boolean).map(skip => ({ ...r, skip })));
  assert.ok(fast.length > 800, `only ${fast.length} races were skipped at 2x and 4x`);
  assert.deepEqual(fast.filter(r => r.skip.change && r.skip.old > 3.05).map(r => `at ${r.skip.speed}x, race day ${r.day}, race ${r.no}: "${r.skip.text}", in front for ${r.skip.old.toFixed(1)} s by then`), []);
  const leads = skips.filter(r => r.skip.lead).length;
  assert.ok(leads >= skips.length * 0.9, `the first line after Skip says who leads in ${leads} of ${skips.length} races`);
  note(`after Skip at 22 s: the first line says who leads in ${leads} of ${skips.length} races, and calls a new leader in ${skips.filter(r => r.skip.change).length} (none in front for more than three seconds by then); the rest: ${[...new Set(skips.filter(r => !r.skip.lead).map(r => r.skip.text))].slice(0, 6).join(' / ')}`);
});

test('the call fills the race: under a quarter of it silent, no silence over six seconds, and nearly every runner named', () => {
  // The caller said nothing for more than half of each race (3.6 silences of five seconds or more a
  // race), and one runner in four was never named. Now the field is run down between the things that
  // happen, a few horses at a time, and the stretch is called stride by stride.
  const races = playLongMeet();
  const quiet = sum(races, 'quiet') / sum(races, 'secs');
  assert.ok(quiet < 0.25, `silent for ${(quiet * 100).toFixed(1)}% of the time between the off and the wire`);
  const longest = races.filter(r => r.longest > 6).map(r => `race day ${r.day}, race ${r.no}: ${r.longest.toFixed(1)} s`);
  assert.deepEqual(longest, [], 'a silence of more than six seconds once the field has been run down the first time');
  const upTo12 = races.filter(r => r.field <= 12);
  const named = sum(upTo12, 'named') / sum(upTo12, 'field');
  assert.ok(named >= 0.99, `${(named * 100).toFixed(1)}% of runners are named before the wire`);
  const words = sum(races, 'words') / (sum(races, 'secs') / 60);
  assert.ok(words > 140 && words < 260, `${Math.round(words)} words for each minute of race`);
  note(`${races.length} races at 1x: ${(sum(races, 'count') / races.length).toFixed(1)} lines a race, ${Math.round(words)} words for each minute of race, silent ${(quiet * 100).toFixed(1)}% of the time from the off to the wire, longest silence after the first run through the field ${Math.max(...races.map(r => r.longest)).toFixed(1)} s, ${sum(upTo12, 'named')} of ${sum(upTo12, 'field')} runners named`);
});

test('no sentence is said twice in a race, and no wording is more than a third of its kind', () => {
  // Every race was called in the same sentences: 195 of 200 first calls were "A and B vie for the early
  // lead, C right there.", and the same line could come three and four times in one race.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'twice'), []);
  const by = {};
  for (const r of races) for (const [slot, shape] of r.shapes) { const m = by[slot] || (by[slot] = new Map()); m.set(shape, (m.get(shape) || 0) + 1); }
  const kinds = ['pre', 'off', 'break', 'run', 'more', 'fill', 'frac', 'change', 'turn', 'eighth', 'sixteenth', 'drive', 'wire', 'placings'];
  for (const slot of kinds) {
    assert.ok(by[slot], `no lines of the kind "${slot}"`);
    const n = [...by[slot].values()].reduce((a, b) => a + b, 0);
    const [shape, most] = [...by[slot]].sort((a, b) => b[1] - a[1])[0];
    assert.ok(by[slot].size >= 4, `only ${by[slot].size} wordings of the kind "${slot}"`);
    assert.ok(most / n <= 1 / 3, `"${shape}" is ${most} of the ${n} lines of the kind "${slot}"`);
  }
  const first = new Map();
  for (const r of races) first.set(r.firstShape, (first.get(r.firstShape) || 0) + 1);
  const [shape, most] = [...first].sort((a, b) => b[1] - a[1])[0];
  assert.ok(most / races.length <= 0.5, `the first call is "${shape}" in ${most} of ${races.length} races`);
  assert.ok(first.size >= 12, `only ${first.size} first calls`);
  note(`wordings: ${kinds.map(k => `${k} ${by[k].size}`).join(', ')}; the commonest first call is ${most} of ${races.length} ("${shape}")`);
});

test('turning for home, the poles and the fractions are called as the leader gets there, or not at all', () => {
  // "Turning for home" waited for the caller to be free: it came up to ten seconds late, inside the last
  // furlong and a half. Now the two and a half seconds before the leader reaches the stretch are kept
  // clear for it, and it's said within two seconds or left out. The three-quarter time was never called.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'poles'), []);
  assert.deepEqual(told(races, 'fraction'), []);
  assert.deepEqual(told(races, 'stretch'), [], 'the same kind of line twice running in the stretch');
  const turned = races.filter(r => r.turn).length;
  assert.ok(turned >= races.length * 0.97, `the turn for home is called in ${turned} of ${races.length} races`);
  note(`the turn for home called in ${turned} of ${races.length} races, never more than two seconds after the leader got there`);
  // (At a mile the three quarters comes up as they turn for home, where that call belongs.)
  const routes = races.filter(r => r.f > 8);
  const called = routes.filter(r => r.threeQuarters).length;
  assert.ok(routes.length > 100 && called > routes.length * 0.8, `the three quarters is called in ${called} of ${routes.length} races of more than a mile`);
  note(`the three quarters called in ${called} of ${routes.length} races of more than a mile; ${total(races, 'fraction')} fractions called in all`);
  assert.ok(total(races, 'fraction') > races.length * 1.6, `only ${total(races, 'fraction')} fractions called`);
});

test("what's said of a horse in the running is what it's doing: moving, flying, right there, third, last", () => {
  // "X is making a run" was said of any horse that gained three places in four seconds: of horses tenth
  // and seven lengths back, in the first twenty seconds, inside the last furlong. "C right there" was a
  // length and a half behind. The horse "charging" at the turn was six lengths back, or checked next line.
  const races = playLongMeet();
  for (const kind of ['mover', 'flying', 'near', 'places', 'where', 'trouble']) assert.deepEqual(told(races, kind), [], kind);
  for (const kind of ['mover', 'flying', 'near', 'three across', 'last', 'spread', 'where', 'trouble']) assert.ok(total(races, kind) > 10, `"${kind}" said ${total(races, kind)} times`);
  note(`said: ${['leader', 'pair', 'change', 'mover', 'flying', 'gaining', 'closing', 'sure', 'home free', 'near', 'three across', 'last', 'spread', 'where', 'trouble', 'clean break', 'gets up', 'going away', 'holds on'].map(k => `${k} ${total(races, k)}`).join(', ')}`);
});

test('the stretch is called about the horses that are deciding it', () => {
  // The last line before a photo between two horses was "Ask Me Later is finishing well from fourth!", and
  // "Lonesome Diva makes up ground from sixth!" was the pace-setter, headed and going backwards. Over the
  // last two and a half seconds the caller keeps to the first two (or one right with them); a horse is
  // only running on if it's near enough to matter, gaining, and wasn't itself the leader a moment ago;
  // and a horse coming for second gets called.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'running on'), []);
  assert.deepEqual(told(races, 'for second'), []);
  assert.ok(total(races, 'for second') > races.length / 20, `a horse comes for second in only ${total(races, 'for second')} races`);
  assert.ok(total(races, 'up to second') > races.length / 20 && total(races, 'two for second') > races.length / 20, `a horse moves up to second ${total(races, 'up to second')} times, and two are at it for second ${total(races, 'two for second')} times`);
  const tight = races.filter(r => r.end.margin < 1), named = tight.filter(r => r.end.lastTwo);
  assert.ok(tight.length > 150 && named.length >= tight.length * 0.95, `in ${tight.length} races won by under a length the last line before the wire names one of the first two home in ${named.length}: ${tight.filter(r => !r.end.lastTwo).slice(0, 5).map(r => r.end.last).join(' / ')}`);
  const second = races.filter(r => r.end.second);
  assert.ok(second.length >= races.length * 0.95, `the runner-up is named in the last furlong in ${second.length} of ${races.length} races`);
  note(`the last line before the wire names one of the first two home in ${named.length} of ${tight.length} races won by under a length (${races.filter(r => r.end.lastTwo).length} of ${races.length} in all); the runner-up is named in the last furlong in ${second.length} of ${races.length}; a horse comes for second ${total(races, 'for second')} times, one moves up to second ${total(races, 'up to second')} times, and two are at it for second ${total(races, 'two for second')} times`);
});

test('a leader that stops is said to be tiring, "Then" follows the run through the field, and the second horse isn\'t given twice running', () => {
  // The horse in front turning for home finished out of the first three in 37 races of 200 and in 22 of
  // them was never named again: no wording said a horse was tiring. "The half mile in 48 and 1." was
  // followed by "Then a gap of three lengths to Spare Anthem", and "... by three lengths over Stormy
  // Dancer!" by "Then Stormy Dancer."
  const races = playLongMeet();
  for (const kind of ['tiring', 'then', 'repeated']) assert.deepEqual(told(races, kind), [], kind);
  assert.ok(total(races, 'tiring') > races.length / 4, `a horse is said to be tiring ${total(races, 'tiring')} times`);
  note(`a horse is said to be tiring ${total(races, 'tiring')} times in ${races.length} races`);
});

test('the caller puts a horse on the outside, on the inside or four wide only where it is running', () => {
  // "Is flying on the outside!" was one of three endings picked at random, and was said of horses on the
  // rail; "four wide" was the chart's third path.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'place'), []);
  for (const kind of ['wide', 'inside', 'outside', 'between']) assert.ok(total(races, kind) > 0, `never says a horse is ${kind}`);
});

test('a clean break is one where nobody bumped, stumbled or broke slowly', () => {
  const races = playLongMeet();
  assert.deepEqual(told(races, 'break'), []);
  assert.ok(total(races, 'clean break') > 10, `a clean break called ${total(races, 'clean break')} times`);
  assert.ok(total(races, 'break') > 10, `a stumble, a slow break or a bump called ${total(races, 'break')} times`);
});

test("the finish is called by the chart's margin, on the wire, and 'going away' only for a winner not being caught", () => {
  // "By a whisker!" covered margins up to six tenths of a length, with "1/2" in the running order above it.
  // The winner's line starts within three tenths of a second of the wire, in every race.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'finish'), []);
  assert.deepEqual(told(races, 'words'), [], 'a whisker, or a number of lengths in figures');
  assert.ok(total(races, 'finish') > races.length / 2);
  assert.ok(total(races, 'going away') > 10, `going away called ${total(races, 'going away')} times`);
  assert.ok(total(races, 'holds on') > 10, `holding on called ${total(races, 'holds on')} times`);
});

test("a horse that stumbles or breaks slowly isn't then called as breaking with the leaders: it recovers", () => {
  // "Scotch Tape stumbles at the start!" and then "Southern Thunder, Scotch Tape and Mystery Key are three
  // across early." Now the first call says it has recovered, or leaves it out of the group.
  const races = playLongMeet();
  assert.deepEqual(told(races, 'recovered'), []);
  // (It comes up seldom since a stumble costs what it looks like: most of these were stumblers, which used
  // to lose nothing and were often up with the leaders at the first call.)
  assert.ok(total(races, 'recovered') > 0, 'no horse recovers from a bad start in a first call');
  note(`first calls that name the horse that stumbled or broke slowly, as recovered: ${total(races, 'recovered')}`);
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
  const won = /\bwins?\b|\bwon\b|winner|gets up|gets there|is up in time|gets the nod|got there|goes to|takes it by|holds|lasts|hangs on|romp|draws off|pulls clear|^It's .+, by /;
  for (const r of photos) {
    const where = `race day ${r.day}, race ${r.no}: ${r.lines.slice(-2).join(' / ')}`;
    const [wire, placings] = r.lines.slice(-2);
    const order = wire.indexOf(r.winner) < wire.indexOf(r.second) ? 0 : 1;
    const two = [[r.winner, r.second], [r.second, r.winner]][order];
    assert.ok(wire.includes(r.winner) && wire.includes(r.second) && /photo/i.test(wire), where);
    assert.ok(placings.indexOf(two[0]) >= 0 && placings.indexOf(two[0]) < placings.indexOf(two[1]) && /photo|camera/.test(placings) && / The time, [\d:.]+\.$/.test(placings), where);
    if (order === 0) winnerFirst++;
    assert.deepEqual(r.lines.slice(-2).filter(l => won.test(l)), [], where);
    assert.ok(!/by a (nose|head|neck)/.test(wire + placings), where);
    assert.match(r.official, /, by a (nose|head|neck)!$/);
    assert.ok(r.official.includes(r.winner) && !r.official.includes(r.second) && won.test(r.official), `${where} / ${r.official}`);
  }
  const share = winnerFirst / photos.length;
  assert.ok(share > 0.3 && share < 0.7, `the winner is named first in ${winnerFirst} of ${photos.length} photo finishes`);
  assert.deepEqual(races.filter(r => !r.photo && r.official !== null).map(r => `race day ${r.day}, race ${r.no}`), [], 'a race that is not a photo has a line for the sign');
  // The line for the sign isn't always the same one.
  const signs = new Map();
  for (const r of photos) { const k = r.official.replace(r.winner, 'N'); signs.set(k, (signs.get(k) || 0) + 1); }
  assert.ok(signs.size >= 4 && Math.max(...signs.values()) <= photos.length / 2, `the official line: ${[...signs].map(([k, n]) => `${n} x ${k}`).join(' / ')}`);
});

test('watched at 2x the call is its shorter lines, and at 4x only the headlines, and both are as true as at 1x', () => {
  // At 2x and 4x the caller said nothing at all. A second of speech covers two or four seconds of race, so
  // at 2x each line is in its shortest wording, and at 4x there's the off, the leader on each part of the
  // track, lead changes, the turn for home, a furlong out and the winner.
  const fast = playLongMeet().flatMap(r => r.fast || []);
  for (const kind of ['leader', 'pair', 'crowded', 'long', 'twice', 'change', 'passed', 'recovered', 'sure', 'closing', 'place', 'mover', 'flying', 'running on', 'for second', 'tiring', 'then', 'repeated', 'near', 'places', 'where', 'trouble', 'break', 'poles', 'fraction', 'stretch', 'finish', 'words']) assert.deepEqual(told(fast, kind), [], kind);
  const [twice, four] = [2, 4].map(speed => fast.filter(r => r.speed === speed));
  assert.equal(twice.length, 120);
  for (const r of fast) {
    for (const kind of ['off', 'wire', 'placings']) assert.ok(r.slots.includes(kind), `race day ${r.day}, race ${r.no} at ${r.speed}x: no "${kind}" line`);
    assert.ok((r.said.leader || 0) + (r.said.pair || 0) >= 1, `race day ${r.day}, race ${r.no} at ${r.speed}x: nobody is ever said to lead`);
  }
  const headlines = new Set(['pre', 'off', 'run', 'fill', 'change', 'turn', 'eighth', 'wire', 'placings']);
  assert.deepEqual(four.flatMap(r => r.slots.filter(k => !headlines.has(k)).map(k => `race day ${r.day}, race ${r.no}: a "${k}" line`)), [], 'more than the headlines at 4x');
  // Real seconds of silence, and lines: fewer and shorter as the race goes by faster.
  const [q2, q4] = [twice, four].map(rs => sum(rs, 'quiet') / sum(rs, 'secs'));
  assert.ok(q2 < 0.35 && q4 < 0.5, `silent ${(q2 * 100).toFixed(0)}% of the race at 2x and ${(q4 * 100).toFixed(0)}% at 4x`);
  const [n2, n4] = [twice, four].map(rs => sum(rs, 'count') / rs.length);
  assert.ok(n2 > 15 && n2 < 30 && n4 > 7 && n4 < 14, `${n2.toFixed(1)} lines a race at 2x and ${n4.toFixed(1)} at 4x`);
  assert.ok(sum(twice, 'called') / sum(twice, 'changes') > 0.75 && sum(four, 'called') / sum(four, 'changes') > 0.5, `lead changes called: ${sum(twice, 'called')} of ${sum(twice, 'changes')} at 2x, ${sum(four, 'called')} of ${sum(four, 'changes')} at 4x`);
  note(`${twice.length} races at 2x: ${n2.toFixed(1)} lines a race, silent ${(q2 * 100).toFixed(1)}%, ${sum(twice, 'called')} of ${sum(twice, 'changes')} lead changes called; at 4x: ${n4.toFixed(1)} lines a race, silent ${(q4 * 100).toFixed(1)}%, ${sum(four, 'called')} of ${sum(four, 'changes')} lead changes called`);
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

test("when the browser won't keep the meet the game knows it, until a save goes in again", () => {
  // Storage that's blocked or full threw away every save without a word: a day's play was gone on the
  // next visit, and nothing on any screen had said so.
  build('refused');
  assert.equal(save(), true);
  assert.equal(notSaved(), false);
  const kept = store.get('post-time/player'), setItem = localStorage.setItem;
  const heard = [];
  const listen = () => heard.push(notSaved());
  window.addEventListener('post-time:saved', listen);
  try {
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    game.player.bank += 5;
    assert.equal(save(), false);
    assert.equal(notSaved(), true);
    assert.equal(store.get('post-time/player'), kept);
    // The meet goes in and the player doesn't: that isn't kept either.
    localStorage.setItem = (k, v) => { if (k === 'post-time/player') throw new Error('QuotaExceededError'); setItem(k, v); };
    assert.equal(save(), false);
    assert.equal(notSaved(), true);
  } finally { localStorage.setItem = setItem; }
  assert.equal(save(), true);
  assert.equal(notSaved(), false);
  window.removeEventListener('post-time:saved', listen);
  assert.deepEqual(heard, [true, true, false], 'the page is told before the save is tried, or not at all');
  assert.equal(JSON.parse(store.get('post-time/player')).bank, game.player.bank);
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
  { bank: 188, races: ['R1 2-3-1 71.17 $8.40', 'R2 3-2-6 64.61 $2.80', 'R3 3-6-7 83.49 $3.60', 'R4 6-5-4 70.72 $14.80', 'R5 1-2-3 64.40 $4.00', 'R6 4-6-7 64.17 $6.60', 'R7 4-3-10 63.38 $28.40', 'R8 2-6-3 101.56 $35.40'] },
  { bank: 196.6, races: ['R1 9-2-8 110.61 $10.40', 'R2 4-5-8 64.66 $20.20', 'R3 8-5-6 102.30 $4.00', 'R4 1-8-3 103.29 $15.60', 'R5 2-7-5 76.56 $4.00', 'R6 1-7-5 63.93 $9.00', 'R7 6-5-1 108.57 $4.20', 'R8 8-5-6 95.30 $21.80'] },
  { bank: 204.6, races: ['R1 1-3-7 84.76 $6.00', 'R2 2-7-6 97.67 $16.40', 'R3 5-9-6 64.18 $13.40', 'R4 8-3-2 64.45 $38.00', 'R5 7-3-5 83.24 $7.20', 'R6 4-2-3 110.15 $8.60', 'R7 1-2-4 103.21 $18.00', 'R8 2-8-1 108.82 $12.80'] },
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

// The tap on To the gate writes the meet once. (When the race's forum thread hadn't been opened it was made
// then, with a save of its own, and the whole meet was written a second time a moment later: 54 ms each on a
// slow phone, with nothing drawn until both were done.)
test('going to the gate saves the meet once, whether or not the forum was opened', () => {
  build('one-save');
  const real = localStorage.setItem;
  let writes = 0;
  localStorage.setItem = (k, v) => { if (k === 'post-time/world') writes++; real(k, v); };
  try {
    const [unread, read] = card().races;
    assert.equal(unread.forum, undefined);
    goToGate(unread);
    assert.equal(writes, 1, `a race whose forum wasn't opened wrote the meet ${writes} times at the gate`);
    assert.ok(unread.forum.length >= 3 && JSON.parse(store.get('post-time/world')).cards[0].races[0].forum.length === unread.forum.length, 'the thread made at the gate was not saved');
    const posts = forumFor(read);
    assert.equal(writes, 2, 'opening the forum should keep its thread');
    goToGate(read);
    assert.equal(writes, 3);
    assert.equal(read.forum, posts);
  } finally { localStorage.setItem = real; }
});

test("the best day is the one you came out furthest ahead on, today included, and there's none until a day is won", () => {
  assert.equal(bestDay([]), null);
  // A losing first day used to show as "Best day −$10.00".
  assert.equal(bestDay([{ day: 0, no: 1, spent: 10, back: 0, best: 0 }]), null, 'a day that lost money is the best day');
  assert.equal(bestDay([{ day: 0, no: 1, spent: 4, back: 4, best: 4 }]), null, 'a day that broke even is the best day');
  const ledger = [
    { day: 0, no: 1, spent: 10, back: 0 }, { day: 0, no: 2, spent: 2, back: 9.6 },
    { day: 1, no: 1, spent: 4, back: 30.2 }, { day: 1, no: 5, spent: 6, back: 0 },
    { day: 2, no: 3, spent: 2, back: 20.1 },
  ];
  assert.deepEqual(bestDay(ledger), { day: 1, net: 20.2 });
  // Today counts as soon as its races are run: nothing waits for the next race day to be asked for.
  build('best-day');
  const race = card().races[0], winner = goToGateWith(race);
  assert.equal(game.player.best, null, 'nothing is saved as the best day until the next race day');
  assert.deepEqual(bestDay(), { day: 0, net: +(winner.back - winner.spent).toFixed(2) });
});

// A $2 win ticket on the horse that's going to win, bought and run.
function goToGateWith(race) {
  const first = buildResult(race);
  assert.ok(placeBet(race, { type: 'win', sel: [first], amt: 2 }).ok);
  return goToGate(race);
}
function buildResult(race) {
  // The race comes out of its seed and its entries, so running it ahead of time says who wins.
  return simulateRace(race, game.world, { record: true }).results[0].h;
}

test('a ticket there isn\'t the money for is refused in dollars', () => {
  build('short-of-money');
  game.player.bank = 3.4;
  const race = card().races[0];
  assert.deepEqual(placeBet(race, { type: 'exbox', sel: [0, 1, 2], amt: 2 }), { ok: false, why: 'That ticket costs $12.00 and you have $3.40.' });
  assert.equal(game.player.bank, 3.4);
});

