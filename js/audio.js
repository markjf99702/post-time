// Sound, all synthesised: the bugle's call to the post, the starting bell, the crowd, hooves,
// the ticket printer and the cash window. Nothing is downloaded, but for the caller's voice when the
// player asks for it (js/joe.js).
import * as joe from './joe.js';
import { raceClips, clipVoice, makingRate } from './joe-call.js';

let ac = null;
let master = null;
let crowd = null;
let hoof = null;
let enabled = true;

export function setSound(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.8 : 0;
  if (!on) stopRace();
}
export function soundOn() { return enabled; }

// Browsers only allow audio after a tap; call this from one.
export function wake() {
  return enabled ? output() : null;
}
// The sound output itself, whether or not the effects are on: the caller's downloaded voice plays through
// it too, and that has a setting of its own.
function output() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = enabled ? 0.8 : 0;
    master.connect(ac.destination);
  }
  if (ac.state !== 'running') ac.resume(); // suspended, or "interrupted" on an iPhone after a call or a lock
  return ac;
}

function noiseBuffer(seconds = 2) {
  const b = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02; // brown-ish
    d[i] = last * 3.5 * 0.6 + w * 0.4;
  }
  return b;
}

// A brass voice: a sawtooth through a filter that opens as the note starts.
function brass(freq, t, dur, vol = 0.22) {
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq * 0.985, t);
  o.frequency.linearRampToValueAtTime(freq, t + 0.04);
  const vib = ac.createOscillator();
  const vg = ac.createGain();
  vib.frequency.value = 5.5; vg.gain.value = freq * 0.006;
  vib.connect(vg); vg.connect(o.frequency);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(400, t);
  f.frequency.linearRampToValueAtTime(2600, t + 0.05);
  f.frequency.linearRampToValueAtTime(1700, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.03);
  g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.05, dur - 0.06));
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}

// A bugle fanfare on the bugle's natural notes, played as the horses come out.
export function bugle() {
  if (!wake()) return 0;
  const C4 = 261.63, G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 783.99;
  const n = [
    [G4, 0.14], [C5, 0.14], [E5, 0.14], [G5, 0.34], [E5, 0.14], [G5, 0.34], [E5, 0.14], [C5, 0.14], [E5, 0.14], [G4, 0.34],
    [G4, 0.14], [C5, 0.14], [E5, 0.14], [G5, 0.14], [G5, 0.14], [G5, 0.14], [E5, 0.14], [C5, 0.14], [E5, 0.14], [C5, 0.5], [C4 * 2, 0.02],
  ];
  let t = ac.currentTime + 0.05;
  for (const [f, d] of n) { if (d > 0.05) brass(f, t, d * 0.92); t += d; }
  return (t - ac.currentTime) * 1000;
}

// The electric bell that rings as the gates open.
export function bell() {
  if (!wake()) return;
  const t = ac.currentTime;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
  g.gain.setValueAtTime(0.2, t + 1.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  const trem = ac.createGain();
  const lfo = ac.createOscillator();
  lfo.type = 'square'; lfo.frequency.value = 22;
  const lg = ac.createGain(); lg.gain.value = 0.5;
  trem.gain.value = 0.5;
  lfo.connect(lg); lg.connect(trem.gain);
  for (const f of [1760, 2217, 2960, 3520]) {
    const o = ac.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    const og = ac.createGain(); og.gain.value = f === 1760 ? 0.5 : 0.18;
    o.connect(og); og.connect(trem);
    o.start(t); o.stop(t + 1.6);
  }
  trem.connect(g); g.connect(master);
  lfo.start(t); lfo.stop(t + 1.6);
}

// Crowd murmur and the rumble of hooves; call raceLevel as the race goes.
export function startRace() {
  if (!wake()) return;
  stopRace();
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(3);
  src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
  const g = ac.createGain(); g.gain.value = 0.05;
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start();
  crowd = { src, g, bp };
  const hs = ac.createBufferSource();
  hs.buffer = noiseBuffer(2);
  hs.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 160;
  const hg = ac.createGain(); hg.gain.value = 0;
  const am = ac.createOscillator();
  am.type = 'sawtooth'; am.frequency.value = 9.5;
  const amg = ac.createGain(); amg.gain.value = 0;
  am.connect(amg); amg.connect(hg.gain);
  hs.connect(lp); lp.connect(hg); hg.connect(master);
  hs.start(); am.start();
  hoof = { src: hs, g: hg, am, amg };
}

// The roar at the wire has the crowd's level to itself until this time, on the sound's own clock.
let cheering = 0;

// Called every frame of the race: how worked up the crowd is (0 to 1) and how loud the hooves are.
export function raceLevel(excite, hooves) {
  if (!ac || !crowd) return;
  const t = ac.currentTime;
  // During the roar the crowd's level is left alone. (It wasn't, so the next frame's level took the
  // roar's place a sixtieth of a second after it began, and the crowd fell away from the wire on.)
  if (t >= cheering) crowd.g.gain.setTargetAtTime(0.04 + excite * 0.3, t, 0.4);
  crowd.bp.frequency.setTargetAtTime(700 + excite * 900, t, 0.5);
  hoof.g.gain.setTargetAtTime(hooves * 0.5, t, 0.2);
  hoof.amg.gain.setTargetAtTime(hooves * 0.5, t, 0.2);
}

// The roar as the winner crosses: up at once, held for two and a half seconds, then dying away.
const ROAR = 2.5, FADE = 1.2; // seconds: how long it's held, and the time constant it fades with
export function cheer() {
  if (!ac || !crowd) return;
  const t = ac.currentTime;
  crowd.g.gain.setTargetAtTime(0.45, t, 0.1);
  crowd.g.gain.setTargetAtTime(0.08, t + ROAR, FADE);
  cheering = t + ROAR + 3 * FADE; // by then it has all but died away
}

// The race is over: the crowd settles, whatever it was doing, and the hooves stop.
export function raceOver() {
  if (!ac || !crowd) return;
  const t = ac.currentTime;
  cheering = 0;
  crowd.g.gain.cancelScheduledValues(t);
  raceLevel(0.1, 0);
}

export function stopRace() {
  for (const x of [crowd, hoof]) {
    if (!x) continue;
    try { x.src.stop(); } catch { /* already stopped */ }
    try { x.am?.stop(); } catch { /* already stopped */ }
  }
  crowd = null; hoof = null;
  cheering = 0;
}

export function ticket() {
  if (!wake()) return;
  const t = ac.currentTime;
  for (let i = 0; i < 9; i++) {
    const o = ac.createOscillator();
    o.type = 'square'; o.frequency.value = 1800 + (i % 3) * 300;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.04, t + i * 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.035 + 0.02);
    o.connect(g); g.connect(master);
    o.start(t + i * 0.035); o.stop(t + i * 0.035 + 0.03);
  }
}

