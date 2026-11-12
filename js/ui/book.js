// Your scrapbook of winner's circle photos, your record at the windows, and how to play.

import { h, money, jdFoot } from './dom.js';
import { game, START_BANK, notSaved, yourMeet, advanceDay, yourWeeks, yourKinds, raceAt, card } from '../game.js';
import { TIPSTERS, JOCKEYS, TRAINERS, BIG_STAKES, SIRES } from '../data.js';
import { longDate, dayDate, dateISO, meetRecord, isClosingDay, MEET_DAYS } from '../world.js';
import { oddsText } from '../handicap.js';
import { photoCard, drawPhoto, savePictureButton } from './results.js';
import { MOVING, shortDay } from './race.js';
import { JOE, offered as joeOffered } from '../joe.js';
import { offered as copyOffered } from '../copy.js';
import { drive } from '../drive.js';

// The page is this meet's: your record in it, the forum's standings, the meets before it (each opens its
// closing page), and your photos as a contact sheet, a meet at a time, the newest first. Each photo is drawn
// small, as it comes into view, and opens full size with its caption. (Every photo used to be drawn full
// size as the page opened, one to a row on a phone: by race day 31 a bettor who cashes three winners a day
// has 97, and the page froze for about two seconds on a slow phone, 40,000 px tall with the standings under
// all of it.) Back from a photo comes back to the same place on the sheet (`params.back`).
let sheetY = 0;
export function renderBook(root, nav, params = {}) {
  const p = game.player, w = game.world, m = w.meet;
  const you = yourMeet();
  const past = (w.meets || []).slice().reverse();
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, `Meet ${m.no}`), h('h1', { class: 'title' }, 'Scrapbook & record')),
    ),
    h('div', { class: 'stats' },
      stat('Bankroll', money(p.bank)),
      putIn(m.no, you),
      stat('Bet', money(you.bet)),
      stat('Back', money(you.back)),
      stat('Races cashed', `${you.cashed} of ${you.races}`),
      stat('Biggest ticket', you.best > 0 ? money(you.best) : 'None yet'),
      // Worked out from the record, so today counts before the next race day is asked for.
      stat('Best day', you.bestDay ? money(you.bestDay.net, { sign: true }) : 'None yet', you.bestDay ? dateOf(you.bestDay.day) : ''),
    ),
  );
  standings(root);
  if (past.length) {
    root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, 'Earlier meets'));
    root.append(h('div', { class: 'meets' }, past.map(r => h('button', { class: 'meet-row', type: 'button', onclick: () => nav.go('meet', { no: r.no }) },
      h('b', {}, `Meet ${r.no}`),
      h('span', { class: 'muted' }, `${dateOf(r.first)} to ${dateOf(r.last)}`),
      r.you ? h('span', { class: `money ${r.you.end - r.you.start - r.you.atm >= 0 ? 'pos' : 'neg'}` }, `${money(r.you.end)} (${money(r.you.end - r.you.start - r.you.atm, { sign: true })})`) : null,
      h('span', { class: 'go', 'aria-hidden': 'true' }, '▸'),
    ))));
  }
  root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, "Winner's circle photos"));
  const open = rec => { sheetY = window.scrollY; nav.go('photo', { day: rec.day, no: rec.no }); };
  watchSheets();
  if (!p.book.length) root.append(h('p', { class: 'pad muted' }, "Back a winner and you're in the picture. Your photos collect here."));
  else if (!past.length) root.append(sheet(p.book.slice().reverse(), open));
  else {
    // A meet at a time, the newest first.
    for (const meet of [{ no: m.no, first: m.first, last: m.last }, ...past]) {
      const photos = p.book.filter(r => r.day >= meet.first && r.day <= meet.last);
      if (!photos.length) continue;
      root.append(h('h3', { class: 'h3 pad meet-photos' }, `Meet ${meet.no}`));
      root.append(sheet(photos.reverse(), open));
    }
  }
  if (params.back) window.scrollTo(0, sheetY);
}

