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
const voice = {
  speak: u => spoken.push(u),
  cancel: () => {},
  getVoices: () => list,
  addEventListener: (type, fn) => { if (type === 'voiceschanged') listening.push(fn); },
};
const arrive = voices => { list = voices; for (const fn of listening) fn(); };
let onLine = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return onLine; } }, configurable: true });
globalThis.window = { speechSynthesis: voice };
globalThis.speechSynthesis = voice;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const audio = await import('../js/audio.js');
const { pickVoice, offeredVoices } = audio;
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
    'Chrome OS': [/^Google US English \d+ \(Natural\)$/, /^Google US English \d+ \(Natural\)$/], // a Chromebook's natural voices are on the device
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
