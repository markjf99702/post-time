// The race card: today's date and weather, the eight races, and what happened in the ones already run.

import { h, money, cloth, jdFoot } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, dayTotals, myBets, atm, advanceDay } from '../game.js';
import { longDate, clockText } from '../world.js';
import { distanceName } from '../track.js';

const SKY = { sunny: '☀️', 'partly cloudy': '⛅', overcast: '☁️', rain: '🌧️', showers: '🌦️' };

export function renderCard(root, nav) {
  const c = card();
  const w = game.world;
  const nxt = nextRace();
  const tot = dayTotals(c);
  root.append(
    h('section', { class: 'day' },
      h('div', { class: 'kicker' }, `Race day ${w.day + 1} of the meet`),
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
    ),
    h('ol', { class: 'races' }, c.races.map(r => h('li', {}, raceRow(r, nxt, nav)))),
  );

  const foot = h('div', { class: 'card-foot' });
  if (!nxt) {
    foot.append(
      h('p', { class: 'h2' }, "That's the card."),
      h('p', { class: 'muted' }, 'Entries for next Saturday are drawn. Some of today\'s horses will be back in two or three weeks.'),
      h('button', { class: 'btn brass', type: 'button', onclick: () => { advanceDay(); nav.go('card'); window.scrollTo(0, 0); } }, 'Next race day ▸'),
    );
  } else if (game.player.bank < 1 && !myBets(nxt).length) {
    foot.append(
      h('p', {}, "You're out of money. There's an ATM by the paddock."),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { atm(); nav.refresh(); } }, 'Take out $100'),
    );
  }
  root.append(foot, jdFoot());
}

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
  h('div', { class: 'sub' }, `${distanceName(r.distance)}${r.surface === 'dirt' ? ' · Dirt' : ''} · ${r.entries.length} horses · $${(r.purse / 1000).toFixed(0)}k purse`, tags.length ? ' ' : '', ...tags.flatMap(t => [t, ' '])),
  );
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }
