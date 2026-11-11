// After the race: the official order, what paid, your tickets, the chart, the forum's verdict,
// and the winner's circle.

import { h, money, cloth, clear } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, myBets, photoRecord, multiFor, multiState, MULTI } from '../game.js';
import { ownerSilks, longDate, isHandicap, raceDayOf, meetDays } from '../world.js';
import { JOCKEYS, TIPSTERS, TRAINERS, OWNERS, BIG_STAKES } from '../data.js';
import { marginShort, fmtTime, fmtClock, ordinal } from '../chart.js';
import { drawCircle } from '../draw/circle.js';
import { distanceName } from '../track.js';
import { ENGINE } from '../sim.js';
import { atmLine, redraw } from './card.js';
import { ticketLine, boughtAt, multiTicket } from './race.js';
import { callAsCalled } from './watch.js';

export function renderResult(root, nav, params) {
  const race = card().races.find(r => r.no === params.no);
  const res = race.result;
  const pay = res.pay;
  const nxt = nextRace();
  const settled = game.player.settled[raceKey(race)];
  const bets = myBets(race);
  // A daily double or Pick 3 with this race in it: alive or torn up after it, paid or torn up after its last.
  const multi = multiFor(race);
  const win = res.order[0];

  const wrap = h('div', { class: 'official' });
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, `Race ${race.no} · Official`), h('h1', { class: 'title' }, raceLabel(race))),
      h('div', { class: 'mtp' }, fmtTime(res.time), h('small', {}, 'time')),
      h('div', { class: 'cond' }, `${distanceName(race.distance)}, ${race.surface} (${race.cond}). Fractions ${res.fr.slice(0, -1).map(fmtTime).join(', ')}.`),
    ),
    wrap,
  );

  // Your result.
  if ((bets.length || multi.length) && settled) {
    const net = settled.back - settled.spent;
    wrap.append(h('div', { class: 'summary' },
      // (The money is what was settled on this race. A double or Pick 3 is settled on its last race, so a
      // race with only one of those still running on it has none.)
      settled.spent > 0 ? h('div', {}, h('div', { class: 'kicker' }, net >= 0 ? 'You cashed' : 'Your tickets'), h('div', { class: `big money ${net >= 0 ? 'pos' : 'neg'}` }, money(settled.back)), h('div', { class: 'muted' }, `on ${money(settled.spent)} bet · ${money(net, { sign: true })}`)) : null,
      h('div', { class: 'tickets', style: { marginTop: 0, flex: '1 1 220px' } }, ...multi.map(t => multiTicket(t)), bets.map((b, i) => {
        const back = settled.returns[i];
        return h('div', { class: `ticket ${back > 0 ? 'cashed' : 'lost'}` },
          h('div', {}, ticketLine(b, b.sel.map(x => race.entries[x].pp)), h('div', { class: 'small' }, `COST ${money(b.cost)}${boughtAt(race, b)}`)),
          back > 0 ? h('span', { class: 'stamp' }, `PAID ${money(back)}`) : h('span', { class: 'small torn' }, 'torn up'),
        );
      })),
      // The race that left you without the price of a ticket says so, with the way to the ATM.
      nxt && nxt.no === race.no + 1 ? atmLine(() => redraw(nav), `That leaves you ${money(game.player.bank)}.`) : null,
    ));
  }

  // Order of finish.
  const mine = new Set(bets.flatMap(b => b.sel));
  const table = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Horse'), h('th', { class: 'r' }, 'Margin'), h('th', { class: 'r' }, 'Odds'))),
    h('tbody', {}, res.order.map((o, k) => {
      const e = race.entries[o.k];
      const hs = horseOf(e);
      const pp = hs.pps.find(p => p.d === race.day && p.no === race.no);
      return h('tr', { class: mine.has(o.k) ? 'mine' : '' },
        h('td', { class: 'fin' }, ordinal(o.pos)),
        h('td', {}, cloth(e.pp, 'sm'), ' ', h('b', {}, hs.name), h('div', { class: 'cm' }, `${JOCKEYS[e.j].name} · ${pp ? pp.cm : ''} · fig\u00a0${pp ? pp.fig : ''}`),
          // The trainer it has now is the one who claimed it: it can't have run again since.
          pp && pp.claimed ? h('div', { class: 'cm' }, `Claimed by ${TRAINERS[hs.trainer]} for $${pp.claimed.price.toLocaleString('en-US')}`) : null),
        h('td', { class: 'r money' }, k === 0 ? '' : marginShort(o.toPrev)),
        h('td', { class: 'r money' }, res.oddsText[o.k]),
      );
    })),
  );
  wrap.append(h('div', { class: 'board' }, h('h3', {}, h('span', {}, 'Order of finish'), h('span', {}, fmtTime(res.time))), table));
  // The call, folded under the chart: every line as it was called at normal speed, with the time on the
  // clock, for a race watched at 4x or skipped, or a line half heard. It's worked out again when it's opened
  // (nothing of it is saved), so only for a race that can be watched again.
  if (res.eng === ENGINE) {
    const list = h('ol', { class: 'call-lines' });
    const box = h('details', { class: 'board the-call' }, h('summary', {}, h('h3', {}, h('span', {}, 'The call'), h('span', { class: 'fold', 'aria-hidden': 'true' }, '▸'))), list);
    box.addEventListener('toggle', () => {
      if (!box.open || list.firstChild) return;
      for (const l of callAsCalled(race)) {
        list.append(h('li', {}, h('span', { class: 'at' }, l.label || (l.t < 0 ? 'Gate' : fmtClock(l.t))), h('span', {}, l.text)));
      }
    });
    wrap.append(box);
  }
  // A weekly stakes is a prep for the Handicap on closing day: its first two are pointed to it.
  const w = game.world;
  if (race.cls === 'STK' && !isHandicap(race) && w.meet && race.day >= w.meet.first && race.day < w.meet.last && res.order.length > 1) {
    const [one, two] = res.order.slice(0, 2).map(o => horseOf(race.entries[o.k]).name);
    const left = meetDays(w) - raceDayOf(w, race.day);
    wrap.append(h('p', { class: 'pointed' }, `${one} and ${two} are pointed to the ${BIG_STAKES.name} on closing day, ${left === 1 ? 'next Saturday' : `race day ${meetDays(w)}`}.`));
  }

  // Payouts.
  const [a, b, c] = res.order.map(o => o.k);
  const rows = [
    [a, pay.win[a], pay.place[a], pay.show[a]],
    b !== undefined ? [b, null, pay.place[b], pay.show[b]] : null,
    c !== undefined ? [c, null, null, pay.show[c]] : null,
  ].filter(Boolean);
  const payTable = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, '$2 payouts'), h('th', { class: 'r' }, 'Win'), h('th', { class: 'r' }, 'Place'), h('th', { class: 'r' }, 'Show'))),
    h('tbody', {},
      rows.map(([k, w, p, s]) => h('tr', {}, h('td', {}, cloth(race.entries[k].pp, 'sm'), ' ', horseOf(race.entries[k]).name), ...[w, p, s].map(v => h('td', { class: 'r money' }, v ? money(v) : '')))),
      pay.exacta ? h('tr', {}, h('td', {}, `$2 exacta ${pay.exacta.sel.map(k => race.entries[k].pp).join('-')}`), h('td', { class: 'r money', colspan: 3 }, money(pay.exacta.pay))) : null,
      pay.trifecta ? h('tr', {}, h('td', {}, `$1 trifecta ${pay.trifecta.sel.map(k => race.entries[k].pp).join('-')}`), h('td', { class: 'r money', colspan: 3 }, money(pay.trifecta.pay))) : null,
      // The daily double and the Pick 3 that end in this race: the winners of their races, by number.
      ...Object.entries(res.multi || {}).map(([type, m]) => {
        const legs = m.sel.map((k, j) => card().races.find(r => r.no === race.no - m.sel.length + 1 + j));
        if (!MULTI[type] || legs.some(r => !r)) return null;
        return h('tr', {}, h('td', {}, `$1 ${type === 'dd' ? 'daily double' : 'Pick 3'} ${m.sel.map((k, j) => legs[j].entries[k].pp).join('-')}`), h('td', { class: 'r money', colspan: 3 }, money(m.pay)));
      }),
    ),
  );
  wrap.append(h('div', { class: 'board' }, h('h3', {}, 'What paid'), payTable));

  // The forum after the race.
  if (race.forumAfter && race.forumAfter.length) {
    const fb = h('div', { class: 'board' }, h('h3', {}, 'Meanwhile, on the forum'));
    const list = h('div', { style: { padding: '8px 8px 0' } });
    for (const p of race.forumAfter) {
      const t = TIPSTERS.find(x => x.id === p.who);
      list.append(h('div', { class: `post after${p.won ? ' won' : ''}` },
        h('div', { class: 'avatar', style: { background: t.color } }, t.handle[0]),
        h('div', {}, h('div', { class: 'meta' }, h('span', { class: 'handle' }, t.handle)), h('p', {}, p.text)),
      ));
    }
    fb.append(list);
    wrap.append(fb);
  }

  root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('circle', { no: race.no }) }, "Winner's circle ▸"),
    // Only a race run the way races are run now can be watched again: one run before that would be worked
    // out again another way, and could show another horse winning. (A save carries the day's earlier races
    // over a change to the racing.)
    res.eng === ENGINE ? h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('watch', { no: race.no }) }, 'Watch again') : null,
  ));
  // The way on is in a bar at the bottom of the screen, where a race's page has To the gate: what the race
  // did for you on the left, and the next race (the card, after the last one) as the button. (It was the
  // third button of the row above, at the end of the page: 1,700 px down a phone's 664 after an ordinary
  // race and 2,250 after one with six tickets, two and a half to three and a half screens.)
  // (What was settled here is this race's tickets and a double or Pick 3 that ends in it. One that ends in a
  // later race is said by where it stands: alive, paid, or torn up, which is no luck.)
  const name = t => (t.type === 'dd' ? 'daily double' : 'Pick 3');
  const cashed = settled && (bets.length || multi.some(t => t.back !== undefined && t.legs[t.legs.length - 1] === race.no)) ? settled.back : null;
  const alive = [...new Set(multi.filter(t => multiState(t) === 'alive').map(name))];
  const paidLater = multi.filter(t => t.back > 0);
  root.append(h('div', { class: 'post-bar' },
    h('div', { class: 'info' }, cashed > 0 ? ['You cashed ', h('b', { class: 'money' }, money(cashed))] : cashed === 0 ? 'No luck this time'
      : alive.length ? `Your ${alive.join(' and ')} ${alive.length > 1 ? 'are' : 'is'} alive`
        : paidLater.length ? [`Your ${[...new Set(paidLater.map(name))].join(' and ')} paid `, h('b', { class: 'money' }, money(paidLater.reduce((s, t) => s + t.back, 0)))]
          : multi.length ? 'No luck this time' : h('span', { class: 'muted' }, 'No tickets')),
    nxt ? h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `Race ${nxt.no} ▸`) : h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('card') }, 'The card ▸'),
  ));
}