// The contact sheet: each photo small, with its horse and its date, drawn once it comes near the screen.
// (One watcher for the page's sheets, made again each time the page is drawn.)
let drawing = null;
function watchSheets() {
  if (drawing) drawing.disconnect();
  drawing = typeof IntersectionObserver === 'function' ? new IntersectionObserver(seen => {
    for (const x of seen) if (x.isIntersecting) { drawing.unobserve(x.target); x.target.draw(); }
  }, { rootMargin: '400px 0px' }) : null;
}
function sheet(photos, open) {
  return h('div', { class: 'sheet' }, photos.map(rec => {
    const c = h('canvas', { 'aria-hidden': 'true' });
    c.draw = () => { drawPhoto(c, rec, true, c.getBoundingClientRect().width || 170); c.dataset.drawn = '1'; };
    if (drawing) drawing.observe(c); else requestAnimationFrame(c.draw);
    return h('button', { class: `contact${rec.name === BIG_STAKES.name ? ' big' : ''}`, type: 'button', onclick: () => open(rec) },
      c, h('span', { class: 'nm' }, rec.horse.name), h('span', { class: 'when' }, `${shortDay(rec.date)} · Race ${rec.no}`));
  }));
}

// A photo full size, with its caption, from the contact sheet.
export function renderPhoto(root, nav, params = {}) {
  const rec = game.player.book.find(r => r.day === params.day && r.no === params.no);
  if (!rec) { nav.go('book'); return; }
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('book', { back: true }) }, '‹ Scrapbook'),
      h('div', {}, h('div', { class: 'kicker' }, `${shortDay(rec.date)} · Race ${rec.no}`), h('h1', { class: 'title' }, rec.horse.name)),
    ),
    h('div', { class: 'pad' }, photoCard(rec, true)),
    // The picture to keep or send, and its race's results while they're kept.
    h('div', { class: 'actions' }, savePictureButton(rec, true),
      raceAt(rec.day, rec.no)?.status === 'official' ? h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('result', { day: rec.day, no: rec.no }) }, 'The race ▸') : null),
  );
}

// What you put into the meet: the first meet's $200 and the trips to the ATM ("Put in", "$200 to start, $1,800
// from the ATM"); a later meet started with the bankroll the last one left you.
function putIn(no, you) {
  const atm = you.atm ? `${money(you.atm, { cents: false })} from the ATM` : '';
  if (no > 1) return stat('Started the meet with', money(you.start + you.atm), [`${money(you.start)} carried over`, atm].filter(Boolean).join(', '));
  return stat('Put in', money(you.start + you.atm), [`${money(you.start, { cents: false })} to start`, atm].filter(Boolean).join(', '));
}

// The forum's standings: each regular's winners and what $2 on each of his picks has paid back, best first.
function standings(root) {
  const rec = game.world.tipsters || {};
  root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, 'The forum standings'));
  const rows = TIPSTERS.map(t => ({ t, r: rec[t.id] || { picks: 0, wins: 0, back: 0 } })).sort((a, b) => (b.r.back / Math.max(1, b.r.picks)) - (a.r.back / Math.max(1, a.r.picks)));
  root.append(h('div', { class: 'pad' }, h('div', { class: 'board' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Regular'), h('th', { class: 'r' }, 'Won'), h('th', { class: 'r' }, '$2 returns'))),
    h('tbody', {}, rows.map(({ t, r }) => h('tr', {},
      h('td', {}, h('b', {}, t.handle), h('div', { class: 'cm' }, t.blurb)),
      h('td', { class: 'r money' }, `${r.wins}/${r.picks}`),
      h('td', { class: `r money ${r.picks && r.back / r.picks >= 2 ? 'pos' : ''}` }, r.picks ? money(r.back / r.picks) : '–'),
    ))),
  ))));
}

const dateOf = day => longDate(dateISO(dayDate(game.world, day))).replace(/^\w+, /, '');

