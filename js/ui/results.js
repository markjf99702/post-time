// After the race: the official order, what paid, your tickets, the chart, the forum's verdict,
// and the winner's circle.

import { h, money, cloth, clear } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, myBets, photoRecord } from '../game.js';
import { ownerSilks, longDate } from '../world.js';
import { JOCKEYS, TIPSTERS, TRAINERS, OWNERS } from '../data.js';
import { marginShort, fmtTime, ordinal } from '../chart.js';
import { BET_NAMES } from '../tote.js';
import { drawCircle } from '../draw/circle.js';
import { distanceName } from '../track.js';

export function renderResult(root, nav, params) {
  const race = card().races.find(r => r.no === params.no);
  const res = race.result;
  const pay = res.pay;
  const nxt = nextRace();
  const settled = game.player.settled[raceKey(race)];
  const bets = myBets(race);
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
  if (bets.length && settled) {
    const net = settled.back - settled.spent;
    wrap.append(h('div', { class: 'summary' },
      h('div', {}, h('div', { class: 'kicker' }, net >= 0 ? 'You cashed' : 'Your tickets'), h('div', { class: `big money ${net >= 0 ? 'pos' : 'neg'}` }, money(settled.back)), h('div', { class: 'muted' }, `on ${money(settled.spent)} bet · ${money(net, { sign: true })}`)),
      h('div', { class: 'tickets', style: { marginTop: 0, flex: '1 1 220px' } }, bets.map((b, i) => {
        const sel = b.sel.map(x => race.entries[x].pp);
        const label = b.type === 'exacta' || b.type === 'trifecta' ? sel.join('-') : b.type.endsWith('box') ? sel.join(', ') : sel[0];
        const back = settled.returns[i];
        return h('div', { class: `ticket ${back > 0 ? 'cashed' : 'lost'}` },
          h('div', {}, h('div', { class: 'what' }, `$${b.amt} ${BET_NAMES[b.type].toUpperCase()} ${label}`), h('div', { class: 'small' }, `COST ${money(b.cost)}`)),
          back > 0 ? h('span', { class: 'stamp' }, `PAID ${money(back)}`) : h('span', { class: 'small' }, 'torn up'),
        );
      })),
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
        h('td', {}, cloth(e.pp, 'sm'), ' ', h('b', {}, hs.name), h('div', { class: 'cm' }, `${JOCKEYS[e.j].name} · ${pp ? pp.cm : ''} · fig ${pp ? pp.fig : ''}`)),
        h('td', { class: 'r money' }, k === 0 ? '' : marginShort(o.toPrev)),
        h('td', { class: 'r money' }, res.oddsText[o.k]),
      );
    })),
  );
  wrap.append(h('div', { class: 'board' }, h('h3', {}, h('span', {}, 'Order of finish'), h('span', {}, fmtTime(res.time))), table));

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
    h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('watch', { no: race.no }) }, 'Watch again'),
    nxt ? h('button', { class: 'btn', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `Race ${nxt.no} ▸`) : h('button', { class: 'btn', type: 'button', onclick: () => nav.go('card') }, 'The card ▸'),
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

export function photoCard(rec, you) {
  const c = h('canvas', { width: 720, height: 500 });
  const frame = h('figure', { class: 'photo-frame', style: { margin: '0 auto' } },
    c,
    h('figcaption', { class: 'caption' },
      h('span', {}, 'Larkspur Downs'), h('span', { class: 'r' }, `Race ${rec.no} · ${shortLong(rec.date)}`),
      h('span', { class: 'horse' }, rec.horse.name),
      h('span', {}, rec.name || classText(rec)), h('span', { class: 'r' }, `${rec.dist} · ${fmtTime(rec.time)}`),
      h('span', {}, `${rec.jockey} up`), h('span', { class: 'r' }, `Tr. ${rec.trainer}`),
      h('span', { style: { gridColumn: '1 / -1' } }, `Owner ${rec.ownerName}`),
      you && rec.won ? h('span', { class: 'you-note' }, `That's you on the right, holding a ticket that paid ${money(rec.won)}.`) : null,
    ),
  );
  requestAnimationFrame(() => {
    const w = c.getBoundingClientRect().width || 360;
    drawCircle(c, { horse: rec.horse, silks: ownerSilks(rec.owner), number: rec.number, stakes: rec.stakes, you, seed: rec.seed, width: w, height: w * 25 / 36 });
  });
  return frame;
}

function classText(rec) {
  const names = { MCL: 'Maiden claiming', MSW: 'Maiden special weight', ALW: 'Allowance', STK: 'Stakes' };
  return names[rec.cls] || `Claiming $${(rec.claim || 0).toLocaleString('en-US')}`;
}
function shortLong(iso) { return longDate(iso).replace(/^\w+, /, ''); }
