// A race before it runs: the past performances, the paddock, the forum and the betting window.

import { h, money, cloth, silksCanvas, clear, ago, plural } from './dom.js';
import { game, card, raceKey, memoKey, horseOf, ranFor, nextRace, raceLabel, myBets, placeBet, cancelBet, currentBoard, mtpState, forumFor, runnersFor } from '../game.js';
import { ownerSilks, ageOf, shortDate, clockText, CLASSES, meetStats } from '../world.js';
import { distanceName, distanceShort, FURLONG } from '../track.js';
import { JOCKEYS, TRAINERS, OWNERS, TIPSTERS, IN_BLOODLINES, SIRES, CLOTH } from '../data.js';
import { callText, marginShort, fmtTime, fmtWork } from '../chart.js';
import { runStyle } from '../forum.js';
import { BET_NAMES, cost as betCost, BASE } from '../tote.js';
import { drawHorse } from '../draw/horse.js';
import { oddsText, angles, newcomer } from '../handicap.js';
import * as audio from '../audio.js';
import { atmLine } from './card.js';

const COND ={ fast: 'ft', good: 'gd', sloppy: 'sly', muddy: 'my', firm: 'fm', yielding: 'yl', soft: 'sf' };
const SEX = { c: 'colt', f: 'filly', g: 'gelding', h: 'horse', m: 'mare' };
// A colt is a horse from the year he turns five, and a filly a mare.
function sexWord(sex, age) {
  return age >= 5 && sex === 'c' ? SEX.h : age >= 5 && sex === 'f' ? SEX.m : SEX[sex];
}

