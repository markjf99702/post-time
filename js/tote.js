// The tote: pari-mutuel pools. Everyone's money goes in one pot per bet type, the track keeps its cut,
// and the rest is shared by the winning tickets. Odds move as the money comes in, and the late money
// knows a little more than the early money.

import { rng, hash } from './rng.js';
import { publicRating, probsFrom, oddsText } from './handicap.js';

export const TAKEOUT = { win: 0.16, place: 0.16, show: 0.16, exacta: 0.2, trifecta: 0.25 };
export const BASE = { win: 2, place: 2, show: 2, exacta: 2, trifecta: 1 };

const POOL = { MCL: 70000, MSW: 95000, C10: 65000, C16: 80000, C25: 95000, C40: 110000, ALW: 140000, STK: 260000 };

export function makeTote(race, world) {
  const R = rng(`tote:${race.seed}`);
  const n = race.entries.length;
  const seen = race.entries.map(e => publicRating(world.horses[e.hid], race, e));
  const pub = seen.map(r => r + R.gauss() * 1.6);
  const early = probsFrom(pub, 0.15).map((p, i) => 0.6 * p + 0.4 * (1 / (race.entries[i].ml + 1)));
  // The late money knows what the public knows, and has a fair but rough idea of how each horse is
  // doing today: its day rating, give or take about seven points. It's most of the pool by the off, so
  // what it knows is in the final price as well as in the way the odds moved.
  const L = rng(`late:${race.seed}`);
  const late = probsFrom(seen.map((r, i) => 0.062 * r + 0.101 * (race.entries[i].rating + L.gauss() * 7)), 1);
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

// Everything the board shows at `frac`, including your own bets.
export function board(tote, frac, bets = []) {
  const win = publicWin(tote, frac);
  const pub = win.reduce((a, b) => a + b, 0);
  const pools = Object.fromEntries(Object.entries(SHARE).map(([k, s]) => [k, pub * s]));
  for (const b of bets) for (const leg of legs(b)) {
    pools[leg.pool] += leg.amt;
    if (leg.pool === 'win') win[leg.sel[0]] += leg.amt;
  }
  const net = pools.win * (1 - TAKEOUT.win);
  const odds = win.map(w => Math.max(0.05, net / w - 1));
  return {
    odds, text: odds.map(o => oddsText(Math.max(0.2, o))),
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
  }
  return out;
}
export function cost(bet) { return legs(bet).reduce((s, l) => s + l.amt, 0); }

// How likely the public thinks a finish in this order is, from the win chances. Using them as they are
// for second and third makes the places as easy to call as the win, which overrates the favourites
// underneath and leaves the long shots there paying too much. So they're flattened for second and
// third (powers 0.81 and 0.65, the usual correction to Harville's formula).
const FLATTEN = [1, 0.81, 0.65];
function inOrder(p, sel) {
  let pr = 1;
  sel.forEach((x, k) => {
    const q = norm(p.map(v => v ** FLATTEN[k]));
    pr *= q[x] / (1 - sel.slice(0, k).reduce((s, i) => s + q[i], 0));
  });
  return pr;
}

// Payouts per base ticket ($2, or $1 for the trifecta), with breakage to the dime and a $2.10 minimum.
export function settle(tote, order, bets = []) {
  const final = publicWin(tote, 1);
  const pub = final.reduce((a, b) => a + b, 0);
  const my = bets.flatMap(legs);
  const winPool = final.slice();
  for (const l of my) if (l.pool === 'win') winPool[l.sel[0]] += l.amt;
  const W = winPool.reduce((a, b) => a + b, 0);
  const p = norm(final);
  // Place and show money follows the chance of running in the first two or three.
  const n = p.length;
  const top2 = p.map((_, i) => p[i] + p.reduce((s, pj, j) => j === i ? s : s + pj * p[i] / (1 - pj), 0));
  const top3 = p.map((_, i) => Math.min(0.97, top2[i] * 1.35));
  const placeMoney = norm(top2).map(x => x * pub * SHARE.place);
  const showMoney = norm(top3).map(x => x * pub * SHARE.show);
  for (const l of my) {
    if (l.pool === 'place') placeMoney[l.sel[0]] += l.amt;
    if (l.pool === 'show') showMoney[l.sel[0]] += l.amt;
  }
  const brk = (perDollar, base) => Math.max(base * 1.05, Math.floor(perDollar * 10 + 1e-9) / 10 * base);
  const [a, b, c] = order;
  const out = { win: {}, place: {}, show: {}, exacta: null, trifecta: null };
  out.win[a] = brk((W * (1 - TAKEOUT.win)) / winPool[a], 2);
  const splitPool = (money, winners, take) => {
    const pool = money.reduce((x, y) => x + y, 0);
    const net = pool * (1 - take);
    const back = winners.reduce((s, i) => s + money[i], 0);
    const profit = Math.max(0, net - back);
    const res = {};
    for (const i of winners) res[i] = brk(1 + profit / winners.length / money[i], 2);
    return res;
  };
  out.place = splitPool(placeMoney, [a, b].filter(x => x !== undefined), TAKEOUT.place);
  out.show = splitPool(showMoney, [a, b, c].filter(x => x !== undefined), TAKEOUT.show);
  // Exotics: the public's money on the winning combination, from their win odds, with some scatter.
  // On a long enough combination that comes to less than one ticket, but a ticket can't be split: it
  // counts as one, so no ticket pays more than the whole pool.
  const scatter = sel => Math.exp(((hash(`${tote.seed}:${sel.join('-')}`) % 1000) / 1000 - 0.5) * 0.5);
  if (b !== undefined) {
    const E = pub * SHARE.exacta;
    let onCombo = E * inOrder(p, [a, b]) * scatter([a, b]);
    const mine = my.filter(l => l.pool === 'exacta');
    const totalE = E + mine.reduce((s, l) => s + l.amt, 0);
    onCombo += mine.filter(l => l.sel[0] === a && l.sel[1] === b).reduce((s, l) => s + l.amt, 0);
    out.exacta = { sel: [a, b], pay: brk(totalE * (1 - TAKEOUT.exacta) / Math.max(onCombo, BASE.exacta), 2) };
  }
  if (c !== undefined) {
    const T = pub * SHARE.trifecta;
    let onCombo = T * inOrder(p, [a, b, c]) * scatter([a, b, c]);
    const mine = my.filter(l => l.pool === 'trifecta');
    const totalT = T + mine.reduce((s, l) => s + l.amt, 0);
    onCombo += mine.filter(l => l.sel[0] === a && l.sel[1] === b && l.sel[2] === c).reduce((s, l) => s + l.amt, 0);
    out.trifecta = { sel: [a, b, c], pay: brk(totalT * (1 - TAKEOUT.trifecta) / Math.max(onCombo, BASE.trifecta), 1) };
  }
  return out;
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
  }
  return Math.round(back * 100) / 100;
}

export const BET_NAMES = {
  win: 'Win', place: 'Place', show: 'Show', wps: 'Across the board', exacta: 'Exacta', exbox: 'Exacta box', trifecta: 'Trifecta', tribox: 'Trifecta box',
};
