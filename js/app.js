// Post Time: a day at the races. This file starts things up and moves between screens.

import { h, clear, money } from './ui/dom.js';
import { game, load, save, newMeet, card, nextRace } from './game.js';
import { renderCard } from './ui/card.js';
import { renderRace } from './ui/race.js';
import { renderWatch } from './ui/watch.js';
import { renderResult, renderCircle } from './ui/results.js';
import { renderBook, renderHelp } from './ui/book.js';
import * as audio from './audio.js';

const app = document.getElementById('app');
const watchEl = document.getElementById('watch');
const bankEl = document.getElementById('bank');
const menu = document.getElementById('menu');
const menuBtn = document.getElementById('menuBtn');

let cleanup = null;
let view = { screen: 'card', params: {} };
let lastBank = null;
// While a meet is being built there's no card or scrapbook to show yet: the Opening day screen stands in
// for the card (so How to play can still be read, and the card brings the progress back), and the
// scrapbook stays shut.
let waiting = null;

const nav = {
  go(screen, params = {}) {
    if (waiting && screen === 'book') { closeMenu(); return; }
    if (cleanup) { cleanup(); cleanup = null; }
    view = { screen, params };
    closeMenu();
    render();
    if (screen !== 'watch') window.scrollTo(0, 0);
  },
  refresh() { nav.go(view.screen, view.params); },
};

function render() {
  clear(app);
  updateBank();
  const { screen, params } = view;
  if (waiting && screen === 'card') { app.append(waiting); return; }
  if (screen === 'watch') {
    cleanup = renderWatch(watchEl, { go: (s, p) => { cleanup = null; nav.go(s, p); } }, params);
    return;
  }
  if (screen === 'card') renderCard(app, nav);
  else if (screen === 'race') cleanup = renderRace(app, nav, params);
  else if (screen === 'result') renderResult(app, nav, params);
  else if (screen === 'circle') renderCircle(app, nav, params);
  else if (screen === 'book') renderBook(app, nav);
  else if (screen === 'help') renderHelp(app, nav);
}

function updateBank() {
  if (waiting) { bankEl.textContent = ''; return; } // no bankroll until the meet is built
  const b = game.player.bank;
  bankEl.textContent = money(b);
  if (lastBank !== null && b !== lastBank) {
    bankEl.classList.remove('up', 'down');
    void bankEl.offsetWidth;
    bankEl.classList.add(b > lastBank ? 'up' : 'down');
    setTimeout(() => bankEl.classList.remove('up', 'down'), 1200);
  }
  lastBank = b;
}

// ------------------------------------------------------------------ menu and settings

function closeMenu() { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => nav.go(b.dataset.go)));
const optSound = document.getElementById('optSound');
const optVoice = document.getElementById('optVoice');
optSound.addEventListener('change', () => { game.player.settings.sound = optSound.checked; audio.setSound(optSound.checked); if (optSound.checked) audio.wake(); save(); });
optVoice.addEventListener('change', () => { game.player.settings.voice = optVoice.checked; audio.setVoice(optVoice.checked); save(); });
// Starting over takes two taps: the first says what it will do.
const restart = document.getElementById('restart');
let armed = null;
restart.addEventListener('click', e => {
  e.stopPropagation();
  if (!armed) {
    restart.textContent = 'Tap again: new horses, $200, empty scrapbook';
    armed = setTimeout(() => { armed = null; restart.textContent = 'Start a new meet'; }, 4000);
    return;
  }
  clearTimeout(armed); armed = null;
  restart.textContent = 'Start a new meet';
  closeMenu();
  setup();
});

// ------------------------------------------------------------------ start

function setup() {
  const bar = h('i');
  waiting = h('div', { class: 'setup' },
    h('div', { class: 'kicker' }, 'Opening day'),
    h('p', { class: 'h2' }, 'Larkspur Downs'),
    h('p', { class: 'muted' }, 'Running the last ten weeks of races, so the form has something in it.'),
    h('div', { class: 'bar' }, bar),
  );
  nav.go('card');
  const meet = newMeet();
  const step = () => {
    let done = false;
    const until = performance.now() + 40;
    while (!done && performance.now() < until) done = meet.step();
    bar.style.width = `${Math.round((done ? 1 : meet.progress()) * 100)}%`;
    if (done) { waiting = null; lastBank = null; applySettings(); nav.go('card'); }
    else setTimeout(step, 0);
  };
  setTimeout(step, 30);
}

function applySettings() {
  const s = game.player.settings;
  optSound.checked = s.sound;
  optVoice.checked = s.voice;
  audio.setSound(s.sound);
  audio.setVoice(s.voice);
}

window.addEventListener('post-time:saved', () => {
  if (game.player && game.world) updateBank();
  // The race has a Sound button of its own: keep the menu in step with it.
  if (game.player?.settings) { optSound.checked = !!game.player.settings.sound; optVoice.checked = !!game.player.settings.voice; }
});

// The game open in another tab (or as the installed app) has saved, so this copy of the meet is out of
// date. Carrying on with it would let a result seen there be bet on here, and its next save would write
// over what happened there. Load the newer one instead.
window.addEventListener('storage', e => { if (e.key?.startsWith('post-time/')) location.reload(); });

// Tests and screenshots drive the app through this.
window.postTime = { game, nav, save, card, nextRace };

if (load()) {
  applySettings();
  nav.go('card');
} else {
  game.player = { settings: { sound: true, voice: false }, bank: 0 };
  applySettings(); // so the menu shows them while the first meet is built
  setup();
}

document.addEventListener('pointerdown', () => { if (game.player?.settings?.sound) audio.wake(); }, { once: true });

// The one-file copy (npm run build) has no service worker to register.
const singleFile = typeof __SINGLE_FILE__ !== 'undefined';
if (!singleFile && 'serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
