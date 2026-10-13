// Plays whole meets with nobody watching and reports how the betting comes out: how often the favourite
// wins, what simple ways of betting get back, how the forum regulars do, and checks on the tote's sums.
// For tuning the tote, the handicapping and the barn.
//   npm run sim                                     6 meets of 20 race days: 960 races, under a minute
//   npm run sim -- --meets 2 --days 40 --seed lab --quick
// Every race is bet and run the way the game does it. --quick runs them with the coarser time step the
// history weeks use: several times faster, and close enough for the betting.
import { createWorld, simulateRace, applyResult, nextDay } from '../js/world.js';
import { makeTote, board, publicWin, settle, ticketReturn, cost, TAKEOUT } from '../js/tote.js';
import { forumPosts, runStyle } from '../js/forum.js';
import { publicRating } from '../js/handicap.js';
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
  ['Best on the form to win', c => win(argmax(c.race.entries.map(e => publicRating(c.world.horses[e.hid], c.race, e))))],
  ['A horse picked at random, to win', c => win(rng(`sim:${c.race.seed}`).int(0, c.race.entries.length - 1))],
  ['Longest price to win', c => win(argmax(c.late))],
  ['Biggest drop in the odds since the opening, to win', c => {
    const move = c.late.map((o, i) => (c.open[i] + 1) / (o + 1));
    return move[argmax(move)] > 1.15 ? win(argmax(move)) : [];
  }],
  ['Every horse that looks good in the paddock, to win', c => c.race.entries.flatMap((e, i) => (e.pdk.kind === 'good' ? win(i) : []))],
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
let races = 0, short = 0, overPool = 0, winPaid = 0, winBet = 0;
const tipsters = {};
const t0 = Date.now();

for (let m = 0; m < MEETS; m++) {
  const world = createWorld(`${SEED}-${m}`, '2026-09-26');
  for (let d = 0; d < DAYS; d++) {
    for (const race of world.cards[world.day].races) {
      const n = race.entries.length;
      if (n < 2) { short++; continue; } // can't be run; the game redraws it
      const tote = makeTote(race, world);
      const open = board(tote, 0).odds, late = board(tote, 0.9).odds, off = board(tote, 1);
      const forumBoard = board(tote, 0.45); // when the game shows the forum
      const posts = forumPosts(world, race, { odds: forumBoard.odds, text: forumBoard.text });
      const run = simulateRace(race, world, { record: !QUICK });
      const order = run.results.map(r => r.h);
      const [a, b, c] = order;
      const pay = settle(tote, order);
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
      applyResult(world, race, run, off.odds);
      for (const p of posts) {
        if (p.pass || !p.pick.length) continue;
        const t = tipsters[p.who] || (tipsters[p.who] = { picks: 0, wins: 0, back: 0 });
        t.picks++;
        if (p.pick[0] === a) { t.wins++; t.back += pay.win[a]; }
      }
      races++;
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
out.push('', `${'Winners by their odds at the off'.padEnd(54)}horses     won   share of the betting`);
for (const B of bands) if (B.n) out.push(row(B.b[0] === 0 ? 'odds-on' : B.b[1] === Infinity ? `${B.b[0]}-1 or longer` : `${B.b[0]}-1 to ${B.b[1]}-1`, B.n, `${share(B.won / B.n).padStart(6)}   ${share(B.share / B.n).padStart(6)}`));
out.push('', `${'Ways of betting, picked at 2 minutes to post'.padEnd(54)} races   won or lost per $1`);
WAYS.forEach(([name], k) => { if (tally[k].length) out.push(row(name, tally[k].length, result(tally[k]))); });
out.push(row('A straight win ticket picked at random', random.win.length, averaged(random.win)));
out.push(row('A straight exacta picked at random', random.exacta.length, averaged(random.exacta)));
out.push(row('A straight trifecta picked at random', random.trifecta.length, averaged(random.trifecta)));
out.push(`  The track keeps ${Math.round(100 * TAKEOUT.win)}% of win, place and show, ${Math.round(100 * TAKEOUT.exacta)}% of the exacta and ${Math.round(100 * TAKEOUT.trifecta)}% of the trifecta.`);
out.push('', `${'The forum regulars, $2 to win on each top pick'.padEnd(54)} picks     won   won or lost per $1`);
for (const t of TIPSTERS) {
  const r = tipsters[t.id];
  if (r) out.push(row(t.handle, r.picks, `${share(r.wins / r.picks).padStart(6)}  ${pct(r.back / (2 * r.picks) - 1).padStart(7)}`));
}
out.push('', 'The tote');
out.push(`  share of the win pool paid back       ${share(winPaid / winBet)}`);
out.push(`  biggest payouts                       ${dollars(big.win)} to win, ${dollars(big.exacta)} for a $2 exacta, ${dollars(big.trifecta)} for a $1 trifecta`);
out.push(`  exotics paying more than their pool   ${overPool}`);
console.log(out.join('\n'));
