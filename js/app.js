// Post Time: a day at the races. This file starts things up and moves between screens.

import { h, clear, money } from './ui/dom.js';
import { game, load, save, notSaved, newMeet, card, nextRace } from './game.js';
import { renderCard, upNextInView } from './ui/card.js';
import { renderRace } from './ui/race.js';
import { renderWatch, rehearse } from './ui/watch.js';
import { renderResult, renderCircle } from './ui/results.js';
import { renderBook, renderHelp, renderMeet } from './ui/book.js';
import { SAMPLE, pace } from './call.js';
import * as audio from './audio.js';
import * as joe from './joe.js';

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
// Where the card was when it was last left for another screen, and which race was up then. Reading ahead
// (race 8's form with race 4 up, then back for race 7's) comes back to the same place on the card, as it
// did when the browser was left to put the page back. Once a race has been run the card opens on the race
// that's up now.
let cardLeft = null;
const upNow = () => { const r = nextRace(); return `${game.world.seed}:${game.world.day}:${r ? r.no : 'over'}`; };

const nav = {
  go(screen, params = {}) {
    if (waiting && (screen === 'book' || screen === 'meet')) { closeMenu(); return; }
    if (cleanup) { cleanup(); cleanup = null; }
    const from = view.screen;
    if (from === 'card' && screen !== 'card' && !waiting) cardLeft = { y: window.scrollY, up: upNow() };
    view = { screen, params };
    remember(screen, params);
    closeMenu();
    render();
    if (screen !== 'watch') window.scrollTo(0, 0);
    if (screen === 'card' && !waiting) {
      // (Out of money, the ATM under the date is the thing to see: the top.)
      if (from !== 'card' && cardLeft && cardLeft.up === upNow() && !document.querySelector('.day .atm')) window.scrollTo(0, cardLeft.y);
      else upNextInView();
    }
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
const entry = (screen, params) => ({ postTime: 1, screen, params, day: game.world?.day, meet: game.world?.seed });

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
    // Forward, onto a screen: show it if it's still there. A race's screens go with its race day and meet:
    // the next race day has a race with the same number, but it isn't that one.
    above = true;
    const here = !waiting && s.day === game.world.day && s.meet === game.world.seed;
    const race = here && s.params && s.params.no ? card().races.find(r => r.no === s.params.no) : null;
    const screen = s.screen === 'watch' ? 'result' : s.screen;
    // A meet's closing page: one that has closed, or this one once its last race is run.
    const meet = !waiting && screen === 'meet' && (s.params?.no ? (game.world.meets || []).some(m => m.no === s.params.no) : s.meet === game.world.seed && s.day === game.world.day && !nextRace());
    const ok = waiting ? screen === 'help'
      : screen === 'book' || screen === 'help' || meet || (screen === 'race' && !!race) || ((screen === 'result' || screen === 'circle') && race?.status === 'official');
    nav.go(ok ? screen : 'card', ok ? s.params : {});
    return;
  }
  // Back, onto the card's entry: one screen back from this one.
  above = false;
  // (An earlier meet's closing page was opened from the scrapbook, and goes back there.)
  const up = !waiting && (view.screen === 'meet' && view.params.no ? 'book' : UP[view.screen]);
  nav.go(up || 'card', up ? { no: view.params.no } : {});
});

// A reload keeps the history entry it happened on, which may be a screen's. The game opens on the card,
// so that entry is the card's now.
try { if (history.state && history.state.postTime) history.replaceState(null, ''); } catch { /* see remember() */ }
// Where a screen opens is the game's to say (the top, or on the card the race that's up). Left to itself the
// browser puts the page back where it was when the card was last left, a moment after the card is drawn.
try { history.scrollRestoration = 'manual'; } catch { /* see remember() */ }

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
  else if (screen === 'meet') renderMeet(app, nav, params);
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
  // A voice downloaded since the page opened is in the list by now.
  if (!menu.hidden) { audio.refreshVoices(); showVoices(); }
});
document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => nav.go(b.dataset.go)));
const optSound = document.getElementById('optSound');
const optVoice = document.getElementById('optVoice');
optSound.addEventListener('change', () => { game.player.settings.sound = optSound.checked; audio.setSound(optSound.checked); if (optSound.checked) audio.wake(); save(); });
optVoice.addEventListener('change', () => { game.player.settings.voice = optVoice.checked; audio.setVoice(optVoice.checked); audio.primeVoice(); showVoices(); rehearseNow(); save(); });