export function renderCircle(root, nav, params) {
  const race = card().races.find(r => r.no === params.no);
  const winK = race.result.order[0].k;
  const bookEntry = game.player.book.find(b => b.day === race.day && b.no === race.no);
  const rec = bookEntry || photoRecord(race, winK, 0);
  const nxt = nextRace();
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('result', { no: race.no }) }, '‹ Results'),
      h('div', {}, h('div', { class: 'kicker' }, `Race ${race.no}`), h('h1', { class: 'title' }, "The winner's circle")),
    ),
    h('div', { class: 'pad' }, photoCard(rec, !!bookEntry)),
    h('p', { class: 'center muted', style: { padding: '0 16px' } }, bookEntry ? "You backed the winner, so you're in the picture. It's in your scrapbook." : 'Back the winner and you get into the picture, and it goes in your scrapbook.'),
    h('div', { class: 'actions' },
      nxt ? h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `On to race ${nxt.no} ▸`) : h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('card') }, 'Back to the card ▸'),
    ),
  );
}

// The silks in a winner's circle photo: the owner's, with the cap the horse wore when it was the owner's
// second runner in the race (kept with the photo; a photo kept before then has none).
const wornBy = rec => { const s = ownerSilks(rec.owner); return rec.cap ? { ...s, cap: rec.cap, capTrim: s.body } : s; };

