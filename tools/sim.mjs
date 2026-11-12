// Plays whole meets with nobody watching and reports how the betting comes out: how often the favourite
// wins, how much the odds move before the off, what simple ways of betting get back, how the forum
// regulars do, and checks on the tote's sums.
// For tuning the tote, the handicapping and the barn.
//   npm run sim                                     6 meets of 20 race days: 960 races, under a minute
//   npm run sim -- --meets 2 --days 40 --seed lab --quick
// Every race is bet and run the way the game does it. --quick runs them with the coarser time step the
// history weeks use: several times faster, and close enough for the betting.
import { createWorld, simulateRace, applyResult, nextDay } from '../js/world.js';
import { makeTote, board, publicWin, settle, ticketReturn, cost, TAKEOUT, MULTI, firstLeg, multiSettle } from '../js/tote.js';
import { forumPosts, runStyle, favouriteAtTheOff } from '../js/forum.js';
import { publicRating, angles } from '../js/handicap.js';
import { TIPSTERS } from '../js/data.js';
import { rng } from '../js/rng.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const MEETS = +opt('meets', 6), DAYS = +opt('days', 20), SEED = opt('seed', 'sim'), QUICK = args.includes('--quick');

// Ways of betting $2 a race, picked at 2 minutes to post (the last chance the game gives you). Each is
// settled on its own, as if it were the only player at the track.
const argmin = a => a.indexOf(Math.min(...a));
const argmax = a => a.indexOf(Math.max(...a));
const byOdds = c => c.late.map((o, i) => [o, i]).sort((x, y) => x[0] - y[0]).map(([, i]) => i);
const win = i => (i >= 0 ? [{ type: 'win', sel: [i], amt: 2 }] : []);
const WAYS = [
  ['Favourite to win', c => win(byOdds(c)[0])],
  ['Favourite to place', c => [{ type: 'place', sel: [byOdds(c)[0]], amt: 2 }]],
  ['Favourite to show', c => [{ type: 'show', sel: [byOdds(c)[0]], amt: 2 }]],
  ['Morning-line favourite to win', c => win(argmin(c.race.entries.map(e => e.ml)))],
  ['Best on the form to win', c => win(argmax(c.race.entries.map(e => publicRating(c.world.horses[e.hid], c.race, e, c.world.horses))))],
  ['A horse picked at random, to win', c => win(rng(`sim:${c.race.seed}`).int(0, c.race.entries.length - 1))],
  ['Longest price to win', c => win(argmax(c.late))],
  ['Biggest drop in the odds since the opening, to win', c => {
    const move = c.late.map((o, i) => (c.open[i] + 1) / (o + 1));
    return move[argmax(move)] > 1.15 ? win(argmax(move)) : [];
  }],
  ['Every horse that looks good in the paddock, to win', c => c.race.entries.flatMap((e, i) => (e.pdk.kind === 'good' ? win(i) : []))],
  ['The only good-looker in the paddock, to win', c => {
    const good = c.race.entries.map((e, i) => i).filter(i => c.race.entries[i].pdk.kind === 'good');
    return good.length === 1 ? win(good[0]) : [];
  }],
  ['Best on the form and good in the paddock, to win', c => {
    const best = argmax(c.race.entries.map(e => publicRating(c.world.horses[e.hid], c.race, e, c.world.horses)));
    return c.race.entries[best].pdk.kind === 'good' ? win(best) : [];
  }],
  ['Favourite at 3-5 or shorter, to place', c => (c.late[byOdds(c)[0]] <= 0.6 ? [{ type: 'place', sel: [byOdds(c)[0]], amt: 2 }] : [])],
  ['Favourite at 3-5 or shorter, to show', c => (c.late[byOdds(c)[0]] <= 0.6 ? [{ type: 'show', sel: [byOdds(c)[0]], amt: 2 }] : [])],
  ['Post 1, to win', c => win(0)],
  ['Posts 1 and 2 in races of a mile or more, to win', c => (c.race.f >= 8 ? [...win(0), ...win(1)] : [])],
  ['The only horse that needs the lead, to win', c => {
    const speed = c.race.entries.map((e, i) => i).filter(i => runStyle(c.world.horses[c.race.entries[i].hid]) === 'E');
    return speed.length === 1 ? win(speed[0]) : [];
  }],
  ['Exacta, favourite over second favourite', c => [{ type: 'exacta', sel: byOdds(c).slice(0, 2), amt: 2 }]],
  ['$1 trifecta box of the top three in the betting', c => [{ type: 'tribox', sel: byOdds(c).slice(0, 3), amt: 1 }]],
];

const tally = WAYS.map(() => []); // [spent, back] per race bet
const random = { win: [], exacta: [], trifecta: [] }; // a straight ticket picked at random: what it gets back per $1
const fav = { off: 0, late: 0, ml: 0 };
const bands = [[0, 1], [1, 2], [2, 5], [5, 10], [10, 20], [20, 35], [35, Infinity]].map(b => ({ b, n: 0, won: 0, share: 0 }));
const big = { win: 0, exacta: 0, trifecta: 0 };
const moves = { keep: 0, keepLate: 0, halves: 0, logs: [] }; // how much the board moves before the off
let races = 0, short = 0, overPool = 0, winPaid = 0, winBet = 0;
// Winners by post: starts, wins, the wins it would have with every horse in the race an equal chance, and
// what $2 to win on every runner from it got back. Sprints (one turn) and races of a mile or more (two).
const posts = { sprint: [], route: [] };
const postRow = (kind, k) => posts[kind][k] || (posts[kind][k] = { n: 0, won: 0, fair: 0, back: 0 });
// What trouble costs in the race itself, and what the Troubled trip chip is worth the next time.
const TROUBLES = [['Stumbled start', r => r.stumble], ['Broke slowly', r => r.slow], ['Bumped start', r => r.bumped && !r.stumble && !r.slow],
  ['Checked', r => r.checked > 0], ['Blocked (no check)', r => !r.checked && r.blocked > 3.5], ['None of these', r => !r.stumble && !r.slow && !r.bumped && !r.checked && r.blocked <= 3.5]];
const trouble = TROUBLES.map(() => ({ n: 0, won: 0, fair: 0, place: 0 }));
const chip = { with: { n: 0, won: 0, fair: 0, back: 0 }, without: { n: 0, won: 0, fair: 0, back: 0 } };
// Place and show on every horse, by its odds at 2 minutes to post.
const pbands = [[0, 0.6], [0.6, 1], [1, 2], [2, 5], [5, 10], [10, Infinity]].map(b => ({ b, n: 0, place: 0, show: 0 }));
// The fractions of six furlongs on a fast dirt track.
const six = { n: 0, q: 0, h: 0, fin: 0, lastFaster: 0 };
// How often the horse in front at the first call wins, by surface and trip.
const early = {};
const tipsters = {};
// The daily double and the Pick 3: a straight ticket picked at random (what it gets back per $1, as for the
// exacta), the favourite in each race, and the biggest payout.
const multi = Object.fromEntries(Object.keys(MULTI).map(t => [t, { random: [], favs: [], big: 0, overPool: 0 }]));
const t0 = Date.now();

