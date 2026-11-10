// Reading the race call aloud, in plain Node with a stand-in for the browser's voice:
//   node --test test/audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// What getVoices() returns in fourteen browsers (see the file's own note on where the lists come from).
const fixture = JSON.parse(readFileSync(new URL('./voices.fixture.json', import.meta.url), 'utf8'));
const lists = Object.fromEntries(Object.entries(fixture.lists).map(([k, v]) => [k, v.map(([name, lang, local]) => ({ name, lang, localService: !!local }))]));
const IPHONE = lists['Safari, iPhone (iOS 17-18)'];
const MAC_CHROME = lists['Chrome, Mac (nothing downloaded)'];
const MAC_DOWNLOADS = lists['Chrome, Mac (Ava Premium, Zoe Enhanced and Alex downloaded)'];

// The stand-in for speechSynthesis: it notes every utterance it's given, and its list of voices can
// arrive late, the way Chrome's does.
const spoken = [];
let list = [];
const listening = [];
let cancels = 0;
let trouble = null; // an error for the next utterance to come back with, in place of being said
let inFlight = false; // lines are begun and not ended, as while one is being said
const voice = {
  // Each line is over as soon as it's begun, so the page's queue is always free for the next one. (Lines
  // that take time are further down, with a clock the tests turn by hand.)
  speak(u) {
    spoken.push(u);
    if (trouble) { const error = trouble; trouble = null; u.onerror?.({ error }); return; }
    u.onstart?.({});
    if (!inFlight) u.onend?.({});
  },
  cancel: () => { cancels++; },
  getVoices: () => list,
  addEventListener: (type, fn) => { if (type === 'voiceschanged') listening.push(fn); },
};
const arrive = voices => { list = voices; for (const fn of listening) fn(); };
let onLine = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return onLine; } }, configurable: true });
// The page going out of sight and coming back, and a sound system that can be held and let go.
const page = { hidden: false, on: {}, addEventListener(type, fn) { this.on[type] = fn; } };
const show = seen => { page.hidden = !seen; page.on.visibilitychange(); };
// Its clock is turned by hand, and every level it's asked to move to is noted on the setting it was asked of.
let sound = null;
const setting = value => ({ value, asked: [], setTargetAtTime(to, at, tc) { this.asked.push({ to, at, tc }); }, cancelScheduledValues(at) { this.asked.push({ cancel: at }); } });
const part = more => ({ connect(to) { this.to = to; }, start() {}, stop() {}, ...more });
class Sound {
  constructor() { sound = this; this.state = 'running'; this.destination = {}; this.currentTime = 0; this.sampleRate = 100; this.filters = []; }
  createGain() { return part({ gain: setting(1) }); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { return part({}); }
  createBiquadFilter() { const f = part({ frequency: setting(350), Q: setting(1) }); this.filters.push(f); return f; }
  createOscillator() { return part({ frequency: setting(440) }); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
globalThis.document = page;
globalThis.window = { speechSynthesis: voice, AudioContext: Sound, addEventListener() {} };
globalThis.speechSynthesis = voice;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const audio = await import('../js/audio.js');
const { pickVoice, offeredVoices, callQueue, sayTime, lineTime, gauge, engineOf, engineRate, engineSpeed } = audio;
const { raceCall, pace, officialLine } = await import('../js/call.js');
const { createWorld, simulateRace, applyResult, nextDay } = await import('../js/world.js');
const { STAKES, BIG_STAKES } = await import('../js/data.js');
const last = () => spoken[spoken.length - 1];

test('the race call is read aloud with the sound off, and not with the voice off', () => {
  // Two separate ticks in the menu: Sound off, "Read the race call aloud" on.
  audio.setSound(false);
  audio.setVoice(true);
  audio.say("And they're off!");
  assert.deepEqual(spoken.map(u => u.text), ["And they're off!"], 'the call is silent with the sound off');
  audio.setSound(true);
  audio.setVoice(false);
  audio.say('The quarter in twenty-two and three.');
  assert.deepEqual(spoken.map(u => u.text), ["And they're off!"], 'the call is read with the voice off');
});

// The voices nobody wants calling a race: Apple's novelty voices (Bells, Zarvox, Whisper), the robotic
// ones kept for screen readers (Fred, and the Eloquence set: Eddy, Flo, Grandma), and eSpeak.
const NEVER = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Eddy|Flo|Grandma|Grandpa|Jacques|Reed|Rocko|Sandy|Shelley)( \(|$)|^eSpeak/i;

test('the voice picked is the best in the list, and never a novelty one', () => {
  // The first voice whose name matched Male, David, Alex, Daniel or Fred was used: Fred on every iPhone
  // and Mac, David on Windows with Edge's natural voices passed over, and on Android (whose languages
  // are written en_US) whichever English came first, Australian in an alphabetical list.
  const want = {
    'Safari, iPhone (iOS 17-18)': ['Samantha', 'Samantha'],
    'Safari, Mac (macOS 14-15)': ['Samantha', 'Samantha'],
    'Firefox, Mac': ['Samantha', 'Samantha'],
    'Chrome, Mac (nothing downloaded)': ['Google US English', 'Samantha'],
    'Chrome, Mac (Ava Premium, Zoe Enhanced and Alex downloaded)': ['Ava (Premium)', 'Ava (Premium)'],
    'Chrome, Windows 10/11': ['Google US English', 'Microsoft David - English (United States)'],
    'Edge, Windows': [/Online \(Natural\) - English \(United States\)$/, 'Microsoft David - English (United States)'],
    'Firefox, Windows': ['Microsoft David Desktop - English (United States)', 'Microsoft David Desktop - English (United States)'],
    'Chrome, Android (list in alphabetical order)': ['English United States', 'English United States'],
    'Chrome, Android (United States first)': ['English United States', 'English United States'],
    'Samsung Internet, Android': ['English United States', 'English United States'],
    'Firefox, Android': ['English (United States)', 'English (United States)'],
    'Chrome OS': ['Chrome OS US English 4', 'Chrome OS US English 4'], // the pick of a Chromebook's own voices, by ear
    'No voices yet (Chrome before voiceschanged, or a browser with none)': [null, null],
  };
  assert.deepEqual(Object.keys(lists).sort(), Object.keys(want).sort(), 'a list in the fixture has no pick to check');
  for (const [where, voices] of Object.entries(lists)) {
    const picks = [pickVoice(voices, { online: true }), pickVoice(voices, { online: false })];
    picks.forEach((v, k) => {
      const w = want[where][k], name = v ? v.name : null, when = k ? 'offline' : 'online';
      if (w instanceof RegExp) assert.match(String(name), w, `${where}, ${when}`);
      else assert.equal(name, w, `${where}, ${when}`);
      if (v) assert.ok(!NEVER.test(v.name), `${where}: ${v.name}`);
    });
    if (picks[1]) assert.equal(picks[1].localService, true, `${where}: offline, a voice that needs the internet`);
    // What the menu offers: English only, none of the novelty voices, the pick first.
    const offered = offeredVoices(voices);
    assert.deepEqual(offered.filter(v => NEVER.test(v.name) || !/^en/i.test(v.lang)).map(v => v.name), [], `${where}: offered`);
    assert.equal(offered[0] || null, picks[0], `${where}: the best voice isn't first in the menu`);
    assert.equal(offered.length, voices.filter(v => /^en/i.test(v.lang) && !NEVER.test(v.name)).length, `${where}: an English voice isn't offered`);
  }
});

test("on a Chromebook the fourth of its own voices is used, with the fifth next, and not the first", () => {
  // Every Chromebook has "Chrome OS US English 1" to "8", and the first was used, as the first in the
  // list. Listened to on one in November 2026, the fourth and fifth were the best of the eight.
  const own = lists['Chrome OS'].filter(v => /^Chrome OS US English \d$/.test(v.name));
  assert.deepEqual(own.map(v => v.name.slice(-1)).join(''), '12345678', 'the list in the fixture has changed');
  for (const online of [true, false]) assert.equal(pickVoice(own, { online }).name, 'Chrome OS US English 4');
  assert.equal(offeredVoices(own).map(v => v.name.slice(-1)).join(''), '45123678');
  // On one that has Google's natural voices as well, these two are still first, then the natural ones.
  assert.match(offeredVoices(lists['Chrome OS']).slice(0, 3).map(v => v.name).join(' / '), /^Chrome OS US English 4 \/ Chrome OS US English 5 \/ Google US English \d+ \(Natural\)$/);
  // A voice chosen in the menu still wins.
  assert.equal(pickVoice(own, { saved: 'Chrome OS US English 7' }).name, 'Chrome OS US English 7');
});

test('a voice chosen in the menu is used while it is there, and kept while it is not', () => {
  assert.equal(pickVoice(MAC_DOWNLOADS, { saved: 'Zoe (Enhanced)' }).name, 'Zoe (Enhanced)');
  // The chosen voice has gone (deleted in the system's settings, or this is another device): the best here.
  assert.equal(pickVoice(MAC_CHROME, { saved: 'Zoe (Enhanced)' }).name, 'Google US English');
  // One that needs the internet, with none: the best that doesn't.
  assert.equal(pickVoice(MAC_CHROME, { saved: 'Google UK English Male', online: true }).name, 'Google UK English Male');
  assert.equal(pickVoice(MAC_CHROME, { saved: 'Google UK English Male', online: false }).name, 'Samantha');
  // A save that names a novelty voice or a voice in another language doesn't get it.
  assert.equal(pickVoice(MAC_CHROME, { saved: 'Zarvox' }).name, 'Google US English');
  assert.equal(pickVoice(MAC_CHROME, { saved: MAC_CHROME.find(v => !/^en/i.test(v.lang)).name }).name, 'Google US English');

  // Through the page's own code: the name is kept while the voice is away, and used when it's back.
  audio.setVoice(true);
  arrive(IPHONE);
  audio.setVoiceName('Zoe (Enhanced)');
  audio.say('Down the backstretch.');
  assert.equal(last().voice.name, 'Samantha', 'the chosen voice is missing, and the best here is not used');
  arrive(MAC_DOWNLOADS);
  audio.say('Around the far turn.');
  assert.equal(last().voice.name, 'Zoe (Enhanced)', "the chosen voice came back and isn't used");
  assert.equal(audio.voiceChoices().best.name, 'Ava (Premium)', '"Best here" in the menu is not the best voice');
  audio.setVoiceName(null);
  audio.say('Turning for home.');
  assert.equal(last().voice.name, 'Ava (Premium)');
});

test('a list of voices that arrives late is used from then on, and the language is always set', () => {
  // Chrome's list is empty until it has loaded. Nothing listened for it arriving, so the first lines
  // went out in whatever voice the browser fell back on.
  audio.setVoice(true);
  audio.setVoiceName(null);
  arrive([]);
  audio.say("And they're off!");
  assert.equal(last().voice, undefined, 'a voice is set with no list');
  assert.equal(last().lang, 'en-US', 'with no voice to name, the language is not set');
  arrive(IPHONE);
  audio.say('Copper Detour goes right to the front.');
  assert.deepEqual([last().voice.name, last().lang], ['Samantha', 'en-US']);
  // Android speaks by language, and writes it en_US: the utterance's own language is still en-US.
  arrive(lists['Chrome, Android (list in alphabetical order)']);
  audio.say('The quarter in twenty-two and three.');
  assert.deepEqual([last().voice.name, last().lang], ['English United States', 'en-US']);
  // Offline, a voice that needs the internet is passed over, and used again when the connection is back.
  arrive(MAC_CHROME);
  audio.say('Down the backstretch.');
  assert.equal(last().voice.name, 'Google US English');
  onLine = false;
  audio.say('Around the far turn.');
  assert.equal(last().voice.name, 'Samantha', 'offline, a voice that needs the internet is used');
  onLine = true;
  audio.say('Turning for home.');
  assert.equal(last().voice.name, 'Google US English');
});

test('a voice that needs the internet and fails is dropped for the rest of the visit', () => {
  audio.setVoice(true);
  audio.setVoiceName(null);
  arrive(MAC_CHROME);
  const from = spoken.length;
  // Our own cancel comes back from Chrome as an error: that isn't the voice failing.
  trouble = 'interrupted';
  audio.say('Down the backstretch.');
  audio.say('Around the far turn.');
  assert.deepEqual(spoken.slice(from).map(u => [u.text, u.voice.name]), [['Down the backstretch.', 'Google US English'], ['Around the far turn.', 'Google US English']]);
  // A real failure: the line is said again by the best voice on the device, and so is the rest.
  trouble = 'network';
  audio.say('Turning for home.');
  audio.say('A furlong to go.');
  assert.deepEqual(spoken.slice(from + 2).map(u => [u.text, u.voice.name]),
    [['Turning for home.', 'Google US English'], ['Turning for home.', 'Samantha'], ['A furlong to go.', 'Samantha']]);
  assert.equal(audio.voiceChoices().best.name, 'Samantha', '"Best here" in the menu still names the voice that failed');
});

test('the first tap that leads to speech says one silent word, so a phone lets the call be read', () => {
  // A phone lets a page speak only once it has spoken inside a tap. The call's first line comes 2.6
  // seconds after the tap that sends the horses to the gate, which is no longer inside it.
  audio.setVoice(false);
  const from = spoken.length;
  audio.primeVoice();
  assert.equal(spoken.length, from, 'a word is spoken with the call not read aloud');
  audio.setVoice(true);
  arrive(IPHONE);
  audio.primeVoice();
  audio.primeVoice();
  audio.hearIt({ text: "Turning for home, it's Copper Detour by a length and a half!" }, { rate: 1.4 });
  assert.deepEqual(spoken.slice(from).map(u => [u.volume, u.lang, u.voice.name, u.text.length > 3]), [[0, 'en-US', 'Samantha', false], [undefined, 'en-US', 'Samantha', true]]);
});

test('with the page out of sight the voice stops and the sound is held, and both come back with it', async () => {
  // Another tab, or the phone locked: the race stops being drawn, and the line being read used to carry
  // on, with the crowd and the hooves, over nothing.
  audio.setSound(true);
  audio.wake();
  audio.setVoice(true);
  inFlight = true;
  let from = spoken.length, cancelled = cancels;
  audio.say('Down the backstretch, Copper Detour leads by a length.');
  audio.say('Velvet Hunch takes over!'); // waiting its turn
  show(false);
  assert.deepEqual([cancels - cancelled, sound.state], [1, 'suspended'], 'out of sight, the voice or the sound carries on');
  inFlight = false;
  cancelled = cancels;
  show(true);
  assert.deepEqual([cancels - cancelled, sound.state], [1, 'running'], 'back in sight: one cancel in case the voice was left stuck, and the sound back');
  // Nothing is said until the next line is due: not the line that was waiting.
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(spoken.slice(from).map(u => u.text), ['Down the backstretch, Copper Detour leads by a length.']);
  from = spoken.length;
  audio.say('Around the far turn.');
  assert.deepEqual(spoken.slice(from).map(u => u.text), ['Around the far turn.']);
  // Sound that wasn't playing (no tap yet, or held by the browser) isn't started by coming back.
  sound.state = 'suspended';
  show(false);
  show(true);
  assert.equal(sound.state, 'suspended');
  sound.state = 'running';
});

test('the roar at the wire is not taken back by the next frame, and the crowd settles when it has died away', () => {
  // The race screen sets the crowd's level every frame, and that used to replace the roar a sixtieth of a
  // second after it began: the crowd fell away from the moment the winner crossed.
  audio.setSound(true);
  audio.startRace();
  const crowd = sound.filters.filter(f => f.type === 'bandpass').pop().to.gain; // the crowd's own level
  const frame = 1 / 60;
  const asked = from => crowd.asked.slice(from).map(a => [+a.to.toFixed(3), +a.at.toFixed(3)]);
  sound.currentTime = 20;
  audio.raceLevel(1, 0.6); // the last strides
  assert.deepEqual(asked(-1), [[0.34, 20]]);
  sound.currentTime = 20 + frame;
  let from = crowd.asked.length;
  audio.cheer();
  // Up at once, held for two and a half seconds, then dying away: and nothing else for six seconds, though
  // the race goes on setting its level every frame.
  for (let t = 20 + 2 * frame; t < 26; t += frame) { sound.currentTime = t; audio.raceLevel(t < 22 ? 1 : 0.15, 0.6); }
  assert.deepEqual(asked(from), [[0.45, 20.017], [0.08, 22.517]], 'the roar at the wire was replaced by the next frame');
  // Once it has died away the crowd follows the race again.
  from = crowd.asked.length;
  sound.currentTime = 26.2;
  audio.raceLevel(0.15, 0.2);
  assert.deepEqual(asked(from), [[0.085, 26.2]], "after the roar the crowd doesn't follow the race");
  // The race over in the middle of a roar (skipped to the end): what was to come of the roar is dropped
  // and the crowd settles.
  sound.currentTime = 30;
  audio.cheer();
  sound.currentTime = 31;
  from = crowd.asked.length;
  audio.raceOver();
  assert.deepEqual(crowd.asked.slice(from).map(a => (a.cancel ? ['cancel', a.cancel] : [+a.to.toFixed(3), a.at])), [['cancel', 31], [0.07, 31]], "the crowd doesn't settle when the race is over");
  // And the next race's crowd isn't held by the last one's roar.
  audio.cheer();
  audio.startRace();
  const next = sound.filters.filter(f => f.type === 'bandpass').pop().to.gain;
  audio.raceLevel(0.5, 0.6);
  assert.equal(next.asked.length, 1, "the next race's crowd is held by the last race's roar");
  audio.stopRace();
});

// ---------------------------------------------------------------- the queue, with a clock turned by hand

// A voice that takes time over a line: about what the queue's own model says at 4.3 syllables a second,
// or slower or quicker than it expects. It says when it starts and ends (while `events` is true), and
// notes everything it's asked to do. `stamp` is filled in by a test that wants the race's clock noted,
// and `heard` by one that wants to know how long each line really took.
function rig({ syllablesASecond = 4.3, startAfter = 20, events = true } = {}) {
  let t = 0, id = 0, saying = null;
  const timers = new Map(), log = [];
  const clock = {
    now: () => t,
    later: (fn, ms) => { timers.set(++id, { at: t + Math.max(0, ms), fn }); return id; },
    never: i => { timers.delete(i); },
  };
  const r = {
    log, stamp: () => null, heard: null, events, startAfter,
    now: () => t,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let first = null;
        for (const [k, x] of timers) if (x.at <= end && (!first || x.at < first[1].at)) first = [k, x];
        if (!first) break;
        timers.delete(first[0]);
        t = first[1].at;
        first[1].fn();
      }
      t = end;
    },
  };
  const voice = {
    prepare() {},
    speak(line, o) {
      const text = line.say || line.text, me = saying = { text };
      log.push({ ev: 'speak', t, T: r.stamp(), line, text, rate: o.rate, pitch: o.pitch });
      const takes = 120 + (sayTime(text, o.rate) - 0.12) * 1000 * 4.3 / syllablesASecond;
      clock.later(() => { if (saying === me && r.events) o.onstart(); }, r.startAfter);
      clock.later(() => { if (saying === me && r.events) { saying = null; log.push({ ev: 'end', t, T: r.stamp(), text }); o.onend(); } }, Math.max(r.startAfter, takes));
    },
    stop(why) { log.push({ ev: 'stop', t, T: r.stamp(), why: why || null, cut: saying ? saying.text : null }); saying = null; },
  };
  r.queue = callQueue(voice, { ...clock, heard: (line, seconds, rate) => { if (r.heard) r.heard(line, seconds, rate); } });
  return r;
}
const texts = (log, ev = 'speak') => log.filter(x => x.ev === ev).map(x => x.text);
const LONG = { text: 'Down the backstretch, Copper Detour leads by a length and a half. Velvet Hunch second. Rusty Nickel is third, and Sly Candle brings up the rear.' };

test('a line waits for the one before it instead of cutting it off', () => {
  const r = rig();
  r.queue.speak(LONG);
  r.advance(1000);
  r.queue.speak({ text: 'The quarter in twenty-two and three.', late: 30 });
  r.advance(20000);
  assert.deepEqual(r.log.filter(x => x.ev !== 'speak').map(x => x.ev), ['end', 'end'], 'a line was cancelled, or never ended');
  assert.deepEqual(texts(r.log), [LONG.text, 'The quarter in twenty-two and three.']);
});

test('one line waits: a newer one takes its place unless the one waiting matters more, and a stale one is left out', () => {
  // Newest wins.
  let r = rig();
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Rusty Nickel is making a run!', late: 30 });
  r.queue.speak({ text: 'Sly Candle has to check, nowhere to go!', late: 30 });
  r.advance(20000);
  assert.deepEqual(texts(r.log), [LONG.text, 'Sly Candle has to check, nowhere to go!']);
  // A lead change keeps its place against an ordinary line, and takes the place of one.
  r = rig();
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Rusty Nickel is making a run!', late: 30 });
  r.queue.speak({ text: 'Velvet Hunch takes over!', late: 30, rank: 1 });
  r.queue.speak({ text: 'Sly Candle has to check, nowhere to go!', late: 30 });
  r.advance(20000);
  assert.deepEqual(texts(r.log), [LONG.text, 'Velvet Hunch takes over!']);
  // Too old by the time the voice is free: left out, on the clock the line came with.
  r = rig();
  let raceClock = 100;
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Velvet Hunch takes over!', late: 1, rank: 1 }, { clock: () => raceClock });
  raceClock = 101.5; // a second and a half later in the race, whatever the wall clock says
  r.advance(20000);
  assert.deepEqual(texts(r.log), [LONG.text], 'a lead change was announced a second and a half late');
  // But one that matters more doesn't hold the place once it's too old itself.
  r = rig();
  raceClock = 100;
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Velvet Hunch takes over!', late: 1, rank: 1 }, { clock: () => raceClock });
  raceClock = 102;
  r.queue.speak({ text: 'A furlong to go, Velvet Hunch leads by a length, Copper Detour chasing.', late: 30 }, { clock: () => raceClock });
  r.advance(20000);
  assert.deepEqual(texts(r.log), [LONG.text, 'A furlong to go, Velvet Hunch leads by a length, Copper Detour chasing.']);
});

test("the call at the wire lets a line that's nearly done finish, cuts off one that isn't, and is never left out", () => {
  const WIRE = { text: 'Copper Detour wins it by a neck!', late: 0.3, rank: 1, wire: true };
  const SHORT = { text: 'Copper Detour still in front by a length!' };
  // Plenty of the line left: it's cut off, and the wire call follows a quarter of a second later (Safari
  // drops a line spoken sooner after a cancel).
  let r = rig();
  r.queue.speak(LONG);
  r.advance(1000);
  r.queue.speak(WIRE);
  r.advance(10000);
  let stop = r.log.find(x => x.ev === 'stop'), wire = r.log.find(x => x.text === WIRE.text);
  assert.equal(stop.cut, LONG.text);
  assert.equal(wire.t - stop.t, 250);
  // Nearly done: it finishes, and the wire call comes straight after, with no cancel.
  r = rig();
  r.queue.speak(SHORT);
  const takes = sayTime(SHORT.text, 1.15) * 1000;
  r.advance(takes - 300);
  r.queue.speak(WIRE);
  r.advance(10000);
  assert.deepEqual(r.log.map(x => x.ev), ['speak', 'end', 'speak', 'end']);
  assert.ok(r.log[2].t - (takes - 300) <= 320, `the wire call waited ${r.log[2].t - (takes - 300)} ms`);
  // "Nearly done" was wrong (a slow voice): half a second on, the line is cut off after all.
  r = rig({ syllablesASecond: 2 });
  r.queue.speak(SHORT);
  r.advance(takes - 300);
  r.queue.speak(WIRE);
  r.advance(10000);
  stop = r.log.find(x => x.ev === 'stop'); wire = r.log.find(x => x.text === WIRE.text);
  assert.equal(stop.t, takes - 300 + 500);
  assert.equal(wire.t, stop.t + 250);
});

test('stopping forgets the line that was waiting, and nothing is spoken within a quarter of a second of a cancel', () => {
  const r = rig();
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Rusty Nickel is making a run!', late: 30 });
  r.queue.stop();
  r.advance(100);
  r.queue.speak({ text: 'Velvet Hunch takes over!', late: 1, rank: 1 });
  r.advance(5000);
  const said = r.log.filter(x => x.ev === 'speak');
  assert.deepEqual(said.map(x => x.text), [LONG.text, 'Velvet Hunch takes over!']);
  assert.equal(said[1].t, 750, 'the next line should come 250 ms after the cancel');
  // Stopping with nothing being said doesn't cancel anything, so it doesn't hold the next line up.
  r.queue.stop();
  r.queue.speak({ text: 'A furlong to go.' });
  assert.equal(r.log.filter(x => x.ev === 'stop').length, 1);
  assert.equal(r.log[r.log.length - 1].text, 'A furlong to go.');
  // Letting the line finish (on the way to the results): it ends by itself, and nothing follows it.
  r.queue.speak({ text: 'Rusty Nickel is making a run!', late: 30 });
  r.queue.settle();
  r.advance(5000);
  assert.deepEqual(r.log.slice(-2).map(x => [x.ev, x.text]), [['speak', 'A furlong to go.'], ['end', 'A furlong to go.']]);
});

test('coming back to the page cancels once whatever the queue believes, and the next line follows', () => {
  const r = rig();
  r.queue.speak(LONG);
  r.advance(500);
  r.queue.speak({ text: 'Rusty Nickel is making a run!', late: 30 });
  r.queue.stop();    // the page goes out of sight
  r.advance(60000);
  r.queue.unstick(); // and comes back
  r.advance(100);
  r.queue.speak({ text: 'A furlong to go.' });
  r.advance(5000);
  assert.deepEqual(r.log.map(x => [x.ev, x.t, x.ev === 'stop' ? x.cut : x.text]), [['speak', 0, LONG.text], ['stop', 500, LONG.text], ['stop', 60500, null], ['speak', 60750, 'A furlong to go.'], ['end', r.log[4].t, 'A furlong to go.']]);
});

test('a voice that goes quiet is cancelled and the call carries on', () => {
  // It has said when lines start, and now doesn't: stuck. Cancelled after a second and a half.
  let r = rig();
  r.queue.speak({ text: "And they're off!" });
  r.advance(3000);
  r.events = false;
  r.queue.speak(LONG);
  r.advance(1400);
  assert.equal(r.log.filter(x => x.ev === 'stop').length, 0);
  r.advance(200);
  assert.deepEqual(r.log.filter(x => x.ev === 'stop').map(x => [x.why, x.cut]), [['silent', LONG.text]]);
  r.events = true;
  r.queue.speak({ text: 'The quarter in twenty-two and three.' });
  r.advance(5000);
  assert.equal(texts(r.log, 'end').pop(), 'The quarter in twenty-two and three.', "the call didn't carry on after a stuck line");
  // It starts a line and never ends it (Chrome's voices that need the internet can): cancelled after
  // twice the line's time and two seconds, and the line waiting behind it is said if it's still wanted.
  r = rig();
  r.queue.speak({ text: "And they're off!" });
  r.advance(3000);
  r.queue.speak(LONG);
  r.advance(100);
  r.events = false; // the line has started; from here the voice says nothing
  const patience = (2 * sayTime(LONG.text, 1.15) + 2) * 1000;
  r.log.length = 0;
  r.queue.speak({ text: 'Second and third, and the time.', late: 60 });
  r.advance(patience - 200);
  assert.deepEqual(r.log, []);
  r.advance(600);
  assert.deepEqual(r.log.map(x => [x.ev, x.why || x.text]), [['stop', 'stalled'], ['speak', 'Second and third, and the time.']]);
  assert.equal(r.log[1].t - r.log[0].t, 250);
});

test('a voice that never says when it starts or ends still reads the call, a line at a time and uncut', () => {
  // Nothing here can tell such a voice from one that's stuck, so each line is given the time it could
  // take before it's cancelled (which unsticks one that is stuck), and the next line due is said.
  const r = rig({ events: false });
  const lines = ["And they're off!", 'Copper Detour goes right to the front. Velvet Hunch second.', 'The quarter in twenty-two and three.', 'Down the backstretch, Copper Detour leads by two lengths.', 'Around the far turn, Copper Detour leads by a length.', "Turning for home, it's Copper Detour by a head.", 'Copper Detour wins it by a neck!'];
  lines.forEach((text, k) => { r.queue.speak({ text, wire: k === lines.length - 1 }); r.advance(12000); });
  r.advance(20000);
  assert.deepEqual(texts(r.log), lines, 'the call went silent, or a line was said twice');
  const said = r.log.filter(x => x.ev === 'speak');
  r.log.filter(x => x.ev === 'stop').forEach(stop => {
    const line = said.filter(x => x.t <= stop.t).pop();
    assert.ok(stop.t - line.t >= sayTime(line.text, line.rate) * 2000, `"${line.text}" was cancelled ${stop.t - line.t} ms in`);
  });
});

// The watch screen's loop (js/ui/watch.js frame()) at normal speed, in plain Node: each line is handed to
// the queue when it comes up, with the pace for that moment and the race's own clock, slow motion and all.
function replay(r, race) {
  let T = -5.2, shown = -1, ended = false, endedAt = 0;
  const clock = () => (ended ? race.endT + (r.now() - endedAt) / 1000 : T);
  const cameUp = new Map();
  const say = line => { cameUp.set(line, clock()); r.queue.speak(line, { ...pace(line, race.winT - T), clock }); };
  r.stamp = clock;
  r.queue.prepare(race.lines);
  while (!ended) {
    r.advance(1000 / 30);
    const slow = race.close && T > race.winT - 2.2 && T < race.winT + 0.6 ? 0.4 : 1;
    T = Math.min(race.endT, T + slow / 30);
    let idx = -1;
    for (let i = 0; i < race.lines.length; i++) if (race.lines[i].t <= T - race.t0) idx = i;
    if (idx !== shown && idx >= 0) { shown = idx; say(race.lines[idx]); }
    if (T >= race.endT - 0.01) { ended = true; endedAt = r.now(); }
  }
  if (race.official) { r.advance(3200); say(officialLine(race.official)); }
  r.advance(15000);
  return cameUp;
}

test("the voice is never asked to go faster than 1.2 times its own speed, or higher than its own pitch", async () => {
  // Sped up, a device's voice gets higher as well as faster: fine at 1.15, a chipmunk at 1.4 and up. The
  // pace was built to climb to 1.6 with the pitch raised. Whatever is asked of the page's queue, the
  // browser's voice is handed no more than its limit.
  audio.setVoice(true);
  arrive(IPHONE);
  await new Promise(done => setTimeout(done, 300)); // clear of the last cancel: the page's own queue keeps real time
  const from = spoken.length;
  audio.hearIt({ text: "Turning for home, it's Copper Detour by a length and a half!" }, { rate: 1.6, pitch: 1.12 });
  // (The silent word that unlocks a phone's voice may come first: it's no faster.)
  assert.ok(spoken.slice(from).every(u => u.rate <= 1.2), "the browser's voice was asked for more");
  assert.deepEqual(spoken.slice(from).filter(u => u.volume !== 0).map(u => [u.rate, u.pitch]), [[1.2, 1]], "the browser's voice was asked for more");
  // And the pace asked for at every point of a race is inside it already: steady, then a small climb.
  for (const kind of ['pre', 'off', 'call', 'frac', 'finish']) {
    for (let toWire = 120; toWire >= -5; toWire -= 0.5) {
      for (const wire of [false, true]) {
        const p = pace({ kind, wire }, toWire);
        assert.ok(p.rate >= 1.15 && p.rate <= 1.2 && p.pitch === 1, `${kind} ${toWire} s from the wire: ${p.rate}, ${p.pitch}`);
      }
    }
  }
  assert.deepEqual([pace({ kind: 'call' }, 60), pace({ kind: 'call' }, 18), pace({ kind: 'finish', wire: true }, 0), pace({ kind: 'finish' }, -3)],
    [{ rate: 1.15, pitch: 1 }, { rate: 1.175, pitch: 1 }, { rate: 1.2, pitch: 1 }, { rate: 1.15, pitch: 1 }]);
});

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
// What each engine makes of the number it's given, from its own source (see engineOf in js/audio.js).
// WebKit's curve between Apple's default and its maximum isn't published: a straight line is the quickest
// it could be, and an even ratio the slowest.
const DELIVERS = {
  'an Apple voice, on a straight line': r => (r <= 1 ? r : 1 + 3 * Math.min(1, r - 1)),
  'an Apple voice, on an even ratio': r => (r <= 1 ? r : Math.pow(4, Math.min(1, r - 1))),
  'a Microsoft voice in Chrome on Windows': r => Math.pow(3, Math.trunc(10 * Math.log10(r)) / 10),
  'a plain multiple': r => r,
};

test("the pace asked for is the pace a device gives: an iPhone isn't sent to half as fast again, and Windows is known to stay put", async () => {
  // A rate of 1.15 was taken to mean 1.15 times a voice's own speed everywhere. On an iPhone (and in Safari
  // or Firefox on a Mac) it's somewhere between 1.23 and 1.45 times, and 1.2 up to 1.6; in Chrome on
  // Windows a Microsoft voice doesn't change speed at all below a rate of 1.26.
  const david = { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true };
  const aria = { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false };
  const samantha = { name: 'Samantha', lang: 'en-US', localService: true };
  assert.deepEqual([engineOf(samantha, UA.iphone), engineOf(samantha, UA.iphoneChrome), engineOf(samantha, UA.ipad, 5), engineOf(samantha, UA.macSafari), engineOf(samantha, UA.macFirefox)], ['apple', 'apple', 'apple', 'apple', 'apple']);
  assert.deepEqual([engineOf(samantha, UA.macChrome), engineOf(null, UA.android), engineOf({ name: 'Chrome OS US English 4' }, UA.chromebook), engineOf(david, UA.winFirefox), engineOf(aria, UA.winEdge), engineOf(samantha, '')], ['plain', 'plain', 'plain', 'plain', 'plain', 'plain']);
  assert.deepEqual([engineOf(david, UA.winChrome), engineOf(david, UA.winEdge), engineOf(null, UA.winChrome)], ['sapi', 'sapi', 'sapi']);
  // Asked for 1.15 to 1.2 times its own speed, no engine is handed more than 1.2, an Apple voice is handed
  // 1.05 to 1.07, and what comes out is never past 1.25 times, whichever way Apple's curve goes.
  for (let p = 1; p <= 1.2001; p += 0.005) {
    for (const kind of ['apple', 'sapi', 'plain']) assert.ok(engineRate(p, kind) <= 1.2 && engineRate(p, kind) >= 1, `${kind} at ${p.toFixed(3)}: ${engineRate(p, kind)}`);
    const r = engineRate(p, 'apple');
    assert.ok(DELIVERS['an Apple voice, on a straight line'](r) <= p + 1e-3 && DELIVERS['an Apple voice, on an even ratio'](r) <= p, `an Apple voice asked for ${p.toFixed(3)} is given ${r}`);
    // The speed the plan takes the voice to be going at lies between the two curves.
    const taken = engineSpeed(r, 'apple');
    assert.ok(taken <= DELIVERS['an Apple voice, on a straight line'](r) + 1e-9 && taken >= DELIVERS['an Apple voice, on an even ratio'](r) - 1e-9, `taken to be ${taken} at ${r}`);
    assert.equal(engineSpeed(engineRate(p, 'sapi'), 'sapi'), DELIVERS['a Microsoft voice in Chrome on Windows'](p));
    assert.equal(engineSpeed(engineRate(p, 'plain'), 'plain'), p);
  }
  assert.deepEqual([engineRate(1.15, 'apple'), engineRate(1.2, 'apple'), engineRate(1.15, 'sapi'), engineSpeed(1.15, 'sapi'), engineSpeed(1.2, 'sapi'), engineSpeed(1.3, 'sapi')], [1.05, 1.0667, 1.15, 1, 1, Math.pow(3, 0.1)]);
  // Through the page's own voice on an iPhone: whatever pace is asked of it, the number the phone gets
  // comes out at no more than 1.25 times the voice's own speed.
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return onLine; }, userAgent: UA.iphone, maxTouchPoints: 5 }, configurable: true });
  try {
    audio.setVoice(true);
    arrive([]);
    arrive(IPHONE);
    for (const asked of [1, 1.15, 1.2, 1.4, 1.6, 2]) {
      await new Promise(done => setTimeout(done, 300)); // clear of the last cancel
      const from = spoken.length;
      audio.hearIt({ text: 'They turn for home! Copper Detour by a length and a half!' }, { rate: asked, pitch: 1 });
      const said = spoken.slice(from).filter(u => u.volume !== 0);
      assert.equal(said.length, 1);
      const delivered = DELIVERS['an Apple voice, on a straight line'](said[0].rate);
      assert.ok(delivered <= 1.25 && said[0].rate >= 1 && said[0].pitch === 1, `asked for ${asked}, the phone is given ${said[0].rate}, which is up to ${delivered.toFixed(2)} times`);
    }
    // A line asked for at 1.2 is taken to last about as long as one at 1.15 would on a plain engine.
    assert.ok(Math.abs(audio.voiceSeconds('They turn for home! Copper Detour by a length and a half!', 1.2) - lineTime('They turn for home! Copper Detour by a length and a half!', 1.148)) < 0.01);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    arrive([]);
    arrive(IPHONE);
  }
});