export function renderRace(root, nav, params) {
  const race = card().races.find(r => r.no === params.no);
  const nxt = nextRace();
  const isNext = nxt && nxt.no === race.no;
  const tab = params.tab || (race.status === 'official' ? 'form' : 'form');
  let timer = null;

  const mtpBox = h('div', { class: 'mtp', 'aria-label': 'Minutes to post' });
  const head = h('div', { class: 'rhead' },
    h('button', { class: 'back', type: 'button', onclick: () => nav.go('card') }, '‹ The card'),
    h('div', {},
      h('div', { class: 'kicker' }, `Race ${race.no} · Post ${clockText(race.post)}`),
      h('h1', { class: 'title' }, raceLabel(race)),
    ),
    mtpBox,
    h('div', { class: 'cond' }, conditions(race)),
  );
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'panel', role: 'tabpanel' });
  // What the bar says is read out when it changes: it's where a pick that hasn't been bought is named.
  const info = h('div', { class: 'info', role: 'status' });
  const bar = h('div', { class: 'post-bar' }, info);
  root.append(head, tabs, panel, bar);

  const TABS = [['form', 'Form'], ['paddock', 'Paddock'], ['forum', 'Forum'], ['bet', 'Bet']];
  let current = tab;
  let stopPanel = null;
  function drawTabs() {
    clear(tabs);
    for (const [k, label] of TABS) {
      const count = k === 'bet' ? myBets(race).length : 0;
      tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === current), onclick: () => { show(k); nav.tab(k); window.scrollTo({ top: 0 }); } }, label, count ? h('span', { class: 'n' }, String(count)) : null));
    }
  }
  function show(which) {
    current = which;
    if (stopPanel) { stopPanel(); stopPanel = null; }
    drawTabs();
    clear(panel);
    if (which === 'form') formPanel(panel, race);
    if (which === 'paddock') stopPanel = paddockPanel(panel, race);
    if (which === 'forum') forumPanel(panel, race);
    if (which === 'bet') betPanel(panel, race, { changed: () => show('bet'), picked: refreshBar, open: isNext });
    refreshBar();
  }

  // The pick on the betting slip, when it's a whole ticket you could buy now for the race that's up. To
  // the gate used to run the race over it without a word, and the slip's own Buy button is often below
  // the bar. So the bar names the pick and its main button buys it, with To the gate beside it; and if To
  // the gate is tapped all the same, the first tap only says what's being left behind.
  const slip = () => (isNext && race.status !== 'official' ? unbought(race) : null);
  let asked = false; // To the gate has been tapped once over a pick that isn't bought
  let notBefore = 0; // a tap on To the gate sooner than this is the second half of a double tap
  function say(text) {
    if (info.textContent === text.map(t => (typeof t === 'string' ? t : t.textContent)).join('')) return;
    clear(info).append(...text);
  }
  function toGate() {
    if (performance.now() < notBefore) return;
    const bet = slip();
    if (bet && !asked) {
      asked = true;
      notBefore = performance.now() + DOUBLE_TAP;
      say([`You picked ${pickShort(race, bet)} for $${betCost(bet)} and haven't bought it. Tap again to go without it.`]);
      return;
    }
    audio.wake(); audio.primeVoice();
    nav.go('watch', { no: race.no });
  }
  function buySlip() {
    const bet = slip();
    if (!bet || !placeBet(race, bet).ok) { refreshBar(); return; }
    audio.ticket();
    clearSlip(race);
    // To the gate takes this button's place: a second tap meant for Buy mustn't start the race.
    notBefore = performance.now() + DOUBLE_TAP;
    if (current === 'bet') { justBought(race); show('bet'); showPrinted(); } else { drawTabs(); refreshBar(); }
  }

  // How tall the bar is just now (it has a second row on a phone while a pick isn't bought), so that
  // whatever is brought into view comes to rest above it and not behind it.
  const measureBar = () => document.documentElement.style.setProperty('--bar', `${bar.offsetHeight}px`);
  function refreshBar() {
    asked = false;
    while (info.nextSibling) info.nextSibling.remove();
    const bets = myBets(race);
    const spent = bets.reduce((a, b) => a + b.cost, 0);
    const bet = slip();
    bar.classList.toggle('pending', !!bet);
    if (bet) {
      say([h('b', {}, pickName(race, bet)), `, $${betCost(bet)}: not bought yet`]);
      bar.append(
        h('button', { class: 'btn ghost', type: 'button', onclick: toGate }, 'To the gate ▸'),
        h('button', { class: 'btn brass', type: 'button', onclick: buySlip }, `Buy ticket · ${money(betCost(bet))}`),
      );
      measureBar();
      return;
    }
    say(bets.length ? [h('b', {}, `${bets.length} ticket${bets.length > 1 ? 's' : ''}`), ` · ${money(spent)} on this race`] : [h('span', { class: 'muted' }, isNext ? 'No tickets yet. You can watch without betting.' : race.status === 'official' ? 'This race is over.' : `Race ${nxt ? nxt.no : ''} is up first.`)]);
    if (race.status === 'official') bar.append(h('button', { class: 'btn', type: 'button', onclick: () => nav.go('result', { no: race.no }) }, 'Results ▸'));
    else if (isNext) bar.append(h('button', { class: 'btn brass', type: 'button', onclick: toGate }, 'To the gate ▸'));
    else bar.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `Race ${nxt.no} first`));
    measureBar();
  }

  // Minutes to post tick down, and the odds move with them.
  let lastMtp = null;
  function tick() {
    const { mtp } = mtpState(race);
    clear(mtpBox);
    if (race.status === 'official') mtpBox.append('OFF', h('small', {}, 'official'));
    else if (!isNext) mtpBox.append(clockText(race.post), h('small', {}, 'post'));
    else mtpBox.append(String(mtp), h('small', {}, 'MTP'));
    if (isNext && lastMtp !== null && mtp !== lastMtp && current === 'bet') updateTote(panel, race);
    lastMtp = mtp;
  }
  tick();
  timer = setInterval(tick, 1000);
  show(current);
  return () => { clearInterval(timer); if (stopPanel) stopPanel(); document.documentElement.style.removeProperty('--bar'); };
}

// Who the race is for, under its name. A stakes isn't by invitation (only an invitational is): it's open to
// any horse whose owner pays the fee to enter. A race for fillies and mares gives their ages too.
export function conditions(race) {
  const C = CLASSES[race.cls];
  const who = race.fm ? 'Fillies and mares, three and up' : 'Three-year-olds and up';
  const what = C.maiden ? `${who}${race.fm ? ',' : ''} that have never won` : race.claim ? `${who}, each for sale for $${race.claim.toLocaleString('en-US')}` : race.cls === 'STK' ? `${who}. A stakes race: owners pay to enter` : `${who}, non-claiming`;
  return `${distanceName(race.distance)} on the ${race.surface} (${race.cond}). ${what}. Purse ${money(race.purse, { cents: false })}.`;
}