for (let m = 0; m < MEETS; m++) {
  const world = createWorld(`${SEED}-${m}`, '2026-09-26');
  for (let d = 0; d < DAYS; d++) {
    const day = []; // each race's tote, winner and favourite at 2 minutes to post, for the multi-race pools
    for (const race of world.cards[world.day].races) {
      const n = race.entries.length;
      if (n < 2) { short++; day.push(null); continue; } // can't be run; the game redraws it
      const tote = makeTote(race, world);
      const open = board(tote, 0).odds, late = board(tote, 0.9).odds, off = board(tote, 1);
      const forumBoard = board(tote, 0.45); // when the game shows the forum
      // ChalkEater's pick is the favourite on the final board, as the game settles it at the off.
      const posts = favouriteAtTheOff(forumPosts(world, race, { odds: forumBoard.odds, text: forumBoard.text }), off.odds);
      const run = simulateRace(race, world, { record: !QUICK });
      const order = run.results.map(r => r.h);
      const [a, b, c] = order;
      const pay = settle(tote, order);
      const kind = race.f >= 8 ? 'route' : 'sprint';
      race.entries.forEach((e, i) => {
        const P = postRow(kind, e.pp - 1);
        P.n++; P.fair += 1 / n;
        if (i === a) { P.won++; P.back += pay.win[a]; }
        const res = run.results.find(r => r.h === i);
        TROUBLES.forEach(([, has], k) => { if (has(res)) { const T = trouble[k]; T.n++; T.fair += 1 / n; T.place += (res.pos - 1) / Math.max(1, n - 1); if (i === a) T.won++; } });
        const C = angles(race, world.horses[e.hid]).some(x => x[0] === 'Troubled trip last time') ? chip.with : chip.without;
        C.n++; C.fair += 1 / n;
        if (i === a) { C.won++; C.back += pay.win[a]; }
        const B = pbands.find(x => late[i] >= x.b[0] && late[i] < x.b[1]);
        B.n++; B.place += pay.place[i] || 0; B.show += pay.show[i] || 0;
      });
      const E = early[`${race.surface} ${kind}`] || (early[`${race.surface} ${kind}`] = { n: 0, won: 0 });
      E.n++; if (run.calls[0][0].h === a) E.won++;
      if (race.surface === 'dirt' && race.cond === 'fast' && race.f === 6 && run.fractions.length >= 3) {
        const [q, h] = run.fractions;
        six.n++; six.q += q.t; six.h += h.t; six.fin += run.finalTime;
        if (run.finalTime - h.t < h.t - q.t) six.lastFaster++;
      }
      const ctx = { race, world, open, late };
      WAYS.forEach(([, pick], k) => {
        const bets = pick(ctx);
        if (!bets.length) return;
        const paid = settle(tote, order, bets);
        tally[k].push([bets.reduce((s, x) => s + cost(x), 0), bets.reduce((s, x) => s + ticketReturn(x, paid), 0)]);
      });
      // A straight ticket picked at random, on average: only the winning combination pays, so it's what
      // that pays (with your ticket in the pool) over the number of combinations.
      random.win.push(settle(tote, order, win(a)).win[a] / 2 / n);
      random.exacta.push(settle(tote, order, [{ type: 'exacta', sel: [a, b], amt: 2 }]).exacta.pay / 2 / (n * (n - 1)));
      if (c !== undefined) random.trifecta.push(settle(tote, order, [{ type: 'trifecta', sel: [a, b, c], amt: 1 }]).trifecta.pay / (n * (n - 1) * (n - 2)));
      // The favourites, and the winners by their odds at the off.
      if (argmin(off.odds) === a) fav.off++;
      if (argmin(late) === a) fav.late++;
      if (argmin(race.entries.map(e => e.ml)) === a) fav.ml++;
      if (argmin(open) === argmin(off.odds)) moves.keep++;
      if (argmin(late) === argmin(off.odds)) moves.keepLate++;
      if (open.some((o, i) => (o + 1) / (late[i] + 1) >= 2)) moves.halves++;
      open.forEach((o, i) => moves.logs.push(Math.abs(Math.log((o + 1) / (off.odds[i] + 1)))));
      const implied = off.odds.map(o => 1 / (o + 1)), book = implied.reduce((s, x) => s + x, 0);
      off.odds.forEach((o, i) => { const B = bands.find(x => o >= x.b[0] && o < x.b[1]); B.n++; B.share += implied[i] / book; if (i === a) B.won++; });
      // The tote's sums: what share of the win pool comes back, and no ticket paying more than its pool.
      const money = publicWin(tote, 1);
      winPaid += pay.win[a] / 2 * money[a];
      winBet += money.reduce((s, x) => s + x, 0);
      if (pay.exacta && pay.exacta.pay > off.pools.exacta * (1 - TAKEOUT.exacta)) overPool++;
      if (pay.trifecta && pay.trifecta.pay > off.pools.trifecta * (1 - TAKEOUT.trifecta)) overPool++;
      big.win = Math.max(big.win, pay.win[a]);
      big.exacta = Math.max(big.exacta, pay.exacta?.pay || 0);
      big.trifecta = Math.max(big.trifecta, pay.trifecta?.pay || 0);
      day.push({ tote, won: a, fav: argmin(late), n });
      applyResult(world, race, run, off.odds);
      for (const p of posts) {
        if (p.pass || !p.pick.length) continue;
        const t = tipsters[p.who] || (tipsters[p.who] = { picks: 0, wins: 0, back: 0 });
        t.picks++;
        if (p.pick[0] === a) { t.wins++; t.back += pay.win[a]; }
      }
      races++;
    }
    for (const [type, M] of Object.entries(MULTI)) {
      const legs = day.slice(firstLeg(type, day.length) - 1);
      if (legs.length !== M.legs || legs.some(x => !x)) continue;
      const totes = legs.map(x => x.tote), won = legs.map(x => x.won), combos = legs.reduce((s, x) => s * x.n, 1);
      const pay = multiSettle(type, totes, won, [{ type, sel: won.map(x => [x]), amt: 1 }]).pay;
      multi[type].random.push(pay / combos);
      multi[type].big = Math.max(multi[type].big, pay);
      if (pay > totes[0].size * M.share * (1 - TAKEOUT[type]) + 1) multi[type].overPool++;
      // (The favourite in each race as the ticket is bought, at 2 minutes to post in its first race: the later
      // races are still at their opening odds.)
      const favs = legs.map((x, k) => (k === 0 ? x.fav : argmin(board(x.tote, 0).odds)));
      const ticket = { type, sel: favs.map(x => [x]), amt: 1 };
      multi[type].favs.push([1, ticketReturn(ticket, { [type]: multiSettle(type, totes, won, [ticket]) })]);
    }
    nextDay(world);
  }
  process.stderr.write(`\rmeet ${m + 1} of ${MEETS}: ${races} races, ${Math.round((Date.now() - t0) / 1000)} s`);
}
process.stderr.write('\n');
if (!races) { console.log('No races were run: --meets and --days take a number.'); process.exit(1); }