test("a voice's lines are timed, and after three of them the call is planned to its pace", () => {
  // The middle one of the ratios, once there are three, held between 0.7 and 1.4.
  const g = gauge();
  assert.equal(g.factor(), 1);
  g.heard(2.4, 2); g.heard(3.6, 3);
  assert.equal(g.factor(), 1, 'two lines are not enough to go by');
  g.heard(1.1, 1);
  assert.ok(Math.abs(g.factor() - 1.2) < 1e-9, `${g.factor()}`);
  g.heard(0.2, 0.3); // too short a line to tell anything by
  assert.equal(g.lines(), 3);
  for (let k = 0; k < 5; k++) g.heard(9, 3);
  assert.equal(g.factor(), 1.4, 'no voice is taken to be more than 1.4 times slower than the model');
  const quick = gauge();
  for (let k = 0; k < 3; k++) quick.heard(1, 3);
  assert.equal(quick.factor(), 0.7);
  // The queue reports each line from the voice's word that it started to its word that it ended, and
  // says nothing of a line when the voice gave no word that it started.
  const r = rig({ startAfter: 120 });
  const times = [];
  r.heard = (line, seconds, rate) => times.push([line.text, +seconds.toFixed(3), rate]);
  r.queue.speak({ text: 'The quarter in twenty-two and three.' }, { rate: 1.15 });
  r.advance(10000);
  assert.deepEqual(times, [['The quarter in twenty-two and three.', +(sayTime('The quarter in twenty-two and three.', 1.15) - 0.12).toFixed(3), 1.15]]);
  r.events = false;
  r.queue.speak({ text: 'The half in forty-six flat.' });
  r.advance(30000);
  assert.equal(times.length, 1, 'a line the voice never said it had started was timed');
});

test('over a race at normal speed no line is cut off before the wire, the wire call is always made, and the pace climbs', () => {
  // Every line used to cancel the one before it: by a model of how long a voice takes, about one line in
  // seven was cut off mid-sentence, in most races, all at one pace. Two race days here, with a voice as
  // quick as the queue expects, one slower and one quicker.
  const w = createWorld('test-voice', '2026-09-26');
  const races = [];
  for (let d = 0; d < 2; d++) {
    for (const race of w.cards[w.day].races) {
      const run = simulateRace(race, w, { record: true });
      const call = raceCall(race, run, race.entries.map(e => w.horses[e.hid].name));
      races.push({ no: `race day ${d + 1}, race ${race.no}`, lines: call.lines, official: call.official, t0: run.t0, winT: run.t0 + run.results[0].time, endT: run.frames.length * run.dt, close: !!(run.results[1] && run.results[1].toPrev < 0.6) });
      applyResult(w, race, run, race.entries.map(() => 3));
    }
    nextDay(w);
  }
  for (const syllablesASecond of [3.7, 4.3, 4.9]) {
    let lines = 0, spoken = 0;
    for (const race of races) {
      const r = rig({ syllablesASecond });
      const cameUp = replay(r, race);
      const at = `${race.no}, ${syllablesASecond} syllables a second`;
      const said = r.log.filter(x => x.ev === 'speak'), stops = r.log.filter(x => x.ev === 'stop');
      lines += race.lines.length; spoken += said.length;
      // Nothing is cancelled from the off to the wire. After it, only the call at the wire may cut in.
      assert.deepEqual(stops.filter(x => x.T >= 0 && x.T <= race.winT).map(x => x.cut), [], `${at}: cancelled during the running`);
      for (const stop of stops) {
        const then = said.find(x => x.t > stop.t);
        assert.ok(then && then.line.wire, `${at}: "${stop.cut}" was cut off, and not by the call at the wire`);
      }
      for (const x of said) {
        const stop = stops.filter(y => y.t <= x.t).pop();
        assert.ok(!stop || x.t - stop.t >= 250, `${at}: "${x.text}" came ${stop && x.t - stop.t} ms after a cancel`);
      }
      // The call at the wire is made, promptly; any other line is said within the time it's allowed.
      const wire = said.filter(x => x.line.wire);
      assert.equal(wire.length, 1, `${at}: the call at the wire was made ${wire.length} times`);
      assert.ok(wire[0].T - cameUp.get(wire[0].line) <= 0.8, `${at}: the call at the wire came ${(wire[0].T - cameUp.get(wire[0].line)).toFixed(2)} s late`);
      for (const x of said) if (!x.line.wire) assert.ok(x.T - cameUp.get(x.line) <= x.line.late + 0.05, `${at}: "${x.text}" was said ${(x.T - cameUp.get(x.line)).toFixed(2)} s late`);
      // The pace: steady early, never falling back before the wire, quickest at the wire (and never past
      // 1.2 times the voice's own speed, or off its own pitch), and back to steady for the placings.
      const running = said.filter(x => x.T >= 0 && x.T <= race.winT + 1 && x.line.kind !== 'pre');
      running.forEach((x, k) => { if (k) assert.ok(x.rate >= running[k - 1].rate, `${at}: the pace falls at "${x.text}"`); });
      assert.deepEqual([running[0].rate, running[0].pitch], [1.15, 1], `${at}: the pace at the start`);
      assert.deepEqual([wire[0].rate, wire[0].pitch], [1.2, 1], `${at}: the pace at the wire`);
      const before = running[running.length - 2];
      assert.ok(before.rate > 1.17 && before.rate <= 1.2, `${at}: the last line before the wire is at ${before.rate}`);
      for (const x of said) {
        assert.ok(x.rate <= 1.2 && x.pitch === 1, `${at}: "${x.text}" was asked for at ${x.rate}, pitch ${x.pitch}`);
        if (x.line.kind === 'pre') assert.equal(x.rate, 1.15, `${at}: the pace before the start`);
        if (x.line.kind === 'finish' && !x.line.wire) assert.deepEqual([x.rate, x.pitch], [1.15, 1], `${at}: the pace of "${x.text}"`);
      }
    }
    // Lines are left out when the voice is still on the one before (more with a slow voice), but not many.
    assert.ok(spoken / lines > 0.9, `${syllablesASecond} syllables a second: ${spoken} of ${lines} lines were said`);
  }
});

