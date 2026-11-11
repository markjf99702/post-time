// The game's state: the racing world, and you (bankroll, tickets, scrapbook). Everything is kept in
// localStorage. A race is settled the moment you send the horses to the gate, so closing the page
// halfway through a race doesn't change what happened.

import { buildWorld, simulateRace, makeOfficial, forumThread, nextDay as worldNextDay, ownerSilks, firstSaturday, CLASSES, redrawShortRaces, ensureStats, ensureMeet, isClosingDay } from './world.js';
import { makeTote, board, settle, ticketReturn, cost as betCost, legs } from './tote.js';
import { reactions } from './forum.js';
import { oddsText, lineText } from './handicap.js';
import { liveCall } from './call.js';
import { JOCKEYS, TRAINERS, OWNERS } from './data.js';
import { distanceName } from './track.js';

const KEY_WORLD = 'post-time/world';
const KEY_PLAYER = 'post-time/player';
export const START_BANK = 200;
const MTP_START = 12;
const MTP_SECONDS = 13; // real seconds per minute-to-post

export const game = { world: null, player: null };

// settings: `sound` and `voice` are the menu's two ticks. `voiceName` is there only when a voice has been
// chosen by name; without it the call is read by the best voice the browser has. `caller` is there, as
// 'joe', only when the downloaded voice is the one chosen (js/joe.js); the browser's reads where he isn't.
// `callerBehind` is there, as true, while the last race he was to call went to the browser's voice because
// this device couldn't make his lines in time: the menu says so.
function freshPlayer() {
  return {
    v: 1, bank: START_BANK, bets: {}, settled: {}, ledger: [], book: [], atm: 0, opened: {},
    settings: { sound: true, voice: false }, best: null,
  };
}

// True when the saved meet loaded, false when there's none, and 'damaged' when there's one that can't be
// used (damaged, or changed by hand). That one is left in storage: starting a new meet over it is the
// player's call, since it takes their bankroll and scrapbook with it. Their settings are kept meanwhile.
export function load() {
  try {
    const w = localStorage.getItem(KEY_WORLD);
    const p = localStorage.getItem(KEY_PLAYER);
    if (w && p) {
      const world = parsed(w), player = parsed(p);
      if (!isMeet(world) || !player || typeof player !== 'object') {
        game.world = null;
        game.player = { settings: { ...freshPlayer().settings, ...(player && typeof player.settings === 'object' ? player.settings : null) }, bank: 0 };
        return 'damaged';
      }
      game.world = world;
      game.player = { ...freshPlayer(), ...player };
      for (const fix of [redrawShort, refundStrays, stopEarlyClocks, countRecords, capMorningLines, meetsEnd]) {
        try { fix(); } catch { /* a save this can't make sense of loads as it is */ }
      }
      return true;
    }
  } catch { /* storage unavailable: start fresh */ }
  return false;
}

function parsed(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Enough of a meet to show today's card.
function isMeet(w) {
  const c = w && typeof w === 'object' && w.cards && typeof w.cards === 'object' ? w.cards[w.day] : null;
  return !!(c && Array.isArray(c.races) && c.races.length && Array.isArray(w.horses) && w.horses.length);
}

// Late in a long meet a maiden race could be left with fewer than three horses (one or none, and it
// couldn't be run, so the day never ended). Draw it again (it's open to winners now, as a claimer) under
// the same race number, and give back anything bet on it.
function redrawShort() {
  for (const race of redrawShortRaces(game.world)) {
    const k = raceKey(race);
    for (const b of game.player.bets[k] || []) game.player.bank = round2(game.player.bank + (b.cost || 0));
    delete game.player.bets[k];
    delete game.player.opened[k];
    delete race.forum;
  }
}

// Starting a new meet on the first race day used to carry the last meet's betting slip over, so a
// ticket could be bought on a number that isn't in the race. It can't be shown or settled: take it
// off the books and give the money back.
function refundStrays() {
  const c = game.world?.cards?.[game.world.day];
  if (!c || !game.player.bets) return;
  for (const race of c.races) {
    const k = raceKey(race);
    const list = game.player.bets[k];
    if (!Array.isArray(list)) continue;
    const s = game.player.settled[k];
    const line = game.player.ledger.find(l => l.day === race.day && l.no === race.no);
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (inRace(race, list[i].sel)) continue;
      const [b] = list.splice(i, 1);
      const cost = b.cost || 0;
      removed++;
      game.player.bank = round2(game.player.bank + cost);
      // A stray ticket never pays, so only the money spent changes.
      if (s && Array.isArray(s.returns)) { s.returns.splice(i, 1); s.spent = round2(s.spent - cost); }
      if (line) line.spent = round2(line.spent - cost);
    }
    if (removed && line && !list.length) game.player.ledger.splice(game.player.ledger.indexOf(line), 1);
  }
}

