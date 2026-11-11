// The caller's downloaded voice, without a browser:  node --test test/joe.test.mjs
// The numbers its model is fed, against Python Piper's for the same lines; its files, against the list
// that the download checks them by; and the arithmetic that turns the model's sound into a line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { phonemizer, phonemeIds, sentencesOf, trimToSpeech, joinSentences, loudness, atLoudness, untar, isFile, soundManifest, LOUDNESS, CEILING } from '../js/joe-speech.js';
import { JOE } from '../js/joe.js';

const voice = path => readFileSync(new URL(`../voice/${path}`, import.meta.url));
const manifest = JSON.parse(voice('manifest.json'));
const config = JSON.parse(voice('joe/en_US-joe-medium.onnx.json'));
// test/joe.fixture.json is Python Piper 1.8.0's own numbers for 1,634 lines (tools/joe-reference.py).
const fixture = JSON.parse(readFileSync(new URL('./joe.fixture.json', import.meta.url), 'utf8'));

test('the voice is fed the numbers Python Piper feeds it, for every line of 64 races', async () => {
  const sounds = phonemizer({ glue: String(voice('phonemize/piper_phonemize.js')), wasm: voice('phonemize/piper_phonemize.wasm'), data: voice('espeak-ng-data/en.tar'), require: createRequire(import.meta.url) });
  assert.ok(fixture.races >= 50 && fixture.lines.length > 1000, 'too few lines to check the voice on');
  const wrong = [];
  let sentences = 0, joined = 0;
  for (let i = 0; i < fixture.lines.length; i += 40) {
    const batch = fixture.lines.slice(i, i + 40);
    const got = await sounds(batch.map(l => l[0]), config.espeak.voice);
    got.forEach((line, k) => {
      const mine = line.map(s => phonemeIds(s, config)), theirs = batch[k].slice(1).map(b => [...Buffer.from(b, 'base64')]);
      sentences += mine.length;
      joined += mine.flat().filter(id => id >= 161).length;
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) wrong.push(batch[k][0]);
    });
  }
  assert.deepEqual(wrong, [], 'lines whose sounds are not the ones Python Piper gives the voice');
  // The check has teeth: lines of more than one sentence, the vowel pairs this voice has one number for
  // (thousands of them), and the linking sound that the data was changed to write (tools/voice-files.mjs).
  assert.ok(sentences > fixture.lines.length + 100 && joined > 1000, `${sentences} sentences, ${joined} joined vowel pairs`);
  const [[early]] = await sounds(['the early lead'], config.espeak.voice);
  assert.equal(early.join(''), 'ðɪʲ ˈɜːli lˈiːd', 'the linking sound after "the" before a vowel');
  // One at a time, as a race asks for them, and many more than the published program lasts for in one go.
  for (let i = 0; i < 90; i++) await sounds([fixture.lines[i][0]], config.espeak.voice);
});

test('a sentence is numbered the way Piper numbers it', () => {
  // "by a half": the two sounds of "by"'s vowel are one number (161) for this voice, with the start mark,
  // the end mark and a pad after every sound.
  const ids = phonemeIds(['b', 'a', 'ɪ', ' ', 'ɐ'], config);
  assert.deepEqual(ids, [1, 0, 15, 0, 161, 0, 3, 0, 50, 0, 2]);
  // Without the pairs (an older voice's config), each sound keeps its own number.
  assert.deepEqual(phonemeIds(['b', 'a', 'ɪ'], { ...config, vowel_clusters: undefined }), [1, 0, 15, 0, 14, 0, 74, 0, 2]);
  // The phonemizer's answer, split into its sentences by the framing of its own numbers.
  assert.deepEqual(sentencesOf({ phonemes: ['a', '.', 'b', 'c', '!'], phoneme_ids: [1, 0, 14, 0, 10, 0, 2, 1, 0, 15, 0, 16, 0, 4, 0, 2] }), [['a', '.'], ['b', 'c', '!']]);
  assert.throws(() => sentencesOf({ phonemes: ['a', 'b'], phoneme_ids: [1, 0, 14, 0, 2] }), /no number/);
});