test('"And they\'re off!" is said in a race with a name, even by a slow voice', () => {
  // "The field is in the gate for the Odds and Ends Handicap." takes a voice about three seconds, and it
  // came up 2.6 seconds before the off: in a card's feature race the line was still being said at the
  // off, which was cut off by it once and left out for it since. A named race's line now comes up sooner.
  const w = createWorld('test-voice', '2026-09-26');
  const race = w.cards[w.day].races[0];
  const run = simulateRace(race, w, { record: true });
  for (const { name } of [...STAKES, BIG_STAKES, { name: '' }]) {
    const call = raceCall({ ...race, name }, run, race.entries.map(e => w.horses[e.hid].name));
    const named = { lines: call.lines, official: call.official, t0: run.t0, winT: run.t0 + run.results[0].time, endT: run.frames.length * run.dt, close: false };
    assert.ok(run.t0 + call.lines[0].t > -5.2, `${name}: the first line is due before the race screen opens`);
    for (const syllablesASecond of [3.7, 4.3, 4.9]) {
      const r = rig({ syllablesASecond });
      replay(r, named);
      const start = r.log.filter(x => x.ev !== 'stop' && x.T < 3).map(x => `${x.ev} ${x.text}`);
      assert.deepEqual(start.slice(0, 4), [`speak ${call.lines[0].say}`, `end ${call.lines[0].say}`, "speak And they're off!", "end And they're off!"], `${name || 'no name'}, ${syllablesASecond} syllables a second`);
      assert.equal(r.log.filter(x => x.ev === 'stop' && x.T < 3).length, 0, `${name}: a line was cut off at the start`);
    }
  }
});