// ------------------------------------------------------------------ form

function formPanel(panel, race) {
  const stats = meetStats(game.world);
  const board = currentBoard(race);
  panel.append(h('p', { class: 'note' }, 'Tap a horse for its past performances. Figures are speed figures: higher is faster, adjusted for distance and going.'));
  race.entries.forEach((e, i) => panel.append(entryCard(race, e, i, stats, board)));
}

function entryCard(race, e, i, stats, board) {
  const hs = horseOf(e);
  const { owner, trainer } = ranFor(e); // a horse claimed out of this race ran it for the people who entered it
  const silks = ownerSilks(owner);
  const js = stats.jockeys[e.j], ts = stats.trainers[trainer];
  const figs = hs.pps.slice().reverse().slice(0, 5).map(p => p.fig);
  const best = figs.length ? Math.max(...figs) : null;
  const chips = angles(race, hs, game.world.day);
  const fresh = newcomer(hs); // no race on its card: a first-time starter, or one that has raced elsewhere
  const style = runStyle(hs);
  const more = h('div', { class: 'entry-more', hidden: true });
  const head = h('button', { class: 'entry-head', type: 'button', 'aria-expanded': 'false' },
    cloth(e.pp, 'lg'),
    silksCanvas(silks, 30),
    h('div', { class: 'nm' }, hs.name),
    h('div', { class: 'ml' }, h('small', {}, race.status === 'official' ? 'Final' : 'Odds'), race.status === 'official' ? race.result.oddsText[i] : board.text[i]),
    h('div', { class: 'who' }, `${JOCKEYS[e.j].name} (${js.w}-${js.starts}) · Tr. ${TRAINERS[trainer]} (${ts.w}-${ts.starts}) · ${e.wt} lb · ML ${e.mlText}`),
  );
  head.addEventListener('click', () => {
    const open = more.hidden;
    more.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    if (open && !more.firstChild) fillMore(more, race, e, hs);
  });
  return h('article', { class: 'entry' },
    head,
    h('div', { class: 'figs' },
      fresh ? h('span', { class: 'chip' }, fresh.chip) : figs.map(f => h('span', { class: `fig${f === best ? ' best' : ''}` }, String(f))),
      style ? h('span', { class: 'chip', title: 'Running style' }, styleName(style)) : null,
      chips.map(c => h('span', { class: `chip ${c[1]}` }, c[0])),
    ),
    more,
  );
}

function styleName(s) {
  return { E: 'Needs the lead', 'E/P': 'Close to the pace', P: 'Stalker', S: 'Closer' }[s];
}