// The meet so far, from the menu, and a meet's closing page: the Handicap's winner, the leading rider and
// trainer, the horse of the meet, the forum's champion, the longest price; the leading riders, trainers and
// horses; the stakes run and who won them; and your own meet, race day by race day and by kind of bet.
// `params.no` is a meet that has closed, from the scrapbook; without it, it's the meet being run, and after its
// last race the way on from it opens the next meet.
export function renderMeet(root, nav, params = {}) {
  const w = game.world;
  const live = !params.no || params.no === w.meet.no;
  const r = live ? { ...meetRecord(w), you: yourMeet() } : (w.meets || []).find(x => x.no === params.no);
  if (!r) { nav.go('book'); return; }
  const over = !live || (isClosingDay(w) && w.cards[w.day].races.every(x => x.status === 'official'));
  const days = r.last - r.first + 1;
  const award = (label, value, note) => stat(label, value || 'Nobody', value ? note : '');
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const champ = r.champ && TIPSTERS.find(t => t.id === r.champ.id);
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go(live ? 'card' : 'book') }, live ? '‹ The card' : '‹ Scrapbook'),
      h('div', {}, h('div', { class: 'kicker' }, `Meet ${r.no}${over ? ' · closing day' : ' so far'}`), h('h1', { class: 'title' }, over ? 'The meet in review' : 'The meet so far')),
    ),
    h('p', { class: 'pad meet-when' }, `${plural(days, 'race day')}, ${dateOf(r.first)} to ${dateOf(r.last)}${days !== MEET_DAYS ? ' (the first meet, carried over from before meets had an end)' : ''}. ${plural(r.races, 'race')} run.`),
    // (Until the Handicap is run there's nothing here: a bare null put the word "null" on the page.)
    r.handicap ? h('div', { class: 'pad' }, h('div', { class: 'meet-big' }, h('span', { class: 'kicker' }, `The ${BIG_STAKES.name}`), h('b', {}, r.handicap.horse))) : '',
    h('div', { class: 'stats awards' },
      award('Leading rider', r.rider && r.rider.w ? JOCKEYS[r.rider.i]?.name : null, r.rider && `${plural(r.rider.w, 'win')} from ${plural(r.rider.starts, 'ride')}`),
      award('Leading trainer', r.trainer && r.trainer.w ? TRAINERS[r.trainer.i] : null, r.trainer && `${plural(r.trainer.w, 'win')} from ${plural(r.trainer.starts, 'starter')}`),
      award('Horse of the meet', r.horse && r.horse.earn ? r.horse.name : null, r.horse && `${plural(r.horse.w, 'win')} from ${plural(r.horse.starts, 'start')}, ${money(r.horse.earn, { cents: false })} won`),
      award("The forum's champion", champ ? handleBreaks(champ.handle) : null, r.champ && `${plural(r.champ.wins, 'winner')} from ${plural(r.champ.picks, 'pick')}, ${money(r.champ.back / r.champ.picks)} back for each $2${r.since ? ', over the whole of the forum\'s record' : ''}`),
      award('The longest price', r.long ? r.long.name : null, r.long && `won at ${oddsText(r.long.odds)}, race ${r.long.no} on race day ${r.long.day - r.first + 1}`),
    ),
  );
  leaders(root, r);
  if (r.stakes.length) {
    root.append(h('div', { class: 'pad' }, h('div', { class: 'board' }, h('h3', {}, over ? 'The stakes winners' : 'The stakes so far'), h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Race day'), h('th', {}, 'Stakes'), h('th', {}, 'Winner'))),
      // (Each opens its results while they're kept.)
      h('tbody', {}, r.stakes.map(s => h('tr', { class: s.name === BIG_STAKES.name ? 'big' : '' }, h('td', { class: 'money' }, String(s.day - r.first + 1)),
        h('td', {}, s.no && raceAt(s.day, s.no)?.status === 'official' ? h('button', { class: 'pp-link', type: 'button', onclick: () => nav.go('result', { day: s.day, no: s.no }) }, s.name) : s.name),
        h('td', {}, h('b', {}, s.horse))))),
    ))));
  }
  const y = r.you;
  if (y) {
    const net = y.end - y.start - y.atm;
    root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, 'Your meet'));
    root.append(h('div', { class: 'stats' },
      putIn(r.no, y),
      stat('Bet', money(y.bet)),
      stat('Back', money(y.back)),
      stat('Races cashed', `${y.cashed} of ${y.races}`),
      stat('Biggest ticket', y.best > 0 ? money(y.best) : 'None'),
      stat('Photos', String(y.photos)),
      stat(over ? 'Finished with' : 'Bankroll', money(y.end), `${money(net, { sign: true })} on the meet`),
      stat('Back for every $1 bet', y.bet > 0 ? money(y.back / y.bet) : '–'),
    ));
    yourRecord(root, r);
  }
  if (live && over) {
    root.append(h('div', { class: 'actions' },
      h('p', { class: 'muted' }, `Meet ${r.no + 1} opens next Saturday with the same horses, ten race days to its own ${BIG_STAKES.name}. Your bankroll comes with you.`),
      h('button', { class: 'btn brass', type: 'button', onclick: () => { advanceDay(); nav.go('card'); window.scrollTo(0, 0); } }, `Open meet ${r.no + 1} ▸`),
    ));
  }
  root.append(jdFoot());
}

