// The race card: today's date and weather, the eight races, and what happened in the ones already run.

import { h, money, cloth, jdFoot, dotted } from './dom.js';
import { canCopyText, copyText } from '../copy.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, dayTotals, myBets, atm, advanceDay, multiFor, starredIn, dayRecap, earlierDays } from '../game.js';
import { longDate, clockText, raceDayOf, meetDays, isClosingDay, isHandicap } from '../world.js';
import { BIG_STAKES, TIPSTERS } from '../data.js';
import { distanceName } from '../track.js';
import { ordinal } from '../chart.js';

const SKY = { sunny: '☀️', 'partly cloudy': '⛅', overcast: '☁️', rain: '🌧️', showers: '🌦️' };

// Out of money. With less than $2 (the least a win, place or show ticket costs) and no ticket on the race
// that's up, there's nothing left to do but watch, so the ATM is offered wherever the player is when that
// happens: under the date on the card, at the betting window, and under the tickets on the result that
// did it. (It was only at the foot of the card, under all eight races, and nothing on the way there said
// so.) `after` draws the screen again where it is; `lead` is said in place of the usual first sentence.
export function atmLine(after, lead) {
  const nxt = nextRace(), left = game.player.bank;
  if (!nxt || left >= 2 || myBets(nxt).length) return null;
  const said = lead || (left >= 1 ? `You're down to ${money(left)}, not enough for a $2 ticket.` : "You're out of money.");
  return h('div', { class: 'atm' },
    h('p', {}, `${said} There's an ATM by the paddock.`),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { atm(); after(); } }, 'Take out $100'),
  );
}
// The same screen again, where it was (going to a screen starts it at the top).
export function redraw(nav) {
  const y = window.scrollY;
  nav.refresh();
  window.scrollTo(0, y);
}

// The card opens at the top, unless the race that's up is off the bottom of the screen: then it opens with
// that race in the middle of what shows under the header. (After five races the Up next row started 772 px
// down a phone's 664, so every return to the card began with a scroll to find it.) Not when the money has
// run out, when the ATM under the date is the thing to see.
export function upNextInView() {
  const row = document.querySelector('.race-row.next');
  if (!row || document.querySelector('.day .atm')) return;
  const r = row.getBoundingClientRect();
  if (r.bottom <= window.innerHeight) return;
  const under = document.getElementById('top')?.getBoundingClientRect().bottom || 0;
  window.scrollTo(0, Math.round(r.top + window.scrollY - (under + window.innerHeight - r.height) / 2));
}

export function renderCard(root, nav) {
  const c = card();
  const w = game.world;
  const nxt = nextRace();
  const tot = dayTotals(c);
  const closing = isClosingDay(w);
  root.append(
    h('section', { class: 'day' },
      h('div', { class: 'kicker' }, dayKicker(w)),
      h('h1', { class: 'day-date' }, longDate(c.date)),
      h('div', { class: 'wx' },
        h('span', {}, `${SKY[c.wx.sky] || ''} `, h('b', {}, cap(c.wx.sky)), `, ${c.wx.temp}°`),
        h('span', {}, 'Dirt ', h('b', {}, c.wx.dirt)),
        h('span', {}, 'Turf ', h('b', {}, c.wx.turf)),
      ),
      // (With the last race run, the day's three lines under "That's the card" say what this would.)
      nxt && (tot.spent || tot.pending) ? h('div', { class: 'daysum' },
        tot.spent ? ['Today: bet ', h('b', { class: 'money' }, money(tot.spent)), ', back ', h('b', { class: 'money' }, money(tot.back)), ' ', h('b', { class: `money ${tot.net >= 0 ? 'pos' : 'neg'}` }, `(${money(tot.net, { sign: true })})`)] : null,
        tot.pending ? h('span', { class: 'muted' }, `${tot.spent ? ' · ' : ''}${money(tot.pending)} riding on races to come`) : null,
      ) : null,
      // The Saturday before closing day says what's coming.
      raceDayOf(w) === meetDays(w) - 1 ? h('p', { class: 'big-next' }, `Next Saturday: the ${BIG_STAKES.name}, ${money(BIG_STAKES.purse, { cents: false })}`) : null,
      atmLine(() => redraw(nav)),
      // With the last race run, the way on is here as well as under the eight results, where it was about
      // 1,170 px down a phone's 844: a card opened the next morning had nothing on it to press.
      !nxt ? h('div', { class: 'day-over' }, h('p', { class: 'h2' }, closing ? "That's the meet." : "That's the card."), nextDayButton(nav, closing), recap(c)) : null,
    ),
    h('ol', { class: 'races' }, c.races.map(r => h('li', {}, raceRow(r, nxt, nav)))),
  );

  const foot = h('div', { class: 'card-foot' });
  if (!nxt) {
    foot.append(
      h('p', { class: 'h2' }, closing ? "That's the meet." : "That's the card."),
      h('p', { class: 'muted' }, closing ? `Meet ${w.meet.no} is over. Its riders, trainers and horses of the meet are on its closing page, with your own meet, and meet ${w.meet.no + 1} opens next Saturday with the same horses.`
        : 'Entries for next Saturday are drawn. Some of today\'s horses will be back in two or three weeks.'),
      nextDayButton(nav, closing),
    );
  }
  // The results of earlier race days.
  if (earlierDays().length) foot.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('past') }, 'Earlier race days ▸'));
  root.append(foot, jdFoot());
}

