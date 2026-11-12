// The tote: pari-mutuel pools. Everyone's money goes in one pot per bet type, the track keeps its cut,
// and the rest is shared by the winning tickets. Odds move as the money comes in, and the late money
// knows a little more than the early money.

import { rng, hash } from './rng.js';
import { publicRating, postEdge, paceEdge, probsFrom, oddsText } from './handicap.js';

export const TAKEOUT = { win: 0.16, place: 0.16, show: 0.16, exacta: 0.2, trifecta: 0.25, dd: 0.2, p3: 0.25 };
export const BASE = { win: 2, place: 2, show: 2, exacta: 2, trifecta: 1, dd: 1, p3: 1 };
// The least a ticket can be bet for, in each pool. Payouts are still quoted for the base above, as tracks
// quote them, and a smaller ticket is paid its share (ticketReturn): $1 is half a $2 exacta, and 50 cents
// half a $1 trifecta. (Exactas were $2 and trifectas $1, twice what tracks sell them for.)
export const MIN = { win: 2, place: 2, show: 2, exacta: 1, trifecta: 0.5, dd: 1, p3: 1 };

const PADDOCK_LATE = 0.08;
const POOL = { MCL: 70000, MSW: 95000, C10: 65000, C16: 80000, C25: 95000, C40: 110000, ALW: 140000, STK: 260000 };

export function makeTote(race, world) {
  const R = rng(`tote:${race.seed}`);
  const n = race.entries.length;
  const seen = race.entries.map(e => publicRating(world.horses[e.hid], race, e, world.horses));
  const pub = seen.map(r => r + R.gauss() * 1.6);
  const early = probsFrom(pub, 0.15).map((p, i) => 0.6 * p + 0.4 * (1 / (race.entries[i].ml + 1)));
  // The late money knows what the public knows, and has a fair but rough idea of how each horse is
  // doing today: its day rating, give or take about seven points. It's most of the pool by the off, so
  // what it knows is in the final price as well as in the way the odds moved.
  const L = rng(`late:${race.seed}`);
  // (It knows the draw, and a horse that should have the lead to itself, as the public does: they're in what
  // it sees, and in its idea of the day rating.)
  // Part of it watches the paddock too: a horse that looks good there is backed a little more, one that
  // looks poor a little less. (Nobody at the track bet on the paddock, which is read from how a horse
  // really is that day, and $2 to win on every good-looker made a profit with no handicapping at all.)
  const looks = e => ({ good: PADDOCK_LATE, poor: -PADDOCK_LATE }[e.pdk?.kind] || 0);
  const late = probsFrom(seen.map((r, i) => 0.062 * r + 0.101 * (race.entries[i].rating + postEdge(race, race.entries[i].pp) + paceEdge(race, world.horses, race.entries[i]) + L.gauss() * 7) + looks(race.entries[i])), 1);
  const size = (POOL[race.cls] || 80000) * (race.purse >= 300000 ? 2.2 : 1) * R.range(0.8, 1.25) * (race.no === 8 ? 1.3 : 1);
  const wig = [...Array(n)].map(() => R.range(0, 1000));
  return { n, early: norm(early), late: norm(late), size, wig, seed: race.seed };
}

function norm(a) { const s = a.reduce((x, y) => x + y, 0); return a.map(x => x / s); }

// The public's win money at a moment in the betting, `frac` from 0 (window opens) to 1 (post time).
// The late money comes in as post time nears: by the off it's 85% of the pool.
export function publicWin(tote, frac) {
  const a = 0.85 * frac * frac;
  const total = tote.size * (0.22 + 0.78 * Math.pow(frac, 1.5));
  const tick = Math.floor(frac * 40);
  const mix = tote.early.map((p, i) => ((1 - a) * p + a * tote.late[i]) * (1 + 0.06 * Math.sin(tote.wig[i] + tick * 1.7) * (1 - frac * 0.6)));
  return norm(mix).map(p => p * total);
}