// Looking ahead at a later race used to start its clock, so it came up at 2 minutes to post with
// the betting nearly over. Only the race that's up next keeps one.
function stopEarlyClocks() {
  const c = game.world?.cards?.[game.world.day];
  if (!c || !game.player.opened) return;
  const up = c.races.find(r => r.status !== 'official');
  for (const r of c.races) if (r !== up && r.status !== 'official') delete game.player.opened[raceKey(r)];
}

// Riders' and trainers' records are a running count kept with the meet. A meet saved before that has none:
// it starts from the lines its horses hold today, and counts every race from here on.
function countRecords() {
  ensureStats(game.world);
}

// A morning line prints nothing longer than 50-1 now. A card drawn before that can have "99-1" on it: it
// reads 50-1 from here, and the price behind it, which the early money goes by, stays.
function capMorningLines() {
  for (const race of game.world.cards[game.world.day].races) {
    for (const e of race.entries) if (e.mlText) e.mlText = lineText(e.ml, e.mlText);
  }
}

// A meet saved before meets ended becomes meet 1, closing on its next tenth race day (js/world.js).
// Its bankroll at the start was $200, with no trip to the ATM: it's the first meet.
function meetsEnd() {
  ensureMeet(game.world);
}

function inRace(race, sel) {
  return Array.isArray(sel) && sel.length > 0 && sel.every(i => Number.isInteger(i) && i >= 0 && i < race.entries.length);
}

// True from when the browser refuses a save (its storage is blocked, or full) until one goes in again.
// The game carries on in memory meanwhile, and the page says the meet isn't being kept.
let refused = false;
export const notSaved = () => refused;

// Returns whether the meet and the player both went into storage.
export function save() {
  // Until the first meet is built there's nothing to keep; a setting changed meanwhile is kept with it.
  if (!game.world) return true;
  try {
    localStorage.setItem(KEY_WORLD, JSON.stringify(game.world, (k, v) => (k === 'path' ? undefined : v)));
    localStorage.setItem(KEY_PLAYER, JSON.stringify(game.player));
    refused = false;
  } catch { refused = true; }
  window.dispatchEvent(new Event('post-time:saved'));
  return !refused;
}

// ------------------------------------------------------------------ a copy of the meet

// A copy of the meet in one file: what Save a copy downloads, and what Google Drive keeps (js/drive.js). It's
// the meet and you as they're saved here, with when and where the copy was made. `more` adds what Drive keeps
// with it (which copy it is, and how far on the meet is).
export const COPY = 'post-time meet';
export function meetCopy(more = {}) {
  return JSON.stringify({ postTime: COPY, v: 1, saved: new Date().toISOString(), ...more, world: game.world, player: game.player }, (k, v) => (k === 'path' ? undefined : v));
}

// A copy read back, checked the way a save is when the page opens: enough of a meet to show its card, and a
// player. { ok: true, world, player, ... } or { ok: false, why }.
export function readCopy(text) {
  const c = typeof text === 'string' ? parsed(text) : null;
  if (!c || typeof c !== 'object' || c.postTime !== COPY) return { ok: false, why: "That file isn't a copy of a Post Time meet." };
  if (!isMeet(c.world) || !c.player || typeof c.player !== 'object' || Array.isArray(c.player)) return { ok: false, why: "That copy of a meet is damaged, so it can't be opened." };
  return { ...c, ok: true };
}