export function cash() {
  if (!wake()) return;
  const t = ac.currentTime;
  for (const [f, d] of [[1318.5, 0], [1760, 0.08], [2637, 0.16]]) {
    const o = ac.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
    o.connect(g); g.connect(master);
    o.start(t + d); o.stop(t + d + 0.55);
  }
}

// ---------------------------------------------------------------- the caller's voice

// The race call, read aloud by the browser's own voice, if there is one. It's a setting of its own, so it
// reads the call with the sound effects off too.

// Which voice. A browser lists every voice the device has, good and bad, in no useful order: an iPhone
// lists about thirty for American English, most of them novelty voices (Bells, Zarvox, Whisper) or the
// robotic ones kept for screen readers, and the first that matched used to be Fred. These are never
// offered, by the name before any bracket.
const NEVER = new Set(['albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ',
  'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'fred', 'junior', 'kathy', 'ralph',
  'eddy', 'flo', 'grandma', 'grandpa', 'jacques', 'reed', 'rocko', 'sandy', 'shelley', 'joelle']);
// Nor is a child's voice: Readium Speech's list of English voices (json/en.json) marks three as children's,
// Apple's Joelle (above) and these two of Edge's. Ana was "Best here" in Edge whenever its list came in
// alphabetical order.
const CHILD = /^Microsoft (Ana|Maisie)\b/i;
// Apple's standard voices, the ones a Mac or an iPhone has before anything is downloaded.
const APPLE = /^(Samantha|Ava|Zoe|Allison|Evan|Nathan|Tom|Karen|Daniel|Moira|Tessa|Rishi|Serena|Kate|Jamie|Oliver|Matilda|Lee)$/;
// Edge's American natural voices all grade the same, and so "Best here" was whichever the browser happened
// to list first. These come first among them, in this order, and the rest follow by name. Nobody here has
// heard any of them: the order is a guess at who suits a race call, made from the names.
const EDGE_FIRST = ['guy', 'christopher', 'eric', 'roger', 'steffan', 'andrew', 'brian'];

// A voice's language the way the standard writes it. Android gives "en_US", and Firefox there "eng-US-f000".
const langOf = v => String(v.lang || '').replace(/_/g, '-').toLowerCase().replace(/^eng(?=-|$)/, 'en');
const needsNet = v => v.localService === false;
// The language a line is sent in: the voice's own, as the standard writes it ("en-GB"), and American
// English when no voice is picked. Chrome on Android hands its speech engine the line's language and never
// a voice by name (TtsPlatformImpl.java sets the engine's language from the utterance's), so a line sent as
// en-US was read by the American voice whichever "voice" was chosen in the menu.
export function langFor(v) {
  const [lang, region] = v ? langOf(v).split('-') : [];
  if (!lang) return 'en-US';
  return /^([a-z]{2}|\d{3})$/.test(region || '') ? `${lang}-${region.toUpperCase()}` : lang;
}

