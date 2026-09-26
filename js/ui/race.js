// A race before it runs: the past performances, the paddock, the forum and the betting window.

import { h, money, cloth, silksCanvas, clear, ago, plural } from './dom.js';
import { game, card, raceKey, horseOf, nextRace, raceLabel, myBets, placeBet, cancelBet, currentBoard, mtpState, forumFor, runnersFor } from '../game.js';
import { ownerSilks, ageOf, shortDate, clockText, CLASSES, meetStats } from '../world.js';
import { distanceName, distanceShort, FURLONG } from '../track.js';
import { JOCKEYS, TRAINERS, OWNERS, TIPSTERS, IN_BLOODLINES, SIRES } from '../data.js';
import { callText, marginShort, fmtTime } from '../chart.js';
import { runStyle } from '../forum.js';
import { BET_NAMES, cost as betCost, BASE } from '../tote.js';
import { drawHorse } from '../draw/horse.js';
import { oddsText } from '../handicap.js';
import * as audio from '../audio.js';

const COND = { fast: 'ft', good: 'gd', sloppy: 'sly', muddy: 'my', firm: 'fm', yielding: 'yl', soft: 'sf' };
const SEX = { c: 'colt', f: 'filly', g: 'gelding', h: 'horse', m: 'mare' };

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
  const bar = h('div', { class: 'post-bar' });
  root.append(head, tabs, panel, bar);

  const TABS = [['form', 'Form'], ['paddock', 'Paddock'], ['forum', 'Forum'], ['bet', 'Bet']];
  let current = tab;
  let stopPanel = null;
  function show(which) {
    current = which;
    if (stopPanel) { stopPanel(); stopPanel = null; }
    clear(tabs);
    for (const [k, label] of TABS) {
      const count = k === 'bet' ? myBets(race).length : 0;
      tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === which), onclick: () => { show(k); window.scrollTo({ top: 0 }); } }, label, count ? h('span', { class: 'n' }, String(count)) : null));
    }
    clear(panel);
    if (which === 'form') formPanel(panel, race);
    if (which === 'paddock') stopPanel = paddockPanel(panel, race);
    if (which === 'forum') forumPanel(panel, race);
    if (which === 'bet') betPanel(panel, race, () => { refreshBar(); show('bet'); }, isNext);
    refreshBar();
  }

  function refreshBar() {
    clear(bar);
    const bets = myBets(race);
    const spent = bets.reduce((a, b) => a + b.cost, 0);
    bar.append(h('div', { class: 'info' },
      bets.length ? [h('b', {}, `${bets.length} ticket${bets.length > 1 ? 's' : ''}`), ` · ${money(spent)} on this race`] : h('span', { class: 'muted' }, isNext ? 'No tickets yet. You can watch without betting.' : race.status === 'official' ? 'This race is over.' : `Race ${race.no} goes after race ${nxt ? nxt.no : ''}.`),
    ));
    if (race.status === 'official') bar.append(h('button', { class: 'btn', type: 'button', onclick: () => nav.go('result', { no: race.no }) }, 'Results ▸'));
    else if (isNext) bar.append(h('button', { class: 'btn brass', type: 'button', onclick: () => { audio.wake(); nav.go('watch', { no: race.no }); } }, 'To the gate ▸'));
    else bar.append(h('button', { class: 'btn ghost', type: 'button', onclick: () => nav.go('race', { no: nxt.no }) }, `Race ${nxt.no} first`));
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
  return () => { clearInterval(timer); if (stopPanel) stopPanel(); };
}

