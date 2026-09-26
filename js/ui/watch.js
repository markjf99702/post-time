// Watching the race: the broadcast view, the running order with margins, fractions on the clock,
// the caller, and at the end the photo sign or the official sign.

import { h, clear, cloth } from './dom.js';
import { RaceScene } from '../draw/scene.js';
import { photoFinish } from '../draw/photo.js';
import { stateAt } from '../sim.js';
import { LENGTH, FURLONG } from '../track.js';
import { marginShort, fmtTime } from '../chart.js';
import { game, goToGate, callFor, runnersFor, raceLabel, horseOf, myBets } from '../game.js';
import { BET_NAMES } from '../tote.js';
import { clockText } from '../world.js';
import * as audio from '../audio.js';

export function renderWatch(el, nav, params) {
  const race = game.world.cards[game.world.day].races.find(r => r.no === params.no);
  const result = goToGate(race);
  const run = result.run;
  const runners = runnersFor(race);
  const call = callFor(race, run);
  const t0 = run.t0;
  const endT = run.frames.length * run.dt;
  const winT = t0 + run.results[0].time;
  const close = run.results[1] && run.results[1].toPrev < 0.6;

  clear(el);
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  const clock = h('div', { class: 'clock' }, '');
  const frs = h('div', { class: 'fr' }, '');
  const canvas = h('canvas', { class: 'scene', 'aria-label': `Race ${race.no}, running now. The race call below describes it.` });
  const mapC = h('canvas', { width: 220, height: 108, 'aria-hidden': 'true' });
  const stage = h('div', { class: 'w-stage' }, canvas, h('div', { class: 'w-map' }, mapC));
  const order = h('div', { class: 'order', 'aria-label': 'Running order' });
  const prev = h('div', { class: 'prev' });
  const now = h('div', { class: 'now', 'aria-live': 'polite' });
  const callBox = h('div', { class: 'call' }, prev, now);
  const mineList = myTickets(race);
  const speedBtns = [1, 2, 4].map(s => h('button', { type: 'button', 'aria-pressed': String(s === 1), onclick: () => setSpeed(s) }, `${s}×`));
  const soundBtn = h('button', { type: 'button', 'aria-pressed': String(game.player.settings.sound), onclick: () => {
    game.player.settings.sound = !game.player.settings.sound;
    audio.setSound(game.player.settings.sound);
    soundBtn.setAttribute('aria-pressed', String(game.player.settings.sound));
    if (game.player.settings.sound && T > 0 && T < endT) audio.startRace();
  } }, 'Sound');
  const skipBtn = h('button', { type: 'button', onclick: skip }, 'Skip ▸▸');
  const doneBtn = h('button', { class: 'btn brass', type: 'button', hidden: true, onclick: () => leave('result') }, 'Results ▸');
  const hint = h('div', { class: 'hint' }, 'Tap a number in the running order to follow that horse. Tap it again to follow the leaders.');
  const ctl = h('div', { class: 'w-ctl' }, ...speedBtns, soundBtn, skipBtn, h('span', { class: 'spacer' }), doneBtn, hint);
  el.append(
    h('div', { class: 'w-top' },
      h('span', {}, `Race ${race.no}`),
      h('span', { class: 'fr' }, raceLabel(race)),
      clock,
    ),
    stage,
    h('div', { class: 'w-top', style: { paddingTop: '2px', paddingBottom: '2px' } }, frs),
    order,
    callBox,
    mineList,
    ctl,
  );

  const scene = new RaceScene(canvas, { race, run, runners, wx: game.world.cards[game.world.day].wx });
  const onResize = () => scene.resize();
  window.addEventListener('resize', onResize);
  let T = -5.2;            // sim time; negative is the wait in the gate
  let speed = 1;
  let last = performance.now();
  let raf = 0;
  let shown = -1;
  let rung = false, cheered = false, ended = false, photoShown = false;
  let orderAt = -1;
  let following = null;
  if (game.player.settings.sound) audio.bugle();

  function setSpeed(s) {
    speed = s;
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([1, 2, 4][i] === s)));
    if (s > 1) audio.hush();
  }
  function skip() {
    audio.hush();
    if (T < winT - 12) { T = winT - 12; scene.lastT = null; }
    else { T = endT; scene.lastT = null; }
  }

  function frame(tNow) {
    const realDt = Math.min(0.1, (tNow - last) / 1000);
    last = tNow;
    // A close finish goes into slow motion for the last couple of seconds.
    const slow = close && speed === 1 && T > winT - 2.2 && T < winT + 0.6 ? 0.4 : 1;
    if (!ended) T = Math.min(endT, T + realDt * speed * slow);
    const clockT = T - t0;

    if (!rung && T >= 0) {
      rung = true;
      if (game.player.settings.sound) { audio.bell(); audio.startRace(); }
    }
    scene.draw(Math.max(0, T));
    scene.drawMap(mapC.getContext('2d'), 220, 108, Math.max(0, T));

    // Clock and fractions.
    clock.textContent = T < 0 ? clockText(race.post) : clockT < 0 ? '0:00.0' : fmtClock(Math.min(clockT, run.results[0].time));
    const fr = run.fractions.filter(f => f.t <= clockT);
    frs.textContent = fr.length ? fr.map((f, i) => `${i === fr.length - 1 && f.at >= race.distance - 1 ? 'Final' : fracName(f.at)} ${fmtTime(f.t)}`).join('   ') : `${race.entries.length} runners · ${race.surface} · ${race.cond}`;

    // The call.
    let idx = -1;
    for (let i = 0; i < call.lines.length; i++) if (call.lines[i].t <= clockT) idx = i;
    if (idx !== shown && idx >= 0) {
      shown = idx;
      prev.textContent = idx > 0 ? call.lines[idx - 1].text : '';
      now.textContent = call.lines[idx].text;
      now.style.animation = 'none'; void now.offsetWidth; now.style.animation = '';
      if (speed === 1) audio.say(call.lines[idx].text);
    }

    // Running order, a few times a second.
    if (Math.floor(T * 4) !== orderAt) {
      orderAt = Math.floor(T * 4);
      drawOrder(Math.max(0, T));
    }

    // Crowd noise follows the race.
    if (T > 0 && !ended) {
      const st = stateAt(run, T, []);
      const lead = Math.max(...st.map(s => s.p));
      const toGo = race.distance - lead;
      const excite = toGo > 600 ? 0.15 : toGo > 0 ? 0.15 + 0.85 * (1 - toGo / 600) : 0.4;
      audio.raceLevel(excite, T < winT + 2 ? 0.6 : 0.2);
    }
    if (!cheered && T >= winT) { cheered = true; audio.cheer(); }

    if (!ended && T >= endT - 0.01) finish();
    raf = requestAnimationFrame(frame);
  }

  function drawOrder(t) {
    const st = stateAt(run, t, []);
    // In the gate, list them by post position.
    const o = st.map((s, i) => ({ ...s, i })).sort((a, b) => t > 1 ? b.p - a.p : a.i - b.i);
    clear(order);
    o.forEach((x, k) => {
      if (k > 0 && t > 1) {
        const gap = (o[k - 1].p - x.p) / LENGTH;
        order.append(h('span', { class: 'gap' }, gap < 0.06 ? 'no' : marginShort(gap)));
      }
      const r = runners[x.i];
      order.append(h('button', {
        type: 'button', class: `${r.mine ? 'me' : ''}${following === x.i ? ' follow' : ''}`, 'aria-label': `${k + 1}: number ${r.number}, ${r.name}`,
        onclick: () => { following = following === x.i ? null : x.i; scene.setFocus(following); orderAt = -1; },
      }, cloth(r.number, 'sm')));
    });
  }

  function finish() {
    ended = true;
    audio.raceLevel(0.1, 0);
    setTimeout(() => audio.stopRace(), 2500);
    const flash = h('div', { class: 'w-flash' }, call.photo ? 'PHOTO' : 'OFFICIAL');
    if (!call.photo) flash.classList.add('official');
    stage.append(flash);
    const done = () => {
      doneBtn.hidden = false;
      skipBtn.hidden = true;
      if (result.cashedWinner) { audio.cash(); }
    };
    if (call.photo) {
      setTimeout(() => {
        flash.remove();
        const pc = h('canvas');
        const w = Math.min(560, Math.round(stage.clientWidth - 30));
        photoFinish(pc, { run, runners, width: Math.max(260, w), height: Math.round(Math.max(260, w) * 0.6) });
        const first = runners[run.results[0].h], second = runners[run.results[1].h];
        const box = h('div', { class: 'w-photo' }, pc, h('div', { class: 'cap' }, `#${first.number} ${first.name} by a ${marginWord(run.results[1].toPrev)} over #${second.number}`));
        stage.append(box);
        photoShown = true;
        setTimeout(() => { box.append(h('div', { class: 'w-flash official', style: { top: '12%' } }, 'OFFICIAL')); done(); }, 1600);
      }, 1600);
    } else setTimeout(done, 900);
  }

  function leave(where) {
    cancelAnimationFrame(raf);
    audio.stopRace();
    audio.hush();
    window.removeEventListener('resize', onResize);
    el.hidden = true;
    clear(el);
    document.body.style.overflow = '';
    nav.go(where, { no: race.no, fresh: true });
  }

  raf = requestAnimationFrame(frame);
  // Debug hook for tests and screenshots.
  window.__watch = { setT: t => { T = t; scene.lastT = null; }, get T() { return T; }, winT, endT, t0, leave, run, pause: () => { speed = 0; } };
  return () => { cancelAnimationFrame(raf); audio.stopRace(); window.removeEventListener('resize', onResize); };
}

function myTickets(race) {
  const bets = myBets(race);
  if (!bets.length) return null;
  return h('div', { class: 'w-tix' }, 'Your tickets: ', bets.map((b, i) => {
    const sel = b.sel.map(x => race.entries[x].pp);
    const label = b.type === 'exacta' || b.type === 'trifecta' ? sel.join('-') : b.type.endsWith('box') ? sel.join(',') : sel[0];
    return h('span', {}, `${i ? ' · ' : ''}$${b.amt} ${BET_NAMES[b.type]} ${label}`);
  }));
}

function fmtClock(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
function fracName(at) {
  const q = Math.round(at / (FURLONG * 2));
  return { 1: '¼', 2: '½', 3: '¾', 4: 'Mile', 5: '1¼' }[q] || '';
}
function marginWord(l) {
  if (l < 0.06) return 'nose';
  if (l < 0.18) return 'head';
  if (l < 0.32) return 'neck';
  return `${marginShort(l)} length${l > 1.1 ? 's' : ''}`;
}
