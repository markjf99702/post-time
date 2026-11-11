// Watching the race: the broadcast view, the running order with margins, fractions on the clock,
// the caller, and at the end the photo sign or the official sign.

import { h, clear, cloth } from './dom.js';
import { RaceScene } from '../draw/scene.js';
import { photoFinish } from '../draw/photo.js';
import { stateAt, runningOrder } from '../sim.js';
import { FURLONG } from '../track.js';
import { marginShort, marginText, fmtTime, fmtClock } from '../chart.js';
import { game, save, goToGate, callFor, runnersFor, raceLabel, horseOf, myBets } from '../game.js';
import { BET_NAMES } from '../tote.js';
import { clockText } from '../world.js';
import { pace, officialLine, SLOW } from '../call.js';
import * as audio from '../audio.js';

export function renderWatch(el, nav, params) {
  const race = game.world.cards[game.world.day].races.find(r => r.no === params.no);
  const result = goToGate(race);
  const run = result.run;
  const runners = runnersFor(race);
  const t0 = run.t0;
  const endT = run.frames.length * run.dt;
  const winT = t0 + run.results[0].time;
  const close = run.results[1] && run.results[1].toPrev < SLOW.margin;

  clear(el);
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  // The page behind the race can't be reached while it's on, by the keyboard or by a screen reader.
  const behind = ['top', 'menu', 'app'].map(id => document.getElementById(id)).filter(Boolean);
  for (const x of behind) x.inert = true;
  // Start with the text the first frame would show, so nothing changes size once the race starts.
  const clock = h('div', { class: 'clock' }, clockText(race.post));
  const frs = h('div', { class: 'fr' }, fieldText(race));
  const canvas = h('canvas', { class: 'scene', 'aria-label': `Race ${race.no}, running now. The race call below describes it.` });
  const mapC = h('canvas', { width: 220, height: 108, 'aria-hidden': 'true' });
  const stage = h('div', { class: 'w-stage' }, canvas, h('div', { class: 'w-map' }, mapC));
  const order = h('div', { class: 'order', 'aria-label': 'Running order' });
  const prev = h('div', { class: 'prev' });
  const now = h('div', { class: 'now', 'aria-live': 'polite' });
  const callBox = h('div', { class: 'call' }, prev, now);
  const mineList = myTickets(race);
  const speedBtns = [1, 2, 4].map(s => h('button', { type: 'button', 'aria-pressed': String(s === 1), onclick: () => setSpeed(s) }, `${s}×`));
  // Turned off here, Sound quiets the caller too, until it's turned back on: the menu, where reading the call
  // aloud has a tick of its own, can't be reached during a race. The next race is read aloud again if that
  // tick is on, whether Sound is or not.
  let quiet = false;
  const soundBtn = h('button', { type: 'button', 'aria-pressed': String(game.player.settings.sound), onclick: () => {
    game.player.settings.sound = !game.player.settings.sound;
    audio.setSound(game.player.settings.sound);
    soundBtn.setAttribute('aria-pressed', String(game.player.settings.sound));
    quiet = !game.player.settings.sound;
    if (quiet) audio.hush();
    if (game.player.settings.sound && T > 0 && T < endT) audio.startRace();
    save(); // the same setting as Sound in the menu, kept the same way
  } }, 'Sound');
  const skipBtn = h('button', { type: 'button', onclick: skip }, 'Skip ▸▸');
  const doneBtn = h('button', { class: 'btn brass', type: 'button', hidden: true, onclick: () => leave('result') }, 'Results ▸');
  const HINT = 'Tap a number in the running order to follow that horse. Tap it again to follow the leaders.';
  const hint = h('div', { class: 'hint' }, HINT);
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
    ...(mineList ? [mineList] : []), // append() would print a null as "null"
    ctl,
  );

  const scene = new RaceScene(canvas, { race, run, runners, wx: game.world.cards[game.world.day].wx });
  // The call is planned here, at the gate, for the voice that will read it: how long this voice takes over
  // a line decides which lines fit where. (With the voice off it's planned the same way, so the call box
  // shows the same lines either way.) With the sound and the voice both on, the gate has an order to it:
  // the bugle, then the caller's first line, then the bell. The caller waits for the bugle to end and the
  // gates wait for the caller, so a race with a name stands in the gate a little longer.
  const bugle = game.player.settings.sound ? audio.bugle() / 1000 : 0;
  const call = callFor(race, run, {
    lineSeconds: (line, toWire) => audio.voiceSeconds(line.say, pace(line, toWire).rate),
    factor: audio.voiceFactor,
    bugle: audio.voiceEnabled() ? bugle : 0,
  });
  let T = -call.gate;      // sim time; negative is the wait in the gate
  let speed = 1;
  let last = performance.now();
  let raf = 0;
  let rung = false, cheered = false, ended = false, photoShown = false;
  let orderAt = -1;
  let following = null;
  // The picture follows the size of its box (the screen turning, the buttons changing at the finish).
  const onResize = () => { fitOrder(); scene.resize(); scene.draw(Math.max(0, T)); fitCall(); };
  const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  if (resizer) resizer.observe(stage); else window.addEventListener('resize', onResize);
  const stopResizing = () => { if (resizer) resizer.disconnect(); else window.removeEventListener('resize', onResize); };
  audio.prepareCall(call.lines);

  // The race's clock for the call, in seconds from the gates opening: the recording's while it runs (slow
  // motion and all), and real time once it has ended.
  let endedAt = 0;
  let up = null; // the line of the call that's up, and when it came up
  const callClock = () => (ended ? endT + (performance.now() - endedAt) / 1000 : T);
  const seconds = () => performance.now() / 1000;

  // The call is read at every speed. A change of speed doesn't cut off the line being said: the rest of
  // the race is planned again from where it is, in shorter lines at 2x and only the headlines at 4x.
  function setSpeed(s) {
    if (s !== speed) call.setSpeed(s, callClock() - t0, seconds());
    speed = s;
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String([1, 2, 4][i] === s)));
  }
  function skip() {
    audio.hush();
    // The bell is for a race that starts by running through the off. Skipped from the gate, the race is
    // picked up with twelve seconds to run: the crowd and the hooves start there, without a bell.
    if (!rung) {
      rung = true;
      if (game.player.settings.sound) audio.startRace();
    }
    if (T < winT - 12) { T = winT - 12; scene.lastT = null; }
    else {
      // Skipped past the wire, nobody saw the finish: no roar for it.
      if (T < winT) cheered = true;
      T = endT; scene.lastT = null;
    }
    // The caller picks the race up from there.
    call.skip(T - t0, seconds());
  }

  function frame(tNow) {
    const realDt = Math.min(0.1, (tNow - last) / 1000);
    last = tNow;
    // A close finish goes into slow motion for the last couple of seconds.
    const slow = close && speed === 1 && T > winT - SLOW.before && T < winT + SLOW.after ? SLOW.by : 1;
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
    frs.textContent = fr.length ? fr.map((f, i) => `${i === fr.length - 1 && f.at >= race.distance - 1 ? 'Final' : fracName(f.at)} ${fmtTime(f.t)}`).join('   ') : fieldText(race);

    // The call: the line that has come up, if it's a new one, with the one before it.
    const line = call.next(callClock() - t0, seconds());
    if (line) {
      const k = call.lines.indexOf(line);
      up = { line, at: performance.now() };
      showLine(line, k > 0 ? call.lines[k - 1].text : '');
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
      // It builds over the last 600 metres, stays at its height for two seconds past the wire, and settles.
      const excite = toGo > 600 ? 0.15 : toGo > 0 ? 0.15 + 0.85 * (1 - toGo / 600) : T < winT + 2 ? 1 : 0.15;
      audio.raceLevel(excite, T < winT + 2 ? 0.6 : 0.2);
    }
    if (!cheered && T >= winT) { cheered = true; audio.cheer(); }

    if (!ended && T >= endT - 0.01) finish();
    raf = requestAnimationFrame(frame);
  }

  // The caller's new line, with the one before it above, read aloud. The voice is given the line's
  // spoken form, where a time is in words ("one seventeen and two" for 1:17.55), at a pace that builds
  // toward the wire. The plan has the voice free when a line comes up; if it's still on the line before
  // (a voice slower than it was taken to be), this one waits its turn, and how long it has waited is
  // counted on the race's clock (in slow motion a line can wait longer) and in real time once the
  // recording has ended.
  function showLine(line, before) {
    prev.textContent = before;
    now.textContent = line.text;
    fitCall();
    now.style.animation = 'none'; void now.offsetWidth; now.style.animation = '';
    if (!quiet) audio.say(line, { ...pace(line, winT - T), clock: callClock });
  }

  // A long line on a narrow screen gets a smaller size rather than spilling out of the box. The line
  // before is shown whole when there's room for it, and cut to one line when there isn't.
  function fitCall() {
    now.style.fontSize = '';
    prev.classList.remove('clip');
    if (callBox.scrollHeight > callBox.clientHeight + 1) prev.classList.add('clip');
    let px = parseFloat(getComputedStyle(now).fontSize);
    while (callBox.scrollHeight > callBox.clientHeight + 1 && px > 12) {
      px -= 1;
      now.style.fontSize = `${px}px`;
    }
  }

  // A field too big for one row of the running order on this screen gets two (it used to run off the
  // right edge, three horses of eleven on a phone, with nothing to say so). Whether it will is worked out
  // at the gate from the widest the row gets, a margin before every number, and the room for two rows is
  // kept from then on, so the picture above never changes size as the margins come and go. The line under
  // the buttons keeps the room its longest wording needs, for the same reason.
  function fitOrder() {
    const probe = h('div', { class: 'order', 'aria-hidden': 'true', style: { position: 'absolute', left: '0', right: '0', visibility: 'hidden', flexWrap: 'nowrap' } },
      runners.map((r, k) => h('span', { class: 'slot' }, k ? h('span', { class: 'gap' }, '2¼') : null, h('button', { type: 'button', tabindex: '-1' }, cloth(r.number, 'sm')))));
    el.append(probe);
    order.classList.toggle('two', probe.scrollWidth > order.clientWidth + 0.5);
    probe.remove();
    hint.style.minHeight = '';
    hint.textContent = HINT;
    hint.style.minHeight = `${hint.offsetHeight}px`;
    showHint();
  }
  // Under the buttons: how to follow a horse or, while one is followed, which.
  function showHint() {
    const r = following === null ? null : runners[following];
    hint.textContent = r ? `Following #${r.number} ${r.name}. Tap again for the leaders.` : HINT;
  }

  let orderShown = '';
  let signUp = false; // after a photo, the official sign is up
  function drawOrder(t) {
    // In the gate, list them by post position.
    let o = t > 1 ? runningOrder(run, t) : runners.map((r, i) => ({ i, gap: 0 }));
    // A photo: the running order has the official order and margins from the moment a horse crosses, which
    // gave the result away while the PHOTO sign was still up. From the wire until the official sign, the
    // two in the photo are shown as a pair, lower number first, with no margin between them.
    if (call.photo && !signUp && t >= winT) {
      const two = [run.results[0].h, run.results[1].h].sort((a, b) => runners[a].number - runners[b].number);
      o = [...two.map(i => ({ i, gap: 0, photo: true })), ...o.filter(x => !two.includes(x.i))];
    }
    // No margins for the first four seconds, while the field sorts itself out ("no" eleven times over).
    const gaps = o.map((x, k) => (k > 0 && t > 4 && !x.photo ? marginShort(x.gap) : ''));
    // Rebuilt only when something on it changes, since a rebuilt button loses the keyboard's place;
    // the horse that had it gets it back.
    const shows = `${following}|${o.map((x, k) => `${x.i} ${x.photo ? 'photo' : gaps[k]}`).join(',')}`;
    if (shows === orderShown) return;
    orderShown = shows;
    const had = order.contains(document.activeElement) ? document.activeElement.dataset.i : null;
    clear(order);
    let pair = null;
    o.forEach((x, k) => {
      const r = runners[x.i];
      const b = h('button', {
        type: 'button', class: `${r.mine ? 'me' : ''}${following === x.i ? ' follow' : ''}`, 'aria-label': `${x.photo ? 'In the photo' : k + 1}: number ${r.number}, ${r.name}`, data: { i: x.i },
        onclick: () => { following = following === x.i ? null : x.i; scene.setFocus(following); orderAt = -1; showHint(); },
      }, cloth(r.number, 'sm'));
      if (x.photo) {
        if (!pair) order.append(pair = h('span', { class: 'pair' }));
        pair.append(b);
      } else order.append(h('span', { class: 'slot' }, gaps[k] ? h('span', { class: 'gap' }, gaps[k]) : null, b)); // a number goes to the next row with its margin
      if (had === String(x.i)) b.focus({ preventScroll: true });
    });
  }

  function finish() {
    ended = true;
    endedAt = performance.now();
    audio.raceOver();
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
        // The official sign goes up under the caption, clear of the photo. Its room is there from the start,
        // so the photo doesn't move when it does.
        const sign = h('div', { class: 'w-flash official under' }, 'OFFICIAL');
        const short = `#${first.number} ${first.name} by a ${marginText(run.results[1].toPrev)} over #${second.number}`;
        const cap = h('div', { class: 'cap' }, `${short} ${second.name}`);
        const box = h('div', { class: 'w-photo' }, pc, cap, sign);
        stage.append(box);
        // The caption names both horses when that fits on its line, in closer letters if it has to; when
        // it doesn't, the second horse is its number.
        if (cap.scrollWidth > cap.clientWidth) cap.classList.add('tight');
        if (cap.scrollWidth > cap.clientWidth) { cap.classList.remove('tight'); cap.textContent = short; }
        photoShown = true;
        const raise = () => {
          sign.classList.add('up');
          signUp = true;
          if (!gone) drawOrder(T); // the pair in the photo, in the order they finished
          // Only now does the caller say who won it (unless the race has been left meanwhile).
          if (call.official && !gone) showLine(officialLine(call.official), now.textContent);
          done();
        };
        // The sign waits for the caller's last line (second, third and the time) to be over, by the time
        // it was planned to take. Watched at 2x or 4x the recording is done well before he is, and the
        // winner's line would have come up over that one.
        const wait = () => {
          const last = call.lines[call.lines.length - 1];
          const over = !last || (up && up.line === last && performance.now() >= up.at + last.d * 1000) || performance.now() - endedAt > 20000;
          if (over || gone) raise(); else setTimeout(wait, 100);
        };
        setTimeout(wait, 1600);
      }, 1600);
    } else setTimeout(done, 900);
  }

  // Put everything back the way it was, whichever way the race is left. On the way to the results the
  // caller finishes the line he's on (it's usually the placings and the time); any other way out, he stops.
  let gone = false;
  function teardown(toResults = false) {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(raf);
    audio.stopRace();
    audio.hush({ finish: toResults });
    stopResizing();
    el.hidden = true;
    clear(el);
    document.body.style.overflow = '';
    for (const x of behind) x.inert = false;
  }
  function leave(where) {
    teardown(where === 'result');
    nav.go(where, { no: race.no, fresh: true });
  }

  fitOrder();
  raf = requestAnimationFrame(frame);
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  // Debug hook for tests and screenshots.
  window.__watch = { setT: t => { T = t; scene.lastT = null; }, get T() { return T; }, winT, endT, t0, leave, run, call, pause: () => { speed = 0; }, get cam() { return scene.cam; } };
  return teardown;
}

function fieldText(race) {
  return `${race.entries.length} runners · ${race.surface} · ${race.cond}`;
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

function fracName(at) {
  const q = Math.round(at / (FURLONG * 2));
  return { 1: '¼', 2: '½', 3: '¾', 4: 'Mile', 5: '1¼' }[q] || '';
}