// How good a voice is for the call, or -1 for one that can't be used. The better kinds first: the two of a
// Chromebook's own voices that were picked by ear, the natural voices in Edge and on a Chromebook, the ones
// downloaded in a Mac's or an iPhone's settings (Premium, Siri, Enhanced), Alex, Chrome's Google voices,
// then what each system starts with. American English ahead of other English, since the track is
// American, and of two alike the one that works offline. Among the ordinary voices an American one comes
// ahead of the next kind up in another English (on an iPhone with Samantha gone, Aaron before the British
// Daniel).
function grade(v, online) {
  const lang = langOf(v), name = String(v.name || '');
  if (!/^en(-|$)/.test(lang)) return -1;
  if (NEVER.has(name.replace(/\s*\(.*$/, '').trim().toLowerCase()) || CHILD.test(name) || /^espeak/i.test(name)) return -1;
  if (needsNet(v) && !online) return -1;
  let g = 20;
  // A Chromebook's own eight voices: the fourth and fifth were the pick of them by ear (the first is its
  // default, and was being used as the first in the list), so on a Chromebook they come before anything.
  if (/^Chrome OS US English [45]$/.test(name)) g = 92;
  else if (/\b(Natural|Neural)\b/i.test(name)) g = 90;
  else if (/\(Premium\)|\bSiri\b/i.test(name)) g = 88;
  else if (/\(Enhanced\)/i.test(name)) g = 80;
  else if (name === 'Alex') g = 78;
  else if (name === 'Google US English') g = 70;
  else if (/^Google UK English/.test(name)) g = 66;
  else if (APPLE.test(name)) g = 60;
  else if (/^Microsoft (David|Mark|Zira)\b/.test(name)) g = 55;
  else if (/^Chrome OS |\(compact\)|^(Aaron|Nicky)$/i.test(name)) g = 50;
  if (/^en-us(-|$)/.test(lang)) g += g <= 60 ? 12 : 8;
  if (!needsNet(v)) g += 1;
  return g;
}
// Of two voices that grade the same, which comes first: a fixed order, not the browser's, so the same
// device always gets the same voice. Edge's natural voices by the list above, then by name.
function first(a, b) {
  const edge = v => { const m = /^Microsoft ([A-Za-z]+?)(Multilingual)? Online \(Natural\)/.exec(v.name || ''), k = m ? EDGE_FIRST.indexOf(m[1].toLowerCase()) : -1; return k < 0 ? EDGE_FIRST.length : k; };
  const x = String(a.name || ''), y = String(b.name || '');
  return edge(a) - edge(b) || (x < y ? -1 : x > y ? 1 : 0);
}

// The voices worth offering from a browser's list, best first.
export function offeredVoices(voices) {
  return Array.from(voices || [], v => ({ v, g: grade(v, true) }))
    .filter(x => x.g >= 0).sort((a, b) => b.g - a.g || first(a.v, b.v)).map(x => x.v);
}

// The voice to use: the one saved in the menu if it's in the list and can be used now, otherwise the
// best there is. A voice that needs the internet is passed over while there isn't any (and, in the page,
// for the rest of the visit once one has failed). Null when the
// list has nothing in English (or hasn't arrived yet): the browser then uses its own voice for en-US.
export function pickVoice(voices, { saved = null, online = true } = {}) {
  const list = Array.from(voices || []);
  const kept = saved && list.find(v => v.name === saved);
  if (kept && grade(kept, online) >= 0) return kept;
  let best = null, top = -1;
  for (const v of list) {
    const g = grade(v, online);
    if (g > top || (g === top && g >= 0 && first(v, best) < 0)) { best = v; top = g; }
  }
  return best;
}

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;
let voiceOn = false;
let voiceName = null; // the voice chosen in the menu, by name; null is the best one here
let voices = [];      // the browser's list, as last read
let picked = null;    // the voice in use: worked out when the list or the choice changes, not on every line
let pickedOnline = true;
let engine = 'plain'; // how this browser's speech engine takes a rate, for that voice (see engineOf)
let voicesChanged = null;
let netDown = false;  // a voice that needs the internet has failed: not again this visit
// A browser can have speech and no voice to speak with: a desktop with no speech service, some web views.
// Its list stays empty and every line fails, in silence. It's taken to have no voice once the list has been
// asked for and is still empty a second and a half later, or a line comes back as failed with the list
// empty, unless a line has been heard to start (a browser may read with a voice it doesn't list).
const LIST_WAIT = 1500; // ms
let listTimer = null, listLate = false, lineFailed = false, lineHeard = false;
const tell = () => { if (voicesChanged) voicesChanged(); };
function heard() { const was = noVoice(); lineHeard = true; if (was) tell(); }
function failedWith(error) {
  if (voices.length || (error !== 'synthesis-failed' && error !== 'voice-unavailable')) return;
  const was = noVoice();
  lineFailed = true;
  if (!was && noVoice()) tell();
}
// True when "Read the race call aloud" can't be done here: the menu says so in place of the choice of voice.
export function noVoice() { return !canSpeak() || (voices.length === 0 && !lineHeard && (listLate || lineFailed)); }
const online = () => !netDown && (typeof navigator === 'undefined' || navigator.onLine !== false);

function pick() {
  pickedOnline = online();
  picked = pickVoice(voices, { saved: voiceName, online: pickedOnline });
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  engine = engineOf(picked, nav.userAgent || '', nav.maxTouchPoints || 0);
}

// Reads the browser's list again. Chrome's is empty until it has loaded (asking for it starts that), and
// tells us when it has; a voice downloaded in the system's settings turns up the same way.
let listening = false;
export function refreshVoices() {
  const s = synth();
  if (!s) return;
  if (!listening) {
    listening = true;
    if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', refreshVoices);
    else s.onvoiceschanged = refreshVoices;
  }
  let list = [];
  try { list = Array.from(s.getVoices() || []); } catch { /* a browser that can't say: its own voice is used */ }
  const was = voices.map(v => v.name).join('|'), none = noVoice();
  if (voices.length && !list.length) lineHeard = false; // the list has emptied: whether there's a voice is to be seen again
  voices = list;
  pick();
  if (list.length) { listLate = lineFailed = false; clearTimeout(listTimer); listTimer = null; }
  else if (voiceOn && !listLate && listTimer === null) {
    listTimer = setTimeout(() => { listTimer = null; const before = noVoice(); listLate = true; refreshVoices(); if (!before && noVoice()) tell(); }, LIST_WAIT);
  }
  if (was !== voices.map(v => v.name).join('|') || none !== noVoice()) tell();
}

export function canSpeak() { return !!synth() && typeof SpeechSynthesisUtterance === 'function'; }
export function setVoice(on) { voiceOn = on; if (on) refreshVoices(); else hush(); }
export function voiceEnabled() { return voiceOn && canSpeak(); }
// The voice chosen in the menu. A name that isn't in the list now is kept: the best voice here is used
// meanwhile, and the chosen one comes back when it does.
export function setVoiceName(name) { voiceName = name || null; pick(); }
// For the menu: the voice "Best here" means now, and the ones to choose from, best first.
// And `using`, the voice that reads now (the one chosen, if it's here), and `none`, true in a browser with
// no voice to read with.
export function voiceChoices() {
  return { best: pickVoice(voices, { online: online() }), offered: offeredVoices(voices), using: picked, none: noVoice() };
}
export function onVoicesChanged(fn) { voicesChanged = fn; }

// ---------------------------------------------------------------- saying the call, a line at a time

// About how long a voice takes over a line, in seconds: 4.3 syllables a second at its own speed (175 words
// a minute), a pause at each comma and between sentences, and a moment to get going. It's a model, not a
// measurement. The call is planned with it (call.js sizes each line to be over before the next thing
// happens), so once a voice has read three lines it's checked against them: see gauge() below.
const START = 0.12; // seconds before a voice makes a sound
function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length);
}
export function sayTime(text, rate = 1) {
  const words = text.replace(/\d/g, ' seven ').split(/\s+/);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const stops = (text.match(/[.!?](\s|$)/g) || []).length, commas = (text.match(/,/g) || []).length;
  return START + (syl / 4.3 + Math.max(0, stops - 1) * 0.3 + commas * 0.15) / rate;
}

