// The downloaded voice at work, in a worker of its own so that making a line never holds up the picture.
// It is asked for a line of text at a speed and answers with the sound: the samples, and how long they run.
//
// Everything it runs comes out of the cache the download filled (js/joe.js), never from the network: the
// voice's model, onnxruntime-web to run it, and the phonemizer with espeak-ng's data for English. See
// voice/NOTICE for what each is. A line is made the way Python Piper made the clips the voice was chosen
// from: text to sounds a sentence at a time, each sentence through the model, the pieces cut to their
// speech and joined (js/joe-speech.js).
//
// Faster speech is the model talking faster: its length_scale is the voice's own divided by the speed. The
// sound is never played back faster, which would raise its pitch.
//
// Messages in, each with an `id` that comes back on its answer, taken strictly one after another:
//   { type: 'load', cache, base }      -> { ms, threads, rate }
//   { type: 'speak', text, speed, ids } -> { samples, rate, seconds, sentences, ms, loudness, limited, ids? }
// or { error } when something went wrong. The page ends the worker to have its memory back (shutdown() in
// js/joe.js).
import { phonemizer, phonemeIds, trimToSpeech, joinSentences, atLoudness, soundManifest } from './joe-speech.js';

const CONFIG = 'joe/en_US-joe-medium.onnx.json', MODEL = 'joe/en_US-joe-medium.onnx';
const SLOWEST = 0.7, FASTEST = 1.8; // the speeds it will be asked to talk at, at the outside

let voice = null; // once loaded: { ort, session, config, sounds, rate }

const words = bytes => new TextDecoder().decode(bytes);
const address = (bytes, type) => URL.createObjectURL(new Blob([bytes], { type }));

async function load({ cache, base }) {
  if (voice) return [{ ms: 0, threads: 1, rate: voice.rate }];
  const began = performance.now();
  const store = await caches.open(cache);
  const read = async path => {
    const kept = await store.match(base + path);
    if (!kept) throw new Error(`${path} is missing from the download`);
    return kept.arrayBuffer();
  };
  const manifest = JSON.parse(words(await read('manifest.json')));
  if (!soundManifest(manifest) || !manifest.whole || !manifest.whole[MODEL]) throw new Error("the download's list of files can't be read");
  const config = JSON.parse(words(await read(CONFIG)));

  // onnxruntime-web, from the copies in the cache. It is told where its own two files are, since it can't
  // find them beside itself, and to use one thread: the site isn't served in the way threads need.
  const ort = await import(address(await read('ort/ort.wasm.min.mjs'), 'text/javascript'));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    mjs: address(await read('ort/ort-wasm-simd-threaded.mjs'), 'text/javascript'),
    wasm: address(await read('ort/ort-wasm-simd-threaded.wasm'), 'application/wasm'),
  };

  // The model, put together from its parts.
  const whole = manifest.whole[MODEL];
  let model = new Uint8Array(whole.bytes), at = 0;
  for (const part of whole.parts) {
    const bytes = new Uint8Array(await read(part));
    if (at + bytes.length > model.length) throw new Error("the voice's parts don't add up");
    model.set(bytes, at);
    at += bytes.length;
  }
  if (at !== model.length) throw new Error("the voice's parts don't add up");
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  model = null; // the runtime has its own copy now

  const sounds = phonemizer({
    glue: words(await read('phonemize/piper_phonemize.js')),
    wasm: await read('phonemize/piper_phonemize.wasm'),
    data: await read('espeak-ng-data/en.tar'),
  });
  voice = { ort, session, config, sounds, rate: config.audio.sample_rate };
  return [{ ms: Math.round(performance.now() - began), threads: ort.env.wasm.numThreads, rate: voice.rate }];
}

async function speak({ text, speed = 1, ids: wantIds = false }) {
  if (!voice) throw new Error('the voice is not loaded');
  const began = performance.now();
  const { ort, session, config, rate } = voice;
  const pace = Math.min(FASTEST, Math.max(SLOWEST, +speed || 1));
  const { noise_scale: noise, length_scale: length, noise_w: noiseW } = config.inference;
  const [sentences] = await voice.sounds([String(text)], config.espeak.voice);
  const pieces = [], fed = [];
  for (const sentence of sentences) {
    const ids = phonemeIds(sentence, config);
    fed.push(ids);
    const out = await session.run({
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([noise, length / pace, noiseW]), [3]),
    });
    pieces.push(trimToSpeech(out[session.outputNames[0]].data, rate));
  }
  const line = atLoudness(joinSentences(pieces, rate), rate);
  const answer = {
    samples: line.samples, rate, seconds: line.samples.length / rate, sentences: pieces.length,
    ms: Math.round(performance.now() - began), loudness: line.loudness, gain: line.gain, limited: line.limited,
  };
  if (wantIds) answer.ids = fed;
  return [answer, [line.samples.buffer]];
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  const work = { load, speak }[data.type];
  queue = queue.then(() => (work ? work(data) : Promise.reject(new Error(`no such request: ${data.type}`)))).then(
    ([answer, hand]) => self.postMessage({ id: data.id, ...answer }, hand || []),
    error => self.postMessage({ id: data.id, error: String((error && error.message) || error) }),
  );
};