// The meet in a copy takes the place of the one here, and the page goes on from it as from a save. This
// device's settings stay (its voice and sound are its own). Nothing changes if either part can't be stored.
export function adopt(copy) {
  const settings = game.player?.settings;
  const player = { ...copy.player, settings: settings && typeof settings === 'object' ? settings : copy.player.settings };
  let was = null;
  try {
    was = [localStorage.getItem(KEY_WORLD), localStorage.getItem(KEY_PLAYER)];
    localStorage.setItem(KEY_WORLD, JSON.stringify(copy.world, (k, v) => (k === 'path' ? undefined : v)));
    localStorage.setItem(KEY_PLAYER, JSON.stringify(player));
  } catch {
    // (Put back what was here, so the two halves are of one meet.)
    try { for (const [k, v] of [[KEY_WORLD, was?.[0]], [KEY_PLAYER, was?.[1]]]) if (v != null) localStorage.setItem(k, v); } catch { /* as it is */ }
    return false;
  }
  totes.clear();
  recorded = { key: '', run: null };
  return load() === true;
}

// How far on a meet is, in what a player does: the race day, the races run on it, the tickets bought, the
// money. Two devices are at the same place in a meet when these match. A forum thread opened or a race's
// clock started isn't counted: just looking at a race doesn't move a meet on.
// (Which tickets, too, not just how many: two devices that each bought a $2 ticket on a race are not at the
// same place.)
export function progressMark(world = game.world, player = game.player) {
  if (!world || !player) return '';
  const races = world.cards?.[world.day]?.races || [];
  const tickets = JSON.stringify([player.bets || {}, player.ledger || []]);
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < tickets.length; i++) hash = Math.imul(hash ^ tickets.charCodeAt(i), 16777619);
  return [world.seed, world.day, races.filter(r => r.status === 'official').length, (hash >>> 0).toString(36), round2(player.bank || 0), player.atm || 0,
    (player.ledger || []).length, (player.book || []).length].join('|');
}

// A meet that's just been built and never played: opening day of the first meet, nothing run or bet. A device
// with one of these takes a meet from Drive without asking.
export function untouched(world = game.world, player = game.player) {
  if (!world || !player) return true;
  const m = world.meet, races = world.cards?.[world.day]?.races || [];
  return !!m && m.no === 1 && world.day === m.first && !(world.meets || []).length && !races.some(r => r.status === 'official')
    && !(player.ledger || []).length && !(player.atm || 0) && !Object.values(player.bets || {}).some(l => Array.isArray(l) && l.length);
}

