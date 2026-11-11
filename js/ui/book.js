// Your scrapbook of winner's circle photos, your record at the windows, and how to play.

import { h, money, jdFoot } from './dom.js';
import { game, START_BANK, notSaved, yourMeet, advanceDay } from '../game.js';
import { TIPSTERS, JOCKEYS, TRAINERS, BIG_STAKES } from '../data.js';
import { longDate, dayDate, dateISO, meetRecord, isClosingDay, MEET_DAYS } from '../world.js';
import { oddsText } from '../handicap.js';
import { photoCard } from './results.js';
import { MOVING } from './race.js';
import { JOE, offered as joeOffered } from '../joe.js';
import { offered as copyOffered } from '../copy.js';
import { drive } from '../drive.js';

// The page is this meet's: your record in it, the meets before it (each opens its closing page), and your
// photos, a meet at a time.
export function renderBook(root, nav) {
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
      stat(m.no > 1 ? 'Started the meet with' : 'Started with', money(you.start + you.atm), you.atm ? `including ${money(you.atm, { cents: false })} from the ATM` : ''),
      stat('Bet', money(you.bet)),
      stat('Back', money(you.back)),
      stat('Races cashed', `${you.cashed} of ${you.races}`),
      stat('Biggest ticket', you.best > 0 ? money(you.best) : 'None yet'),
      // Worked out from the record, so today counts before the next race day is asked for.
      stat('Best day', you.bestDay ? money(you.bestDay.net, { sign: true }) : 'None yet', you.bestDay ? dateOf(you.bestDay.day) : ''),
    ),
  );
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
  if (!p.book.length) root.append(h('p', { class: 'pad muted' }, "Back a winner and you're in the picture. Your photos collect here."));
  else if (!past.length) root.append(h('div', { class: 'book-grid' }, p.book.slice().reverse().map(r => photoCard(r, true))));
  else {
    // A meet at a time, the newest first.
    for (const meet of [{ no: m.no, first: m.first, last: m.last }, ...past]) {
      const photos = p.book.filter(r => r.day >= meet.first && r.day <= meet.last);
      if (!photos.length) continue;
      root.append(h('h3', { class: 'h3 pad meet-photos' }, `Meet ${meet.no}`));
      root.append(h('div', { class: 'book-grid' }, photos.reverse().map(r => photoCard(r, true))));
    }
  }

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