// The public bets the other pools in step with the win pool: for every $100 to win, $46 to place, $34
// to show, $92 on the exacta and $70 on the trifecta. Your own tickets go only in their own pools.
const SHARE = { win: 1, place: 0.46, show: 0.34, exacta: 0.92, trifecta: 0.7 };
const PLACE_LEAN = 1, SHOW_LEAN = 1.5;

// Everything the board shows at `frac`, including your own bets.
export function board(tote, frac, bets = []) {
  const win = publicWin(tote, frac);
  const pub = win.reduce((a, b) => a + b, 0);
  const pools = Object.fromEntries(Object.entries(SHARE).map(([k, s]) => [k, pub * s]));
  for (const b of bets) for (const leg of legs(b)) {
    if (!(leg.pool in pools)) continue; // (a double or Pick 3 has a pool of its own: multiSettle)
    pools[leg.pool] += leg.amt;
    if (leg.pool === 'win') win[leg.sel[0]] += leg.amt;
  }
  const net = pools.win * (1 - TAKEOUT.win);
  const odds = win.map(w => Math.max(0.05, net / w - 1));
  return {
    odds, text: odds.map(o => oddsText(o)),
    pools,
    fav: odds.indexOf(Math.min(...odds)),
  };
}

// A ticket becomes one or more simple bets on single outcomes.
// Entries are referred to by index (0-based order in race.entries).
export function legs(bet) {
  const out = [];
  const a = bet.amt;
  if (bet.type === 'win' || bet.type === 'place' || bet.type === 'show') out.push({ pool: bet.type, sel: bet.sel, amt: a });
  else if (bet.type === 'wps') for (const pool of ['win', 'place', 'show']) out.push({ pool, sel: bet.sel, amt: a });
  else if (bet.type === 'exacta') out.push({ pool: 'exacta', sel: bet.sel, amt: a });
  else if (bet.type === 'trifecta') out.push({ pool: 'trifecta', sel: bet.sel, amt: a });
  else if (bet.type === 'exbox') {
    for (const x of bet.sel) for (const y of bet.sel) if (x !== y) out.push({ pool: 'exacta', sel: [x, y], amt: a });
  } else if (bet.type === 'tribox') {
    for (const x of bet.sel) for (const y of bet.sel) for (const z of bet.sel) if (x !== y && y !== z && x !== z) out.push({ pool: 'trifecta', sel: [x, y, z], amt: a });
  } else if (MULTI[bet.type]) {
    // A daily double or Pick 3 names one or more horses in each of its races, and is one bet on every way
    // of putting them together: 2 and 3 in the first race with 5 in the second is two bets, 2-5 and 3-5.
    const combos = bet.sel.reduce((all, leg) => all.flatMap(c => leg.map(i => [...c, i])), [[]]);
    for (const sel of combos) out.push({ pool: bet.type, sel, amt: a });
  }
  return out;
}
export function cost(bet) { return legs(bet).reduce((s, l) => s + l.amt, 0); }

// How likely the public thinks a finish in this order is, from the win chances. Using them as they are
// for second and third makes the places as easy to call as the win, which overrates the favourites
// underneath and leaves the long shots there paying too much. So they're flattened for second and
// third (powers 0.81 and 0.65, the usual correction to Harville's formula).
const FLATTEN = [1, 0.81, 0.65];
function inOrder(p, sel, flat = FLATTEN.map(f => norm(p.map(v => v ** f)))) {
  let pr = 1;
  sel.forEach((x, k) => {
    const q = flat[k];
    pr *= q[x] / (1 - sel.slice(0, k).reduce((s, i) => s + q[i], 0));
  });
  return pr;
}