// The leading riders and trainers (the top five, the rest behind Show all) and the leading horses, by wins and
// by what they've earned. (A meet that closed before these were kept has its awards and no tables.)
function leaders(root, r) {
  const pct = (w, starts) => `${Math.round(100 * w / starts)}%`;
  for (const [key, title, names, ride] of [['riders', 'Leading riders', i => JOCKEYS[i]?.name, 'Rides'], ['trainers', 'Leading trainers', i => TRAINERS[i], 'Starters']]) {
    const rows = Array.isArray(r[key]) ? r[key].filter(x => names(x[0])) : [];
    if (!rows.length) continue;
    const body = h('tbody', {}, rows.map(([i, starts, w], k) => h('tr', { hidden: k >= 5 }, h('td', {}, names(i)), h('td', { class: 'r money' }, String(w)), h('td', { class: 'r money' }, String(starts)), h('td', { class: 'r money' }, pct(w, starts)))));
    const more = rows.length > 5 ? h('button', { class: 'btn ghost show-all', type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      [...body.rows].forEach((tr, k) => { if (k >= 5) tr.hidden = !open; });
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Show the top five' : `Show all ${rows.length}`;
    } }, `Show all ${rows.length}`) : null;
    root.append(h('div', { class: 'pad' }, h('div', { class: 'board leaders' }, h('h3', {}, title),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, key === 'riders' ? 'Rider' : 'Trainer'), h('th', { class: 'r' }, 'Wins'), h('th', { class: 'r' }, ride), h('th', { class: 'r' }, 'Won'))), body),
      more ? h('div', { class: 'more' }, more) : null)));
  }
  const horses = (list, title) => (Array.isArray(list) && list.length ? h('div', { class: 'board leaders' }, h('h3', {}, title), h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Horse'), h('th', { class: 'r' }, 'Wins'), h('th', { class: 'r' }, 'Starts'), h('th', { class: 'r' }, 'Earned'))),
    h('tbody', {}, list.map(x => h('tr', {}, h('td', {}, x.name), h('td', { class: 'r money' }, String(x.w)), h('td', { class: 'r money' }, String(x.starts)), h('td', { class: 'r money' }, money(x.earn, { cents: false }))))))) : null);
  const pair = [horses(r.wins, 'Most wins'), horses(r.earners, 'Most earned')].filter(Boolean);
  if (pair.length) root.append(h('div', { class: 'pad horse-leaders' }, pair));
}

// Your meet race day by race day (what you bet and got back, and back for every $1 bet), and by kind of bet.
function yourRecord(root, r) {
  const m = { first: r.first, last: r.last };
  const weeks = yourWeeks(m);
  if (!weeks.length) return;
  const per = (back, spent) => (spent > 0 ? money(back / spent) : '–');
  const row = (label, x) => h('tr', {}, h('td', {}, label), h('td', { class: 'r money' }, money(x.spent)), h('td', { class: 'r money' }, money(x.back)),
    h('td', { class: `r money ${x.back - x.spent >= 0 ? 'pos' : 'neg'}` }, money(x.back - x.spent, { sign: true })), h('td', { class: 'r money' }, per(x.back, x.spent)));
  const head = first => h('thead', {}, h('tr', {}, h('th', {}, first), h('th', { class: 'r' }, 'Bet'), h('th', { class: 'r' }, 'Back'), h('th', { class: 'r' }, 'Net'), h('th', { class: 'r' }, 'Per $1')));
  const all = weeks.reduce((a, x) => ({ spent: a.spent + x.spent, back: a.back + x.back }), { spent: 0, back: 0 });
  root.append(h('div', { class: 'pad' }, h('div', { class: 'board' }, h('h3', {}, 'Race day by race day'), h('table', { class: 'yours' }, head('Race day'),
    h('tbody', {}, weeks.map(x => row(`${x.raceDay} · ${dateOf(x.day).replace(/, \d{4}$/, '')}`, x)), weeks.length > 1 ? h('tr', { class: 'total' }, ...row('The meet', all).childNodes) : null)))));
  const { since, kinds } = yourKinds(m);
  if (!kinds.length) return;
  root.append(h('div', { class: 'pad' }, h('div', { class: 'board' }, h('h3', {}, 'By kind of bet'), h('table', { class: 'yours' }, head('Bet'),
    h('tbody', {}, kinds.map(k => row(k.name, k)))),
  since && since > 1 ? h('p', { class: 'board-note' }, `Since race day ${since}: the record kept the kinds of bet from then.`) : null)));
}

// A forum handle in an award's tile may break between its words, GreyHorse|Greg, where it would run out of the
// tile at a desktop's width.
const handleBreaks = name => name.split(/(?<=[a-z])(?=[A-Z])/).flatMap((part, k) => (k ? [h('wbr'), part] : [part]));