export function conditions(race) {
  const C = CLASSES[race.cls];
  const who = race.fm ? 'Fillies and mares' : 'Three-year-olds and up';
  const what = C.maiden ? `${who} that have never won` : race.claim ? `${who}, each for sale for $${race.claim.toLocaleString('en-US')}` : race.cls === 'STK' ? `${who}, by invitation` : `${who}, non-claiming`;
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
  const silks = ownerSilks(hs.owner);
  const js = stats.jockeys[e.j], ts = stats.trainers[hs.trainer];
  const figs = hs.pps.slice().reverse().slice(0, 5).map(p => p.fig);
  const best = figs.length ? Math.max(...figs) : null;
  const chips = angles(race, hs);
  const style = runStyle(hs);
  const more = h('div', { class: 'entry-more', hidden: true });
  const head = h('button', { class: 'entry-head', type: 'button', 'aria-expanded': 'false' },
    cloth(e.pp, 'lg'),
    silksCanvas(silks, 30),
    h('div', { class: 'nm' }, hs.name),
    h('div', { class: 'ml' }, h('small', {}, race.status === 'official' ? 'Final' : 'Odds'), race.status === 'official' ? race.result.oddsText[i] : board.text[i]),
    h('div', { class: 'who' }, `${JOCKEYS[e.j].name} (${js.w}-${js.starts}) · Tr. ${TRAINERS[hs.trainer]} (${ts.w}-${ts.starts}) · ${e.wt} lb · ML ${e.mlText}`),
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
      figs.length ? figs.map(f => h('span', { class: `fig${f === best ? ' best' : ''}` }, String(f))) : h('span', { class: 'chip' }, 'First-time starter'),
      style ? h('span', { class: 'chip', title: 'Running style' }, styleName(style)) : null,
      chips.map(c => h('span', { class: `chip ${c[1]}` }, c[0])),
    ),
    more,
  );
}

function styleName(s) {
  return { E: 'Needs the lead', 'E/P': 'Close to the pace', P: 'Stalker', S: 'Closer' }[s];
}

// Angles a handicapper would notice.
function angles(race, hs) {
  const out = [];
  const last = hs.pps[hs.pps.length - 1];
  if (race.surface === 'turf' && hs.pps.length && !hs.pps.some(p => p.surf === 't')) out.push(['First time on turf', '']);
  if (race.surface === 'dirt' && hs.pps.length && hs.pps.every(p => p.surf === 't')) out.push(['Turf horse on dirt', '']);
  const f = race.distance / FURLONG;
  if (hs.pps.length && f >= 8 && hs.pps.every(p => p.f < 8)) out.push(['First time going long', '']);
  if (hs.pps.length && f < 8 && hs.pps.every(p => p.f >= 8)) out.push(['Cutting back to a sprint', '']);
  if (last && last.claimed) out.push(['New barn: claimed last out', 'good']);
  if (last && race.claim && last.clm && race.claim < last.clm) out.push([`Drops from $${last.clm / 1000}k`, 'good']);
  if (last && race.claim && last.clm && race.claim > last.clm) out.push([`Up from $${last.clm / 1000}k`, '']);
  if (last && !last.clm && race.claim && last.cls !== 'MCL') out.push(['Drops into a claimer', 'good']);
  if (hs.works.some(w => w.rank === 1)) out.push(['Bullet work', 'good']);
  if (last && game.world.day - last.d >= 5) out.push([`Back from ${game.world.day - last.d} weeks off`, '']);
  if (last && /Blocked|Checked|Stumbled|Broke slowly|Bumped/.test(last.cm)) out.push(['Troubled trip last time', 'good']);
  if (['sloppy', 'muddy', 'yielding', 'soft'].includes(race.cond)) {
    const wet = hs.pps.filter(p => ['sloppy', 'muddy', 'yielding', 'soft'].includes(p.cond));
    if (wet.length && wet.some(p => p.fin <= 2)) out.push(['Has run well on a wet track', 'good']);
  }
  return out;
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
      `${hs.coatShort} ${SEX[hs.sex]}, ${age} · by `, sireLink(hs.sire), ` out of ${hs.dam}, by `, sireLink(hs.damsire), '.',
      h('br'),
      `Owner ${OWNERS[hs.owner]}. Life: ${plural(life.starts, 'start')}, ${plural(life.w, 'win')}, ${plural(life.p, 'second')}, ${plural(life.s, 'third')}, ${money(life.earn, { cents: false })}.`,
      turf.length ? ` On turf: ${turf.length}-${turf.filter(p => p.fin === 1).length}-${turf.filter(p => p.fin === 2).length}-${turf.filter(p => p.fin === 3).length}.` : '',
    ),
  );
  if (!hs.pps.length) more.append(h('p', { class: 'first-timer' }, 'Has not raced yet. The workouts are all there is to go on.'));
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
          h('td', {}, p.nm ? shortStakes(p.nm) : (p.fm ? 'f-' : '') + CLASSES[p.cls].short),
          h('td', { class: 'f' }, String(p.fig)),
          h('td', {}, calls.map(c => [supCall(c), ' ']), h('b', { class: p.fin === 1 ? 'win' : '' }, supCall(fin))),
          h('td', {}, p.odds.toFixed(1), h('br'), h('span', { class: 'muted' }, JOCKEYS[p.j].name.split(' ')[1])),
        ),
        h('tr', { class: 'c' }, h('td', { colspan: 6 },
          h('b', {}, p.cm), ' · ',
          p.fr.slice(0, -1).map(fmtTime).join(' '), ' ', h('b', {}, fmtTime(p.fr[p.fr.length - 1])), ' · ',
          p.top.map((x, k) => `${x[0]}${k < 2 && x[1] ? ' ' + marginShort(x[1]) : ''}`).join(', '),
          p.claimed ? ` · Claimed from ${TRAINERS[p.claimed.from]} for $${p.claimed.price.toLocaleString('en-US')}` : '',
        )),
      );
    }
    t.append(tb);
    more.append(t);
  }
  if (hs.works.length) {
    more.append(h('p', { class: 'works' }, h('b', {}, 'Works: '), hs.works.slice().reverse().map((w, k) => [
      k ? ' · ' : '', `${shortDate(w.dt).slice(0, -2)} ${w.f}f ${w.surf === 't' ? 'turf' : 'ft'} ${fmtWork(w.t)} ${w.g} `,
      w.rank === 1 ? h('b', {}, `${w.rank}/${w.of} ●`) : `${w.rank}/${w.of}`,
    ])));
  }
}

