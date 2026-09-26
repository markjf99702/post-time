// Your scrapbook of winner's circle photos, your record at the windows, and how to play.

import { h, money } from './dom.js';
import { game, START_BANK } from '../game.js';
import { TIPSTERS } from '../data.js';
import { longDate } from '../world.js';
import { photoCard } from './results.js';

export function renderBook(root, nav) {
  const p = game.player;
  const spent = p.ledger.reduce((s, x) => s + x.spent, 0);
  const back = p.ledger.reduce((s, x) => s + x.back, 0);
  const best = p.ledger.reduce((m, x) => Math.max(m, x.best), 0);
  const cashed = p.ledger.filter(x => x.back > 0).length;
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, 'This meet'), h('h1', { class: 'title' }, 'Scrapbook & record')),
    ),
    h('div', { class: 'stats' },
      stat('Bankroll', money(p.bank)),
      stat('Started with', money(START_BANK + p.atm), p.atm ? `including ${money(p.atm, { cents: false })} from the ATM` : ''),
      stat('Bet', money(spent)),
      stat('Back', money(back)),
      stat('Races cashed', `${cashed} of ${p.ledger.length}`),
      stat('Biggest ticket', money(best)),
      p.best ? stat('Best day', money(p.best.net, { sign: true }), longDate(p.best.date).replace(/^\w+, /, '')) : null,
    ),
  );
  root.append(h('h2', { class: 'h2 pad', style: { paddingBottom: 0 } }, "Winner's circle photos"));
  if (!p.book.length) root.append(h('p', { class: 'pad muted' }, "Back a winner and you'll be in the picture. They'll collect here."));
  else root.append(h('div', { class: 'book-grid' }, p.book.slice().reverse().map(r => photoCard(r, true))));

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

function stat(label, value, note) {
  return h('div', { class: 'stat' }, h('span', { class: 'kicker' }, label), h('b', { class: 'money' }, value), note ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, note) : null);
}

export function renderHelp(root, nav) {
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, 'Larkspur Downs'), h('h1', { class: 'title' }, 'How to play')),
    ),
    h('div', { class: 'help' },
      h('p', {}, `You start the meet with ${money(START_BANK, { cents: false })}. Every race day has eight races. For each one you can read the form, look at the horses in the paddock, see what the regulars on the forum are betting, buy tickets at the window, and then watch the race from the gate to the wire.`),
      h('p', {}, "The horses are the same from week to week. Everything in a horse's past performances happened in a race that was run the same way as the ones you watch, so reading the form really does help."),
      h('h3', {}, 'Reading the form'),
      h('dl', {},
        h('dt', {}, 'Speed figure'), h('dd', {}, 'How fast the horse ran, as one number, adjusted for the distance and how fast the track was that day. Higher is better. A horse that runs a 90 is about five lengths better than one that runs an 80 over six furlongs.'),
        h('dt', {}, 'Calls'), h('dd', {}, 'Where the horse was at points in the race, and how far behind the horse in front of it (for the leader: how far in front). "3²" is third, two lengths back. The last one is the finish.'),
        h('dt', {}, 'Running style'), h('dd', {}, 'Some horses need the lead, some sit just behind it, some come from the back. When several speed horses are entered they tend to tire each other out, which sets it up for a closer. A lone speed horse, left alone on the lead, is dangerous.'),
        h('dt', {}, 'Class'), h('dd', {}, 'Maiden races are for horses that have never won. In a claiming race every horse is for sale at the listed price, so trainers enter where they think they belong. A horse dropping in price may be better than these, or may have something wrong with it.'),
        h('dt', {}, 'Workouts'), h('dd', {}, 'Morning training runs, with the rank among the horses that worked that distance that morning. A bullet (●) is the fastest of the day, and can mean a horse is sharp.'),
        h('dt', {}, 'Morning line'), h('dd', {}, "The track handicapper's guess at the odds, printed before any money is bet. The odds on the board are what the betting public actually thinks."),
        h('dt', {}, 'Pedigree'), h('dd', {}, 'The sire (father) and the dam\'s sire. Some sires get horses that love grass, or mud, or a long way. Sire names link to Bloodlines, the racehorse family tree.'),
      ),
      h('h3', {}, 'Betting'),
      h('p', {}, 'All bets go into pools. The track takes its cut (16% from win, place and show, more from exactas and trifectas) and the rest is shared by the winning tickets, so the odds move as money comes in, right up to post time. Late money tends to know a little more.'),
      h('dl', {},
        h('dt', {}, 'Win, place, show'), h('dd', {}, 'Your horse finishes first; first or second; first, second or third.'),
        h('dt', {}, 'Exacta, trifecta'), h('dd', {}, 'The first two, or the first three, in order. A box covers every order of the horses you pick, one bet per order.'),
        h('dt', {}, 'Odds'), h('dd', {}, '5-2 means $5 profit for every $2 bet, so a $2 win ticket pays $7. Payouts are rounded down to the dime, and the least a winning $2 ticket pays is $2.10.'),
      ),
      h('h3', {}, 'The race'),
      h('p', {}, 'The camera follows the leaders. Tap a number in the running order to follow one horse instead. The little map shows the whole field on the oval. In a close finish the stewards look at the photo: a finish-line camera that only sees the line, so the horses in it are stretched and squashed by their speed.'),
      h('p', {}, "Back the winner and you're in the winner's circle photo. It goes in your scrapbook."),
      h('h3', {}, 'Saving'),
      h('p', {}, 'Everything is saved in this browser: your bankroll, tickets, scrapbook and the whole racing world. Nothing is sent anywhere. It works offline once it has loaded.'),
    ),
  );
}