// Under "Read the race call aloud" while it's ticked: which voice reads it, and a button to hear it. "Best
// here" is the best voice this browser has just now, and the line under the list says which that is (in
// the list itself the name was cut off: "Best here (Chrome OS ..."). A voice chosen by name is kept by name
// (settings.voiceName), so it's still the choice after a spell on a device that doesn't have it. In a
// browser with no voice to read with, one line says so in place of all that; the tick stays, since the
// same meet may be played where there is one, and the line goes if a voice turns up.
//
// Second in the list, where it can work, is Joe: a voice the game downloads when asked and keeps (js/joe.js).
// Choosing him is a setting of its own (settings.caller), beside the browser's voice chosen by name, which
// goes on reading until he's on the device and whenever he can't be started. Chosen, he has a few lines
// of his own under the list: what he is and how big, the download with its progress and a way to stop it,
// and a way to take him off the device again.
const voiceRow = document.getElementById('voiceRow');
const optVoiceName = document.getElementById('optVoiceName');
const voiceNote = document.getElementById('voiceNote');
const JOE = ':joe'; // his place in the list: no browser's voice has a name like it
const mb = bytes => Math.round(bytes / 1e6);
const joeChosen = () => joe.offered() && game.player?.settings?.caller === 'joe';
let voicesShown = '';
function showVoices() {
  voiceRow.hidden = !optVoice.checked;
  if (!optVoice.checked) return;
  const { offered, using, none } = audio.voiceChoices();
  voiceRow.classList.toggle('none', none);
  document.getElementById('voiceNone').hidden = !none;
  if (none) return;
  const saved = savedVoice(), his = joe.status(), chosen = joeChosen(), voice = audio.downloadedVoice();
  const names = [...new Set(offered.map(v => v.name))];
  const options = [
    ['', 'Best here'],
    ...(joe.offered() ? [[JOE, his.state === 'ready' ? joe.JOE.name : `${joe.JOE.name} (a ${mb(his.total)} MB download)`]] : []),
    ...names.map(n => [n, `${n}${offered.find(v => v.name === n).localService === false ? ' (needs the internet)' : ''}`]),
    ...(saved && !names.includes(saved) ? [[saved, `${saved} (not here now)`]] : []),
  ];
  const browsers = using ? using.name : "the browser's voice";
  voiceNote.textContent = !chosen ? (using ? `Reading in ${using.name}` : '')
    : voice.preparing ? `Getting ${joe.JOE.name} ready`
      : voice.reading ? `Reading in ${joe.JOE.name}`
        : voice.problem ? `Reading in ${browsers}` : `Reading in ${browsers} until ${joe.JOE.name} is here`;
  // Built again only when the list has changed, so a list that arrives late doesn't shut one that's open.
  const shows = JSON.stringify(options);
  if (shows !== voicesShown) {
    voicesShown = shows;
    clear(optVoiceName);
    for (const [value, text] of options) optVoiceName.append(h('option', { value }, text));
  }
  optVoiceName.value = chosen ? JOE : saved || '';
  showJoe(chosen, his, voice, browsers);
}
const savedVoice = () => { const n = game.player?.settings?.voiceName; return typeof n === 'string' && n ? n : null; };
optVoiceName.addEventListener('change', () => {
  if (optVoiceName.value === JOE) game.player.settings.caller = 'joe';
  else {
    delete game.player.settings.caller;
    delete game.player.settings.callerBehind;
    if (optVoiceName.value) game.player.settings.voiceName = optVoiceName.value;
    else delete game.player.settings.voiceName;
  }
  applyVoice();
  showVoices();
  save();
});
// (Whether he's on this device is looked up whoever is chosen, so the list says "Joe" and not "a 76 MB
// download" when he's here and another voice is reading. Looking fetches nothing and makes no cache.)
function applyVoice() {
  audio.setVoiceName(savedVoice());
  audio.setDownloadedVoice(joeChosen());
  audio.setBehind(joeChosen() && game.player.settings.callerBehind === true);
  if (joe.offered()) joe.look();
  rehearseNow();
}
// With the form of the race that's up already on the screen when he's chosen, ticked or has just arrived:
// its call starts being made now, as it would have when the page was opened (js/ui/watch.js).
function rehearseNow() {
  if (view.screen !== 'race' || waiting || !game.world) return;
  const race = card().races.find(r => r.no === view.params.no);
  if (race && race === nextRace()) rehearse(race);
}