function supCall([pos, margin]) {
  return [String(pos), margin > 0.03 ? h('sup', {}, marginShort(margin)) : null];
}
function fmtWork(t) {
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(1).padStart(4, '0');
  return m ? `${m}:${s}` : `:${s}`;
}
function shortStakes(name) {
  return name.replace(/ (Stakes|Handicap|Mile|Sprint)$/, '').split(' ').map(w => w.slice(0, 5)).join('') + (/Handicap/.test(name) ? 'H' : 'S');
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
      drawHorse(ctx, { phase: (t * (nervy ? 1.3 : 0.9) + d.offset) % 1, gait: 'walk', coat: d.hs.coat, marks: d.hs.marks, number: d.e.pp, silks: ownerSilks(d.hs.owner), noRider: true });
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
  panel.append(h('p', { class: 'note' }, 'Records are this meet: how many of their top picks won, and what a $2 win bet on each pick would have paid back on average. Anything under $2.00 is losing money.'));
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

function betPanel(panel, race, changed, isNext) {
  const k = raceKey(race);
  const st = state.get(k) || { type: 'win', picks: [[], [], []], amt: 2 };
  state.set(k, st);
  const open = isNext && race.status !== 'official';

  panel.append(toteBoard(race));
  if (race.status === 'official') {
    panel.append(h('p', { class: 'note' }, 'Betting is closed. See the results for what paid.'));
    panel.append(ticketList(race, false, changed));
    return;
  }
  if (!open) panel.append(h('p', { class: 'note' }, `You can bet this race once race ${nextRace().no} is over. The odds will have moved by then.`));

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
        const [bg, fg] = clothColors(e.pp);
        const on = st.picks[r].includes(i);
        grid.append(h('button', {
          type: 'button', 'aria-pressed': String(on), 'aria-label': `${e.pp} ${horseOf(e).name}`, style: { background: bg, color: fg },
          onclick: () => {
            if (multi) st.picks[r] = on ? st.picks[r].filter(x => x !== i) : [...st.picks[r], i];
            else {
              st.picks[r] = on ? [] : [i];
              // The same horse can't finish in two places.
              if (!on) st.picks.forEach((p, rr) => { if (rr !== r) st.picks[rr] = p.filter(x => x !== i); });
            }
            draw();
          },
        }, String(e.pp)));
      });
      builder.append(h('div', { class: 'pick-row' }, h('span', { class: 'lbl' }, label), grid));
    });
    const amts = h('div', { class: 'seg amounts', role: 'group', 'aria-label': 'Amount' });
    for (const a of [1, 2, 5, 10, 20, 50, 100]) {
      if (a < BASE[legType(st.type)]) continue;
      amts.append(h('button', { type: 'button', 'aria-pressed': String(st.amt === a), onclick: () => { st.amt = a; draw(); } }, `$${a}`));
    }
    builder.append(amts);
    const bet = currentBet(st);
    const c = bet ? betCost(bet) : 0;
    const msg = h('div', { class: 'cost' });
    if (bet) msg.append(h('b', { class: 'money' }, money(c)), c > st.amt ? h('span', { class: 'muted' }, ` (${c / st.amt} bets of $${st.amt})`) : null, h('span', { class: 'muted' }, ` · you have ${money(game.player.bank)}`));
    else msg.append(h('span', { class: 'muted' }, needs(st)));
    const buy = h('button', {
      class: 'btn', type: 'button', disabled: !bet || !open || c > game.player.bank + 1e-9 ? true : null,
      onclick: () => {
        const res = placeBet(race, bet);
        if (!res.ok) { msg.textContent = res.why; return; }
        audio.ticket();
        st.picks = [[], [], []];
        state.set(k, st);
        changed();
        setTimeout(() => document.querySelector('.ticket.printed')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
      },
    }, 'Buy ticket');
    builder.append(h('div', { class: 'bet-foot' }, msg, buy));
  };
  draw();
}