// Where a meet is, for saying which is which: "Meet 1, race day 7", its date, the races run that day and the
// bankroll. (A save from before meets ended has no meet number yet.)
export function whereIs(world = game.world, player = game.player) {
  const c = world.cards[world.day];
  return {
    meet: world.meet?.no || 1, raceDay: world.meet ? world.day - world.meet.first + 1 : null, date: c.date,
    run: c.races.filter(r => r.status === 'official').length, of: c.races.length, bank: round2(player.bank || 0),
  };
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
// Things kept in memory for a race (its tote, your betting slip) are kept per meet too: a new meet
// starts again at race day 1 with the same race numbers.
export const memoKey = race => `${game.world.seed}:${raceKey(race)}`;

const totes = new Map();
export function toteFor(race) {
  const k = memoKey(race);
  if (!totes.has(k)) totes.set(k, makeTote(race, game.world));
  return totes.get(k);
}

// Minutes to post, and how far through the betting we are, from when you first opened the race.
// Only the race that's up next has a clock running; a later one shows its opening odds until then.
export function mtpState(race) {
  const k = raceKey(race);
  if (race.status === 'official') return { mtp: 0, frac: 1 };
  if (nextRace() !== race) return { mtp: MTP_START, frac: 0 };
  // A race opened later than now was opened by a clock that has since been put back (a phone's wrong
  // clock put right). Start its clock again from now, or it would be hundreds of minutes from post, with
  // a board that can't work out any odds, until the clock caught up.
  const now = Date.now();
  if (!(game.player.opened[k] <= now)) game.player.opened[k] = now;
  const secs = Math.max(0, (now - game.player.opened[k]) / 1000);
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
  if (c <= 0 || !inRace(race, bet.sel)) return { ok: false, why: 'Pick your horses first.' };
  if (c > game.player.bank + 1e-9) return { ok: false, why: `That ticket costs $${c.toFixed(2)} and you have $${game.player.bank.toFixed(2)}.` };
  const k = raceKey(race);
  // A win, place or show ticket keeps the price its horse showed on the board when it was bought, so its
  // result can say how far the odds moved before the off ("bought at 15-1, went off 3-1"): every ticket is
  // paid at the final odds. (A ticket bought before this has none, and says nothing about it.)
  const at = ONE_HORSE.includes(bet.type) ? currentBoard(race).text[bet.sel[0]] : null;
  (game.player.bets[k] || (game.player.bets[k] = [])).push({ ...bet, cost: c, ...(at ? { at } : {}) });
  game.player.bank = round2(game.player.bank - c);
  save();
  return { ok: true, cost: c };
}

const ONE_HORSE = ['win', 'place', 'show', 'wps'];

export function cancelBet(race, i) {
  const list = myBets(race);
  const [b] = list.splice(i, 1);
  if (b) game.player.bank = round2(game.player.bank + b.cost);
  save();
}

// The forum's thread on a race, made the first time it's wanted and kept with the meet from then on.
const thread = race => race.forum || (race.forum = forumThread(game.world, race, toteFor(race)));
export function forumFor(race) {
  if (!race.forum) { thread(race); save(); }
  return race.forum;
}

// Who a horse runs for in this race: its owner and trainer or, once the race has been run and the horse
// was claimed out of it, the ones who entered it. (A race run before that was kept has only the new ones.)
export const ranFor = e => e.ran || horseOf(e);

export function runnersFor(race) {
  const mine = new Set(myBets(race).flatMap(b => b.sel));
  return race.entries.map((e, i) => {
    const h = horseOf(e);
    return { number: e.pp, coat: h.coat, marks: h.marks, silks: ownerSilks(ranFor(e).owner), name: h.name, mine: mine.has(i), blinkers: h.style > 0.8 };
  });
}

// A race as it will be run, or was: it comes only from the race's own seed and entries, so it can be
// worked out before the race goes to the gate. The caller's downloaded voice has the call made by then
// (js/ui/watch.js rehearse). Nothing is settled or shown by this, and the one race kept is the last asked for.
let recorded = { key: '', run: null };
export function recordingOf(race) {
  const key = `${memoKey(race)}:${race.seed}`;
  if (recorded.key !== key) recorded = { key, run: simulateRace(race, game.world, { record: true }) };
  return recorded.run;
}

// Off they go: run the race, settle every ticket, and write it all down.
export function goToGate(race) {
  const run = recordingOf(race);
  if (race.status === 'official') return { run, replay: true };
  const bets = myBets(race);
  // (A thread nobody has opened is made here without a save of its own: the whole meet, half a million
  // characters, was written twice on the tap that starts a race. The save below writes it.)
  const { order, pay, posts } = makeOfficial(game.world, race, run, { tote: toteFor(race), bets, posts: thread(race) });
  race.forumAfter = reactions(game.world, race, posts, order, pay, run);
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
  const { owner, trainer } = ranFor(e);
  return {
    day: race.day, date: race.date, no: race.no, name: race.name, cls: race.cls, claim: race.claim, dist: distanceName(race.distance),
    surface: race.surface, time: race.result.time, horse: { name: h.name, coat: h.coat, marks: h.marks, sex: h.sex },
    owner, number: e.pp, jockey: JOCKEYS[e.j].name, trainer: TRAINERS[trainer], ownerName: OWNERS[owner],
    seed: race.seed, won: round2(won || 0), stakes: race.cls === 'STK',
  };
}

// The race call, planned at the gate (see liveCall in call.js for what `opts` may say about the voice).
export function callFor(race, run, opts) {
  const names = race.entries.map(e => horseOf(e).name);
  return liveCall(race, run, names, { info: callInfo(race), ...opts });
}
// What the caller knows of a race besides its running (raceCall in call.js): the board at the off, the
// riders, and the horse with your money on it. The final odds are the board the race is settled with,
// your tickets and all (makeOfficial in world.js), so they're known before it's run, and a call made while
// the form is read says what the board will say at the off, as long as no ticket is bought after it.
export function callInfo(race) {
  const done = race.status === 'official' && race.result && Array.isArray(race.result.odds);
  const bets = myBets(race);
  const final = done ? { odds: race.result.odds, text: race.result.oddsText || race.result.odds.map(oddsText) } : board(toteFor(race), 1, bets);
  const odds = final.odds;
  const most = new Map();
  for (const b of bets) for (const i of b.sel) most.set(i, (most.get(i) || 0) + (b.amt || 0));
  let mine = null;
  for (const [i, amt] of most) if (mine === null || amt > most.get(mine) || (amt === most.get(mine) && i < mine)) mine = i;
  // What the winner pays, for the announcer: settled as makeOfficial will settle it, your tickets and all.
  const order = done ? race.result.order.map(o => o.k) : recordingOf(race).results.map(r => r.h);
  const pay = done ? race.result.pay : settle(toteFor(race), order, bets);
  const h = order[0];
  const paid = pay && pay.win ? { h, pp: race.entries[h].pp, win: pay.win[h] || 0, place: (pay.place || {})[h] || 0, show: (pay.show || {})[h] || 0 } : null;
  return {
    odds, oddsText: final.text, fav: odds.indexOf(Math.min(...odds)), mine, paid,
    riders: race.entries.map(e => (JOCKEYS[e.j] ? JOCKEYS[e.j].name.replace(/^[A-Z]\.\s*/, '') : '')),
    him: race.entries.map(e => (['f', 'm'].includes(horseOf(e).sex) ? 'her' : 'him')),
  };
}

export function atm() {
  game.player.bank = round2(game.player.bank + 100);
  game.player.atm += 100;
  save();
}

// Your meet: what you started it with (the bankroll it opened with; $200 for the first) and the trips to
// the ATM, what you bet and got back, the races you bet on and cashed, your biggest ticket, your photos,
// and what you finished with. `player.meetStart` is the bankroll and the ATM count as the meet opened;
// there's none in the first meet.
export function yourMeet(m = game.world.meet, p = game.player) {
  const start = p.meetStart && p.meetStart.no === m.no ? p.meetStart : { bank: START_BANK, atm: 0 };
  const inMeet = x => x.day >= m.first && x.day <= m.last;
  const ledger = p.ledger.filter(inMeet);
  const bet = round2(ledger.reduce((s, x) => s + x.spent, 0)), back = round2(ledger.reduce((s, x) => s + x.back, 0));
  return {
    start: start.bank, atm: round2(p.atm - start.atm), bet, back, races: ledger.length, cashed: ledger.filter(x => x.back > 0).length,
    best: round2(ledger.reduce((s, x) => Math.max(s, x.best), 0)), photos: p.book.filter(inMeet).length, end: p.bank,
    bestDay: bestDay(ledger),
  };
}

export function advanceDay() {
  const c = card();
  // Closing day: your meet goes on the meet's line, and the next one opens with your bankroll as it is.
  const closing = isClosingDay(game.world);
  const you = closing ? yourMeet() : null;
  const spent = c.races.reduce((s, r) => s + (game.player.settled[raceKey(r)]?.spent || 0), 0);
  const back = c.races.reduce((s, r) => s + (game.player.settled[raceKey(r)]?.back || 0), 0);
  if (spent && (!game.player.best || back - spent > game.player.best.net)) game.player.best = { day: c.day, date: c.date, net: round2(back - spent) };
  // Keep the save small: old tickets and opened times go.
  for (const k of Object.keys(game.player.bets)) if (+k.split(':')[0] < c.day) delete game.player.bets[k];
  for (const k of Object.keys(game.player.opened)) if (+k.split(':')[0] < c.day) delete game.player.opened[k];
  worldNextDay(game.world);
  if (closing) {
    const line = game.world.meets[game.world.meets.length - 1];
    if (line) line.you = you;
    game.player.meetStart = { no: game.world.meet.no, bank: game.player.bank, atm: game.player.atm };
  }
  totes.clear();
  save();
}

// The race day you came out furthest ahead on, by the betting record, with today's races so far in it; null
// until there's a day you came out ahead on. (The record page used to show what's saved as `best`, which
// is written only when the next race day is asked for, and was the least bad day when every day had lost:
// "Best day −$10.00".)
export function bestDay(ledger = game.player.ledger) {
  const days = new Map();
  for (const x of ledger) days.set(x.day, (days.get(x.day) || 0) + x.back - x.spent);
  let best = null;
  for (const [day, net] of days) if (round2(net) > 0 && (!best || net > best.net)) best = { day, net: round2(net) };
  return best;
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
  return b.odds.map(o => oddsText(o));
}

export { legs, betCost };
export function round2(x) { return Math.round(x * 100) / 100; }