// The pace wanted of a voice is a multiple of its own speed: 1.15 to 1.2 (pace() in call.js). The number a
// browser's speech engine has to be given for that isn't always the same number. Read from each browser's
// own source, not heard:
// - An Apple voice in Safari, in any browser on an iPhone or iPad, or in Firefox on a Mac ("apple"). WebKit
//   and Firefox lay a rate of 1 to 2 in a straight line along Apple's own scale, from its default to its
//   maximum, and the maximum is about four times the default. So a rate of 1.15 to 1.2 comes out somewhere
//   between 1.23 and 1.6 times the voice's own speed (the curve in between isn't published). The rate asked
//   for is the one that gives the pace wanted if the curve is a straight line, 1.05 to 1.07, so the voice is
//   never quicker than was meant, and its speed is taken as halfway between the two curves.
// - A Microsoft voice on the device in Chrome or Edge on Windows ("sapi"). The rate becomes a whole number
//   of steps, each the tenth root of three, with the part of a step dropped: 1.15 and 1.2 are no steps at
//   all. The rate is left as it is and the voice is taken to be at its own speed.
// - Anything else ("plain"): the rate is the multiple, near enough (Chrome on a Mac and Android in the
//   source; the rest unread).
export function engineOf(voice, userAgent = '', touchPoints = 0) {
  const chrome = /Chrome\/|Chromium\/|CriOS\/|Edg\//.test(userAgent);
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && (touchPoints > 1 || !chrome))) return 'apple';
  if (/Windows/.test(userAgent) && chrome && (!voice || (/^Microsoft /.test(voice.name || '') && !needsNet(voice)))) return 'sapi';
  return 'plain';
}
const APPLE_TOP = 4; // Apple's fastest, in times a voice's own speed
// The number to give the engine for a pace of `pace` times the voice's own speed.
export function engineRate(pace, kind = 'plain') {
  return kind === 'apple' && pace > 1 ? +(1 + (pace - 1) / (APPLE_TOP - 1)).toFixed(4) : pace;
}
// And the other way: about how fast a voice goes, in times its own speed, when the engine is given `rate`.
export function engineSpeed(rate, kind = 'plain') {
  if (kind === 'apple' && rate > 1) {
    const x = Math.min(1, rate - 1);
    return (1 + (APPLE_TOP - 1) * x + Math.pow(APPLE_TOP, x)) / 2;
  }
  if (kind === 'sapi' && rate > 0) return Math.pow(3, Math.trunc(10 * Math.log10(rate)) / 10);
  return rate;
}
// About how long a voice takes over a line asked for at `pace`: the model, at the speed its engine really
// gives it, times how the voice has measured up against the model so far (`factor`).
export function lineTime(text, pace, { engine: kind = 'plain', factor = 1 } = {}) {
  return START + (sayTime(text, engineSpeed(engineRate(pace, kind), kind)) - START) * factor;
}

// How a voice measures up against the model: each line it reads is timed from the moment it says it has
// started to the moment it says it has ended, and set against what the model gave it. After three lines,
// the middle one of those ratios (held between 0.7 and 1.4) is the voice's factor: the call is planned
// with it from then on. Nothing is kept from one visit to the next.
export function gauge() {
  const ratios = [];
  return {
    heard(seconds, modelled) {
      if (!(modelled > 0.4) || !(seconds > 0.1)) return; // too short a line to tell anything by
      ratios.push(seconds / modelled);
      if (ratios.length > 25) ratios.shift();
    },
    factor() {
      if (ratios.length < 3) return 1;
      const s = ratios.slice().sort((a, b) => a - b), mid = s.length >> 1;
      return Math.min(1.4, Math.max(0.7, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2));
    },
    lines: () => ratios.length,
  };
}

const GAP = 250;       // ms between a cancel and the next line: Safari drops a line spoken sooner than that
const NO_START = 1500; // ms a voice gets to say it has started a line
const OVER = 0.2;      // seconds past the call at the wire's time that a line of known length may run
// The fastest the browser's voice is ever asked to go, whatever is asked of the queue. Sped up, a device's
// voice gets higher as well as faster: by 1.4 times its own speed it's a chipmunk. (See pace() in call.js.)
const FASTEST = 1.2;

