// Watching the race: the broadcast view, the running order with margins, fractions on the clock,
// the caller, and at the end the photo sign or the official sign.

import { h, clear, cloth, money } from './dom.js';
import { RaceScene } from '../draw/scene.js';
import { photoFinish } from '../draw/photo.js';
import { stateAt, runningOrder } from '../sim.js';
import { FURLONG } from '../track.js';
import { marginShort, marginText, fmtTime, fmtClock } from '../chart.js';
import { game, save, goToGate, recordingOf, memoKey, callFor, runnersFor, raceLabel, horseOf, myBets, betCost } from '../game.js';
import { BET_NAMES } from '../tote.js';
import { clockText } from '../world.js';
import { pace, climb, officialLine, SLOW } from '../call.js';
import { planSeconds, jobsFor } from '../joe-call.js';
import * as audio from '../audio.js';

// ---------------------------------------------------------------- the call in the downloaded voice

// With Joe the caller's voice (js/joe.js), a race's call is planned for him: at his pace, which opens
// quicker than a browser's voice is ever asked to go and climbs through the stretch, and with his own
// time over each line. His plan of a race is the same whenever it's made, so its lines can be made into
// sound ahead of the race (js/joe-call.js).
const joePlan = (race, run, opts) => callFor(race, run, { lineSeconds: planSeconds(climb), ...opts });
// What that plan asks of him: each line as he's given it, with its speed, its time and the room it has.
// (`since` is the race's clock, when the plan has been made again in the middle of the race.)
const joeJobs = (call, run, since) => jobsFor(call, run.finalTime, climb, call.official ? officialLine(call.official).say : null, since);
// The race that's up next, while its form is being read: the call is planned and its lines begin to be
// made. Nothing of the result is shown, kept or settled by it.
export function rehearse(race) {
  if (!audio.joeCanCall() || race.status === 'official') return;
  const run = recordingOf(race);
  audio.rehearse(memoKey(race), joeJobs(joePlan(race, run), run));
}