// The day in three lines, under "That's the card": bet and back, your best ticket, and the forum's best day.
function recap(c) {
  const r = dayRecap(c);
  const tip = r.tip && TIPSTERS.find(t => t.id === r.tip.id);
  const net = r.back - r.spent;
  const copy = canCopyText() ? h('button', { class: 'btn ghost copy-day', type: 'button' }, 'Copy my day') : null;
  if (copy) copy.addEventListener('click', async () => {
    const ok = await copyText(dayText(c, r));
    copy.textContent = ok ? 'Copied' : "Couldn't copy it here";
    setTimeout(() => { copy.textContent = 'Copy my day'; }, 2500);
  });
  return h('div', { class: 'recap-wrap' }, h('ul', { class: 'recap' },
    h('li', {}, r.spent ? ['Bet ', h('b', { class: 'money' }, money(r.spent)), ', back ', h('b', { class: 'money' }, money(r.back)), ': ', h('b', { class: `money ${net >= 0 ? 'pos' : 'neg'}` }, money(net, { sign: true })), ' on the day.'] : 'No tickets today.'),
    r.spent ? h('li', {}, r.best ? ['Your best ticket: ', h('b', { class: 'money' }, money(r.best.back)), ` in race ${r.best.no}.`] : 'No ticket cashed today.') : null,
    h('li', {}, tip ? [h('b', {}, tip.handle), ` had the forum's best day: ${r.tip.wins} of ${r.tip.picks} picks won, ${money(r.tip.back)} back for $2 on each.`] : 'Nobody on the forum picked a winner today.'),
  ), copy);
}

// Copy my day: a few lines on the finished card, to paste into a message.
//   Post Time, Saturday, November 21, 2026 (meet 1, race day 9 of 10)
//   Cashed 4 of 8 races: bet $16.00, back $67.00 (+$51.00)
//   Best ticket: $17.20 in race 4, Cadence's Kettle
//   https://post-time.junkdrawer.works/
function dayText(c, r) {
  const w = game.world, lines = game.player.ledger.filter(x => x.day === c.day);
  const best = r.best && c.races.find(x => x.no === r.best.no);
  const winner = best && horseOf(best.entries[best.result.order[0].k]).name;
  return [
    `Post Time, ${longDate(c.date)} (meet ${w.meet.no}, race day ${raceDayOf(w)} of ${meetDays(w)})`,
    r.spent ? `Cashed ${lines.filter(x => x.back > 0).length} of ${lines.length} races: bet ${money(r.spent)}, back ${money(r.back)} (${money(r.back - r.spent, { sign: true })})` : 'Watched all eight races without a ticket.',
    r.best ? `Best ticket: ${money(r.best.back)} in race ${r.best.no}${winner ? `, ${winner}` : ''}` : null,
    'https://post-time.junkdrawer.works/',
  ].filter(Boolean).join('\n');
}