test("the voice's files are the ones the list says, in parts small enough to push", async () => {
  assert.ok(soundManifest(manifest), 'voice/manifest.json is not a list the download would take');
  for (const file of manifest.files) {
    const bytes = voice(file.path);
    assert.ok(await isFile(file, bytes), `voice/${file.path} is not the file the list says`);
    assert.ok(file.bytes <= 16 * 1024 * 1024, `voice/${file.path} is over 16 MB`);
  }
  // The model's parts, end to end, are the model as published (its SHA-256 is Hugging Face's own for the file).
  const [[name, whole]] = Object.entries(manifest.whole);
  const model = Buffer.concat(whole.parts.map(p => voice(p)));
  assert.deepEqual([name, model.length, createHash('sha256').update(model).digest('hex')], ['joe/en_US-joe-medium.onnx', whole.bytes, whole.sha256]);
  assert.equal(whole.sha256, 'abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2');
  assert.deepEqual(whole.parts, manifest.files.filter(f => f.of === name).map(f => f.path));
  // What the page says without fetching anything is what the list says.
  assert.deepEqual([JOE.cache, JOE.bytes], [manifest.cache, manifest.bytes], 'JOE in js/joe.js and voice/manifest.json disagree');
  // A file that arrives damaged, or cut short, is not taken.
  const one = manifest.files.find(f => f.path === 'joe/MODEL_CARD'), card = voice(one.path);
  const damaged = Buffer.from(card); damaged[10] ^= 1;
  assert.deepEqual([await isFile(one, card), await isFile(one, damaged), await isFile(one, card.subarray(0, card.length - 1))], [true, false, false]);
  // Nor is a list that points outside the voice's folder, or whose sizes don't add up.
  assert.equal(soundManifest({ ...manifest, files: [{ ...manifest.files[0], path: '../index.html' }, ...manifest.files.slice(1)] }), false);
  assert.equal(soundManifest({ ...manifest, bytes: manifest.bytes + 1 }), false);
  assert.equal(soundManifest(null), false);
});