function stat(label, value, note) {
  return h('div', { class: 'stat' }, h('span', { class: 'kicker' }, label), h('b', { class: 'money' }, value), note ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, note) : null);
}

// What How to play says about saving, which depends on where the game is running. In a browser that's
// refusing to save (its storage is blocked or full; a frame with no storage of its own), "Everything is
// saved in this browser" stood under a line at the top of the page saying the browser isn't keeping the
// meet. And the one-file copy has nothing that would let it work offline "once it has loaded": it's a
// file, and opens wherever the file is.
const singleFile = typeof __SINGLE_FILE__ !== 'undefined';
function savingText() {
  if (notSaved()) return "This browser isn't keeping anything, so this meet lasts until you close the page. Nothing is sent anywhere.";
  const offline = singleFile ? '' : ' It works offline once it has loaded.';
  if (drive.isOn()) return `Everything is saved in this browser: your bankroll, tickets, scrapbook and the whole racing world. A copy goes to your own Google Drive, in a Post Time folder, and comes back from there to every phone or computer where you turn on Save to Google Drive in the menu. Nothing else is sent anywhere.${offline}`;
  return `Everything is saved in this browser: your bankroll, tickets, scrapbook and the whole racing world. Nothing is sent anywhere.${offline}${drive.available ? ' Save to Google Drive, in the menu, keeps a copy in your own Google Drive too, to carry the meet on from another phone or computer.' : ''}`;
}

// How to play's headings, each with an id: "What do these mean?" under the form and under the board opens the
// page at its part (`at`), and its back button goes back to the race it came from (`from`: its number and tab).
const part = (id, title) => h('h3', { id: `help-${id}`, tabindex: '-1' }, title);
// What a winner's speed figure is here, by the class of race: the middle of the winners' figures in 960 races,
// six meets of twenty race days (seeds wf1 to wf6, measured 12 November 2026).
const WINS_AT = [['A $20,000 maiden claimer', 66], ['A $10,000 claimer', 69], ['A $16,000 claimer', 73], ['A maiden special weight', 77], ['A $25,000 claimer', 78], ['A $40,000 claimer', 81], ['An allowance', 83], ['A stakes', 92]];

// What a sire's foals want, in words, from the sire's own numbers (js/data.js SIRES): his distance (each foal's
// is his, give or take about a furlong), and how much grass, a wet track and early speed suit them. A
// sprinter's sire is one to seven furlongs, as PedigreePam has it, a miler's seven and a half or a mile, and a
// stayer's further. Grass: a "loves it" sire is worth five or six points on the turf to his foals, "likes it" about
// three, "handles it" a point or two either way, and "better on dirt" costs about two. Wet: "loves it" is
// worth one and a half points or more, "likes it" about half that, "dislikes it" costs a point or so.
const halves = f => `${Math.floor(f)}${f % 1 ? '½' : ''}f`;
const sireTrip = s => `${s.dist <= 7 ? 'Sprinter' : s.dist <= 8 ? 'Miler' : 'Stayer'}, ${halves(s.dist)}`;
// (An "it" isn't left on a line of its own in a column a phone has narrowed.)
const sireGrass = s => (s.turf >= 0.75 ? 'Loves\u00a0it' : s.turf >= 0.45 ? 'Likes\u00a0it' : s.turf > -0.2 ? 'Handles\u00a0it' : 'Better on dirt');
const sireWet = s => (s.mud >= 0.3 ? 'Loves\u00a0it' : s.mud >= 0.1 ? 'Likes\u00a0it' : s.mud > -0.1 ? 'Handles\u00a0it' : 'Dislikes\u00a0it');
const sireSpeed = s => (s.speed >= 0.75 ? 'Lots' : s.speed >= 0.55 ? 'Some' : 'Little');