// A meet's closing page: the Handicap's winner, the leading rider and trainer, the horse of the meet, the
// forum's champion, the longest price, the stakes winners, and your own meet. `params.no` is a meet that
// has closed, from the scrapbook; without it, it's the meet being run, after its last race, and the way
// on from it opens the next meet.
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
      h('div', {}, h('div', { class: 'kicker' }, `Meet ${r.no}${over ? ' · closing day' : ' so far'}`), h('h1', { class: 'title' }, 'The meet in review')),
    ),
    h('p', { class: 'pad meet-when' }, `${plural(days, 'race day')}, ${dateOf(r.first)} to ${dateOf(r.last)}${days !== MEET_DAYS ? ' (the first meet, carried over from before meets had an end)' : ''}. ${plural(r.races, 'race')} run.`),
    r.handicap ? h('div', { class: 'pad' }, h('div', { class: 'meet-big' }, h('span', { class: 'kicker' }, `The ${BIG_STAKES.name}`), h('b', {}, r.handicap.horse))) : null,
    h('div', { class: 'stats' },
      award('Leading rider', r.rider && r.rider.w ? JOCKEYS[r.rider.i]?.name : null, r.rider && `${plural(r.rider.w, 'win')} from ${plural(r.rider.starts, 'ride')}`),
      award('Leading trainer', r.trainer && r.trainer.w ? TRAINERS[r.trainer.i] : null, r.trainer && `${plural(r.trainer.w, 'win')} from ${plural(r.trainer.starts, 'starter')}`),
      award('Horse of the meet', r.horse && r.horse.earn ? r.horse.name : null, r.horse && `${plural(r.horse.w, 'win')} from ${plural(r.horse.starts, 'start')}, ${money(r.horse.earn, { cents: false })} won`),
      award("The forum's champion", champ ? champ.handle : null, r.champ && `${plural(r.champ.wins, 'winner')} from ${plural(r.champ.picks, 'pick')}, ${money(r.champ.back / r.champ.picks)} back for each $2${r.since ? ', over the whole of the forum\'s record' : ''}`),
      award('The longest price', r.long ? r.long.name : null, r.long && `won at ${oddsText(r.long.odds)}, race ${r.long.no} on race day ${r.long.day - r.first + 1}`),
    ),
  );
  if (r.stakes.length) {
    root.append(h('div', { class: 'pad' }, h('div', { class: 'board' }, h('h3', {}, 'The stakes winners'), h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Race day'), h('th', {}, 'Stakes'), h('th', {}, 'Winner'))),
      h('tbody', {}, r.stakes.map(s => h('tr', { class: s.name === BIG_STAKES.name ? 'big' : '' }, h('td', { class: 'money' }, String(s.day - r.first + 1)), h('td', {}, s.name), h('td', {}, h('b', {}, s.horse))))),
    ))));
  }
  const y = r.you;
  if (y) {
    const net = y.end - y.start - y.atm;
    root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, 'Your meet'));
    root.append(h('div', { class: 'stats' },
      stat('Started with', money(y.start + y.atm), y.atm ? `including ${money(y.atm, { cents: false })} from the ATM` : ''),
      stat('Bet', money(y.bet)),
      stat('Back', money(y.back)),
      stat('Races cashed', `${y.cashed} of ${y.races}`),
      stat('Biggest ticket', y.best > 0 ? money(y.best) : 'None'),
      stat('Photos', String(y.photos)),
      stat(over ? 'Finished with' : 'Bankroll', money(y.end), `${money(net, { sign: true })} on the meet`),
    ));
  }
  if (live && over) {
    root.append(h('div', { class: 'actions' },
      h('p', { class: 'muted' }, `Meet ${r.no + 1} opens next Saturday with the same horses, ten race days to its own ${BIG_STAKES.name}. Your bankroll comes with you.`),
      h('button', { class: 'btn brass', type: 'button', onclick: () => { advanceDay(); nav.go('card'); window.scrollTo(0, 0); } }, `Open meet ${r.no + 1} ▸`),
    ));
  }
  root.append(jdFoot());
}

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

