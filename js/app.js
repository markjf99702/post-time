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
    remember(screen, params);
    closeMenu();
    render();
    if (screen !== 'watch') window.scrollTo(0, 0);
  },
  refresh() { nav.go(view.screen, view.params); },
  // A race's tabs change its entry in the history rather than adding one, so Back doesn't step through them.
  tab(which) {
    view.params = { ...view.params, tab: which };
    try { if (above) history.replaceState(entry(view.screen, view.params), ''); } catch { /* see remember() */ }
  },
};

// ------------------------------------------------------------------ the Back button

// The browser's or the phone's Back button goes back a screen, the way the back buttons on the page do:
// to the card from a race, its result, the scrapbook or How to play; to the result from the winner's
// circle, and from a race that's running, since it was settled when it went to the gate. On the card it
// leaves, as it always has. The history holds the card's entry and at most one more above it, replaced
// as you go from screen to screen.
const UP = { watch: 'result', circle: 'result' };
let above = false; // the history has an entry above the card's
let ours = 0;      // steps back the game took itself, on its way to the card
const entry = (screen, params) => ({ postTime: 1, screen, params });

function remember(screen, params) {
  try {
    if (screen === 'card') {
      if (above) { above = false; history.back(); ours++; }
    } else if (above) history.replaceState(entry(screen, params), '');
    else { history.pushState(entry(screen, params), ''); above = true; }
  } catch { /* a copy that can't keep a history (in a sandboxed frame, say) still changes screens */ }
}

window.addEventListener('popstate', e => {
  if (ours) { ours--; return; }
  const s = e.state;
  if (s && s.postTime) {
    // Forward, onto a screen: show it if it's still there (a new race day or meet has its own races).
    above = true;
    const race = !waiting && s.params && s.params.no ? card().races.find(r => r.no === s.params.no) : null;
    const screen = s.screen === 'watch' ? 'result' : s.screen;
    const ok = waiting ? screen === 'help'
      : screen === 'book' || screen === 'help' || (screen === 'race' && !!race) || ((screen === 'result' || screen === 'circle') && race?.status === 'official');
    nav.go(ok ? screen : 'card', ok ? s.params : {});
    return;
  }
  // Back, onto the card's entry: one screen back from this one.
  above = false;
  const up = !waiting && UP[view.screen];
  nav.go(up || 'card', up ? { no: view.params.no } : {});
});

// A reload keeps the history entry it happened on, which may be a screen's. The game opens on the card,
// so that entry is the card's now.
try { if (history.state && history.state.postTime) history.replaceState(null, ''); } catch { /* see remember() */ }

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

// The meet saved in this browser can't be read. Say so, and leave it where it is until the player starts
// a new meet over it.
function cantRead() {
  waiting = h('div', { class: 'setup' },
    h('p', { class: 'h2' }, "Your saved meet can't be read"),
    h('p', { class: 'muted' }, "Something has changed or damaged what this browser saved, so there's no card to show. A new meet starts over with new horses, $200 and an empty scrapbook."),
    h('button', { class: 'btn brass', type: 'button', onclick: () => setup() }, 'Start a new meet'),
  );
  nav.go('card');
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

const loaded = load();
if (loaded === true) {
  applySettings();
  nav.go('card');
} else if (loaded === 'damaged') {
  applySettings();
  cantRead();
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