test("espeak-ng's data is English only, and the offline copy leaves the voice alone", () => {
  const names = untar(voice('espeak-ng-data/en.tar')).map(f => f.name);
  assert.deepEqual(names.filter(n => n.endsWith('_dict')), ['en_dict']);
  for (const need of ['phontab', 'phonindex', 'phondata', 'intonations', 'lang/gmw/en-US']) assert.ok(names.includes(need), `${need} is not in the data`);
  // None of the voice's files is in the list the offline worker fetches on every release, and the caches
  // it never deletes are the ones the voice is kept in.
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(/'voice\//.test(sw.match(/SHELL = \[([^\]]*)\]/)[1]), false, "sw.js's SHELL lists a file of the voice");
  const keeps = new RegExp(sw.match(/const VOICE = \/(.*)\/;/)[1]);
  assert.deepEqual([keeps.test(JOE.cache), keeps.test('post-time-v5')], [true, false]);
});

// A second of a 220 Hz tone at `level`, with `quiet` seconds of nothing before and after it.
const RATE = 22050;
function tone(level, seconds = 1, quiet = 0.3, hz = 220) {
  const out = new Float32Array(Math.round((seconds + 2 * quiet) * RATE)), from = Math.round(quiet * RATE);
  for (let i = 0; i < Math.round(seconds * RATE); i++) out[from + i] = level * Math.sin(2 * Math.PI * hz * i / RATE);
  return out;
}
const peakOf = a => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('loudness is measured the broadcasters\' way', () => {
  // The standard's own check: a 997 Hz tone at full scale measures -3.01 LUFS.
  const full = new Float32Array(RATE * 3);
  for (let i = 0; i < full.length; i++) full[i] = Math.sin(2 * Math.PI * 997 * i / RATE);
  assert.ok(Math.abs(loudness(full, RATE) + 3.01) < 0.05, `a full-scale 997 Hz tone measures ${loudness(full, RATE)}`);
  // A tenth of that is 20 dB down. Silence around it is left out of the measure, so it changes little:
  // only the blocks that are part tone and part silence, at each end, pull it down (by 0.4 here).
  const tenth = full.map(x => x / 10), padded = new Float32Array(RATE * 9);
  padded.set(tenth, RATE * 3);
  assert.ok(Math.abs(loudness(tenth, RATE) + 23.01) < 0.05, `a tenth of full scale measures ${loudness(tenth, RATE)}`);
  assert.ok(Math.abs(loudness(padded, RATE) + 23.42) < 0.1, `with silence round it, ${loudness(padded, RATE)}`);
  assert.equal(loudness(new Float32Array(RATE), RATE), -Infinity);
});

test('a sentence is cut to its speech, and sentences are set 200 ms apart', () => {
  const piece = trimToSpeech(tone(0.25), RATE);
  // Brought up to full scale, with 40 ms kept before the speech and 80 ms after, faded.
  assert.ok(Math.abs(peakOf(piece.samples) - 1) < 0.001);
  assert.ok(Math.abs(piece.lead - 0.040) < 0.002 && Math.abs(piece.trail - 0.080) < 0.002, `${piece.lead} before, ${piece.trail} after`);
  assert.ok(Math.abs(piece.samples.length / RATE - 1.12) < 0.004);
  assert.deepEqual([piece.samples[0], piece.samples[piece.samples.length - 1]], [0, 0]);
  // Two of them: 200 ms from the end of the first's speech to the start of the second's.
  const line = joinSentences([piece, piece], RATE);
  assert.ok(Math.abs(line.length / RATE - (1.12 + 0.2 - 0.08 - 0.04 + 1.12)) < 0.004, `${line.length / RATE} s`);
  // Nothing but silence is no sentence at all.
  assert.equal(trimToSpeech(new Float32Array(1000), RATE).samples.length, 0);
  assert.equal(joinSentences([trimToSpeech(new Float32Array(1000), RATE), piece], RATE).length, piece.samples.length);
});

test('every line comes out at one loudness, and none of it over the ceiling', () => {
  const top = Math.pow(10, CEILING / 20);
  // A quiet line is brought up and a loud one down, to the same loudness.
  for (const level of [0.02, 0.2, 0.9]) {
    const line = atLoudness(tone(level, 2), RATE);
    assert.ok(Math.abs(loudness(line.samples, RATE) - LOUDNESS) < 0.1, `a tone at ${level} came out at ${loudness(line.samples, RATE)} LUFS`);
    assert.ok(peakOf(line.samples) <= top + 1e-6);
    assert.equal(line.limited, 0);
  }
  // A line with peaks far above the rest of it (speech is like that): the peaks are held under the
  // ceiling, not cut off flat, and the rest is left as it was.
  const spiky = tone(0.05, 3), spikes = [];
  for (let i = 8000; i < spiky.length - 8000; i += 11025) { spiky[i] = spikes.length % 2 ? 1 : -1; spikes.push(i); }
  const line = atLoudness(spiky, RATE);
  assert.ok(line.gain > 2 && line.limited > 0.01, `gain ${line.gain}, limited ${line.limited}`);
  assert.ok(peakOf(line.samples) <= top + 1e-6, `a peak of ${peakOf(line.samples)}`);
  // Each peak is at the ceiling, alone: nothing is clipped flat.
  for (const i of spikes) assert.ok(Math.abs(Math.abs(line.samples[i]) - top) < 1e-3, `the peak at ${i} came out at ${line.samples[i]}`);
  assert.equal(line.samples.filter(x => Math.abs(x) > top - 1e-4).length, spikes.length);
  // The limiter turns the sound down just before a peak and lets go after it: a millisecond before, it's
  // already down; 0.4 s after, the sound has only the gain.
  const [at] = spikes, near = at - 22, far = at + 8820;
  assert.ok(Math.abs(line.samples[near]) < Math.abs(spiky[near] * line.gain) * 0.9, 'the limiter did not turn down ahead of the peak');
  assert.ok(Math.abs(line.samples[far] - spiky[far] * line.gain) < Math.abs(spiky[far] * line.gain) * 0.01 + 1e-6, 'the limiter had not let go 0.4 s after a peak');
});