export function renderWatch(el, nav, params) {
  const race = game.world.cards[game.world.day].races.find(r => r.no === params.no);
  // The race as it will be run. Which voice calls it is decided here, before it's settled, so that the
  // one save a race makes as it goes to the gate keeps that too.
  const run = recordingOf(race);
  // The gate has an order to it with the sound and the voice both on: the bugle, then the caller's first
  // line, then the bell. The caller waits for the bugle to end and the gates wait for the caller, so a
  // race with a name stands in the gate a little longer.
  const bugle = game.player.settings.sound ? audio.bugle() / 1000 : 0;
  // Joe calls it if he's the voice chosen and its lines are made, or will be made in time on this device
  // (audio.joeTakes); the browser's voice calls it otherwise, all of it. If he couldn't keep up, the menu
  // says so until he has called a race again.
  let joeCalls = false;
  let call = null;
  audio.primeVoice(); // this is inside the tap that started the race, from the form or from Watch again
  if (audio.joeCanCall()) {
    const his = joePlan(race, run, { bugle, lead: () => (joeCalls ? audio.joeLead() : 0) });
    joeCalls = audio.joeTakes(memoKey(race), joeJobs(his, run));
    if (joeCalls) { call = his; delete game.player.settings.callerBehind; } else game.player.settings.callerBehind = true;
  }
  const result = goToGate(race);
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
  const frsRow = h('div', { class: 'w-top w-frs', style: { paddingTop: '2px', paddingBottom: '2px' } }, frs);
  const order = h('div', { class: 'order', role: 'group', 'aria-label': 'Running order' });
  const prev = h('div', { class: 'prev' });
  const now = h('div', { class: 'now', 'aria-live': 'polite' });
  const callBox = h('div', { class: 'call' }, prev, now);
  const mineList = myTickets(race);
  const speedBtns = [1, 2, 4].map(s => h('button', { type: 'button', 'aria-pressed': String(s === 1), onclick: () => setSpeed(s) }, `${s}×`));
  // Sound is the effects: the bugle, the bell, the crowd and the hooves. The caller has a button of his own
  // beside it, which does what the menu's "Read the race call aloud" does (the menu can't be reached during a
  // race): turned off, he stops mid-line and the rest of the race is written out only; turned on, he picks the
  // race up at the next line.
  const soundBtn = h('button', { type: 'button', 'aria-pressed': String(game.player.settings.sound), onclick: () => {
    game.player.settings.sound = !game.player.settings.sound;
    audio.setSound(game.player.settings.sound);
    soundBtn.setAttribute('aria-pressed', String(game.player.settings.sound));
    if (game.player.settings.sound && T > 0 && T < endT) audio.startRace();
    save(); // the same setting as Sound in the menu, kept the same way
  } }, 'Sound');
  const callerBtn = h('button', { type: 'button', class: 'caller', title: 'Caller', 'aria-label': 'Caller', 'aria-pressed': String(!!game.player.settings.voice), onclick: () => {
    const on = !game.player.settings.voice;
    game.player.settings.voice = on;
    audio.setVoice(on); // off, that stops him mid-line
    if (on) audio.primeVoice(); // inside the tap, so a phone lets him speak
    callerBtn.setAttribute('aria-pressed', String(on));
    save();
  } }, micIcon());
  const skipBtn = h('button', { type: 'button', onclick: skip }, 'Skip ▸▸');
  const doneBtn = h('button', { class: 'btn brass', type: 'button', hidden: true, onclick: () => leave('result') }, 'Results ▸');
  const HINT = 'Tap a number in the running order to follow that horse. Tap it again to follow the leaders.';
  const HINT_SHORT = 'Tap a number to follow that horse.';
  const hint = h('div', { class: 'hint' }, HINT);
  const ctl = h('div', { class: 'w-ctl' }, ...speedBtns, soundBtn, callerBtn, skipBtn, h('span', { class: 'spacer' }), doneBtn, hint);
  el.append(
    h('div', { class: 'w-top' },
      h('span', {}, `Race ${race.no}`),
      h('span', { class: 'fr' }, raceLabel(race)),
      clock,
    ),
    stage,
    frsRow,
    order,
    callBox,
    ...(mineList ? [mineList] : []), // append() would print a null as "null"
    ctl,
  );

  const scene = new RaceScene(canvas, { race, run, runners, wx: game.world.cards[game.world.day].wx });
  // The call is planned here, at the gate, for the voice that will read it: how long this voice takes over
  // a line decides which lines fit where. (With the voice off it's planned the same way, so the call box
  // shows the same lines either way.)
  if (!call) call = callFor(race, run, {
    lineSeconds: (line, toWire) => audio.voiceSeconds(line.say, pace(line, toWire).rate),
    factor: audio.voiceFactor,
    bugle: audio.voiceEnabled() ? bugle : 0,
  });
  // His lines for the rest of the race, when the plan has changed under him (another speed, a skip).
  // The lines that have come up by now keep the clips they have: only the ones to come are made.
  const rehearseAgain = () => { if (joeCalls) audio.rehearse(memoKey(race), joeJobs(call, run, callClock() - t0)); };
  let T = -call.gate;      // sim time; negative is the wait in the gate
  let speed = 1;
  let last = performance.now();
  let raf = 0;
  let rung = false, cheered = false, ended = false;
  let orderAt = -1;
  let following = null;
  // The picture follows the size of its box (the screen turning, the buttons changing at the finish).
  const onResize = () => { fitOrder(); scene.resize(); scene.draw(Math.max(0, T)); fitCall(); fitPhoto(); showFractions(T - t0, true); };
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
    if (s !== speed) { call.setSpeed(s, callClock() - t0, seconds()); rehearseAgain(); }
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
    rehearseAgain();
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
    scene.drawMap(mapC.getContext('2d'), mapC.width, mapC.height, Math.max(0, T));

    // Clock and fractions.
    clock.textContent = T < 0 ? clockText(race.post) : clockT < 0 ? '0:00.0' : fmtClock(Math.min(clockT, run.results[0].time));
    showFractions(clockT);

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

  // The fractions so far, written when there's a new one (or the screen has changed size). On a screen too
  // narrow for all of them the earliest go, so the latest is always there: at 320 wide a route's line was cut
  // off before its final time.
  let frCount = -1;
  function showFractions(clockT, again = false) {
    const fr = run.fractions.filter(f => f.t <= clockT);
    if (fr.length === frCount && !again) return;
    frCount = fr.length;
    const parts = fr.map((f, i) => `${i === fr.length - 1 && f.at >= race.distance - 1 ? 'Final' : fracName(f.at)} ${fmtTime(f.t)}`);
    frs.textContent = parts.length ? parts.join('   ') : fieldText(race);
    while (parts.length > 1 && frs.scrollWidth > frs.clientWidth) { parts.shift(); frs.textContent = parts.join('   '); }
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
    // (`room` is for a voice that knows a line's length to the sample: one that would still be going when
    // the call at the wire is due is left out, not cut off.)
    audio.say(line, { ...pace(line, winT - T), clock: callClock, room: () => call.toWire(callClock() - t0) });
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

  // A field too big for one row of the running order gets two, or three in the narrow column beside the
  // picture (it used to run off the right edge, three horses of eleven on a phone, with nothing to say so).
  // How many is worked out at the gate, and again when the screen turns: a copy of the strip at its real
  // width, with a margin before every number, the widest it gets, is left to wrap, and the room it takes is
  // kept from then on. So the picture above, and the call below, never move as the margins come and go.
  // (A few pixels are held back for the margins wider than this one.) The line under the buttons keeps the
  // room its longest wording needs, for the same reason.
  function fitOrder() {
    const probe = h('div', { class: 'order', 'aria-hidden': 'true', style: { position: 'absolute', left: '0', top: '0', width: `${order.offsetWidth - 6}px`, visibility: 'hidden' } },
      runners.map((r, k) => h('span', { class: 'slot' }, k ? h('span', { class: 'gap' }, '2¼') : null, h('button', { type: 'button', tabindex: '-1' }, cloth(r.number, 'sm')))));
    el.append(probe);
    order.style.minHeight = `${probe.offsetHeight}px`;
    probe.remove();
    // An upright phone with the browser's bars showing is short of room, and the picture is what gives way:
    // with eleven runners and six tickets it had 150 px of a 548 px screen. There, from the gate on, the line
    // under the buttons is one line, and tickets that would take more than a line are a count and their cost.
    low = matchMedia('(orientation: portrait) and (max-height: 700px)').matches;
    el.classList.toggle('low', low);
    if (mineList) {
      mineList.classList.toggle('sum', false);
      if (low && mineList.firstChild.getClientRects().length > 1) mineList.classList.toggle('sum', true);
    }
    hint.style.minHeight = '';
    hint.textContent = low ? HINT_SHORT : HINT;
    hint.style.minHeight = `${hint.offsetHeight}px`;
    showHint();
    // The map in the corner is smaller on a picture this short: at its full size it's a third of the height
    // of a 200 px picture, and sits over the leaders.
    const small = stage.offsetHeight < 230;
    stage.classList.toggle('small', small);
    if (mapC.width !== (small ? 168 : 220)) { mapC.width = small ? 168 : 220; mapC.height = small ? 88 : 108; }
  }
  // Under the buttons: how to follow a horse or, while one is followed, which. Once the race is official
  // there's nothing left to follow, and the line is blank (it keeps its room, so nothing moves). Where the
  // line is one line, it's the longest wording that fits it.
  let official = false, low = false;
  function showHint() {
    const r = following === null ? null : runners[following];
    const says = official ? [''] : r ? [`Following #${r.number} ${r.name}. Tap again for the leaders.`, `Following #${r.number} ${r.name}.`] : [HINT, HINT_SHORT];
    hint.textContent = says[0];
    if (low) for (const text of says) { hint.textContent = text; if (hint.scrollWidth <= hint.clientWidth) break; }
  }

  // The strip's buttons are made once, here, and kept for the race. It used to be emptied and built again
  // whenever a margin's text changed, three times a second: a mouse press that was still down when that
  // happened lost its button and never became a click, and a screen reader was told the focus had moved
  // each time. Now a margin is written into a span that stays, a number moves only when the order
  // changes, and the one the keyboard is on is the one that stays put while the others move round it.
  const slots = runners.map((r, i) => {
    const b = h('button', { type: 'button', class: r.mine ? 'me' : '', 'aria-pressed': 'false', data: { i } }, cloth(r.number, 'sm'));
    const text = document.createTextNode('');
    return { b, text, gap: h('span', { class: 'gap' }, text), slot: h('span', { class: 'slot' }, b), label: '' };
  });
  const pair = h('span', { class: 'pair' }); // the two in a photo
  function follow(i) {
    following = following === i ? null : i;
    scene.setFocus(following);
    slots.forEach((s, k) => { s.b.classList.toggle('follow', k === following); s.b.setAttribute('aria-pressed', String(k === following)); });
    showHint();
  }
  // A press is for the number that was under it when it went down. If the order changes before it comes
  // up, the number has moved from under the pointer and the click lands on its neighbour or between two.
  let pressed = null;
  order.addEventListener('pointerdown', e => {
    const b = e.target.closest('button');
    pressed = b ? { i: +b.dataset.i, at: performance.now() } : null;
  });
  order.addEventListener('pointercancel', () => { pressed = null; });
  order.addEventListener('click', e => {
    const b = e.target.closest('button');
    const down = pressed && performance.now() - pressed.at < 1500 ? pressed.i : null;
    pressed = null;
    if (down !== null) follow(down);
    else if (b) follow(+b.dataset.i); // the keyboard
  });
  // Puts `kids` into `box` in that order, and takes out anything else. `keep`, the one with the keyboard's
  // focus in it, is never moved (a button taken out of the page, even for a moment, loses the focus):
  // the ones after it are set in place from the right and the ones before it from the left.
  function arrange(box, kids, keep) {
    for (const x of [...box.children]) if (!kids.includes(x)) x.remove();
    const at = keep && keep.parentNode === box ? kids.indexOf(keep) : -1;
    for (let k = kids.length - 1, next = null; k > at; next = kids[k--]) {
      if (kids[k].parentNode !== box || kids[k].nextSibling !== next) box.insertBefore(kids[k], next);
    }
    for (let k = 0, before = null; k < at; before = kids[k++]) {
      if (kids[k].parentNode !== box || kids[k].previousSibling !== before) box.insertBefore(kids[k], before ? before.nextSibling : box.firstChild);
    }
  }

  // Two horses running level are in front of each other by turns, many times a second, and their numbers
  // changed places on the strip as often. A number goes past the one in front of it when its horse is a
  // head in front, and until then it's a nose behind. Horses past the wire are in the official order.
  const CLEAR = 0.18; // lengths: a head
  let kept = null, keptAt = 0; // the order of the ones still running, as last shown
  function steady(o, t) {
    const done = run.results.filter(r => t0 + r.time <= t).length;
    const back = new Map(); // lengths behind the first of them
    let sum = 0;
    o.slice(done).forEach((x, k) => back.set(x.i, sum += k ? x.gap : 0));
    // After a jump (Skip, or the picture taken back), it's the order as it stands.
    const was = kept && t >= keptAt && t - keptAt < 1 ? kept.filter(i => back.has(i)) : [];
    const now = [...was, ...o.slice(done).map(x => x.i).filter(i => !was.includes(i))];
    for (let k = 1; k < now.length; k++) {
      for (let j = k; j > 0 && back.get(now[j - 1]) - back.get(now[j]) > CLEAR; j--) [now[j - 1], now[j]] = [now[j], now[j - 1]];
    }
    kept = now; keptAt = t;
    const lead = done < o.length ? o[done].gap : 0; // from the wire, once a horse has crossed it
    return [...o.slice(0, done), ...now.map((i, k) => ({ i, gap: k ? Math.max(0, back.get(i) - back.get(now[k - 1])) : lead + back.get(i) }))];
  }

  let signUp = false; // after a photo, the official sign is up
  function drawOrder(t) {
    // In the gate, list them by post position.
    let o = t > 1 ? steady(runningOrder(run, t), t) : runners.map((r, i) => ({ i, gap: 0 }));
    // A photo: the running order has the official order and margins from the moment a horse crosses, which
    // gave the result away while the PHOTO sign was still up. From the wire until the official sign, the
    // two in the photo are shown as a pair, lower number first, with no margin between them.
    if (call.photo && !signUp && t >= winT) {
      const two = [run.results[0].h, run.results[1].h].sort((a, b) => runners[a].number - runners[b].number);
      o = [...two.map(i => ({ i, gap: 0, photo: true })), ...o.filter(x => !two.includes(x.i))];
    }
    const focused = order.contains(document.activeElement) ? document.activeElement : null;
    const row = [], photo = [];
    o.forEach((x, k) => {
      const r = runners[x.i], s = slots[x.i];
      const label = `${x.photo ? 'In the photo' : k + 1}: number ${r.number}, ${r.name}`;
      if (label !== s.label) s.b.setAttribute('aria-label', s.label = label);
      // No margins for the first four seconds, while the field sorts itself out ("no" eleven times over).
      const margin = k > 0 && t > 4 && !x.photo ? marginShort(x.gap) : '';
      if (margin !== s.text.data) s.text.data = margin;
      if (x.photo) { photo.push(s.b); return; }
      // A number goes to the next row with its margin, so the two share a slot. The leader's has no margin.
      if (!margin) s.gap.remove();
      else if (s.gap.parentNode !== s.slot) s.slot.prepend(s.gap);
      if (s.b.parentNode !== s.slot) s.slot.append(s.b);
      row.push(s.slot);
    });
    if (photo.length) { arrange(pair, photo, focused); row.unshift(pair); }
    arrange(order, row, focused && row.find(x => x.contains(focused)));
    // The button the keyboard was on has it still, unless it has just gone into the photo's pair or come
    // out of it: then it's given back.
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  // The photo finish goes up in a box of its own over the picture, and it's drawn the size it's shown. On
  // an upright phone that's short of room the picture is 150 to 200 px tall, and the photo, made to fit
  // inside it with its caption and the sign, was 42 px wide. So where the picture is too short for a photo
  // the width of the screen, the box runs on down over what's under the picture, the fractions and then the
  // running order, as far as it needs and never over the call. The caption names both horses when that fits
  // on a line, in closer letters if it has to; when it doesn't, the second horse is its number, on two lines
  // if one won't hold it. All of it is done again when the screen turns or changes size.
  let photo = null; // while the photo is up: its box, canvas, caption and sign, and how wide it's drawn
  function fitPhoto() {
    if (!photo) return;
    const { box, pc, cap, sign } = photo;
    const left = stage.offsetLeft, top = stage.offsetTop, wide = stage.offsetWidth;
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${wide}px` });
    cap.className = 'cap';
    cap.textContent = photo.both;
    if (cap.scrollWidth > cap.clientWidth) cap.classList.add('tight');
    if (cap.scrollWidth > cap.clientWidth) { cap.classList.remove('tight'); cap.textContent = photo.short; }
    if (cap.scrollWidth > cap.clientWidth) cap.classList.add('wrap');
    // What the box holds besides the photo: its own padding, the photo's frame, the caption and the sign.
    const cs = getComputedStyle(box), px = v => parseFloat(v) || 0;
    const around = px(cs.paddingTop) + px(cs.paddingBottom) + 2 * px(cs.rowGap) + 12 + cap.offsetHeight + sign.offsetHeight;
    const most = Math.min(560, wide - px(cs.paddingLeft) - px(cs.paddingRight) - 12);
    let bottom = top + stage.offsetHeight, w;
    const under = [frsRow, order], covered = [];
    for (;;) {
      w = Math.min(most, Math.floor((bottom - top - around) / 0.6));
      // What's next under the box, in the picture's own column.
      const next = w < most && under.find(x => Math.abs(x.offsetTop - bottom) < 2 && x.offsetLeft >= left - 1 && x.offsetLeft + x.offsetWidth <= left + wide + 1);
      if (!next) break;
      covered.push(next);
      bottom = next.offsetTop + next.offsetHeight;
    }
    // What the box is over keeps its room and isn't shown: it read through the caption.
    for (const x of under) x.style.visibility = covered.includes(x) ? 'hidden' : '';
    box.style.height = `${bottom - top}px`;
    w = Math.max(120, w);
    if (w !== photo.w) photoFinish(pc, { run, runners, width: photo.w = w, height: Math.round(w * 0.6) });
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
      official = true;
      showHint();
      // The cash window rings for any ticket that paid: a place or show ticket on a horse that didn't
      // win is cashed too. (It used to ring only when the winner was backed.)
      if (result.back > 0) audio.cash();
    };
    if (call.photo) {
      setTimeout(() => {
        flash.remove();
        const pc = h('canvas');
        const first = runners[run.results[0].h], second = runners[run.results[1].h];
        // The official sign goes up under the caption, clear of the photo. Its room is there from the start,
        // so the photo doesn't move when it does.
        const sign = h('div', { class: 'w-flash official under' }, 'OFFICIAL');
        const short = `#${first.number} ${first.name} by a ${marginText(run.results[1].toPrev)} over #${second.number}`;
        const cap = h('div', { class: 'cap' });
        const box = h('div', { class: 'w-photo' }, pc, cap, sign);
        el.append(box);
        photo = { box, pc, cap, sign, short, both: `${short} ${second.name}`, w: 0 };
        fitPhoto();
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
    audio.endCall();
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
  window.__watch = { setT: t => { T = t; scene.lastT = null; }, get T() { return T; }, winT, endT, t0, leave, run, call, pause: () => { speed = 0; }, get cam() { return scene.cam; }, get horizon() { return scene.hor / scene.H; } };
  return teardown;
}

// The Caller button's picture: a microphone, drawn in the button's own colour.
function micIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'mic');
  for (const d of ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M6 11a6 6 0 0 0 12 0M12 17v4M8.5 21h7']) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function fieldText(race) {
  return `${race.entries.length} runners · ${race.surface} · ${race.cond}`;
}

function myTickets(race) {
  const bets = myBets(race);
  if (!bets.length) return null;
  // Each ticket in full, and, for a short screen where they'd take more than a line, how many and what they cost.
  const full = h('span', { class: 'full' }, 'Your tickets: ', bets.map((b, i) => {
    const sel = b.sel.map(x => race.entries[x].pp);
    const label = b.type === 'exacta' || b.type === 'trifecta' ? sel.join('-') : b.type.endsWith('box') ? sel.join(',') : sel[0];
    return h('span', {}, `${i ? ' · ' : ''}$${b.amt} ${BET_NAMES[b.type]} ${label}`);
  }));
  const paid = bets.reduce((sum, b) => sum + (b.cost ?? betCost(b)), 0);
  return h('div', { class: 'w-tix' }, full, h('span', { class: 'count' }, `Your tickets: ${bets.length}, ${money(paid)}`));
}

function fracName(at) {
  const q = Math.round(at / (FURLONG * 2));
  return { 1: '¼', 2: '½', 3: '¾', 4: 'Mile', 5: '1¼' }[q] || '';
}