export function renderHelp(root, nav) {
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, 'Larkspur Downs'), h('h1', { class: 'title' }, 'How to play')),
    ),
    h('div', { class: 'help' },
      h('p', {}, `You start your first meet with ${money(START_BANK, { cents: false })}. Every race day has eight races. For each one you can read the form, look at the horses in the paddock, see what the regulars on the forum are betting, buy tickets at the window, and then watch the race from the gate to the wire.`),
      h('p', {}, "The horses are the same from week to week. Everything in a horse's past performances happened in a race that was run the same way as the ones you watch, so reading the form really does help."),
      h('h3', {}, 'The meet'),
      h('p', {}, `A meet is ${MEET_DAYS} race days. The last race of every Saturday is a stakes, and the first two home in each are pointed to the ${BIG_STAKES.name}, ${money(BIG_STAKES.purse, { cents: false })}, on closing day: they're entered in it first. After the Handicap the meet closes, with its leading rider and trainer, its horse of the meet, the forum's champion and your own meet, and the next meet opens the Saturday after with the same horses. Your bankroll carries over, and each meet's record is kept in your scrapbook.`),
      h('h3', {}, 'Reading the form'),
      h('dl', {},
        h('dt', {}, 'Speed figure'), h('dd', {}, 'How fast the horse ran, as one number, adjusted for the distance and how fast the track was that day. Higher is better. A horse that runs a 90 is about five lengths better than one that runs an 80 over six furlongs.'),
        h('dt', {}, 'Calls'), h('dd', {}, 'Where the horse was at three points in the race, and how far behind the horse in front of it (for the leader: how far in front). "3²" is third, two lengths back. The last one is the finish. In a sprint the first two are taken a quarter of a mile and half a mile from the start (a little sooner at five furlongs and five and a half), and in a race of a mile or more at the half and the three quarters. The third is always a furlong from the finish.'),
        h('dt', {}, 'Running style'), h('dd', {}, 'Some horses need the lead, some sit just behind it, some come from the back. When several speed horses are entered they tend to tire each other out, which sets it up for a closer. A lone speed horse, left alone on the lead, is dangerous.'),
        h('dt', {}, 'Class'), h('dd', {}, 'Maiden races are for horses that have never won. In a claiming race every horse is for sale at the listed price, so trainers enter where they think they belong. A horse dropping in price may be better than these, or may have something wrong with it.'),
        h('dt', {}, 'Workouts'), h('dd', {}, 'Morning training runs, with the rank among the horses that worked that distance that morning. A bullet (●) in front of one marks the fastest of the day, and can mean a horse is sharp.'),
        h('dt', {}, 'Post'), h('dd', {}, 'Where the horse starts in the gate, 1 nearest the rail. In a race of a mile or more the first turn comes up quickly: posts 2 and 3 do best, and from post 7 out a horse loses ground or has to take back. In a sprint it matters less. Riders dread drawing the rail, where a horse that doesn\'t break sharply gets squeezed as the others come over. The morning line and the odds allow for the draw.'),
        h('dt', {}, 'Morning line'), h('dd', {}, "The track handicapper's guess at the odds, printed before any money is bet. The odds on the board are what the betting public actually thinks."),
        h('dt', {}, 'Pedigree'), h('dd', {}, 'The sire (father) and the dam\'s sire. Some sires get horses that love grass, or mud, or a long way. Sire names link to Bloodlines, the racehorse family tree.'),
      ),
      h('h3', {}, 'Betting'),
      h('p', {}, 'All bets go into pools. The track takes its cut (16% from win, place and show, more from exactas and trifectas) and the rest is shared by the winning tickets, so the odds move as money comes in, right up to post time. Late money tends to know a little more.'),
      h('p', {}, MOVING),
      h('dl', {},
        h('dt', {}, 'Win, place, show'), h('dd', {}, 'Your horse finishes first; first or second; first, second or third.'),
        h('dt', {}, 'Exacta, trifecta'), h('dd', {}, 'The first two, or the first three, in order. A box covers every order of the horses you pick, one bet per order.'),
        h('dt', {}, 'Odds'), h('dd', {}, '5-2 means $5 profit for every $2 bet, so a $2 win ticket pays $7. Payouts are worked out per dollar and rounded down to the dime, so a $2 ticket pays in steps of 20 cents, and never less than $2.10.'),
      ),
      h('h3', {}, 'The race'),
      h('p', {}, 'The camera follows the leaders. Tap a number in the running order to follow one horse instead. The little map shows the whole field on the oval. In a close finish the placing judges read the photo. It comes from a finish-line camera that only sees the line, so the horses in it are stretched and squashed by their speed.'),
      h('p', {}, "The caller's lines are written out as the race is run, under the picture or beside it. Tick Read the race call aloud in the menu to have them spoken."),
      // Where the downloaded voice can work (not in the one-file copy, or a viewer with nowhere to keep him).
      joeOffered() ? h('p', {}, `The list of voices there has ${JOE.name}, the track's own caller. He's a download, ${Math.round(JOE.bytes / 1e6)} MB, once, kept on this device, and he's the same wherever you play. He calls quicker than a browser's voice does, and quicker still down the stretch. His lines for a race are made while you read its form. If they aren't ready when the race goes to the gate, the browser's voice calls that one.`) : null,
      h('p', {}, "Back the winner and you're in the winner's circle photo. It goes in your scrapbook."),
      h('h3', {}, 'Saving'),
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
}