// ------------------------------------------------------------------ the report

const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;
const share = x => `${(100 * x).toFixed(1)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dollars = x => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Won or lost per $1 bet, with its standard error over the races bet.
function result(list) {
  const spent = list.reduce((s, x) => s + x[0], 0), back = list.reduce((s, x) => s + x[1], 0);
  const r = back / spent, n = list.length;
  const v = list.reduce((s, x) => s + (x[1] - r * x[0]) ** 2, 0) / Math.max(1, n - 1);
  return `${pct(r - 1).padStart(7)} ±${(100 * Math.sqrt(v / n) / (spent / n)).toFixed(1)}`;
}
function averaged(list) {
  const m = list.reduce((s, x) => s + x, 0) / list.length;
  const v = list.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, list.length - 1);
  return `${pct(m - 1).padStart(7)} ±${(100 * Math.sqrt(v / list.length)).toFixed(1)}`;
}
const row = (label, n, value) => `  ${label.padEnd(52)}${String(n).padStart(6)}  ${value}`;

const out = [
  `Post Time: ${plural(MEETS, 'meet')} of ${plural(DAYS, 'race day')}, ${races} races (seed "${SEED}"${QUICK ? ', quick races' : ''}), ${Math.round((Date.now() - t0) / 1000)} s`,
];
if (short) out.push(`  ${plural(short, 'race')} had fewer than two horses and couldn't be run`);
out.push('', 'How often the favourite wins');
out.push(`  at the off               ${share(fav.off / races)}`);
out.push(`  at 2 minutes to post     ${share(fav.late / races)}`);
out.push(`  on the morning line      ${share(fav.ml / races)}`);
const median = list => list.slice().sort((x, y) => x - y)[Math.floor(list.length / 2)];
out.push('', 'How much the odds move');
out.push('  the favourite is still the favourite at the off');
out.push(`    from the opening       ${share(moves.keep / races)}`);
out.push(`    from 2 minutes to post ${share(moves.keepLate / races)}`);
out.push(`  races with a payout that halves by 2 minutes to post   ${share(moves.halves / races)}`);
out.push(`  a typical horse's payout, opening to the off           x${Math.exp(median(moves.logs)).toFixed(2)} up or down`);
out.push('', `${'Winners by their odds at the off'.padEnd(54)}horses     won   share of the betting`);
for (const B of bands) if (B.n) out.push(row(B.b[0] === 0 ? 'odds-on' : B.b[1] === Infinity ? `${B.b[0]}-1 or longer` : `${B.b[0]}-1 to ${B.b[1]}-1`, B.n, `${share(B.won / B.n).padStart(6)}   ${share(B.share / B.n).padStart(6)}`));
out.push('', `${'Ways of betting, picked at 2 minutes to post'.padEnd(54)} races   won or lost per $1`);
WAYS.forEach(([name], k) => { if (tally[k].length) out.push(row(name, tally[k].length, result(tally[k]))); });
out.push(row('A straight win ticket picked at random', random.win.length, averaged(random.win)));
out.push(row('A straight exacta picked at random', random.exacta.length, averaged(random.exacta)));
out.push(row('A straight trifecta picked at random', random.trifecta.length, averaged(random.trifecta)));
const MULTI_NAME = { dd: 'daily double', p3: 'Pick 3' };
for (const [type, M] of Object.entries(multi)) {
  if (!M.random.length) continue;
  out.push(row(`A straight ${MULTI_NAME[type]} picked at random`, M.random.length, averaged(M.random)));
  out.push(row(`$1 ${MULTI_NAME[type]}, the favourite in each race`, M.favs.length, result(M.favs)));
}
out.push(`  The track keeps ${Math.round(100 * TAKEOUT.win)}% of win, place and show, ${Math.round(100 * TAKEOUT.exacta)}% of the exacta and the daily double, and ${Math.round(100 * TAKEOUT.trifecta)}% of the trifecta and the Pick 3.`);
const ratio = (won, fair) => (fair ? (won / fair).toFixed(2) : '-');
out.push('', `${'Winners by post'.padEnd(54)}starts     won   x fair share   back per $1`);
for (const kind of ['sprint', 'route']) {
  out.push(`  ${kind === 'sprint' ? 'Sprints (under a mile)' : 'A mile or more'}`);
  posts[kind].forEach((P, k) => { if (P && P.n >= 20) out.push(row(`  post ${k + 1}`, P.n, `${share(P.won / P.n).padStart(6)}   ${ratio(P.won, P.fair).padStart(6)}       ${pct(P.back / (2 * P.n) - 1).padStart(7)}`)); });
}
out.push('', `${'What trouble costs in the race'.padEnd(54)}starts     won   x fair share   finished (0 first, 1 last)`);
TROUBLES.forEach(([name], k) => { const T = trouble[k]; if (T.n) out.push(row(name, T.n, `${share(T.won / T.n).padStart(6)}   ${ratio(T.won, T.fair).padStart(6)}       ${(T.place / T.n).toFixed(2)}`)); });
out.push('', `${'The Troubled trip last time chip, next time out'.padEnd(54)}starts     won   x fair share   back per $1`);
for (const [name, C] of [['with the chip', chip.with], ['without it', chip.without]]) if (C.n) out.push(row(name, C.n, `${share(C.won / C.n).padStart(6)}   ${ratio(C.won, C.fair).padStart(6)}       ${pct(C.back / (2 * C.n) - 1).padStart(7)}`));
out.push('', `${'Place and show on every horse, by odds at 2 minutes'.padEnd(54)}horses   place    show`);
for (const B of pbands) if (B.n) out.push(row(B.b[1] === Infinity ? `${B.b[0]}-1 or longer` : B.b[1] === 0.6 ? '3-5 or shorter' : B.b[1] === 1 ? '3-5 to even money' : `${B.b[0]}-1 to ${B.b[1]}-1`, B.n, `${pct(B.place / (2 * B.n) - 1).padStart(7)} ${pct(B.show / (2 * B.n) - 1).padStart(7)}`));
const secs = t => `${t >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : `:${t.toFixed(1)}`}`;
out.push('', 'The horse in front at the first call wins');
for (const k of ['dirt sprint', 'dirt route', 'turf sprint', 'turf route']) if (early[k]) out.push(`  ${k.padEnd(24)} ${share(early[k].won / early[k].n)} of ${early[k].n}`);
if (six.n) out.push('', `Six furlongs on a fast dirt track, ${plural(six.n, 'race')}: ${secs(six.q / six.n)}, ${secs(six.h / six.n)}, ${secs(six.fin / six.n)} on average; the last quarter faster than the second in ${share(six.lastFaster / six.n)}`);
out.push('', `${'The forum regulars, $2 to win on each top pick'.padEnd(54)} picks     won   won or lost per $1`);
for (const t of TIPSTERS) {
  const r = tipsters[t.id];
  if (r) out.push(row(t.handle, r.picks, `${share(r.wins / r.picks).padStart(6)}  ${pct(r.back / (2 * r.picks) - 1).padStart(7)}`));
}
out.push('', 'The tote');
out.push(`  share of the win pool paid back       ${share(winPaid / winBet)}`);
out.push(`  biggest payouts                       ${dollars(big.win)} to win, ${dollars(big.exacta)} for a $2 exacta, ${dollars(big.trifecta)} for a $1 trifecta`);
out.push(`  exotics paying more than their pool   ${overPool}`);
out.push(`  biggest $1 daily double and Pick 3    ${dollars(multi.dd.big)} and ${dollars(multi.p3.big)}, ${multi.dd.overPool + multi.p3.overPool} paying more than their pool`);
console.log(out.join('\n'));