export function renderHelp(root, nav, params = {}) {
  const from = params.from && game.world && card().races.some(r => r.no === params.from.no) ? params.from : null;
  root.append(
    h('div', { class: 'rhead' },
      from ? h('button', { class: 'back', type: 'button', onclick: () => nav.go('race', from) }, `‹ Race ${from.no}`)
        : h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, 'Larkspur Downs'), h('h1', { class: 'title' }, 'How to play')),
    ),
    h('div', { class: 'help' },
      h('p', {}, `You start your first meet with ${money(START_BANK, { cents: false })}. Every race day has eight races. For each one you can read the form, look at the horses in the paddock, see what the regulars on the forum are betting, buy tickets at the window, and then watch the race from the gate to the wire.`),
      h('p', {}, "The horses are the same from week to week. Everything in a horse's past performances happened in a race that was run the same way as the ones you watch, so reading the form really does help."),
      part('start', 'Your first race'),
      h('ol', {},
        h('li', {}, 'On the card, tap the race that\'s up next.'),
        h('li', {}, 'Read the form: tap a horse for its past performances. The Paddock and the Forum tabs have more.'),
        h('li', {}, `Under Bet, pick a horse and buy a ${money(2, { cents: false })} ticket to win.`),
        h('li', {}, 'Tap To the gate, and watch them run.'),
      ),
      part('meet', 'The meet'),
      h('p', {}, `A meet is ${MEET_DAYS} race days. The last race of every Saturday is a stakes, and the first two home in each are pointed to the ${BIG_STAKES.name}, ${money(BIG_STAKES.purse, { cents: false })}, on closing day: they're entered in it first. After the Handicap the meet closes, with its leading rider and trainer, its horse of the meet, the forum's champion and your own meet, and the next meet opens the Saturday after with the same horses. Your bankroll carries over, and each meet's record is kept in your scrapbook.`),
      part('form', 'Reading the form'),
      h('dl', {},
        h('dt', {}, 'An entry'), h('dd', {}, 'Its number and silks, its name, and its odds on the board now (once the race is run, the odds it went off at). Under them the rider and the trainer, each with a record in brackets: (12-60) is 12 wins from 60 starts here, counted from ten weeks before your first meet. Then the weight it carries, and ML, its morning line.'),
        h('dt', {}, 'Speed figure'), h('dd', {}, 'How fast the horse ran, as one number, adjusted for the distance and how fast the track was that day. Higher is better. A horse that runs a 90 is about five lengths better than one that runs an 80 over six furlongs. An entry shows its last five, newest first, with the best of them on green.'),
        h('dt', {}, 'What wins here'), h('dd', {}, 'About what the winner runs, by the class of race (the middle of the winners\' figures over six meets):',
          h('table', { class: 'help-table wins-at' }, h('tbody', {}, WINS_AT.map(([what, fig]) => h('tr', {}, h('td', {}, what), h('td', { class: 'r' }, String(fig))))))),
        h('dt', {}, 'Chips'), h('dd', {}, "The tags beside the figures. The first is the horse's running style, from where it has been at the first call lately: Needs the lead, Close to the pace, Stalker or Closer. The rest are angles a handicapper looks for, such as First time on turf, Drops into a claimer, Bullet work or Troubled trip last time."),
        h('dt', {}, 'Calls'), h('dd', {}, 'Where the horse was at three points in the race, and how many lengths behind the leader (for the leader: how far in front of the second). "3²" is third, two lengths behind the leader. The last one is the finish, where the small figure is the lengths behind the winner (for the winner: how far it won by), so "7¹²" was seventh, beaten twelve lengths. Lines from races run before the game printed them this way show just the position at the calls. In a sprint the first two are taken a quarter of a mile and half a mile from the start (a little sooner at five furlongs and five and a half), and in a race of a mile or more at the half and the three quarters. The third is always a furlong from the finish.'),
        h('dt', {}, 'Running style'), h('dd', {}, 'Some horses need the lead, some sit just behind it, some come from the back. When several speed horses are entered they tend to tire each other out, which sets it up for a closer. A lone speed horse, left alone on the lead, is dangerous.'),
        h('dt', {}, 'Class'), h('dd', {}, 'Maiden races are for horses that have never won. In a claiming race every horse is for sale at the listed price, so trainers enter where they think they belong. A horse dropping in price may be better than these, or may have something wrong with it.'),
        h('dt', {}, 'Past performances'), h('dd', {}, "A horse's races, newest first. Its date (tap it for that race's results, while they're kept), and Lrk with the going: Larkspur, ft fast, gd good, sly sloppy, my muddy, fm firm, yl yielding, sf soft. The distance (6f, 1m, 1 1/16 is a mile and a sixteenth), ⓣ for the turf, and how many ran. The class: MdClm maiden claiming, MdSpWt maiden special weight, Clm16k a claimer for $16,000, Alw allowance, and a stakes by the start of its name (OddsEndsH is the Odds and Ends Handicap); f- in front is a race for fillies and mares. Then the figure, the calls and the finish, and the odds it went off at to $1 (4.5 is 9-2). On the line under it: the trip, the fractions with the final time in bold, the first three home with the margins between them, the rider, and a claim if it was claimed."),
        h('dt', {}, 'Workouts'), h('dd', {}, 'Morning training runs: the date, the distance, dirt (ft) or turf, the time, B for breezing (under a hold) or H for handily (pushed along), and the rank among the horses that worked that distance that morning. A bullet (●) in front of one marks the fastest of the day, and can mean a horse is sharp.'),
        h('dt', {}, 'Post'), h('dd', {}, 'Where the horse starts in the gate, 1 nearest the rail. In a race of a mile or more the first turn comes up quickly: posts 2 and 3 do best, and from post 7 out a horse loses ground or has to take back. In a sprint it matters less. Riders dread drawing the rail, where a horse that doesn\'t break sharply gets squeezed as the others come over. The morning line and the odds allow for the draw.'),
        h('dt', {}, 'Morning line'), h('dd', {}, "The track handicapper's guess at the odds, printed before any money is bet. The odds on the board are what the betting public actually thinks. On the board, ▼ marks a horse at a shorter price than its morning line (it's been backed) and ▲ one at a longer price, and FAV the favourite. A win, place or show ticket remembers the price it was bought at, and its result says what it went off at."),
        h('dt', {}, 'Pedigree'), h('dd', {}, "The sire (the father), and the dam (the mother) with her own sire. Here only the sire counts: a horse takes after him in the distance it wants, how it goes on grass and on a wet track, and its early speed (Sires, below). The dam's sire is drawn at random and changes nothing. Sire names link to Bloodlines, the racehorse family tree."),
      ),
      part('sires', 'Sires'),
      h('p', {}, "A horse's best distance is its sire's, give or take about a furlong, and the further a race is from it the more that costs: two or three furlongs off can cost several lengths. A grass sire's foals tend to go better on turf, a mud sire's on a wet track (sloppy or muddy dirt, yielding or soft turf), and a sire with early speed gets foals that are quick away. The odds on the board go by the figures and know none of this."),
      h('div', { class: 'sires-wrap' }, h('table', { class: 'help-table sires' },
        h('thead', {}, h('tr', {}, ['Sire', 'Best trip', 'Grass', 'Wet track', 'Early speed'].map(x => h('th', {}, x)))),
        h('tbody', {}, SIRES.slice().sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name)).map(x => h('tr', {},
          h('td', {}, x.name), h('td', {}, sireTrip(x)), h('td', {}, sireGrass(x)), h('td', {}, sireWet(x)), h('td', {}, sireSpeed(x))))),
      )),
      part('paddock', 'The paddock'),
      h('p', {}, "The horses walk the paddock before each race, with a word on how each one looks. It says something about how a horse feels today, which the form can't: dappled, gleaming or bright-eyed is good news, and washed out (sweating between the legs), dull or fighting the groom is bad. Most look like nothing much either way, and that says nothing."),
      part('betting', 'Betting'),
      h('p', {}, 'All bets go into pools. The track takes its cut (16% from win, place and show, more from exactas and trifectas) and the rest is shared by the winning tickets, so the odds move as money comes in, right up to post time. Late money tends to know a little more.'),
      h('p', {}, MOVING),
      h('dl', {},
        h('dt', { id: 'help-odds', tabindex: '-1' }, 'The board'), h('dd', {}, "Each horse's odds now, then ▼ if they're shorter than its morning line (it's been backed) or ▲ if longer, with ML and the line beside them. FAV marks the favourite, and $2 pays is about what a $2 win ticket would pay at that price. Over it, the minutes to post and the money in the win pool so far."),
        h('dt', {}, 'Minutes to post'), h('dd', {}, 'The race that\'s up opens at 12 minutes to post, and the clock loses a minute about every 13 seconds from then. It stops at 2 minutes to post and waits for you: the race doesn\'t go until you send them to the gate.'),
        h('dt', {}, 'Win, place, show'), h('dd', {}, 'Your horse finishes first; first or second; first, second or third.'),
        h('dt', {}, 'Across the board'), h('dd', {}, `A win, a place and a show ticket on one horse, bought as one: ${money(6, { cents: false })} for ${money(2, { cents: false })} each. If it wins, all three pay.`),
        h('dt', {}, 'Exacta, trifecta'), h('dd', {}, 'The first two, or the first three, in order. A box covers every order of the horses you pick, one bet per order. An exacta can be bet for $1 and a trifecta for 50 cents, as at a track. What paid is given for a $2 exacta and a $1 trifecta, and a smaller ticket is paid its share.'),
        h('dt', {}, 'Daily double, Pick 3'), h('dd', {}, "One ticket on the winners of races in a row: the daily double on races 7 and 8, the Pick 3 on races 6, 7 and 8, ending in the stakes. Each is bought at the window of its first race, from $1. Pick one or more horses in each race, and the ticket is one bet for each way of putting them together: two in race 7 with three in race 8 is six bets. Each has a pool of its own, which closes when its first race goes off, so before the last race its Bet tab has the will-pays, what $1 pays with each horse in it, with yours marked."),
        h('dt', {}, 'Odds'), h('dd', {}, '5-2 means $5 profit for every $2 bet, so a $2 win ticket pays $7. Payouts are worked out per dollar and rounded down to the dime, so a $2 ticket pays in steps of 20 cents, and never less than $2.10.'),
        h('dt', {}, 'The ATM'), h('dd', {}, "Down to less than $2, the least a ticket costs, with nothing on the race that's up, and the game shows you the ATM by the paddock: $100 a time. The meet so far counts your trips there."),
      ),
      part('race', 'The race'),
      h('p', {}, 'The camera follows the leaders. Tap a number in the running order to follow one horse instead. The little map shows the whole field on the oval. The button with two bars, or the space bar, pauses the race, the caller and the sound, and the same again goes on. Close the page in the middle of a race and the game opens on it again, from the gate (it was settled as it went to the gate, so nothing is bet or paid twice). In a close finish the placing judges read the photo. It comes from a finish-line camera that only sees the line, so the horses in it are stretched and squashed by their speed. When the result is official, the first four go up over the picture with the time, and your tickets say what each paid.'),
      h('p', {}, "The caller's lines are written out as the race is run, under the picture or beside it. Tick Read the race call aloud in the menu to have them spoken, or tap the microphone beside Sound during a race. Sound is the bugle, the bell and the crowd. The caller knows the favourite and the prices on the board, the riders, and the horse you've bet on. Between races he's the track's announcer: minutes to post, and what the winner paid. A race's results have the whole call under the chart, to read back."),
      // Where the downloaded voice can work (not in the one-file copy, or a viewer with nowhere to keep him).
      joeOffered() ? h('p', {}, `The list of voices there has ${JOE.name}, the track's own caller. He's a download, ${Math.round(JOE.bytes / 1e6)} MB, once, kept on this device, and he's the same wherever you play. He calls quicker than a browser's voice does, and quicker still down the stretch. His lines for a race are made while you read its form, the ones for after Skip too. If they aren't ready when the race goes to the gate, the browser's voice calls that one.`) : null,
      h('p', {}, "Back the winner and you're in the winner's circle photo. It goes in your scrapbook. Save the picture, under a photo, makes the photo and its caption one picture to keep or send."),
      part('between', 'Between the races'),
      h('p', {}, "Tap the star on a horse, in the form or in a race's results, to watch for it: the card marks every race it runs in. The horses in your photos are starred for you. When the last race is run, three lines under the card sum up the day, and Copy my day puts them on the clipboard."),
      h('p', {}, "A race's results have The form: its form, paddock and forum as they were before the race, with its own line marked. Earlier race days, at the foot of the card, has the results of this meet's race days and the last meet's, each race to watch again. The meet so far, in the menu, has the leading riders, trainers and horses, the stakes, and your own meet race day by race day and by kind of bet."),
      part('saving', 'Saving'),
      h('p', { class: 'saving' }, savingText()),
      copyOffered() ? h('p', {}, 'Save a copy, in the menu, downloads the whole meet as one file. Open a copy carries the meet on from a file like that, on this device or another, in place of the one here.') : null,
      // (A game on the Home Screen keeps its storage apart from Safari's, so it opens with a meet of its own: a
      // WebKit engineer called that intended, 1 February 2022, WebKit bug 181849. Without the second sentence a
      // player who follows the first finds a new meet and $200, and thinks theirs is gone.)
      singleFile ? null : h('p', {}, "On an iPhone or iPad, add Post Time to the Home Screen (the Share button, then Add to Home Screen). Safari clears a site's saved data once it has been used for seven days without a visit to the site, and a game on the Home Screen isn't cleared that way.",
        copyOffered() ? " The game on the Home Screen keeps its own storage, apart from Safari's, so it opens with a new meet: Save a copy in Safari first, then Open a copy in the game on the Home Screen to carry yours on." : ''),
      jdFoot(),
    ),
  );
  const at = params.at && document.getElementById(`help-${params.at}`);
  if (at) requestAnimationFrame(() => { at.scrollIntoView({ block: 'start' }); at.focus({ preventScroll: true }); });
}