function legType(t) { return t === 'trifecta' || t === 'tribox' ? 'trifecta' : t === 'exacta' || t === 'exbox' ? 'exacta' : 'win'; }

function currentBet(st) {
  const p = st.picks;
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

function clothColors(n) {
  const c = { 1: ['#d62828', '#fff'], 2: ['#f4f4f0', '#111'], 3: ['#1f4fd1', '#fff'], 4: ['#f5d400', '#111'], 5: ['#1e8a3a', '#fff'], 6: ['#111', '#f5d400'], 7: ['#f27b1a', '#111'], 8: ['#f59ac5', '#111'], 9: ['#35c9c9', '#111'], 10: ['#6a2ea0', '#fff'], 11: ['#9a9a9a', '#d62828'], 12: ['#9bd13a', '#111'] };
  return c[n] || c[1];
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
      h('div', { class: 'pay' }, `pays ~$${Math.max(2.2, Math.floor((vals[i] + 1) * 20) / 10).toFixed(0)}`),
    ));
  });
  return h('div', { class: 'tote', id: 'tote' },
    h('div', { class: 'tote-top' }, h('span', {}, final ? 'Final odds' : `Odds · ${mtp} min to post`), h('span', {}, `Win pool ${money(b.pools.win, { cents: false })}`)),
    grid,
  );
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
  bets.forEach((b, i) => {
    const sel = b.sel.map(x => race.entries[x].pp);
    const label = b.type === 'exacta' || b.type === 'trifecta' ? sel.join('-') : b.type.endsWith('box') ? sel.join(', ') : sel[0];
    const back = settled ? settled.returns[i] : null;
    wrap.append(h('div', { class: `ticket${i === bets.length - 1 && !settled ? ' printed' : ''}${back > 0 ? ' cashed' : back === 0 ? ' lost' : ''}` },
      h('div', {},
        h('div', { class: 'what' }, `$${b.amt} ${BET_NAMES[b.type].toUpperCase()} ${label}`),
        h('div', { class: 'small' }, `LRK R${race.no} · ${sel.map(n => horseOf(race.entries.find(e => e.pp === n)).name).join(' / ')} · COST ${money(b.cost)}`),
      ),
      back > 0 ? h('span', { class: 'stamp' }, `PAID ${money(back)}`) : back === 0 ? h('span', { class: 'small' }, 'no luck') : open ? h('button', { type: 'button', onclick: () => { cancelBet(race, i); changed(); } }, 'Cancel') : null,
    ));
  });
  return wrap;
}

export { runnersFor };