// The pools as they would be if the race went off at `frac` (1 is the off), your tickets in them: the
// money each payout is worked out from. Settling a race and saying what a ticket would pay at these odds
// (wouldPay) both start here, so the two can't disagree.
function poolsAt(tote, frac, bets) {
  const final = publicWin(tote, frac);
  const pub = final.reduce((a, b) => a + b, 0);
  const my = bets.flatMap(legs);
  const winPool = final.slice();
  for (const l of my) if (l.pool === 'win') winPool[l.sel[0]] += l.amt;
  const W = winPool.reduce((a, b) => a + b, 0);
  const p = norm(final);
  // Place and show money follows the chance of running in the first two or three.
  const top2 = p.map((_, i) => p[i] + p.reduce((s, pj, j) => j === i ? s : s + pj * p[i] / (1 - pj), 0));
  const top3 = p.map((_, i) => Math.min(0.97, top2[i] * 1.35));
  // ...and it leans on the short prices: place and show bettors pile onto a standout. (Spread by the
  // chances alone, the money on a favourite at 3-5 or shorter was thin enough that $2 to place on it made a
  // profit: 6.9% over 24 meets.)
  const placeMoney = norm(top2.map((x, i) => x * Math.exp(PLACE_LEAN * p[i]))).map(x => x * pub * SHARE.place);
  const showMoney = norm(top3.map((x, i) => x * Math.exp(SHOW_LEAN * p[i]))).map(x => x * pub * SHARE.show);
  for (const l of my) {
    if (l.pool === 'place') placeMoney[l.sel[0]] += l.amt;
    if (l.pool === 'show') showMoney[l.sel[0]] += l.amt;
  }
  const exacta = my.filter(l => l.pool === 'exacta'), trifecta = my.filter(l => l.pool === 'trifecta');
  // (The flattened chances for second and third, worked out once: an estimate tries every finish.)
  const q = FLATTEN.map(f => norm(p.map(v => v ** f)));
  return { pub, winPool, W, p, placeMoney, showMoney, exacta, trifecta, q };
}

const brk = (perDollar, base) => Math.max(base * 1.05, Math.floor(perDollar * 10 + 1e-9) / 10 * base);
const splitPool = (money, winners, take) => {
  const pool = money.reduce((x, y) => x + y, 0);
  const net = pool * (1 - take);
  const back = winners.reduce((s, i) => s + money[i], 0);
  const profit = Math.max(0, net - back);
  const res = {};
  for (const i of winners) res[i] = brk(1 + profit / winners.length / money[i], 2);
  return res;
};

// The payouts for a finish in `order`, from the pools.
function payOut(tote, P, order) {
  const { pub, winPool, W, p, placeMoney, showMoney } = P;
  const [a, b, c] = order;
  const out = { win: {}, place: {}, show: {}, exacta: null, trifecta: null };
  out.win[a] = brk((W * (1 - TAKEOUT.win)) / winPool[a], 2);
  out.place = splitPool(placeMoney, [a, b].filter(x => x !== undefined), TAKEOUT.place);
  out.show = splitPool(showMoney, [a, b, c].filter(x => x !== undefined), TAKEOUT.show);
  // Exotics: the public's money on the winning combination, from their win odds, with some scatter.
  // On a long enough combination that comes to less than one ticket, but a ticket can't be split: it
  // counts as one, so no ticket pays more than the whole pool.
  const scatter = sel => Math.exp(((hash(`${tote.seed}:${sel.join('-')}`) % 1000) / 1000 - 0.5) * 0.5);
  if (b !== undefined) {
    const E = pub * SHARE.exacta;
    let onCombo = E * inOrder(p, [a, b], P.q) * scatter([a, b]);
    const mine = P.exacta;
    const totalE = E + mine.reduce((s, l) => s + l.amt, 0);
    onCombo += mine.filter(l => l.sel[0] === a && l.sel[1] === b).reduce((s, l) => s + l.amt, 0);
    out.exacta = { sel: [a, b], pay: brk(totalE * (1 - TAKEOUT.exacta) / Math.max(onCombo, BASE.exacta), 2) };
  }
  if (c !== undefined) {
    const T = pub * SHARE.trifecta;
    let onCombo = T * inOrder(p, [a, b, c], P.q) * scatter([a, b, c]);
    const mine = P.trifecta;
    const totalT = T + mine.reduce((s, l) => s + l.amt, 0);
    onCombo += mine.filter(l => l.sel[0] === a && l.sel[1] === b && l.sel[2] === c).reduce((s, l) => s + l.amt, 0);
    out.trifecta = { sel: [a, b, c], pay: brk(totalT * (1 - TAKEOUT.trifecta) / Math.max(onCombo, BASE.trifecta), 1) };
  }
  return out;
}