// After closing day the way on is the meet's closing page, which opens the next meet.
function nextDayButton(nav, closing) {
  if (closing) return h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('meet') }, 'The meet in review ▸');
  return h('button', { class: 'btn brass', type: 'button', onclick: () => { advanceDay(); nav.go('card'); window.scrollTo(0, 0); } }, 'Next race day ▸');
}

// Over the date: which race day of the meet this is, counting down to the Handicap on closing day.
// "Race day 5 of 10 · the Larkspur Handicap in five weeks"; on closing day "Larkspur Handicap day · race
// day 10 of 10". (A meet carried over from before meets ended can be shorter or longer than ten: its first.)
export function dayKicker(w) {
  const n = raceDayOf(w), of = meetDays(w), left = of - n;
  if (!left) return `${BIG_STAKES.name} day · race day ${n} of ${of}`;
  if (left === 1) return `Race day ${n} of ${of}`; // the line under the weather says what next Saturday is
  return `Race day ${n} of ${of} · the ${BIG_STAKES.name} in ${countWord(left)} weeks`;
}
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const countWord = n => WORDS[n] || String(n);

function raceRow(r, nxt, nav) {
  const isNext = nxt && r.no === nxt.no;
  const done = r.status === 'official';
  const tags = [];
  const big = isHandicap(r);
  if (r.cls === 'STK') tags.push(h('span', { class: `tag stk${big ? ' big' : ''}` }, big ? 'Feature' : 'Stakes'));
  if (r.surface === 'turf') tags.push(h('span', { class: 'tag turf' }, 'Turf'));
  if (r.fm) tags.push(h('span', { class: 'tag' }, 'Fillies & mares'));
  // (A daily double or Pick 3 is on the race it was bought in.)
  const mine = [...myBets(r), ...multiFor(r, { starting: true })];
  let state;
  if (done) {
    const winK = r.result.order[0].k;
    const e = r.entries[winK];
    const s = game.player.settled[raceKey(r)];
    state = h('div', { class: 'state' },
      h('div', { class: 'result' }, cloth(e.pp, 'sm'), ' ', horseOf(e).name),
      h('div', { class: 'money muted' }, `Paid ${money(r.result.pay.win[winK])}`),
      s && s.spent ? h('div', { class: `money ${s.back - s.spent >= 0 ? 'pos' : 'neg'}` }, money(s.back - s.spent, { sign: true })) : null,
    );
  } else {
    state = h('div', { class: 'state' },
      isNext ? h('span', { class: 'tag go' }, 'Up next') : null,
      h('div', { class: 'muted', style: { marginTop: '4px' } }, `Post ${clockText(r.post)}`),
      mine.length ? h('div', { class: 'money' }, `🎟️ ${money(mine.reduce((a, b) => a + b.cost, 0))}`) : null,
    );
  }
  return h('button', {
    class: `race-row${done ? ' done' : ''}${isNext ? ' next' : ''}${big ? ' big' : ''}`, type: 'button',
    onclick: () => nav.go(done ? 'result' : 'race', { no: r.no }),
  },
  h('div', { class: 'no' }, h('small', {}, 'Race'), String(r.no)),
  h('div', { class: 'what' }, raceLabel(r)),
  state,
  h('div', { class: 'sub' }, dotted([distanceName(r.distance), r.surface === 'dirt' ? 'Dirt' : null, `${r.entries.length} horses`, `$${(r.purse / 1000).toFixed(0)}k purse`]), tags.length ? ' ' : '', ...tags.flatMap(t => [t, ' '])),
  starLine(r),
  );
}

// A race with a horse you've starred in it says so: "★ Quiet Ramble runs", and once it's run where it finished.
function starLine(r) {
  const mine = starredIn(r);
  if (!mine.length) return null;
  const done = r.status === 'official';
  const names = mine.map(i => {
    const name = horseOf(r.entries[i]).name;
    const fin = done ? r.result.order.find(o => o.k === i) : null;
    return fin ? `${name}, ${ordinal(fin.pos)}` : name;
  });
  const list = done ? names.join('; ') : names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return h('div', { class: 'starred' }, h('span', { 'aria-hidden': 'true' }, '★ '), h('span', { class: 'sr' }, 'Starred: '), done ? list : `${list} ${names.length > 1 ? 'run' : 'runs'}`);
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
