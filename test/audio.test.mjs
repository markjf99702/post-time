// Reading the race call aloud, in plain Node with a stand-in for the browser's voice:
//   node --test test/audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const spoken = [];
const voice = { speak: u => spoken.push(u.text), cancel: () => {}, getVoices: () => [] };
globalThis.window = { speechSynthesis: voice };
globalThis.speechSynthesis = voice;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const audio = await import('../js/audio.js');

test('the race call is read aloud with the sound off, and not with the voice off', () => {
  // Two separate ticks in the menu: Sound off, "Read the race call aloud" on.
  audio.setSound(false);
  audio.setVoice(true);
  audio.say("And they're off!");
  assert.deepEqual(spoken, ["And they're off!"], 'the call is silent with the sound off');
  audio.setSound(true);
  audio.setVoice(false);
  audio.say('The quarter in 22 and 3.');
  assert.deepEqual(spoken, ["And they're off!"], 'the call is read with the voice off');
});
