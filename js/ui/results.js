// After the race: the official order, what paid, your tickets, the chart, the forum's verdict,
// and the winner's circle.

import { h, money, cloth, clear } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, myBets, photoRecord, multiFor, multiState, MULTI, raceAt, earlierDays, meetOf, ticketNote, memoKey } from '../game.js';
import { ownerSilks, longDate, isHandicap, raceDayOf, meetDays } from '../world.js';
import { JOCKEYS, TIPSTERS, TRAINERS, OWNERS, BIG_STAKES } from '../data.js';
import { marginShort, fmtTime, fmtClock, ordinal } from '../chart.js';
import { drawCircle } from '../draw/circle.js';
import { distanceName } from '../track.js';
import { ENGINE } from '../sim.js';
import { atmLine, redraw } from './card.js';
import { ticketLine, boughtAt, multiTicket, starButton } from './race.js';
import { callAsCalled } from './watch.js';
import { canGive, givePicture } from '../copy.js';

// `params.day` is there for an earlier race day's race (kept in js/world.js's pastRace): its results have the
// order of finish, what paid, the call and Watch again, and what you bet and got back on it.
const landed = new Set(); // the races whose tickets have landed on their result
export function renderResult(root, nav, params) {
  const race = raceAt(params.day, params.no);
  if (!race || race.status !== 'official') { nav.go('card'); return; }
  const past = !!race.past;
  const res = race.result;
  const pay = res.pay;
  const nxt = nextRace();
  const settled = game.player.settled[raceKey(race)];
  const bets = myBets(race);
  // A daily double or Pick 3 with this race in it: alive or torn up after it, paid or torn up after its last.
  const multi = multiFor(race);
  const win = res.order[0];

  const wrap = h('div', { class: 'official' });
  const when = past ? meetOf(race.day) : null;
  root.append(
    h('div', { class: 'rhead' },
      past ? h('button', { class: 'back', type: 'button', onclick: () => nav.go('past', { day: race.day }) }, '‹ Earlier race days')
        : h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
      h('div', {}, h('div', { class: 'kicker' }, past ? `${shortLong(race.date, 3)}${when ? ` · race day ${when.raceDay}` : ''} · Race ${race.no}` : `Race ${race.no} · Official`), h('h1', { class: 'title' }, raceLabel(race))),
      h('div', { class: 'mtp' }, fmtTime(res.time), h('small', {}, 'time')),
      h('div', { class: 'cond' }, `${distanceName(race.distance)}, ${race.surface} (${race.cond}). Fractions ${res.fr.slice(0, -1).map(fmtTime).join(', ')}.`),
    ),
    wrap,
  );

  // Your result. Come straight from the race, the tickets settle in turn: each PAID stamp lands, one after
  // another, and a losing ticket tears a beat after them. (Once a race: not again when the page is drawn again.)
  const landing = !!params.fresh && !landed.has(memoKey(race));
  landed.add(memoKey(race));
  if ((bets.length || multi.length) && settled) {
    const net = settled.back - settled.spent;
    const note = past ? null : ticketNote(race); // (a ticket that cashed, whatever the race came to)
    let k = 0;
    const turn = el => { if (landing) el.style.setProperty('--i', String(k++)); return el; };
    wrap.append(h('div', { class: `summary${landing ? ' landing' : ''}` },
      // (The money is what was settled on this race. A double or Pick 3 is settled on its last race, so a
      // race with only one of those still running on it has none.)
      settled.spent > 0 ? h('div', {}, h('div', { class: 'kicker' }, net >= 0 ? 'You cashed' : 'Your tickets'), h('div', { class: `big money ${net >= 0 ? 'pos' : 'neg'}` }, money(settled.back)), h('div', { class: 'muted' }, `on ${money(settled.spent)} bet · ${money(net, { sign: true })}`),
        note ? h('div', { class: 'ticket-note' }, note) : null) : null,
      h('div', { class: 'tickets', style: { marginTop: 0, flex: '1 1 220px' } }, ...multi.map(t => turn(multiTicket(t))), bets.map((b, i) => {
        const back = settled.returns[i];
        return turn(h('div', { class: `ticket ${back > 0 ? 'cashed' : 'lost'}` },
          h('div', {}, ticketLine(b, b.sel.map(x => race.entries[x].pp)), h('div', { class: 'small' }, `COST ${money(b.cost)}${boughtAt(race, b)}`)),
          back > 0 ? h('span', { class: 'stamp' }, `PAID ${money(back)}`) : h('span', { class: 'small torn' }, 'torn up'),
        ));
      })),
      // The race that left you without the price of a ticket says so, with the way to the ATM.
      !past && nxt && nxt.no === race.no + 1 ? atmLine(() => redraw(nav), `That leaves you ${money(game.player.bank)}.`) : null,
    ));
  }
  // An earlier race day's tickets go when the race day after it is over; what they came to is in your record.
  const line = past ? game.player.ledger.find(x => x.day === race.day && x.no === race.no) : null;
  if (line && !((bets.length || multi.length) && settled)) {
    wrap.append(h('div', { class: 'summary' }, h('div', {}, h('div', { class: 'kicker' }, line.back > line.spent ? 'You cashed' : 'Your tickets'),
      h('div', { class: `big money ${line.back - line.spent >= 0 ? 'pos' : 'neg'}` }, money(line.back)), h('div', { class: 'muted' }, `on ${money(line.spent)} bet · ${money(line.back - line.spent, { sign: true })}`))));
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
        h('td', {}, cloth(e.pp, 'sm'), ' ', h('b', {}, hs.name), starButton(e.hid, hs.name), h('div', { class: 'cm' }, `${JOCKEYS[e.j].name} · ${pp ? pp.cm : ''} · fig\u00a0${pp ? pp.fig : ''}`),
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
  if (!past && race.cls === 'STK' && !isHandicap(race) && w.meet && race.day >= w.meet.first && race.day < w.meet.last && res.order.length > 1) {
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
        const legs = m.sel.map((k, j) => raceAt(race.day, race.no - m.sel.length + 1 + j));
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

  const at = past ? { no: race.no, day: race.day } : { no: race.no };
  root.append(h('div', { class: 'actions' },
    past ? null : h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('circle', { no: race.no }) }, "Winner's circle ▸"),
    // Only a race run the way races are run now can be watched again: one run before that would be worked
    // out again another way, and could show another horse winning. (A save carries the day's earlier races
    // over a change to the racing.)
    res.eng === ENGINE ? h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('watch', at) }, 'Watch again') : null,
    // The race's form, paddock and forum as they were before it, to read the result against. (Not kept for an
    // earlier race day.)
    past ? null : h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('race', { no: race.no, tab: 'form' }) }, 'The form'),
  ));
  if (past) {
    root.append(h('div', { class: 'post-bar' },
      h('div', { class: 'info' }, line ? (line.back > 0 ? ['You cashed ', h('b', { class: 'money' }, money(line.back))] : 'No luck this time') : h('span', { class: 'muted' }, 'No tickets')),
      h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('card') }, "Today's card ▸"),
    ));
    return;
  }
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

