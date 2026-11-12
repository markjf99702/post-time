// The game's state: the racing world, and you (bankroll, tickets, scrapbook). Everything is kept in
// localStorage. A race is settled the moment you send the horses to the gate, so closing the page
// halfway through a race doesn't change what happened.

import { buildWorld, simulateRace, makeOfficial, forumThread, nextDay as worldNextDay, ownerSilks, fieldSilks, firstSaturday, CLASSES, redrawShortRaces, ensureStats, ensureMeet, isClosingDay } from './world.js';
import { makeTote, board, settle, ticketReturn, cost as betCost, legs, MULTI, firstLeg, multiSettle, multiClose, willPays as multiWillPays, wouldPayMulti } from './tote.js';
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
// this device couldn't make his lines in time: the menu says so. `betType` is the kind of bet last chosen at
// the window, which a race's betting slip starts on. `multi` is the day's daily double and Pick 3 tickets,
// which span races (see the section below). `stars` is the ids of the horses you've starred, to watch for:
// it's made the first time it's wanted (and from a save without one, as it loads: starsKept).
function freshPlayer() {
  return {
    v: 1, bank: START_BANK, bets: {}, multi: [], settled: {}, ledger: [], book: [], atm: 0, opened: {},
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
      for (const fix of [multiTickets, redrawShort, refundStrays, stopEarlyClocks, countRecords, capMorningLines, meetsEnd, starsKept]) {
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
    refundMulti(t => t.day === race.day && t.legs.includes(race.no));
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

// A save from before the daily double and the Pick 3 has no list of tickets that span races: it starts with
// none. A ticket in the list that isn't one of today's, or names a horse that isn't in its race, can't be
// settled: it goes, and its money comes back if it hasn't been settled.
function multiTickets() {
  const p = game.player;
  if (!Array.isArray(p.multi)) { p.multi = []; return; }
  const races = card().races;
  const ok = t => t && typeof t === 'object' && MULTI[t.type] && t.day === game.world.day && Array.isArray(t.legs) && Array.isArray(t.sel)
    && t.legs.length === MULTI[t.type].legs && t.sel.length === t.legs.length
    && t.legs.every((no, k) => { const r = races.find(x => x.no === no); return r && t.sel[k].length && inRace(r, t.sel[k]); });
  refundMulti(t => !ok(t));
}
function refundMulti(which) {
  const p = game.player;
  p.multi = p.multi.filter(t => {
    if (!which(t)) return true;
    if (t && typeof t === 'object' && t.back === undefined) p.bank = round2(p.bank + (+t.cost || 0));
    return false;
  });
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

// A save from before horses could be starred has no list of them: it starts with the horses in your winner's
// circle photos, which are starred for you. (Only then: a horse taken off the list stays off it.)
function starsKept() {
  const p = game.player;
  if (Array.isArray(p.stars)) { p.stars = p.stars.filter(Number.isInteger); return; }
  p.stars = [...new Set(p.book.map(photoHorse).filter(id => id !== null))];
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
  // (A daily double or Pick 3 is counted only when there is one, so a meet without them keeps its mark.)
  const tickets = JSON.stringify([player.bets || {}, player.ledger || [], ...(player.multi && player.multi.length ? [player.multi] : [])]);
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
    && !(player.ledger || []).length && !(player.atm || 0) && !Object.values(player.bets || {}).some(l => Array.isArray(l) && l.length)
    && !(player.multi || []).length;
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
  if (MULTI[bet.type]) return placeMulti(race, bet);
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
  const mine = new Set([...myBets(race).flatMap(b => b.sel), ...multiPicks(race).keys()]);
  const silks = silksFor(race);
  return race.entries.map((e, i) => {
    const h = horseOf(e);
    return { number: e.pp, coat: h.coat, marks: h.marks, silks: silks[i], name: h.name, mine: mine.has(i), blinkers: h.style > 0.8 };
  });
}

// The silks each runner wears in this race: an owner's second and third runner in a cap of their own.
export const silksFor = race => fieldSilks(race.entries.map(e => ranFor(e).owner));

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
  closePools(race);
  const { order, pay, posts } = makeOfficial(game.world, race, run, { tote: toteFor(race), bets, posts: thread(race) });
  race.forumAfter = reactions(game.world, race, posts, order, pay, run);
  const returns = bets.map(b => ticketReturn(b, pay));
  // A double or Pick 3 that ends in this race is settled with it, and goes on its line in your record.
  const ending = settleMulti(race, order[0]);
  const spent = bets.reduce((s, b) => s + b.cost, 0) + ending.reduce((s, t) => s + t.cost, 0);
  const back = returns.reduce((s, r) => s + r, 0) + ending.reduce((s, t) => s + t.back, 0);
  game.player.bank = round2(game.player.bank + back);
  game.player.settled[raceKey(race)] = { returns, spent, back };
  if (bets.length || ending.length) game.player.ledger.push({ day: race.day, no: race.no, spent, back, best: Math.max(0, ...returns, ...ending.map(t => t.back)) });
  // The winner's circle photo goes in your scrapbook if you backed the winner.
  const winIdx = order[0];
  const cashedWinner = bets.some((b, i) => returns[i] > 0 && (b.type === 'exbox' || b.type === 'tribox' || b.sel[0] === winIdx)) || ending.some(t => t.back > 0);
  if (cashedWinner) {
    game.player.book.push(photoRecord(race, winIdx, back));
    // And its horse is starred for you, to follow.
    star(race.entries[winIdx].hid, true);
  }
  save();
  return { run, pay, returns, spent, back, cashedWinner };
}

// A race left before its result came up (the page closed, or dropped by the phone, in the middle of it): the
// game opens on it again, from the gate, as a replay. It's kept on this device only, beside the meet and not
// in it, so another device carrying on with the same meet isn't sent into a race it never started. Cleared
// when the result comes up (at the end of the race, or Skip to the end) and when the race is left.
const KEY_WATCHING = 'post-time.watching';
export function markWatching(race) {
  try { localStorage.setItem(KEY_WATCHING, JSON.stringify({ meet: game.world.seed, day: race.day, no: race.no })); } catch { /* not kept: it opens on the card */ }
}
export function clearWatching() {
  try { localStorage.removeItem(KEY_WATCHING); } catch { /* nothing to clear */ }
}
// The race to open on, if there is one: run, and on today's card of this meet.
export function leftWatching() {
  let w = null;
  try { w = JSON.parse(localStorage.getItem(KEY_WATCHING) || 'null'); } catch { /* unreadable: none */ }
  if (!w || !game.world || w.meet !== game.world.seed || w.day !== game.world.day) return null;
  const race = card().races.find(r => r.no === w.no);
  return race && race.status === 'official' ? race : null;
}

export function photoRecord(race, winIdx, won) {
  const e = race.entries[winIdx];
  const h = horseOf(e);
  const { owner, trainer } = ranFor(e);
  const worn = silksFor(race)[winIdx];
  return {
    day: race.day, date: race.date, no: race.no, name: race.name, cls: race.cls, claim: race.claim, dist: distanceName(race.distance),
    surface: race.surface, time: race.result.time, horse: { name: h.name, coat: h.coat, marks: h.marks, sex: h.sex },
    owner, number: e.pp, jockey: JOCKEYS[e.j].name, trainer: TRAINERS[trainer], ownerName: OWNERS[owner],
    seed: race.seed, won: round2(won || 0), stakes: race.cls === 'STK', hid: e.hid,
    // The cap the winner wore, when it wasn't the owner's own (an owner's second runner in the race).
    ...(worn.cap !== ownerSilks(owner).cap ? { cap: worn.cap } : {}),
  };
}

// ------------------------------------------------------------------ horses to watch

// The horse in a winner's circle photo. A photo kept before photos had the horse's id has its name, and a name
// belongs to one horse in a meet.
function photoHorse(rec) {
  if (Number.isInteger(rec?.hid)) return rec.hid;
  const name = rec?.horse?.name;
  const h = name ? game.world.horses.find(x => x.name === name) : null;
  return h ? h.id : null;
}
export const isStarred = hid => Array.isArray(game.player.stars) && game.player.stars.includes(hid);
// Stars a horse (`on`), or takes its star off. Not saved: the caller saves, or goToGate does.
function star(hid, on) {
  const p = game.player;
  if (!Array.isArray(p.stars)) p.stars = [];
  const i = p.stars.indexOf(hid);
  if (on && i < 0) p.stars.push(hid);
  if (!on && i >= 0) p.stars.splice(i, 1);
}
export function toggleStar(hid) {
  const on = !isStarred(hid);
  star(hid, on);
  save();
  return on;
}
// The starred horses in a race, as its entries' indices.
export const starredIn = race => race.entries.map((e, i) => (isStarred(e.hid) ? i : -1)).filter(i => i >= 0);
// The races you cashed when this horse won, from your winner's circle photos, newest first: [{ won, date, day,
// no }]. With `before` (a race), only the ones run before it.
export function cashedOn(hid, before = null) {
  return game.player.book.filter(rec => photoHorse(rec) === hid && rec.won > 0 && (!before || rec.day < before.day || (rec.day === before.day && rec.no < before.no)))
    .map(rec => ({ won: rec.won, date: rec.date, day: rec.day, no: rec.no })).reverse();
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
  for (const [i, amt] of multiPicks(race)) most.set(i, (most.get(i) || 0) + amt);
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
  game.player.multi = (game.player.multi || []).filter(t => t.day > c.day);
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
  const pending = c.races.reduce((s, r) => s + (r.status === 'official' ? 0 : myBets(r).reduce((a, b) => a + b.cost, 0)), 0)
    + (game.player.multi || []).reduce((s, t) => s + (t.back === undefined ? t.cost : 0), 0);
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

// ------------------------------------------------------------------ the daily double and the Pick 3

// A daily double is one ticket on the winners of the last two races of the day, and a Pick 3 on the last
// three. Each is bought at the window of its first race while that race is up, and kept in `player.multi`:
// { type, day, legs: [race numbers], sel: [[entry indices] for each race], amt, cost }, with `back` once its
// last race is run. Its money is counted on that last race's line in your record, where it's decided.
export { MULTI };
// The kinds of multi-race ticket that start in this race, on today's card.
export function multiStarting(race) {
  const n = card().races.length;
  return Object.keys(MULTI).filter(t => n >= MULTI[t].legs && firstLeg(t, n) === race.no);
}
// The races of a double or Pick 3 that starts in `race`.
export function legRaces(type, race) {
  return card().races.filter(r => r.no >= race.no && r.no < race.no + MULTI[type].legs);
}
const legsOf = t => t.legs.map(no => card().races.find(r => r.no === no));
// A ticket's numbers, a race at a time: "3 / 5, 6" is 3 in the first race with 5 or 6 in the second.
export const multiNumbers = (races, sel) => sel.map((leg, k) => leg.map(i => races[k].entries[i].pp).join(', ')).join(' / ');
// Today's tickets that have `race` as one of their races, or (`starting`) as their first.
export function multiFor(race, { starting = false } = {}) {
  // (The doubles first, then the Pick 3s, however they were bought.)
  const order = Object.keys(MULTI);
  return (game.player.multi || []).filter(t => t.day === race.day && (starting ? t.legs[0] === race.no : t.legs.includes(race.no)))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}
// Where a ticket stands, from the races run before `race` (all of them, without it): 'dead' once one of
// its races has been won by a horse it doesn't have; 'alive' once one has been won and none lost; else
// 'open'. Once its last race is run it's 'paid' or 'dead'. (The watch screen asks it as of the race being
// shown, which is settled already, so the result isn't given away.)
export function multiState(t, race = null) {
  let won = 0;
  for (const [k, r] of legsOf(t).entries()) {
    if (race && r.no >= race.no) break;
    if (r.status !== 'official') break;
    if (!t.sel[k].includes(r.result.order[0].k)) return 'dead';
    won++;
  }
  if (won === t.legs.length) return t.back > 0 ? 'paid' : 'dead';
  return won ? 'alive' : 'open';
}

// Your horses in `race` on a double or Pick 3 that's still alive going into it, with what's on each: the
// horses you have with it, as much as a ticket on them.
export function multiPicks(race) {
  const out = new Map();
  for (const t of multiFor(race)) {
    if (multiState(t, race) === 'dead') continue;
    for (const i of t.sel[t.legs.indexOf(race.no)]) out.set(i, (out.get(i) || 0) + (t.amt || 0));
  }
  return out;
}

function placeMulti(race, bet) {
  const races = legRaces(bet.type, race);
  if (!multiStarting(race).includes(bet.type) || races.length !== MULTI[bet.type].legs || !Array.isArray(bet.sel) || bet.sel.length !== races.length
    || bet.sel.some((sel, k) => !sel.length || !inRace(races[k], sel))) return { ok: false, why: 'Pick a horse in each race first.' };
  if (nextRace() !== race || race.status === 'official') return { ok: false, why: `Betting on race ${race.no} has closed.` };
  const c = betCost(bet);
  if (c > game.player.bank + 1e-9) return { ok: false, why: `That ticket costs $${c.toFixed(2)} and you have $${game.player.bank.toFixed(2)}.` };
  (game.player.multi || (game.player.multi = [])).push({ type: bet.type, day: race.day, legs: races.map(r => r.no), sel: bet.sel.map(s => [...s].sort((x, y) => x - y)), amt: bet.amt, cost: c });
  game.player.bank = round2(game.player.bank - c);
  save();
  return { ok: true, cost: c };
}

// A ticket can be cancelled while its first race is still open.
export function cancelMulti(t) {
  const list = game.player.multi || [];
  const i = list.indexOf(t);
  if (i < 0 || t.back !== undefined) return;
  list.splice(i, 1);
  game.player.bank = round2(game.player.bank + t.cost);
  save();
}

const multiTotes = races => races.map(r => toteFor(r));

// As the first race of a double or Pick 3 goes off, its pool closes on the chances the public has given each of
// its races, and they're kept with that race (`pools`), before it's run: a tote made again after a race has
// been run sees it in the horses' form, so the will-pays and the payout would change if the page were closed
// and opened again, or the meet carried to another device, between the races.
function closePools(race) {
  for (const type of multiStarting(race)) {
    const races = legRaces(type, race);
    if (races.length === MULTI[type].legs) race.pools = { ...race.pools, [type]: multiClose(type, multiTotes(races)) };
  }
}
// What a pool closed on, if it was kept and is still of these races' fields. (Not for a day begun before the
// pools were: its totes are made again, as they were.)
function closedOn(type, races) {
  const c = races[0].pools?.[type];
  return c && Array.isArray(c.p) && c.p.length === races.length && c.p.every((p, k) => Array.isArray(p) && p.length === races[k].entries.length && p.every(Number.isFinite)) ? c : null;
}
// Your tickets in a pool: everything bought on it today.
const inPool = (type, day) => (game.player.multi || []).filter(t => t.type === type && t.day === day);

// When the last race of a double or Pick 3 is run (`won` is its winner), the pool pays: what $1 paid goes
// with the race's result, for the results to show, and each of your tickets on it is settled. Returns the
// tickets settled.
function settleMulti(race, won) {
  const ending = [];
  for (const type of Object.keys(MULTI)) {
    const first = card().races.find(r => r.no === race.no - MULTI[type].legs + 1);
    if (!first || !multiStarting(first).includes(type)) continue;
    const races = legRaces(type, first);
    if (races.slice(0, -1).some(r => r.status !== 'official')) continue;
    const winners = [...races.slice(0, -1).map(r => r.result.order[0].k), won];
    const mine = inPool(type, race.day);
    const pay = multiSettle(type, multiTotes(races), winners, mine, closedOn(type, races));
    race.result.multi = { ...race.result.multi, [type]: pay };
    for (const t of mine) {
      if (t.back !== undefined) continue;
      t.back = ticketReturn(t, { [type]: pay });
      ending.push(t);
    }
  }
  return ending;
}

// The will-pays for the race that ends a double or Pick 3, once the races before it have been run: what $1
// pays with each horse in it. [{ type, won: [winners' numbers], pays: [per entry] }], or none.
export function willPaysFor(race) {
  const out = [];
  for (const type of Object.keys(MULTI)) {
    const first = card().races.find(r => r.no === race.no - MULTI[type].legs + 1);
    if (!first || !multiStarting(first).includes(type) || race.status === 'official') continue;
    const races = legRaces(type, first), before = races.slice(0, -1);
    if (before.some(r => r.status !== 'official')) continue;
    const won = before.map(r => r.result.order[0].k);
    out.push({ type, races: before, won, pays: multiWillPays(type, multiTotes(races), won, inPool(type, race.day), closedOn(type, races)) });
  }
  return out;
}

// What a double or Pick 3 on the slip would pay, if its first race went off now and the others went as their
// opening odds say (wouldPayMulti in js/tote.js).
export function multiWouldPay(race, bet) {
  const races = legRaces(bet.type, race);
  return wouldPayMulti(multiTotes(races), mtpState(race).frac, inPool(bet.type, race.day), bet);
}

export { legs, betCost };
export function round2(x) { return Math.round(x * 100) / 100; }