function fillMore(more, race, e, hs) {
  const age = ageOf(game.world, hs);
  const sireLink = name => IN_BLOODLINES.has(name)
    ? h('a', { href: `https://junkdrawer.works/bloodlines/#${encodeURIComponent(name)}`, target: '_blank', rel: 'noopener' }, name)
    : name;
  const life = hs.life;
  const turf = hs.pps.filter(p => p.surf === 't');
  more.append(
    h('p', { class: 'pedigree' },
      `${hs.coatShort} ${sexWord(hs.sex, age)}, ${age} · by `, sireLink(hs.sire), ` out of ${hs.dam}, by `, sireLink(hs.damsire), '.',
      h('br'),
      `Owner ${OWNERS[ranFor(e).owner]}. Life: ${plural(life.starts, 'start')}, ${plural(life.w, 'win')}, ${plural(life.p, 'second')}, ${plural(life.s, 'third')}, ${money(life.earn, { cents: false })}.`,
      turf.length ? ` On turf: ${turf.length}-${turf.filter(p => p.fin === 1).length}-${turf.filter(p => p.fin === 2).length}-${turf.filter(p => p.fin === 3).length}.` : '',
    ),
  );
  if (!hs.pps.length) more.append(h('p', { class: 'first-timer' }, newcomer(hs).note));
  else {
    const t = h('table', { class: 'pps' },
      h('thead', {}, h('tr', {}, ['Date', 'Race', 'Class', 'Fig', 'Calls · Fin', 'Odds'].map(x => h('th', {}, x)))),
    );
    const tb = h('tbody');
    for (const p of hs.pps.slice().reverse()) {
      const calls = p.line.slice(0, -1).filter(Boolean);
      const fin = p.line[p.line.length - 1];
      tb.append(
        h('tr', {},
          h('td', {}, shortDate(p.dt), h('br'), h('span', { class: 'muted' }, `Lrk ${COND[p.cond] || p.cond}`)),
          h('td', {}, `${distanceShort(p.f * FURLONG)}${p.surf === 't' ? ' ⓣ' : ''}`, h('br'), h('span', { class: 'muted' }, `${p.fs} ran`)),
          h('td', {}, p.nm ? shortStakes(p.nm) : (p.fm ? 'f-' : '') + shortClass(p.cls)),
          h('td', { class: 'f' }, String(p.fig)),
          // The calls are the one cell that may take a second line, between one call and the next, when
          // the table would otherwise be wider than the card (the cells beside it have two lines already).
          h('td', { class: 'calls' }, calls.map(c => [h('span', {}, supCall(c)), ' ']), h('b', { class: p.fin === 1 ? 'win' : '' }, supCall(fin))),
          h('td', {}, p.odds.toFixed(1)),
        ),
        // The rider is on this line, which wraps, and not under the odds, where a long surname made the
        // narrowest column the widest and pushed the table off the side of a phone.
        h('tr', { class: 'c' }, h('td', { colspan: 6 }, h('div', {},
          h('b', {}, p.cm), ' · ',
          p.fr.slice(0, -1).map(fmtTime).join(' '), ' ', h('b', {}, fmtTime(p.fr[p.fr.length - 1])), ' · ',
          p.top.map((x, k) => `${x[0]}${k < 2 && x[1] ? ' ' + marginShort(x[1]) : ''}`).join(', '),
          ` · ${JOCKEYS[p.j].name.split(' ')[1]} up`,
          p.claimed ? ` · Claimed from ${TRAINERS[p.claimed.from]} for $${p.claimed.price.toLocaleString('en-US')}` : '',
        ))),
      );
    }
    t.append(tb);
    more.append(t);
  }
  if (hs.works.length) {
    // Newest first, by date. They're kept in the order they were made, and a work's date is a few days
    // before that, so two made on the same day (as every horse has from before the meet) can be either
    // way round: one horse in five listed a work from August ahead of one from September.
    const works = hs.works.slice().reverse().sort((a, b) => (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0));
    // A bullet goes in front of the work, where the Form prints it, and the time is given to the fifth.
    more.append(h('p', { class: 'works' }, h('b', {}, 'Works: '), works.map((w, k) => [
      k ? ' · ' : '', w.rank === 1 ? h('b', {}, '●') : null,
      `${shortDate(w.dt).slice(0, -2)} ${w.f}f ${w.surf === 't' ? 'turf' : 'ft'} ${fmtWork(w.t)} ${w.g} `,
      w.rank === 1 ? h('b', {}, `${w.rank}/${w.of}`) : `${w.rank}/${w.of}`,
    ])));
  }
}

function supCall([pos, margin]) {
  return [String(pos), margin > 0.03 ? h('sup', {}, marginShort(margin)) : null];
}
// The Class column's labels, short enough for the table to fit a phone 360 wide: a stakes by four letters
// of each word of its name, without its "and" ("OddsEndsH", which was "OddsandEndsH"; a name of one word
// is kept whole), and a claiming price in thousands ("f-Clm40k", which was "f-Clm40000").
function shortStakes(name) {
  const words = name.replace(/ (Stakes|Handicap|Mile|Sprint)$/, '').split(' ').filter(w => !/^(and|the|of)$/i.test(w));
  return words.map(w => (words.length > 1 ? w.slice(0, 4) : w)).join('') + (/Handicap/.test(name) ? 'H' : 'S');
}
function shortClass(cls) {
  return CLASSES[cls].short.replace(/000$/, 'k');
}

// ------------------------------------------------------------------ paddock