// Payouts per base ticket ($2, or $1 for the trifecta), with breakage to the dime and a $2.10 minimum.
export function settle(tote, order, bets = []) {
  return payOut(tote, poolsAt(tote, 1, bets), order);
}

// What `bet` would bring back if the race went off now, at `frac`, with the board as it is and your tickets
// (`bets`, and this one) in the pools: { low, high } over every finish it cashes on, the same for a ticket
// that can cash only one way, or null for one that can't cash. A place or show ticket pays more beside a long
// shot than beside the favourite, and a box pays what its combination that comes in pays.
export function wouldPay(tote, frac, bets, bet) {
  const P = poolsAt(tote, frac, [...bets, bet]);
  const n = P.p.length, top = Math.min(3, n), mine = new Set(bet.sel);
  let low = Infinity, high = 0;
  // Every order of the first three that has one of the ticket's horses in it.
  const pick = (order, used) => {
    if (order.length === top) {
      if (!order.some(i => mine.has(i))) return;
      const back = ticketReturn(bet, payOut(tote, P, order));
      if (back > 0) { low = Math.min(low, back); high = Math.max(high, back); }
      return;
    }
    for (let i = 0; i < n; i++) if (!used[i]) { used[i] = true; pick([...order, i], used); used[i] = false; }
  };
  pick([], []);
  return high > 0 ? { low, high } : null;
}

// What a ticket brings back, given the payouts.
export function ticketReturn(bet, pay) {
  let back = 0;
  for (const l of legs(bet)) {
    const units = l.amt / BASE[l.pool];
    if (l.pool === 'win' && pay.win[l.sel[0]]) back += units * pay.win[l.sel[0]];
    if (l.pool === 'place' && pay.place[l.sel[0]]) back += units * pay.place[l.sel[0]];
    if (l.pool === 'show' && pay.show[l.sel[0]]) back += units * pay.show[l.sel[0]];
    if (l.pool === 'exacta' && pay.exacta && l.sel[0] === pay.exacta.sel[0] && l.sel[1] === pay.exacta.sel[1]) back += units * pay.exacta.pay;
    if (l.pool === 'trifecta' && pay.trifecta && l.sel.every((x, k) => x === pay.trifecta.sel[k])) back += units * pay.trifecta.pay;
    if (MULTI[l.pool] && pay[l.pool] && l.sel.every((x, k) => x === pay[l.pool].sel[k])) back += units * pay[l.pool].pay;
  }
  return Math.round(back * 100) / 100;
}

export const BET_NAMES = {
  win: 'Win', place: 'Place', show: 'Show', wps: 'Across the board', exacta: 'Exacta', exbox: 'Exacta box', trifecta: 'Trifecta', tribox: 'Trifecta box',
  dd: 'Daily double', p3: 'Pick 3',
};

// ------------------------------------------------------------------ the daily double and the Pick 3

// Tickets on the winners of races in a row: a daily double on the last two races of the day, and a Pick 3
// on the last three, ending in the stakes. Each has a pool of its own, which closes when its first race
// goes off. The public bets it at about half that race's win pool for the double and two fifths for the
// Pick 3, and the track keeps what it keeps from the exacta and the trifecta.
export const MULTI = { dd: { legs: 2, share: 0.5 }, p3: { legs: 3, share: 0.4 } };
// The race a daily double or Pick 3 starts in, on a card of `count` races.
export const firstLeg = (type, count) => count - MULTI[type].legs + 1;

