// Sound, all synthesised: the bugle's call to the post, the starting bell, the crowd, hooves,
// the ticket printer and the cash window. Nothing is downloaded.

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
  if (!enabled) return null;
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
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

export function raceLevel(excite, hooves) {
  if (!ac || !crowd) return;
  const t = ac.currentTime;
  crowd.g.gain.setTargetAtTime(0.04 + excite * 0.3, t, 0.4);
  crowd.bp.frequency.setTargetAtTime(700 + excite * 900, t, 0.5);
  hoof.g.gain.setTargetAtTime(hooves * 0.5, t, 0.2);
  hoof.amg.gain.setTargetAtTime(hooves * 0.5, t, 0.2);
}

export function cheer() {
  if (!ac || !crowd) return;
  const t = ac.currentTime;
  crowd.g.gain.setTargetAtTime(0.45, t, 0.1);
  crowd.g.gain.setTargetAtTime(0.08, t + 2.5, 1.2);
}

export function stopRace() {
  for (const x of [crowd, hoof]) {
    if (!x) continue;
    try { x.src.stop(); } catch { /* already stopped */ }
    try { x.am?.stop(); } catch { /* already stopped */ }
  }
  crowd = null; hoof = null;
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
  'eddy', 'flo', 'grandma', 'grandpa', 'jacques', 'reed', 'rocko', 'sandy', 'shelley']);
// Apple's standard voices, the ones a Mac or an iPhone has before anything is downloaded.
const APPLE = /^(Samantha|Ava|Zoe|Allison|Evan|Nathan|Tom|Joelle|Karen|Daniel|Moira|Tessa|Rishi|Serena|Kate|Jamie|Oliver|Matilda|Lee)$/;

// A voice's language the way the standard writes it. Android gives "en_US", and Firefox there "eng-US-f000".
const langOf = v => String(v.lang || '').replace(/_/g, '-').toLowerCase().replace(/^eng(?=-|$)/, 'en');
const needsNet = v => v.localService === false;

// How good a voice is for the call, or -1 for one that can't be used. The better kinds first: the natural
// voices in Edge and on a Chromebook, the ones downloaded in a Mac's or an iPhone's settings (Premium,
// Siri, Enhanced), Alex, Chrome's Google voices, then what each system starts with. American English
// ahead of other English, since the track is American, and of two alike the one that works offline.
function grade(v, online) {
  const lang = langOf(v), name = String(v.name || '');
  if (!/^en(-|$)/.test(lang)) return -1;
  if (NEVER.has(name.replace(/\s*\(.*$/, '').trim().toLowerCase()) || /^espeak/i.test(name)) return -1;
  if (needsNet(v) && !online) return -1;
  let g = 20;
  if (/\b(Natural|Neural)\b/i.test(name)) g = 90;
  else if (/\(Premium\)|\bSiri\b/i.test(name)) g = 88;
  else if (/\(Enhanced\)/i.test(name)) g = 80;
  else if (name === 'Alex') g = 78;
  else if (name === 'Google US English') g = 70;
  else if (/^Google UK English/.test(name)) g = 66;
  else if (APPLE.test(name)) g = 60;
  else if (/^Microsoft (David|Mark|Zira)\b/.test(name)) g = 55;
  else if (/^Chrome OS |\(compact\)|^(Aaron|Nicky)$/i.test(name)) g = 50;
  if (/^en-us(-|$)/.test(lang)) g += 8;
  if (!needsNet(v)) g += 1;
  return g;
}

// The voices worth offering from a browser's list, best first.
export function offeredVoices(voices) {
  return Array.from(voices || [], (v, i) => ({ v, i, g: grade(v, true) }))
    .filter(x => x.g >= 0).sort((a, b) => b.g - a.g || a.i - b.i).map(x => x.v);
}

// The voice to use: the one saved in the menu if it's in the list and can be used now, otherwise the
// best there is. A voice that needs the internet is passed over while there isn't any. Null when the
// list has nothing in English (or hasn't arrived yet): the browser then uses its own voice for en-US.
export function pickVoice(voices, { saved = null, online = true } = {}) {
  const list = Array.from(voices || []);
  const kept = saved && list.find(v => v.name === saved);
  if (kept && grade(kept, online) >= 0) return kept;
  let best = null, top = -1;
  for (const v of list) {
    const g = grade(v, online);
    if (g > top) { best = v; top = g; }
  }
  return best;
}

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;
let voiceOn = false;
let voiceName = null; // the voice chosen in the menu, by name; null is the best one here
let voices = [];      // the browser's list, as last read
let picked = null;    // the voice in use: worked out when the list or the choice changes, not on every line
let pickedOnline = true;
let voicesChanged = null;
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

function pick() {
  pickedOnline = online();
  picked = pickVoice(voices, { saved: voiceName, online: pickedOnline });
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
  const was = voices.map(v => v.name).join('|');
  voices = list;
  pick();
  if (voicesChanged && was !== voices.map(v => v.name).join('|')) voicesChanged();
}

export function canSpeak() { return !!synth() && typeof SpeechSynthesisUtterance === 'function'; }
export function setVoice(on) { voiceOn = on; if (on) refreshVoices(); else hush(); }
export function voiceEnabled() { return voiceOn && canSpeak(); }
// The voice chosen in the menu. A name that isn't in the list now is kept: the best voice here is used
// meanwhile, and the chosen one comes back when it does.
export function setVoiceName(name) { voiceName = name || null; pick(); }
// For the menu: the voice "Best here" means now, and the ones to choose from, best first.
export function voiceChoices() {
  return { best: pickVoice(voices, { online: online() }), offered: offeredVoices(voices) };
}
export function onVoicesChanged(fn) { voicesChanged = fn; }

function utter(text, rate, pitch) {
  const u = new SpeechSynthesisUtterance(text);
  if (pickedOnline !== online()) pick(); // gone offline, or back: a voice that needs the internet comes and goes with it
  // The language is always set: Android speaks by language, not by a named voice.
  u.lang = 'en-US';
  if (picked) u.voice = picked;
  u.rate = rate; u.pitch = pitch;
  synth().cancel();
  synth().speak(u);
}
export function say(text, rate = 1.15) {
  if (voiceEnabled()) utter(text, rate, 1.05);
}
// One line of a race call in the chosen voice, for the menu's Hear it.
export function hearIt() {
  if (canSpeak()) utter("Turning for home, it's Copper Detour by a length and a half!", 1.15, 1.05);
}
export function hush() { synth()?.cancel(); }