function paddockPanel(panel, race) {
  panel.append(h('p', { class: 'note' }, 'The horses walk the paddock before they go out. How they look can say something about how they feel today.'));
  const grid = h('div', { class: 'paddock' });
  const draws = [];
  race.entries.forEach((e, i) => {
    const hs = horseOf(e);
    const c = h('canvas', { 'aria-hidden': 'true' });
    const offset = (i * 0.37) % 1;
    draws.push({ c, hs, e, offset });
    grid.append(h('div', { class: 'pdk' },
      c,
      h('div', { class: 'row' }, cloth(e.pp, 'sm'), hs.name),
      h('p', { class: e.pdk.kind }, e.pdk.text),
      h('p', { class: 'muted', style: { fontSize: '12.5px' } }, `${JOCKEYS[e.j].name} up`),
    ));
  });
  panel.append(grid);
  let raf = 0;
  const start = performance.now();
  const frame = now => {
    const t = (now - start) / 1000;
    for (const d of draws) {
      const r = d.c.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (d.c.width !== Math.round(r.width * dpr)) { d.c.width = Math.round(r.width * dpr); d.c.height = Math.round(r.height * dpr); }
      const ctx = d.c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, d.c.width, d.c.height);
      // Tanbark underfoot.
      ctx.fillStyle = 'rgba(140,100,60,.22)';
      ctx.fillRect(0, d.c.height * 0.86, d.c.width, d.c.height * 0.14);
      const k = d.c.height / 3.1;
      ctx.translate(d.c.width / 2, d.c.height * 0.9);
      ctx.scale(k, -k);
      const nervy = d.e.pdk.kind === 'poor' && /Fractious|edge/.test(d.e.pdk.text);
      drawHorse(ctx, { phase: (t * (nervy ? 1.3 : 0.9) + d.offset) % 1, gait: 'walk', coat: d.hs.coat, marks: d.hs.marks, number: d.e.pp, silks: ownerSilks(ranFor(d.e).owner), noRider: true });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// ------------------------------------------------------------------ forum

function forumPanel(panel, race) {
  const posts = forumFor(race);
  const rec = game.world.tipsters || {};
  panel.append(h('div', { class: 'thread-title' }, `Race ${race.no}: who do you like?`));
  const tip = id => TIPSTERS.find(t => t.id === id);
  const recText = id => {
    const r = rec[id];
    if (!r || !r.picks) return 'new here';
    return `${r.wins} for ${r.picks} · $2 returns ${money(r.back / r.picks)}`;
  };
  const post = (p, after) => {
    const t = tip(p.who);
    return h('div', { class: `post${after ? ' after' : ''}${p.won ? ' won' : ''}` },
      h('div', { class: 'avatar', style: { background: t.color } }, t.handle[0]),
      h('div', {},
        h('div', { class: 'meta' }, h('span', { class: 'handle' }, t.handle), h('span', {}, after ? 'after the race' : ago(p.mins)), h('span', {}, recText(p.who))),
        h('p', {}, p.text),
        !after && p.pick && p.pick.length ? h('div', { class: 'picks' }, 'Picks', p.pick.map(i => cloth(race.entries[i].pp, 'sm'))) : null,
      ),
    );
  };
  for (const p of posts) panel.append(post(p, false));
  if (race.forumAfter) for (const p of race.forumAfter) panel.append(post(p, true));
  panel.append(h('p', { class: 'note' }, 'Records run from ten weeks before the meet opened: how many of their top picks won, and what a $2 win bet on each pick would have paid back on average. Anything under $2.00 is losing money.'));
}

// ------------------------------------------------------------------ betting

const HELP = {
  win: 'Win: your horse has to finish first.',
  place: 'Place: first or second. Pays less than win.',
  show: 'Show: first, second or third. The safest bet and the smallest payout.',
  wps: 'Across the board: a win, a place and a show bet on one horse. Three tickets in one.',
  exacta: 'Exacta: the first two finishers, in order.',
  exbox: 'Exacta box: pick two or more; any two of them finishing first and second, in either order. One bet per order.',
  trifecta: 'Trifecta: the first three, in order. Hard to hit, and it pays like it.',
  tribox: 'Trifecta box: pick three or more; any three of them in the top three, in any order.',
};

const state = new Map(); // per race: builder choices survive switching tabs
const slipFor = race => {
  const k = memoKey(race);
  if (!state.has(k)) state.set(k, { type: 'win', picks: [[], [], []], amt: 2 });
  return state.get(k);
};
function clearSlip(race) { slipFor(race).picks = [[], [], []]; }
// The ticket the slip would buy, if it's whole and there's the money for it.
function unbought(race) {
  const bet = currentBet(slipFor(race), race.entries.length);
  return bet && betCost(bet) <= game.player.bank + 1e-9 ? bet : null;
}
// A second tap sooner than this after a first is a double tap, not a second answer.
const DOUBLE_TAP = 700; // ms

// A pick in words. On the slip: "$10 to win on #3 Early Ticket", "$2 exacta box 3, 5, 7". In the bar,
// by name ("#3 Early Ticket to win"), and in a sentence after "You picked" ("#3 to win").
const TO = { win: 'to win', place: 'to place', show: 'to show', wps: 'across the board' };
const numbers = (race, bet) => bet.sel.map(i => race.entries[i].pp).join(bet.type.endsWith('box') ? ', ' : '-');
const named = (race, bet) => { const e = race.entries[bet.sel[0]]; return `#${e.pp} ${horseOf(e).name}`; };
function pickLine(race, bet) {
  return TO[bet.type] ? `$${bet.amt} ${TO[bet.type]} on ${named(race, bet)}` : `$${bet.amt} ${BET_NAMES[bet.type].toLowerCase()} ${numbers(race, bet)}`;
}
function pickName(race, bet) {
  return TO[bet.type] ? `${named(race, bet)} ${TO[bet.type]}` : `${BET_NAMES[bet.type]} ${numbers(race, bet)}`;
}
function pickShort(race, bet) {
  if (TO[bet.type]) return `#${race.entries[bet.sel[0]].pp} ${TO[bet.type]}`;
  const name = BET_NAMES[bet.type].toLowerCase();
  return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name} (${numbers(race, bet)})`;
}
// The ticket just bought prints out under the others, and the page moves to show it. (It used to print
// behind the bar at the bottom: the page was moved a moment into the half second the ticket takes to slide
// out, so it aimed short, and only as far as the bottom of the screen, which the bar covers. A ticket keeps
// the bar's height clear below it now, in the stylesheet.) The move is aimed at where the ticket will lie
// once it's out, and the ticket prints as the page gets there.
let printing = null; // the ticket just bought, until the list it's in is drawn
function justBought(race) { printing = { race: memoKey(race), i: myBets(race).length - 1 }; }
function showPrinted() {
  const t = document.querySelector('.ticket.printed');
  if (!t) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  t.style.animation = 'none';
  t.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  t.style.animation = '';
}

// Said under the board and in How to play: a ticket isn't paid at the price it was bought at.
export const MOVING = 'Odds keep moving until the gate opens. Every ticket is paid at the final odds, whatever the board said when you bought it.';

function betPanel(panel, race, { changed, picked, open: isNext }) {
  const st = slipFor(race);
  const open = isNext && race.status !== 'official';

  panel.append(toteBoard(race));
  if (race.status === 'official') {
    panel.append(h('p', { class: 'note' }, 'Betting is closed. See the results for what paid.'));
    panel.append(ticketList(race, false, changed));
    return;
  }
  // A later race opens for betting when the one before it is over (which isn't always the one that's up).
  panel.append(h('p', { class: 'note' }, open ? MOVING : `You can bet this race once race ${race.no - 1} is over. The odds will have moved by then.`));

  const builder = h('div', { class: 'builder' });
  panel.append(builder);
  panel.append(ticketList(race, open, changed));
  const draw = () => {
    clear(builder);
    const types = h('div', { class: 'seg', role: 'group', 'aria-label': 'Bet type' });
    for (const t of ['win', 'place', 'show', 'wps', 'exacta', 'exbox', 'trifecta', 'tribox']) {
      types.append(h('button', { type: 'button', 'aria-pressed': String(st.type === t), onclick: () => { st.type = t; st.picks = [[], [], []]; if (st.amt < BASE[legType(t)]) st.amt = BASE[legType(t)]; draw(); } }, BET_NAMES[t]));
    }
    builder.append(types, h('p', { class: 'bet-help' }, HELP[st.type]));
    const rows = st.type === 'exacta' ? ['1st', '2nd'] : st.type === 'trifecta' ? ['1st', '2nd', '3rd'] : [st.type.endsWith('box') ? 'Pick' : 'Horse'];
    const multi = st.type.endsWith('box');
    rows.forEach((label, r) => {
      const grid = h('div', { class: 'picks-grid' });
      race.entries.forEach((e, i) => {
        const [bg, fg] = CLOTH[e.pp] || CLOTH[1];
        const on = st.picks[r].includes(i);
        grid.append(h('button', {
          type: 'button', 'aria-pressed': String(on), 'aria-label': `${e.pp} ${horseOf(e).name}`, style: { backgroundColor: bg, color: fg },
          onclick: () => {
            if (multi) st.picks[r] = on ? st.picks[r].filter(x => x !== i) : [...st.picks[r], i];
            else {
              st.picks[r] = on ? [] : [i];
              // The same horse can't finish in two places.
              if (!on) st.picks.forEach((p, rr) => { if (rr !== r) st.picks[rr] = p.filter(x => x !== i); });
            }
            draw();
          },
        }, h('span', {}, String(e.pp)))); // the number, on a patch of the cloth at full strength
      });
      builder.append(h('div', { class: 'pick-row' }, h('span', { class: 'lbl' }, label), grid));
    });
    const amts = h('div', { class: 'seg amounts', role: 'group', 'aria-label': 'Amount' });
    for (const a of [1, 2, 5, 10, 20, 50, 100]) {
      if (a < BASE[legType(st.type)]) continue;
      amts.append(h('button', { type: 'button', 'aria-pressed': String(st.amt === a), onclick: () => { st.amt = a; draw(); } }, `$${a}`));
    }
    builder.append(amts);
    const bet = currentBet(st, race.entries.length);
    const c = bet ? betCost(bet) : 0;
    const msg = h('div', { class: 'cost' });
    // The pick in words, so the number can be checked against the name without going back to the form;
    // what it costs when that's more than one bet; and what there is to spend.
    if (bet) msg.append(h('b', {}, pickLine(race, bet)), c > st.amt ? h('span', { class: 'money' }, ` · ${money(c)} (${c / st.amt} bets of $${st.amt})`) : '', h('span', { class: 'muted' }, ` · you have ${money(game.player.bank)}`));
    else msg.append(h('span', { class: 'muted' }, needs(st)));
    // With no money for a ticket and none bought, the way to the ATM is here, where the cost would be.
    const broke = open ? atmLine(changed) : null;
    const buy = h('button', {
      class: 'btn', type: 'button', disabled: !bet || !open || c > game.player.bank + 1e-9 ? true : null,
      onclick: () => {
        const res = placeBet(race, bet);
        if (!res.ok) { msg.textContent = res.why; return; }
        audio.ticket();
        clearSlip(race);
        justBought(race);
        changed();
        showPrinted();
      },
    }, 'Buy ticket');
    builder.append(h('div', { class: 'bet-foot' }, broke || msg, buy));
    picked(); // the bar at the bottom follows the slip
  };
  draw();
}

function legType(t) { return t === 'trifecta' || t === 'tribox' ? 'trifecta' : t === 'exacta' || t === 'exbox' ? 'exacta' : 'win'; }

function currentBet(st, runners) {
  const p = st.picks.map(row => row.filter(i => i < runners));
  if (['win', 'place', 'show', 'wps'].includes(st.type)) return p[0].length === 1 ? { type: st.type, sel: [p[0][0]], amt: st.amt } : null;
  if (st.type === 'exacta') return p[0].length && p[1].length ? { type: 'exacta', sel: [p[0][0], p[1][0]], amt: st.amt } : null;
  if (st.type === 'trifecta') return p[0].length && p[1].length && p[2].length ? { type: 'trifecta', sel: [p[0][0], p[1][0], p[2][0]], amt: st.amt } : null;
  if (st.type === 'exbox') return p[0].length >= 2 ? { type: 'exbox', sel: p[0].slice(), amt: st.amt } : null;
  if (st.type === 'tribox') return p[0].length >= 3 ? { type: 'tribox', sel: p[0].slice(), amt: st.amt } : null;
  return null;
}
function needs(st) {
  if (st.type === 'exacta') return 'Pick a first and a second.';
  if (st.type === 'trifecta') return 'Pick a first, second and third.';
  if (st.type === 'exbox') return 'Pick at least two.';
  if (st.type === 'tribox') return 'Pick at least three.';
  return 'Pick a horse.';
}

function toteBoard(race) {
  const b = currentBoard(race);
  const { mtp } = mtpState(race);
  const final = race.status === 'official';
  const odds = final ? race.result.oddsText : b.text;
  const vals = final ? race.result.odds : b.odds;
  const fav = vals.indexOf(Math.min(...vals));
  const grid = h('div', { class: 'tote-grid' });
  race.entries.forEach((e, i) => {
    grid.append(h('div', { class: `tote-cell${i === fav ? ' fav' : ''}`, data: { i } },
      cloth(e.pp, 'sm'),
      h('div', { class: 'odds' }, odds[i]),
      h('div', { class: 'pay' }, '$2 pays ', h('span', {}, `~$${twoPays(vals[i])}`)),
    ));
  });
  const live = nextRace() === race; // a later race shows its opening odds until it's up
  return h('div', { class: 'tote', id: 'tote' },
    h('div', { class: 'tote-top' }, h('span', {}, final ? 'Final odds' : live ? `Odds · ${mtp} min to post` : 'Opening odds'), h('span', {}, `Win pool ${money(b.pools.win, { cents: false })}`)),
    grid,
  );
}

// About what a $2 win ticket pays at these odds, worked out the way the payouts are: per dollar, rounded
// down to the dime, and never less than $2.10. To the dime under $10, where a dollar either way is most of
// the profit ("1-5" on the board is anything from $2.40 to $2.70), and to the dollar above.
function twoPays(odds) {
  const pay = Math.max(2.1, Math.floor((odds + 1) * 10 + 1e-9) / 10 * 2);
  return pay < 9.995 ? pay.toFixed(2) : String(Math.round(pay));
}

function updateTote(panel, race) {
  const old = panel.querySelector('#tote');
  if (!old) return;
  const before = [...old.querySelectorAll('.odds')].map(x => x.textContent);
  const fresh = toteBoard(race);
  [...fresh.querySelectorAll('.odds')].forEach((x, i) => { if (x.textContent !== before[i]) x.classList.add('flash'); });
  old.replaceWith(fresh);
}

function ticketList(race, open, changed) {
  const wrap = h('div', { class: 'tickets' });
  const bets = myBets(race);
  const settled = game.player.settled[raceKey(race)];
  // Only the ticket just bought prints out. (The last one in the list used to, every time the list was
  // drawn: when the Bet tab was opened, and when another ticket was cancelled.)
  const fresh = printing && printing.race === memoKey(race) ? printing.i : -1;
  printing = null;
  bets.forEach((b, i) => {
    const sel = b.sel.map(x => race.entries[x].pp);
    const label = b.type === 'exacta' || b.type === 'trifecta' ? sel.join('-') : b.type.endsWith('box') ? sel.join(', ') : sel[0];
    const back = settled ? settled.returns[i] : null;
    wrap.append(h('div', { class: `ticket${i === fresh ? ' printed' : ''}${back > 0 ? ' cashed' : back === 0 ? ' lost' : ''}` },
      h('div', {},
        h('div', { class: 'what' }, `$${b.amt} ${BET_NAMES[b.type].toUpperCase()} ${label}`),
        h('div', { class: 'small' }, `LRK R${race.no} · ${sel.map(n => horseOf(race.entries.find(e => e.pp === n)).name).join(' / ')} · COST ${money(b.cost)}`),
      ),
      back > 0 ? h('span', { class: 'stamp' }, `PAID ${money(back)}`) : back === 0 ? h('span', { class: 'small torn' }, 'torn up') : open ? h('button', { type: 'button', onclick: () => { cancelBet(race, i); changed(); } }, 'Cancel') : null,
    ));
  });
  return wrap;
}

export { runnersFor };