// The caller's queue. Each line used to cancel the one before it, so in most races a line or two was cut
// off in the middle of a sentence. Now a line that comes up while another is being said waits for it to
// end, one line at most: a newer line takes the place of the one waiting, unless the one waiting matters
// more (rank: the off, a lead change, the call at the wire). When the voice is free the waiting line is
// said if it isn't too old by then (its `late`, in seconds on the clock it came with), and left out
// otherwise. The call at the wire is the one line that can't wait: it lets a line that's nearly done
// finish, and cuts off one that isn't.
//
// The call is planned so that a line is over before the next comes up (call.js), so with a voice as
// quick as it was taken to be nothing here waits long and nothing is left out: the holding and the
// leaving out are for a voice that turns out slower. stats() counts what happened to the lines.
//
// `voice` is anything with { prepare(lines), speak(line, opts), stop() }: the browser's voice below is
// one, and another source of sound could stand in for it. speak() says line.say (or line.text) and calls
// opts.onstart, then opts.onend or opts.onerror. Nothing here trusts those calls to come: a voice that
// goes quiet is cancelled and the call carries on. A voice with a `fastest` is never asked to go faster.
// `heard(line, seconds, rate)` is told how long each line really took, from the voice's word that it had
// started to its word that it had ended.
//
// A voice whose sound is made ahead (Joe: js/joe-call.js) can say more. With `seconds(line)` it gives a
// line's exact length, which is used in place of the estimate. With `ready(line)` it says whether the
// line's sound is there: a line whose sound isn't there when its turn comes is left out, not said late
// (stats().unmade). And a line said with `room`, a function giving the real seconds until the call at the
// wire, is left out if its exact length is more than that and a fifth of a second (stats().unfit): it
// would have to be cut off. (The call at the wire waits that long for a line to end sooner than lose it.)
export function callQueue(voice, { now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms), never = id => clearTimeout(id), heard = null } = {}) {
  let cur = null;       // the line being said
  let held = null;      // the one line waiting for it to end
  let quietUntil = 0;   // no line before this, after a cancel
  let gapTimer = null;
  let proven = false;   // this voice has said when a line started, so silence from it means it's stuck
  // Lines begun, lines left out as too old or for a newer one, lines cut off; and, of a voice whose sound
  // is made ahead, lines left out because their sound wasn't made in time, or would have run into the wire.
  const count = { said: 0, dropped: 0, cut: 0, unmade: 0, unfit: 0 };
  const exact = line => (voice.seconds ? voice.seconds(line) : null);

  // The call at the wire is never too old: it's said as soon as the voice is free.
  const inTime = h => !!h.line.wire || h.clock() - h.due <= (h.line.late ?? 1.5);

  function hold(item) {
    if (held && inTime(held) && (held.line.rank || 0) > (item.line.rank || 0)) { count.dropped++; return; }
    if (held) count.dropped++;
    held = item;
  }

  function next() {
    if (cur || !held) return;
    const wait = quietUntil - now();
    if (wait > 0) {
      if (gapTimer === null) gapTimer = later(() => { gapTimer = null; next(); }, wait);
      return;
    }
    const h = held;
    held = null;
    if (!inTime(h)) { count.dropped++; return; }
    if (voice.ready && !voice.ready(h.line)) { count.unmade++; return; }
    if (!h.line.wire && h.room && exact(h.line) > h.room() + OVER) { count.unfit++; return; }
    begin(h);
  }

  function begin(item) {
    const text = item.line.say || item.line.text;
    const rate = Math.min(voice.fastest || 1.7, Math.max(0.9, item.rate));
    // The plan's own figure for the line when it has one (line.d), which knows this voice's pace.
    const me = cur = { item, at: now(), started: null, real: false, est: exact(item.line) || item.line.d || sayTime(text, rate), timer: null };
    if (!item.tried) count.said++;
    const patience = (2 * me.est + 2) * 1000; // no line takes twice its time and two seconds more
    me.timer = later(() => {
      // No word that it started. From a voice that has sent word before, that's a voice that's stuck.
      // From one that never has, it may be speaking and not saying so: leave it be for as long as the
      // line could take, rather than cut it off a second and a half into every line.
      if (proven) { fail(me, 'silent'); return; }
      me.started = me.at;
      me.timer = later(() => fail(me, 'stalled'), Math.max(0, patience - NO_START));
    }, NO_START);
    const opts = {
      rate, pitch: item.pitch, volume: item.volume,
      onstart() {
        if (cur !== me || me.started !== null) return;
        proven = true;
        me.started = now();
        me.real = true;
        never(me.timer);
        // Chrome's voices that need the internet can stop partway with no word: don't wait for ever.
        me.timer = later(() => fail(me, 'stalled'), patience);
      },
      onend() {
        if (cur !== me) return;
        never(me.timer);
        cur = null;
        if (me.real && heard) heard(item.line, (now() - me.started) / 1000, rate);
        next();
      },
      onerror() { if (cur === me) { never(me.timer); cur = null; again(me); next(); } },
    };
    try { voice.speak(item.line, opts); } catch { opts.onerror(); }
  }

  // The voice has gone quiet on this line: cancel it, which unsticks a stuck voice, and carry on.
  function fail(me, why) {
    if (cur !== me) return;
    cur = null;
    voice.stop(why);
    quietUntil = now() + GAP;
    again(me);
    next();
  }
  // A line that failed before a word of it was heard gets one more go, if it's still wanted by then.
  function again(me) {
    if (me.started !== null || me.item.tried || held) return;
    me.item.tried = true;
    held = me.item;
  }

  function cut() {
    never(cur.timer);
    cur = null;
    count.cut++;
    voice.stop();
    quietUntil = now() + GAP;
  }

  return {
    prepare(lines) { voice.prepare(lines); },
    // opts: rate and pitch (and volume), and `clock`, a function giving the time, in seconds, that the
    // line's lateness is counted on: the race's own clock while it runs. Without one it's real time.
    speak(line, { rate = 1.15, pitch = 1, volume, clock = () => now() / 1000, room = null } = {}) {
      if (cur && line.wire) {
        const was = cur, left = cur.est - (now() - (cur.started ?? cur.at)) / 1000;
        if (left > 0.5) cut();
        // "Nearly done" is a guess. If the line is still going in half a second, it's cut off then.
        else later(() => { if (cur === was) { cut(); next(); } }, 500);
      }
      hold({ line, rate, pitch, volume, clock, room, due: clock(), tried: false });
      next();
    },
    // Stops the line being said, if there is one, and forgets the one waiting.
    stop() {
      held = null;
      if (cur) cut();
    },
    // The same, but cancels whatever the queue believes: for a voice the browser may have left stuck.
    unstick() {
      held = null;
      if (cur) cut();
      else { voice.stop(); quietUntil = now() + GAP; }
    },
    // The line being said, if any, is let finish; the one waiting is forgotten.
    settle() { held = null; },
    speaking: () => !!cur,
    stats: () => ({ ...count }),
  };
}

