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
let netDown = false;  // a voice that needs the internet has failed: not again this visit
const online = () => !netDown && (typeof navigator === 'undefined' || navigator.onLine !== false);

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

// ---------------------------------------------------------------- saying the call, a line at a time

// About how long a voice takes over a line, in seconds: 4.3 syllables a second at its own speed (175 words
// a minute), a pause at each comma and between sentences, and a moment to get going. It's a model, not a
// measurement, and the queue below only leans on it to tell "nearly done" from "barely started" and to
// know when a voice has gone quiet for far too long.
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
  return 0.12 + (syl / 4.3 + Math.max(0, stops - 1) * 0.3 + commas * 0.15) / rate;
}

const GAP = 250;       // ms between a cancel and the next line: Safari drops a line spoken sooner than that
const NO_START = 1500; // ms a voice gets to say it has started a line

// The caller's queue. Each line used to cancel the one before it, so in most races a line or two was cut
// off in the middle of a sentence. Now a line that comes up while another is being said waits for it to
// end, one line at most: a newer line takes the place of the one waiting, unless the one waiting matters
// more (rank: the off, a lead change, the call at the wire). When the voice is free the waiting line is
// said if it isn't too old by then (its `late`, in seconds on the clock it came with), and left out
// otherwise. The call at the wire is the one line that can't wait: it lets a line that's nearly done
// finish, and cuts off one that isn't.
//
// `voice` is anything with { prepare(lines), speak(line, opts), stop() }: the browser's voice below is
// one, and another source of sound could stand in for it. speak() says line.say (or line.text) and calls
// opts.onstart, then opts.onend or opts.onerror. Nothing here trusts those calls to come: a voice that
// goes quiet is cancelled and the call carries on.
export function callQueue(voice, { now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms), never = id => clearTimeout(id) } = {}) {
  let cur = null;       // the line being said
  let held = null;      // the one line waiting for it to end
  let quietUntil = 0;   // no line before this, after a cancel
  let gapTimer = null;
  let proven = false;   // this voice has said when a line started, so silence from it means it's stuck

  // The call at the wire is never too old: it's said as soon as the voice is free.
  const inTime = h => !!h.line.wire || h.clock() - h.due <= (h.line.late ?? 1.5);

  function hold(item) {
    if (held && inTime(held) && (held.line.rank || 0) > (item.line.rank || 0)) return;
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
    if (inTime(h)) begin(h);
  }

  function begin(item) {
    const text = item.line.say || item.line.text;
    const rate = Math.min(1.7, Math.max(0.9, item.rate));
    const me = cur = { item, at: now(), started: null, est: sayTime(text, rate), timer: null };
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
        never(me.timer);
        // Chrome's voices that need the internet can stop partway with no word: don't wait for ever.
        me.timer = later(() => fail(me, 'stalled'), patience);
      },
      onend() { if (cur === me) { never(me.timer); cur = null; next(); } },
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
    voice.stop();
    quietUntil = now() + GAP;
  }

  return {
    prepare(lines) { voice.prepare(lines); },
    // opts: rate and pitch (and volume), and `clock`, a function giving the time, in seconds, that the
    // line's lateness is counted on: the race's own clock while it runs. Without one it's real time.
    speak(line, { rate = 1.25, pitch = 1, volume, clock = () => now() / 1000 } = {}) {
      if (cur && line.wire) {
        const was = cur, left = cur.est - (now() - (cur.started ?? cur.at)) / 1000;
        if (left > 0.5) cut();
        // "Nearly done" is a guess. If the line is still going in half a second, it's cut off then.
        else later(() => { if (cur === was) { cut(); next(); } }, 500);
      }
      hold({ line, rate, pitch, volume, clock, due: clock(), tried: false });
      next();
    },
    // Stops the line being said, if there is one, and forgets the one waiting.
    stop() {
      held = null;
      if (cur) cut();
    },
    // The line being said, if any, is let finish; the one waiting is forgotten.
    settle() { held = null; },
    speaking: () => !!cur,
  };
}

// The browser's own voice, as the queue's voice.
let uttering = null; // kept while it's being said: Chrome can lose an utterance nothing refers to, and its events with it
const browserVoice = {
  prepare() { refreshVoices(); },
  speak(line, { rate, pitch, volume, onstart, onend, onerror }) {
    const u = new SpeechSynthesisUtterance(line.say || line.text);
    if (pickedOnline !== online()) pick(); // gone offline, or back: a voice that needs the internet comes and goes with it
    // The language is always set: Android speaks by language, not by a named voice.
    u.lang = 'en-US';
    if (picked) u.voice = picked;
    u.rate = rate; u.pitch = pitch;
    if (volume !== undefined) u.volume = volume;
    u.onstart = onstart;
    u.onend = onend;
    u.onerror = e => {
      // Chrome reports a line that was cancelled as an error: that's only the line ending.
      if (e && (e.error === 'interrupted' || e.error === 'canceled')) { onend(); return; }
      localOnly(u.voice);
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

const caller = callQueue(browserVoice);
// A race's lines, at the gate: the browser's voice only looks at its list of voices again.
export function prepareCall(lines) { if (voiceEnabled()) caller.prepare(lines); }
// Says a line of the call ({ text, say, late, rank, wire }, or just the words), when the voice is free.
export function say(line, opts) {
  if (voiceEnabled()) caller.speak(typeof line === 'string' ? { text: line } : line, opts);
}
// One line in the chosen voice, for the menu's Hear it. A second tap starts it again.
export function hearIt(line, opts) {
  if (!canSpeak()) return;
  caller.stop();
  caller.speak(line, opts);
}
// Stops the caller mid-line. With `finish`, the line being said is let finish, and nothing follows it.
export function hush({ finish = false } = {}) {
  if (finish) caller.settle(); else caller.stop();
}