// The public's chances in each race of a multi-race pool: the first race at its final odds (the pool closes
// as it goes off), and the later ones at their opening odds, which is all anyone has seen of them by then.
// `frac` is how far the first race's betting has gone, for saying what a ticket would pay before the off.
// The money on a combination is the pool times the chances of its winners, with some scatter, as the
// exacta's is; your own tickets (`bets`) are added in.
// The later races' chances are flattened (to the power 0.7): money there is spread wider than the opening
// odds, which are early, rough and from a few bettors, and the errors in them multiply from race to race. As
// they were, a straight Pick 3 picked at random got back more than it cost (+2.9% over 600 race days), and
// once flattened it's -25% to -29%, like a trifecta (npm run sim).
const LATER_LEGS = 0.7;
// `closed` is what the pool closed on (multiClose), once its first race has gone off.
function multiPool(type, totes, bets, frac, closed = null) {
  const p = closed ? closed.p : totes.map((t, k) => norm(k === 0 ? publicWin(t, frac) : publicWin(t, 0).map(v => v ** LATER_LEGS)));
  const pub = totes[0].size * MULTI[type].share;
  const mine = bets.flatMap(legs).filter(l => l.pool === type);
  return { p, pub, mine, total: pub + mine.reduce((s, l) => s + l.amt, 0), seed: totes[0].seed };
}
function multiPayFrom(type, P, sel) {
  const scatter = Math.exp(((hash(`${P.seed}:${type}:${sel.join('-')}`) % 1000) / 1000 - 0.5) * 0.5);
  let onCombo = P.pub * sel.reduce((pr, x, k) => pr * P.p[k][x], 1) * scatter;
  onCombo += P.mine.filter(l => l.sel.every((x, k) => x === sel[k])).reduce((s, l) => s + l.amt, 0);
  // (A combination with less than one ticket on it counts as one: no ticket pays more than the whole pool.)
  return { sel: sel.slice(), pay: brk(P.total * (1 - TAKEOUT[type]) / Math.max(onCombo, BASE[type]), BASE[type]) };
}

// What a pool closes on as its first race goes off: the public's chances in each of its races, { p }. The game
// keeps it with that race (js/game.js), since a race's tote made again once it has been run sees the race in
// its horses' form and comes out different: the will-pays and the payout would move after the page was closed
// and opened again between the races.
export function multiClose(type, totes) {
  return { p: multiPool(type, totes, [], 1).p };
}

// What a $1 daily double or Pick 3 pays when the winners of its races are `sel` (one entry index per race),
// with your tickets in the pool: { sel, pay }. `totes` are its races' totes, first race first, and `closed`
// what the pool closed on, when that was kept.
export function multiSettle(type, totes, sel, bets = [], closed = null) {
  return multiPayFrom(type, multiPool(type, totes, bets, 1, closed), sel);
}

// The will-pays: once every race of a double or Pick 3 but its last has been run, with `won` their winners,
// what $1 would pay with each horse in the last race. They're what's paid, since the pool closed at the
// first race.
export function willPays(type, totes, won, bets = [], closed = null) {
  const P = multiPool(type, totes, bets, 1, closed);
  return P.p[P.p.length - 1].map((_, j) => multiPayFrom(type, P, [...won, j]).pay);
}

// What a double or Pick 3 ticket would bring back if its first race went off now (at `frac`) and the others
// went as their opening odds say: { low, high } over the combinations it has, as wouldPay does for one race.
export function wouldPayMulti(totes, frac, bets, bet) {
  const P = multiPool(bet.type, totes, [...bets, bet], frac);
  let low = Infinity, high = 0;
  for (const l of legs(bet)) {
    const back = l.amt / BASE[bet.type] * multiPayFrom(bet.type, P, l.sel).pay;
    low = Math.min(low, back); high = Math.max(high, back);
  }
  return high > 0 ? { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 } : null;
}