// The browser's own voice, as the queue's voice.
let uttering = null; // kept while it's being said: Chrome can lose an utterance nothing refers to, and its events with it
const browserVoice = {
  fastest: FASTEST,
  prepare() { refreshVoices(); },
  speak(line, { rate, pitch, volume, onstart, onend, onerror }) {
    const u = new SpeechSynthesisUtterance(line.say || line.text);
    if (pickedOnline !== online()) pick(); // gone offline, or back: a voice that needs the internet comes and goes with it
    // The language is always set, and it's the voice's own: Android speaks by language, not by a named voice.
    u.lang = langFor(picked);
    if (picked) u.voice = picked;
    u.rate = engineRate(rate, engine); // the number this engine needs for that pace
    u.pitch = Math.min(1, pitch); // never higher than the voice's own pitch: see FASTEST
    if (volume !== undefined) u.volume = volume;
    u.onstart = e => { heard(); onstart(e); };
    u.onend = onend;
    u.onerror = e => {
      // Chrome reports a line that was cancelled as an error: that's only the line ending.
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) { onend(); return; }
      localOnly(u.voice);
      failedWith(e && e.error);
      onerror();
    };
    uttering = u;
    synth().speak(u);
  },
  // With a reason, the voice had gone quiet and is being given up on.
  stop(why) {
    if (why) localOnly(picked);
    synth()?.cancel();
  },
};
// A voice that needs the internet has failed: the voices on the device read the rest of this visit.
function localOnly(v) {
  if (!v || !needsNet(v) || netDown) return;
  netDown = true;
  pick();
}

// Each voice's measure against the model, by name, for this visit.
const gauges = new Map();
function gaugeNow() {
  const name = picked ? picked.name : '';
  if (!gauges.has(name)) gauges.set(name, gauge());
  return gauges.get(name);
}
const caller = callQueue(browserVoice, {
  heard(line, seconds, rate) { gaugeNow().heard(seconds, lineTime(line.say || line.text, rate, { engine }) - START); },
});
// How the voice in use has measured up against the model (1 until it has read three lines), and about how
// long it takes over a line asked for at `pace`. The race call is planned with these.
export function voiceFactor() { return voiceEnabled() ? gaugeNow().factor() : 1; }
export function voiceSeconds(text, pace) { return lineTime(text, pace, { engine, factor: voiceFactor() }); }
// What has happened to the lines of the call so far this visit, by the browser's voice and by the
// downloaded one: { said, dropped, cut, unmade, unfit } (see callQueue).
export function callStats() {
  const a = caller.stats(), b = joeCaller.stats();
  return Object.fromEntries(Object.keys(a).map(k => [k, a[k] + b[k]]));
}
// A race's lines, at the gate: the browser's voice only looks at its list of voices again.
export function prepareCall(lines) { if (!calling && voiceEnabled()) caller.prepare(lines); }
// Says a line of the call ({ text, say, late, rank, wire }, or just the words), when the voice is free.
// One voice calls a race from the gate to the official sign: the downloaded one if it took the race
// (joeTakes below), the browser's otherwise.
export function say(line, opts) {
  line = typeof line === 'string' ? { text: line } : line;
  if (calling) { if (voiceOn) joeCaller.speak(line, opts); } else if (voiceEnabled()) caller.speak(line, opts);
}
// One line in the chosen voice, for the menu's Hear it. A second tap starts it again.
export function hearIt(line, opts) {
  if (!voiceOn) return;
  primeVoice();
  hush();
  if (downloadedReads()) { hearDownloaded(line, opts); return; }
  if (canSpeak()) caller.speak(line, opts);
}
// Stops the caller mid-line, whichever voice it is. With `finish`, the line being said is let finish, and
// nothing follows it.
export function hush({ finish = false } = {}) {
  if (finish) { caller.settle(); joeCaller.settle(); } else { caller.stop(); joeCaller.stop(); quiet(); }
}