// Earlier race days: the race days kept (this meet's and the last meet's), the newest first, and with
// `params.day` that day's races, each opening its results.
export function renderPast(root, nav, params = {}) {
  const days = earlierDays();
  const day = params.day !== undefined ? days.find(d => d.day === params.day) : null;
  const net = d => game.player.ledger.filter(x => x.day === d).reduce((s, x) => s + x.back - x.spent, 0);
  const bet = d => game.player.ledger.some(x => x.day === d);
  const label = d => { const m = meetOf(d); return m ? `Meet ${m.no}, race day ${m.raceDay}` : 'Race day'; };
  if (!day) {
    root.append(
      h('div', { class: 'rhead' },
        h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
        h('div', {}, h('div', { class: 'kicker' }, 'Results'), h('h1', { class: 'title' }, 'Earlier race days')),
      ),
      days.length ? h('div', { class: 'meets' }, days.map(d => h('button', { class: 'meet-row', type: 'button', onclick: () => nav.go('past', { day: d.day }) },
        h('b', {}, label(d.day)), h('span', { class: 'muted' }, shortLong(d.date)),
        bet(d.day) ? h('span', { class: `money ${net(d.day) >= 0 ? 'pos' : 'neg'}` }, money(net(d.day), { sign: true })) : h('span', {}),
        h('span', { class: 'go', 'aria-hidden': 'true' }, '▸'),
      ))) : h('p', { class: 'pad muted' }, 'Once a race day is over its results are kept here, this meet\'s and the last meet\'s.'),
      days.length ? h('p', { class: 'pad muted' }, 'The results of this meet\'s race days and the last meet\'s are kept, each race to look at and watch again.') : '',
    );
    return;
  }
  root.append(
    h('div', { class: 'rhead' },
      h('button', { class: 'back', type: 'button', onclick: () => nav.go('past') }, '‹ Earlier race days'),
      h('div', {}, h('div', { class: 'kicker' }, label(day.day)), h('h1', { class: 'title' }, longDate(day.date))),
    ),
    h('ol', { class: 'races' }, day.races.map(s => {
      const race = raceAt(day.day, s.no), win = race.result.order[0].k, e = race.entries[win];
      const line = game.player.ledger.find(x => x.day === day.day && x.no === s.no);
      return h('li', {}, h('button', { class: 'race-row done', type: 'button', onclick: () => nav.go('result', { day: day.day, no: s.no }) },
        h('div', { class: 'no' }, h('small', {}, 'Race'), String(s.no)),
        h('div', { class: 'what' }, raceLabel(race)),
        h('div', { class: 'state' },
          h('div', { class: 'result' }, cloth(e.pp, 'sm'), ' ', horseOf(e).name),
          h('div', { class: 'money muted' }, `Paid ${money(race.result.pay.win[win])}`),
          line ? h('div', { class: `money ${line.back - line.spent >= 0 ? 'pos' : 'neg'}` }, money(line.back - line.spent, { sign: true })) : null),
        h('div', { class: 'sub' }, `${distanceName(race.distance)}${race.surface === 'turf' ? ' on the turf' : ''} · ${race.entries.length} horses`),
      ));
    })),
  );
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
    h('div', { class: 'pad' }, flash(photoCard(rec, !!bookEntry), bookEntry ? memoKey(race) : null)),
    h('div', { class: 'actions save-row' }, savePictureButton(rec, !!bookEntry)),
    h('p', { class: 'center muted', style: { padding: '0 16px' } }, bookEntry ? "You backed the winner, so you're in the picture. It's in your scrapbook." : 'Back the winner and you get into the picture, and it goes in your scrapbook.'),
    h('div', { class: 'actions' },
      nxt ? h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `On to race ${nxt.no} ▸`) : h('button', { class: 'btn brass', type: 'button', onclick: () => nav.go('card') }, 'Back to the card ▸'),
    ),
  );
}

