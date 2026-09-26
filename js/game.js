// The game's state: the racing world, and you (bankroll, tickets, scrapbook). Everything is kept in
// localStorage. A race is settled the moment you send the horses to the gate, so closing the page
// halfway through a race doesn't change what happened.

import { buildWorld, simulateRace, applyResult, nextDay as worldNextDay, ownerSilks, firstSaturday, CLASSES } from './world.js';
import { makeTote, board, settle, ticketReturn, cost as betCost, legs } from './tote.js';
import { forumPosts, reactions, scoreTipsters } from './forum.js';
import { oddsText } from './handicap.js';
import { raceCall } from './call.js';
import { JOCKEYS, TRAINERS, OWNERS } from './data.js';
import { distanceName } from './track.js';

const KEY_WORLD = 'post-time/world';
const KEY_PLAYER = 'post-time/player';
export const START_BANK = 200;
const MTP_START = 12;
const MTP_SECONDS = 13; // real seconds per minute-to-post

export const game = { world: null, player: null };

function freshPlayer() {
  return {
    v: 1, bank: START_BANK, bets: {}, settled: {}, ledger: [], book: [], atm: 0, opened: {},
    settings: { sound: true, voice: false }, best: null,
  };
}

export function load() {
  try {
    const w = localStorage.getItem(KEY_WORLD);
    const p = localStorage.getItem(KEY_PLAYER);
    if (w && p) {
      game.world = JSON.parse(w);
      game.player = { ...freshPlayer(), ...JSON.parse(p) };
      return true;
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return false;
}

export function save() {
  window.dispatchEvent(new Event('post-time:saved'));
  try {
    localStorage.setItem(KEY_WORLD, JSON.stringify(game.world, (k, v) => (k === 'path' ? undefined : v)));
    localStorage.setItem(KEY_PLAYER, JSON.stringify(game.player));
  } catch { /* private mode or full: carry on in memory */ }
}

// Builds a new meet a step at a time; call step() until it returns true.
export function newMeet(seed = Math.random().toString(36).slice(2, 10)) {
  const steps = buildWorld(seed, firstSaturday());
  let progress = 0;
  return {
    progress: () => progress,
    step() {
      const r = steps.next();
      if (r.done) {
        game.world = r.value;
        const keepSettings = game.player?.settings;
        game.player = freshPlayer();
        if (keepSettings) game.player.settings = keepSettings;
        save();
        return true;
      }
      progress = r.value;
      return false;
    },
  };
}

export const card = () => game.world.cards[game.world.day];
export const raceKey = race => `${race.day}:${race.no}`;
export const horseOf = e => game.world.horses[e.hid];
export const nextRace = () => card().races.find(r => r.status !== 'official') || null;

const totes = new Map();
export function toteFor(race) {
  const k = raceKey(race);
  if (!totes.has(k)) totes.set(k, makeTote(race, game.world));
  return totes.get(k);
}

// Minutes to post, and how far through the betting we are, from when you first opened the race.
export function mtpState(race) {
  const k = raceKey(race);
  if (race.status === 'official') return { mtp: 0, frac: 1 };
  const opened = game.player.opened[k] || (game.player.opened[k] = Date.now());
  const secs = (Date.now() - opened) / 1000;
  const mtp = Math.max(2, MTP_START - Math.floor(secs / MTP_SECONDS));
  const frac = Math.min(0.9, secs / (MTP_SECONDS * (MTP_START - 2)) * 0.9);
  return { mtp, frac };
}

export function currentBoard(race) {
  const { frac } = mtpState(race);
  return board(toteFor(race), race.status === 'official' ? 1 : frac, myBets(race));
}

export function myBets(race) { return game.player.bets[raceKey(race)] || []; }

export function placeBet(race, bet) {
  const c = betCost(bet);
  if (c <= 0) return { ok: false, why: 'Pick your horses first.' };
  if (c > game.player.bank + 1e-9) return { ok: false, why: `That ticket costs ${c.toFixed(2)} and you have ${game.player.bank.toFixed(2)}.` };
  const k = raceKey(race);
  (game.player.bets[k] || (game.player.bets[k] = [])).push({ ...bet, cost: c });
  game.player.bank = round2(game.player.bank - c);
  save();
  return { ok: true, cost: c };
}

export function cancelBet(race, i) {
  const list = myBets(race);
  const [b] = list.splice(i, 1);
  if (b) game.player.bank = round2(game.player.bank + b.cost);
  save();
}

export function forumFor(race) {
  if (!race.forum) {
    const b = board(toteFor(race), 0.45, []);
    race.forum = forumPosts(game.world, race, { odds: b.odds, text: b.text });
    save();
  }
  return race.forum;
}

export function runnersFor(race) {
  const mine = new Set(myBets(race).flatMap(b => b.sel));
  return race.entries.map((e, i) => {
    const h = horseOf(e);
    return { number: e.pp, coat: h.coat, marks: h.marks, silks: ownerSilks(h.owner), name: h.name, mine: mine.has(i), blinkers: h.style > 0.8 };
  });
}

// Off they go: run the race, settle every ticket, and write it all down.
export function goToGate(race) {
  const run = simulateRace(race, game.world, { record: true });
  if (race.status === 'official') return { run, replay: true };
  const tote = toteFor(race);
  const bets = myBets(race);
  const final = board(tote, 1, bets);
  const order = run.results.map(r => r.h);
  const pay = settle(tote, order, bets);
  const forum = forumFor(race);
  applyResult(game.world, race, run, final.odds);
  race.result.pay = pay;
  race.result.odds = final.odds.map(o => +o.toFixed(2));
  race.result.oddsText = final.text;
  race.forumAfter = reactions(game.world, race, forum, order, pay, run);
  game.world.tipsters = scoreTipsters(game.world.tipsters || {}, forum, order, pay);
  const returns = bets.map(b => ticketReturn(b, pay));
  const spent = bets.reduce((s, b) => s + b.cost, 0);
  const back = returns.reduce((s, r) => s + r, 0);
  game.player.bank = round2(game.player.bank + back);
  game.player.settled[raceKey(race)] = { returns, spent, back };
  if (bets.length) game.player.ledger.push({ day: race.day, no: race.no, spent, back, best: Math.max(0, ...returns) });
  // The winner's circle photo goes in your scrapbook if you backed the winner.
  const winIdx = order[0];
  const cashedWinner = bets.some((b, i) => returns[i] > 0 && (b.type === 'exbox' || b.type === 'tribox' || b.sel[0] === winIdx));
  if (cashedWinner) game.player.book.push(photoRecord(race, winIdx, back));
  save();
  return { run, pay, returns, spent, back, cashedWinner };
}

export function photoRecord(race, winIdx, won) {
  const e = race.entries[winIdx];
  const h = horseOf(e);
  return {
    day: race.day, date: race.date, no: race.no, name: race.name, cls: race.cls, claim: race.claim, dist: distanceName(race.distance),
    surface: race.surface, time: race.result.time, horse: { name: h.name, coat: h.coat, marks: h.marks, sex: h.sex },
    owner: h.owner, number: e.pp, jockey: JOCKEYS[e.j].name, trainer: TRAINERS[h.trainer], ownerName: OWNERS[h.owner],
    seed: race.seed, won: round2(won || 0), stakes: race.cls === 'STK',
  };
}

export function callFor(race, run) {
  const names = race.entries.map(e => horseOf(e).name);
  return raceCall(race, run, names);
}

export function atm() {
  game.player.bank = round2(game.player.bank + 100);
  game.player.atm += 100;
  save();
}

export function advanceDay() {
  const c = card();
  const spent = c.races.reduce((s, r) => s + (game.player.settled[raceKey(r)]?.spent || 0), 0);
  const back = c.races.reduce((s, r) => s + (game.player.settled[raceKey(r)]?.back || 0), 0);
  if (spent && (!game.player.best || back - spent > game.player.best.net)) game.player.best = { day: c.day, date: c.date, net: round2(back - spent) };
  // Keep the save small: old tickets and opened times go.
  for (const k of Object.keys(game.player.bets)) if (+k.split(':')[0] < c.day) delete game.player.bets[k];
  for (const k of Object.keys(game.player.opened)) if (+k.split(':')[0] < c.day) delete game.player.opened[k];
  worldNextDay(game.world);
  totes.clear();
  save();
}

export function dayTotals(c = card()) {
  let spent = 0, back = 0;
  for (const r of c.races) {
    const s = game.player.settled[raceKey(r)];
    if (s) { spent += s.spent; back += s.back; }
  }
  const pending = c.races.reduce((s, r) => s + (r.status === 'official' ? 0 : myBets(r).reduce((a, b) => a + b.cost, 0)), 0);
  return { spent, back, net: back - spent, pending };
}

export function raceLabel(race) {
  if (race.name) return race.name;
  const C = CLASSES[race.cls];
  if (race.claim) return `${C.long} $${race.claim.toLocaleString('en-US')}`;
  return C.long;
}

export function oddsNow(race) {
  const b = currentBoard(race);
  return b.odds.map(o => oddsText(Math.max(0.2, o)));
}

export { legs, betCost };
export function round2(x) { return Math.round(x * 100) / 100; }