// Joe's own lines in the menu, while he's the one chosen (or on his way down).
const joeRow = document.getElementById('joeRow'), joeNote = document.getElementById('joeNote'), joeBar = document.getElementById('joeBar');
const joeGet = document.getElementById('joeGet'), joeStop = document.getElementById('joeStop'), joeRemove = document.getElementById('joeRemove');
function showJoe(chosen, his, voice, browsers) {
  const coming = his.state === 'downloading', size = `${mb(his.total)} MB`, have = `${mb(his.have)} of ${size}`;
  const some = his.state === 'partial' && mb(his.have) > 0; // less than that of him is as good as none
  joeRow.hidden = !(chosen || coming);
  if (joeRow.hidden) return;
  joeNote.textContent = coming ? `Downloading ${joe.JOE.name}: ${have}.`
    : his.problem ? `The download stopped: ${his.problem}.${some ? ' What arrived is kept.' : ''}`
      : some ? `Part of ${joe.JOE.name} is here: ${have}. The download carries on from there.`
        : his.state === 'ready' ? (voice.problem ? `${joe.JOE.name} couldn't be started on this device, so ${browsers} reads the call. (${voice.problem})`
          // A race's lines are made ahead of it, and this device didn't make the last race's in time.
          : voice.behind ? `${joe.JOE.name} couldn't keep up on this device last time, so ${browsers} called the race. He'll try again at the next one.`
            : `${joe.JOE.name} is on this device (${size}).`)
          : `${joe.JOE.name} is a voice the game downloads and keeps on this device: ${size}, once. He's the same on every phone and computer, where a browser's own voices differ.`;
  joeBar.hidden = !coming;
  joeBar.firstElementChild.style.width = `${Math.round(100 * his.have / his.total)}%`;
  joeGet.hidden = coming || his.state === 'ready';
  joeGet.textContent = his.problem ? 'Try again' : some ? 'Carry on' : `Download ${joe.JOE.name}`;
  joeStop.hidden = !coming;
  joeRemove.hidden = !(his.state === 'ready' || some);
  if (!removing) joeRemove.textContent = his.state === 'ready' ? `Remove ${joe.JOE.name}` : 'Remove what arrived';
}
joeGet.addEventListener('click', e => { e.stopPropagation(); joe.download(); });
joeStop.addEventListener('click', e => { e.stopPropagation(); joe.stopDownload(); });
// Taking him off the device takes two taps, like starting a new meet: it's 76 MB to fetch again.
let removing = null, removingAt = 0;
joeRemove.addEventListener('click', e => {
  e.stopPropagation();
  if (!removing) {
    joeRemove.textContent = `Tap again to take ${joe.JOE.name} off this device`;
    removingAt = performance.now();
    removing = setTimeout(() => { removing = null; showVoices(); }, 4000);
    return;
  }
  if (performance.now() - removingAt < DOUBLE_TAP) return;
  clearTimeout(removing); removing = null;
  // He goes, and the browser's voice is the choice again.
  delete game.player.settings.caller;
  delete game.player.settings.callerBehind;
  applyVoice();
  save();
  joe.remove().then(showVoices);
});
joe.onChange(() => { showVoices(); if (joe.status().state === 'ready') rehearseNow(); });
// Hear it: a line of a call in that voice, at the pace of one about twenty seconds from the wire (or, in
// the downloaded voice, at the pace his call opens at: audio.js).
document.getElementById('hearIt').addEventListener('click', () => audio.hearIt(SAMPLE, pace(SAMPLE, 20)));
audio.onVoicesChanged(showVoices);
// Starting over takes two taps: the first says what it will do, and the second has four seconds to come.
// A second tap straight after the first is a double tap, which wiped a meet with no way back: it's ignored,
// and the button goes on saying what the next tap will do. The button is off while a meet is being built.
const restart = document.getElementById('restart');
const DOUBLE_TAP = 700; // ms
let armed = null, armedAt = 0;
restart.addEventListener('click', e => {
  e.stopPropagation();
  if (building) return;
  if (!armed) {
    restart.textContent = 'Tap again: new horses, $200, empty scrapbook';
    armedAt = performance.now();
    armed = setTimeout(() => { armed = null; restart.textContent = 'Start over'; }, 4000);
    return;
  }
  if (performance.now() - armedAt < DOUBLE_TAP) return;
  clearTimeout(armed); armed = null;
  restart.textContent = 'Start over';
  closeMenu();
  setup();
});