// The camera flashes the first time you see yourself in a photo (once a race, while the page is open).
const flashed = new Set();
function flash(frame, key) {
  if (key && !flashed.has(key)) { flashed.add(key); frame.classList.add('flash'); }
  return frame;
}

// The silks in a winner's circle photo: the owner's, with the cap the horse wore when it was the owner's
// second runner in the race (kept with the photo; a photo kept before then has none).
const wornBy = rec => { const s = ownerSilks(rec.owner); return rec.cap ? { ...s, cap: rec.cap, capTrim: s.body } : s; };

export function photoCard(rec, you) {
  const c = h('canvas', { width: 720, height: 500 });
  // What the photo was worth is everything cashed on the race, which can be more than one ticket.
  const cashed = photoTickets(rec);
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
  requestAnimationFrame(() => drawPhoto(c, rec, you, c.getBoundingClientRect().width || 360));
  return frame;
}

// Save the picture: the photo with its caption under it, as one picture 1,080 px wide, the way the scrapbook
// frames it, handed to the share sheet or downloaded. (A long press on the photo saved a picture with no names
// on it: the caption is text beside it.) Under the photo where it's shown, wherever it can be handed over.
export function savePictureButton(rec, you) {
  if (!canGive()) return null;
  const b = h('button', { class: 'btn ghost', type: 'button' }, 'Save the picture');
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const blob = await photoPicture(rec, you);
      if (blob) await givePicture(blob, `Post Time, ${rec.horse.name}, ${shortLong(rec.date)}.png`);
    } finally { b.disabled = false; }
  });
  return b;
}
export async function photoPicture(rec, you) {
  const W = 1080, pad = 36, inner = W - 2 * pad, ph = Math.round(inner * 25 / 36);
  const shot = document.createElement('canvas');
  drawPhoto(shot, rec, you, inner);
  // The caption's lines, as the photo card sets them: left and right, the horse's name across.
  const big = rec.name === BIG_STAKES.name;
  const rows = [
    ['Larkspur Downs', `Race ${rec.no} · ${shortLong(rec.date)}`],
    [rec.horse.name],
    [big ? `Winner of the ${rec.name}` : rec.name || classText(rec), `${rec.dist} · ${fmtTime(rec.time)}`],
    [`${rec.jockey} up`, `Tr. ${rec.trainer}`],
    [`Owner ${rec.ownerName}`, ''],
  ];
  const note = you && rec.won ? `That's me on the right, holding ${photoTickets(rec) > 1 ? 'tickets' : 'a ticket'} that paid ${money(rec.won)}.` : '';
  try { await Promise.all(['500 30px Oswald', '500 48px Oswald', 'italic 400 30px Plex'].map(f => document.fonts.load(f))); } catch { /* the fallback fonts */ }
  const line = 40, H = pad + ph + 24 + line + 62 + line * 3 + (note ? 50 : 0) + pad;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbf8ef';
  ctx.fillRect(0, 0, W, H);
  if (big) { ctx.strokeStyle = '#b8892d'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, W - 12, H - 12); }
  ctx.drawImage(shot, pad, pad, inner, ph);
  let y = pad + ph + 24;
  const caps = s => s.toUpperCase();
  ctx.textBaseline = 'top';
  const pair = ([l, r], size, color) => {
    ctx.font = `500 ${size}px Oswald, 'Arial Narrow', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left'; ctx.fillText(caps(l), pad + 6, y, r ? inner * 0.6 : inner - 12);
    if (r) { ctx.textAlign = 'right'; ctx.fillText(caps(r), W - pad - 6, y, inner * 0.5); }
  };
  pair(rows[0], 28, '#2a2419'); y += line;
  pair(rows[1], 46, '#1d3a2e'); y += 62;
  for (const r of rows.slice(2)) { pair(r, 28, '#2a2419'); y += line; }
  if (note) {
    ctx.font = "italic 400 30px Plex, 'Arial Narrow', sans-serif";
    ctx.fillStyle = '#6b604b'; ctx.textAlign = 'left';
    ctx.fillText(note, pad + 6, y + 8, inner - 12);
  }
  return new Promise(res => c.toBlob(res, 'image/png'));
}

// A winner's circle photo drawn on `c`, `w` px wide: in the photo card, and small on the scrapbook's contact sheet.
export function drawPhoto(c, rec, you, w) {
  drawCircle(c, { horse: rec.horse, silks: wornBy(rec), number: rec.number, stakes: rec.stakes, you, seed: rec.seed, meet: game.world.seed, width: w, height: w * 25 / 36 });
}

// How many tickets the photo's payout was: everything cashed on the race.
function photoTickets(rec) {
  return (game.player.settled[`${rec.day}:${rec.no}`]?.returns || []).filter(x => x > 0).length
    + (game.player.multi || []).filter(t => t.day === rec.day && t.legs[t.legs.length - 1] === rec.no && t.back > 0).length;
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
