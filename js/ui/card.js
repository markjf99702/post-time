// The race card: today's date and weather, the eight races, and what happened in the ones already run.

import { h, money, cloth, jdFoot, dotted } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, dayTotals, myBets, atm, advanceDay } from '../game.js';
import { longDate, clockText, raceDayOf, meetDays, isClosingDay } from '../world.js';
import { BIG_STAKES } from '../data.js';
import { distanceName } from '../track.js';

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
      (tot.spent || tot.pending) ? h('div', { class: 'daysum' },
        tot.spent ? ['Today: bet ', h('b', { class: 'money' }, money(tot.spent)), ', back ', h('b', { class: 'money' }, money(tot.back)), ' ', h('b', { class: `money ${tot.net >= 0 ? 'pos' : 'neg'}` }, `(${money(tot.net, { sign: true })})`)] : null,
        tot.pending ? h('span', { class: 'muted' }, `${tot.spent ? ' · ' : ''}${money(tot.pending)} riding on races to come`) : null,
      ) : null,
      atmLine(() => redraw(nav)),
      // With the last race run, the way on is here as well as under the eight results, where it was about
      // 1,170 px down a phone's 844: a card opened the next morning had nothing on it to press.
      !nxt ? h('div', { class: 'day-over' }, h('p', { class: 'h2' }, closing ? "That's the meet." : "That's the card."), nextDayButton(nav, closing)) : null,
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
  root.append(foot, jdFoot());
}

// After closing day the way on is the meet's closing page, which opens the next meet.
function nextDayButton(nav, closing) {
  if (closing) return h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('meet') }, 'The meet in review ▸');
  return h('button', { class: 'btn brass', type: 'button', onclick: () => { advanceDay(); nav.go('card'); window.scrollTo(0, 0); } }, 'Next race day ▸');
}

// Over the date: which race day of the meet this is, counting down to the Handicap on closing day.
// "Race day 5 of 10 · the Larkspur Handicap in five weeks"; on closing day "Larkspur Handicap day · race
// day 10 of 10". (A meet carried over from before meets ended can be longer than ten: its first.)
export function dayKicker(w) {
  const n = raceDayOf(w), of = meetDays(w), left = of - n;
  if (!left) return `${BIG_STAKES.name} day · race day ${n} of ${of}`;
  if (left === 1) return `Race day ${n} of ${of} · the ${BIG_STAKES.name} next Saturday`;
  return `Race day ${n} of ${of} · the ${BIG_STAKES.name} in ${countWord(left)} weeks`;
}
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const countWord = n => WORDS[n] || String(n);

function raceRow(r, nxt, nav) {
  const isNext = nxt && r.no === nxt.no;
  const done = r.status === 'official';
  const tags = [];
  if (r.cls === 'STK') tags.push(h('span', { class: 'tag stk' }, r.name.includes('Larkspur') ? 'Feature' : 'Stakes'));
  if (r.surface === 'turf') tags.push(h('span', { class: 'tag turf' }, 'Turf'));
  if (r.fm) tags.push(h('span', { class: 'tag' }, 'Fillies & mares'));
  const mine = myBets(r);
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
    class: `race-row${done ? ' done' : ''}${isNext ? ' next' : ''}`, type: 'button',
    onclick: () => nav.go(done ? 'result' : 'race', { no: r.no }),
  },
  h('div', { class: 'no' }, h('small', {}, 'Race'), String(r.no)),
  h('div', { class: 'what' }, raceLabel(r)),
  state,
  h('div', { class: 'sub' }, dotted([distanceName(r.distance), r.surface === 'dirt' ? 'Dirt' : null, `${r.entries.length} horses`, `$${(r.purse / 1000).toFixed(0)}k purse`]), tags.length ? ' ' : '', ...tags.flatMap(t => [t, ' '])),
  );
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