// ---------------------------------------------------------------- the caller's downloaded voice

// Joe (js/joe.js), when he's the voice chosen in the menu and he's on this device. His sound is made in a
// worker and played here, through the same output as the bugle and the bell (woken by the same taps), on
// a line of its own so that it's heard with the effects off. It is played as it was made, never faster:
// his pace is the model's (the speed asked of joe.speak). If he can't be started on this device, the
// browser's voice reads for the rest of the visit and the menu says why.
// His lines come at one loudness, none of them over 0.84 of full scale (LOUDNESS and CEILING in
// joe-speech.js), and are played at this gain: no sample over 0.68. The crowd at its roar, the hooves and
// the bell, rendered together as the page plays them, peak at 0.31 at the most, so the two together stay
// under full scale, which the output would clip at. At this gain his speech is 6 dB over the roar at the
// wire and over the bell, and 9 dB over the crowd and the hooves in the running (rms against rms).
const JOE_LEVEL = 0.8;
let downloaded = false;  // chosen in the menu
let downloadedFailed = ''; // why he couldn't be started this visit, if he couldn't
let preparing = 0;       // lines being made for Hear it
let voiceOut = null;
let playing = null;      // the clip being played
let hearing = 0;         // the latest Hear it: an older one's sound is not played when it arrives
let behind = false;      // he couldn't have made the last race's lines in time, so the browser's voice called it
let rehearsed = null;    // the race whose call is made or being made: { key, clips } (raceClips in joe-call.js)
let calling = false;     // he is calling the race that's on
let resting = null;      // the timer that ends his worker once it has nothing to do

export function setDownloadedVoice(on) {
  if (downloaded === !!on) return;
  downloaded = !!on;
  downloadedFailed = ''; // chosen again, he's tried again
  if (!downloaded) { joeCaller.stop(); quiet(); forget(); joe.shutdown(); }
  tell();
}
// For the menu: is he chosen, is he the one reading, is a line of his being made, what went wrong, and
// whether the browser's voice had to call the last race because he couldn't keep up.
export function downloadedVoice() {
  return { chosen: downloaded, reading: downloadedReads(), preparing: preparing > 0, problem: downloadedFailed, behind };
}
const downloadedReads = () => downloaded && !downloadedFailed && joe.status().state === 'ready';

// ---------------------------------------------------------------- the downloaded voice calling a race

// A race's result is fixed before it's run, and so is its call. With Joe the voice, the lines are made
// ahead (raceClips in js/joe-call.js): from when the race's page is opened, each in the order it will be
// said, and kept in memory for that race only. The worker that makes them holds some hundreds of megabytes
// while it's up, so it is ended as soon as the last of them is made, and started again when there are
// more to make (the next race; this one, watched at another speed or skipped ahead).
//
// Whether he calls a race is decided once, as it goes to the gate: he does if every line is made, or if
// each will be made before it's needed at the rate this device has been making them. If not, the
// browser's voice calls the whole race, and the menu says he couldn't keep up. Never two voices in one
// race. Once he has a race, a line whose sound isn't there when its time comes is left out (the written
// call still shows it), and if his worker fails the rest of the race goes unspoken.
const LOAD = 2;      // seconds his worker is taken to need to start, until it has been timed on this device
const REST = 15000;  // ms the worker is kept after a Hear it, in case of another
const TYPICAL = 3;   // seconds: about what a line of the call runs
let loadSeconds = null;

// Can he call a race now? Chosen and on the device, with the call read aloud, and not failed this visit.
export function joeCanCall() { return voiceOn && downloadedReads() && !out; }
// The lines a race's call needs, in the order they'll be said ({ say, speed, room, wire, at }): made if
// they aren't, kept if they are. Asked again as often as the plan changes.
export function rehearse(key, jobs) {
  if (!joeCanCall()) return false;
  if (!rehearsed || rehearsed.key !== key) {
    forget();
    rehearsed = { key, clips: raceClips({ make: makeLine, idle: () => rest(0) }) };
  }
  clearTimeout(resting);
  rehearsed.clips.want(jobs);
  return true;
}
function makeLine(text, speed) {
  const cold = !joe.running(), began = performance.now();
  if (cold) joe.ready().then(() => { loadSeconds = (performance.now() - began) / 1000; }, () => {});
  return joe.speak(text, speed);
}
// Ends his worker once it has nothing to do: at once when a race's lines are all made, a little after a
// Hear it. (Never while a line is being made.)
function rest(ms) {
  clearTimeout(resting);
  resting = setTimeout(() => {
    resting = null;
    if (rehearsed && rehearsed.clips.broken() && !downloadedFailed) { downloadedFailed = rehearsed.clips.broken(); tell(); }
    if (joe.busy()) { rest(Math.max(ms, 1000)); return; } // something is still being made: look again later
    joe.shutdown();
  }, ms);
}
function forget() {
  if (rehearsed) rehearsed.clips.drop();
  rehearsed = null;
  calling = false;
}
// The decision, as a race goes to the gate. True if he calls it. `jobs` is his plan of it, as for rehearse().
export function joeTakes(key, jobs) {
  calling = false;
  if (!rehearse(key, jobs)) return false;
  const clips = rehearsed.clips;
  calling = clips.ready() || clips.keepsUp(joe.running() ? 0 : loadSeconds ?? LOAD);
  if (behind === calling) { behind = !calling; tell(); }
  // Not his race: what was made of it is let go, and the worker with it.
  if (!calling) endCall();
  return calling;
}
// About how long before he can say a line that has only just been planned, in seconds: the worker
// started if it isn't up, and one line made.
export function joeLead() {
  return Math.min(5, (joe.running() ? 0 : loadSeconds ?? LOAD) + TYPICAL * (makingRate() ?? 0.5) + 0.2);
}
// The race is over, or left: its clips are let go, and the next line said is the browser's again.
export function endCall() {
  forget();
  rest(0);
}
// For the menu, which keeps it with the settings: did the browser's voice have to call the last race?
export function setBehind(was) { behind = !!was; }
// For the tests and for measuring: the race being rehearsed, as numbers.
export function rehearsal() {
  return rehearsed ? { key: rehearsed.key, calling, ready: rehearsed.clips.ready(), ...rehearsed.clips.measures(), rate: makingRate(), up: joe.running() } : null;
}
const joeVoice = clipVoice({
  clipFor: line => (rehearsed ? rehearsed.clips.clip(line.say || line.text) : null),
  play: (clip, handlers) => playClip(clip, handlers),
});
const joeCaller = callQueue(joeVoice);

