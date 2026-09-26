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

const nav = {
  go(screen, params = {}) {
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
document.getElementById('restart').addEventListener('click', () => {
  if (!confirm('Start a new meet? A new barn of horses, and your bankroll goes back to $200. Your scrapbook is cleared.')) return;
  closeMenu();
  setup();
});

// ------------------------------------------------------------------ start

function setup() {
  clear(app);
  const bar = h('i');
  app.append(h('div', { class: 'setup' },
    h('div', { class: 'kicker' }, 'Opening day'),
    h('p', { class: 'h2' }, 'Larkspur Downs'),
    h('p', { class: 'muted' }, 'Running the last ten weeks of races, so the form has something in it.'),
    h('div', { class: 'bar' }, bar),
  ));
  bankEl.textContent = '';
  const meet = newMeet();
  const step = () => {
    let done = false;
    const until = performance.now() + 40;
    while (!done && performance.now() < until) done = meet.step();
    bar.style.width = `${Math.round((done ? 1 : meet.progress()) * 100)}%`;
    if (done) { lastBank = null; applySettings(); nav.go('card'); }
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

window.addEventListener('post-time:saved', () => { if (game.player && game.world) updateBank(); });

// Tests and screenshots drive the app through this.
window.postTime = { game, nav, save, card, nextRace };

if (load()) {
  applySettings();
  nav.go('card');
} else {
  game.player = { settings: { sound: true, voice: false }, bank: 0 };
  setup();
}

document.addEventListener('pointerdown', () => { if (game.player?.settings?.sound) audio.wake(); }, { once: true });

if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