// ------------------------------------------------------------------ start

// One meet at a time: a second build started beside the first put up one meet's card and then replaced it
// with the other's, and any ticket bought in between went with it.
let building = false;
const OPENING = 1200; // ms: the least the Opening day screen is up for
function setup() {
  if (building) return;
  building = true;
  restart.disabled = true;
  const bar = h('i');
  waiting = h('div', { class: 'setup' },
    h('div', { class: 'kicker' }, 'Opening day'),
    h('p', { class: 'h2' }, 'Larkspur Downs'),
    h('p', { class: 'muted' }, 'Running the last ten weeks of races, so the form has something in it.'),
    h('div', { class: 'bar' }, bar),
  );
  nav.go('card');
  const shown = performance.now();
  const meet = newMeet();
  const open = () => { waiting = null; building = false; restart.disabled = false; lastBank = null; applySettings(); nav.go('card'); };
  const step = () => {
    let done = false;
    const until = performance.now() + 40;
    while (!done && performance.now() < until) done = meet.step();
    bar.style.width = `${Math.round((done ? 1 : meet.progress()) * 100)}%`;
    // The screen says what the wait is for, so it stays up long enough to be read: a quick machine builds
    // the meet in a third of a second, and the line was gone before it could be.
    if (done) setTimeout(open, Math.max(0, OPENING - (performance.now() - shown)));
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
  applyVoice();
  audio.refreshVoices(); // Chrome's list is empty until it's asked for: ask now, so it's there by the first race
  showVoices();
}

// One line under the header while the browser is refusing to save (its storage is blocked, or full), so a
// day's play doesn't vanish on the next visit without a word. It goes when a save works again.
const unsaved = h('p', { class: 'unsaved', role: 'status', hidden: true }, "This browser isn't keeping your meet, so it will be gone when you close the page.");
app.before(unsaved);

window.addEventListener('post-time:saved', () => {
  unsaved.hidden = !notSaved();
  // Not while a race is on the screen. Its tickets are settled as it goes to the gate, and the bankroll
  // used to change then, with its flash, behind the race where nobody saw it. It changes when the next
  // screen is drawn (the result, as a rule), where it's seen.
  if (game.player && game.world && view.screen !== 'watch') updateBank();
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