// Plays a clip from joe.speak() ({ samples, rate }) and returns a function that stops it. `onstart` is
// called as it begins and `onend` when it's over, stopped or played out. The clip is played at its own
// rate (the output does the sums if its own is different): that changes neither its pace nor its pitch.
export function playClip(clip, { onstart = null, onend = null } = {}) {
  const ctx = output();
  if (!ctx || !clip.samples.length) { if (onend) onend(); return () => {}; }
  if (!voiceOut) { voiceOut = ctx.createGain(); voiceOut.gain.value = JOE_LEVEL; voiceOut.connect(ctx.destination); }
  const buffer = ctx.createBuffer(1, clip.samples.length, clip.rate);
  buffer.getChannelData(0).set(clip.samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(voiceOut);
  const me = { source, over: false };
  const end = () => { if (me.over) return; me.over = true; if (playing === me) playing = null; if (onend) onend(); };
  source.onended = end;
  quiet();
  playing = me;
  source.start();
  if (onstart) onstart();
  return () => { try { source.stop(); } catch { /* not started, or over */ } end(); };
}
// Stops the downloaded voice mid-line.
function quiet() {
  hearing++;
  if (!playing) return;
  const was = playing;
  playing = null;
  try { was.source.stop(); } catch { /* over already */ }
}

// Hear it, in the downloaded voice: the line is made (the first takes a second or two longer, while the
// voice is loaded) and played when it's ready, unless Hear it has been tapped again by then.
function hearDownloaded(line, opts) {
  output(); // inside the tap, so the sound is allowed when the line is ready
  const mine = hearing;
  preparing++;
  tell();
  clearTimeout(resting);
  joe.speak(line.say || line.text, joe.JOE.opens).then(clip => {
    preparing--;
    tell();
    if (mine === hearing && !out) playClip(clip);
    rest(REST);
  }, error => {
    preparing--;
    // He couldn't be started. (Not when the page itself shut him down while the line was being made.)
    if (!joe.running() && !(error && error.shutdown)) downloadedFailed = String((error && error.message) || error);
    tell();
    // The browser's voice carries on.
    if (mine === hearing && !out && canSpeak() && !downloadedReads()) caller.speak(line, opts);
  });
}

// A phone only lets a page speak once it has spoken inside a tap, and the call's first line comes a few
// seconds after the tap that sends the horses to the gate. So the taps that lead to speech (the menu's
// tick, Hear it, To the gate) each call this, and the first of them says one word at no volume.
let primed = false;
export function primeVoice() {
  if (voiceOn && downloaded) output(); // the downloaded voice plays through the sound output, which a tap has to wake
  if (primed || !voiceEnabled()) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance('a');
    u.volume = 0;
    u.rate = engineRate(FASTEST, engine);
    u.lang = langFor(picked);
    if (picked) u.voice = picked;
    u.onstart = heard;
    u.onerror = e => failedWith(e && e.error);
    synth().speak(u);
  } catch { /* a browser that won't: the tap carries on, and the call's own lines find out */ }
}

// Another tab, or the phone locked: the browser stops drawing, so the race stops where it is. The voice
// used to finish its line and the crowd and the hooves carried on over nothing. Now the voice stops, the
// line waiting is forgotten and the sound is held until the page is back. Coming back, the voice is
// cancelled once more, since a phone can leave it stuck, and it says nothing until the next line is due.
let out = false;       // the page is out of sight
let soundHeld = false; // the sound is held by us, not by a browser that hasn't had its tap yet
const quietly = promise => { if (promise && promise.catch) promise.catch(() => {}); };
function away() {
  out = true;
  caller.stop();
  joeCaller.stop();
  quiet();
  joe.shutdown(); // the downloaded voice's worker holds some hundreds of megabytes: a page out of sight gives them back
  if (ac && ac.state === 'running') { soundHeld = true; quietly(ac.suspend()); }
}
function back() {
  if (!out) return;
  out = false;
  if (voiceEnabled()) caller.unstick();
  if (rehearsed) rehearsed.clips.resume(); // the lines still to be made for the race that's on
  if (!ac || !soundHeld) return;
  soundHeld = false;
  quietly(ac.resume());
  // A phone may not let the sound back without a tap: ask again at the next one.
  document.addEventListener('pointerdown', () => { if (ac.state !== 'running') quietly(ac.resume()); }, { once: true });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); else back(); });
  // Leaving the page for another, and coming back to it with the browser's Back button.
  window.addEventListener('pagehide', away);
  window.addEventListener('pageshow', back);
}