export function photoCard(rec, you) {
  const c = h('canvas', { width: 720, height: 500 });
  // What the photo was worth is everything cashed on the race, which can be more than one ticket.
  const cashed = (game.player.settled[`${rec.day}:${rec.no}`]?.returns || []).filter(x => x > 0).length
    + (game.player.multi || []).filter(t => t.day === rec.day && t.legs[t.legs.length - 1] === rec.no && t.back > 0).length;
  // The Larkspur Handicap's photo says so, and is framed in brass in the scrapbook.
  const big = rec.name === BIG_STAKES.name;
  const frame = h('figure', { class: `photo-frame${big ? ' big' : ''}`, style: { margin: '0 auto' } },
    c,
    h('figcaption', { class: 'caption' },
      h('span', {}, 'Larkspur Downs'), h('span', { class: 'r' }, `Race ${rec.no} · `, h('span', { class: 'long' }, shortLong(rec.date)), h('span', { class: 'short' }, shortLong(rec.date, 3))),
      h('span', { class: 'horse' }, rec.horse.name),
      h('span', {}, big ? `Winner of the ${rec.name}` : rec.name || classText(rec)), h('span', { class: 'r' }, `${rec.dist} · ${fmtTime(rec.time)}`),
      h('span', {}, `${rec.jockey} up`), h('span', { class: 'r' }, `Tr. ${rec.trainer}`),
      h('span', { style: { gridColumn: '1 / -1' } }, `Owner ${rec.ownerName}`),
      you && rec.won ? h('span', { class: 'you-note' }, `That's you on the right, holding ${cashed > 1 ? 'tickets' : 'a ticket'} that paid ${money(rec.won)}.`) : null,
    ),
  );
  requestAnimationFrame(() => {
    const w = c.getBoundingClientRect().width || 360;
    drawCircle(c, { horse: rec.horse, silks: wornBy(rec), number: rec.number, stakes: rec.stakes, you, seed: rec.seed, meet: game.world.seed, width: w, height: w * 25 / 36 });
  });
  return frame;
}

// The kind of race, under the horse's name. A maiden claimer has its price, as it has on the card.
function classText(rec) {
  const names = { MSW: 'Maiden special weight', ALW: 'Allowance', STK: 'Stakes' };
  const price = rec.claim ? ` $${rec.claim.toLocaleString('en-US')}` : '';
  return names[rec.cls] || `${rec.cls === 'MCL' ? 'Maiden claiming' : 'Claiming'}${price}`;
}
// A race's date without its weekday, "November 14, 2026", or with the month cut to `letters`: "Nov 14, 2026".
function shortLong(iso, letters) {
  const date = longDate(iso).replace(/^\w+, /, '');
  return letters ? date.replace(/^\w+/, month => month.slice(0, letters)) : date;
}
