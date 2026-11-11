// The downloaded voice's arithmetic: the phonemizer's answer turned into the numbers the voice's model takes,
// and the model's sound turned into a line ready to play. No browser and no model in here, so the tests can
// run all of it in Node. js/joe-worker.js does the work with these; js/joe.js is the page's side.
//
// The voice is Piper's "Joe" (voice/NOTICE). What the tests hold this file to is Python Piper 1.8.0, which
// made the clips the voice was chosen from: the same numbers into the model for every line (test/joe.test.mjs),
// and each sentence of a line cut and joined the way those clips were.

// ---------------------------------------------------------------- phonemes to the model's numbers

// The phonemizer (piper_phonemize, run as its command) answers each text with one line of JSON: `phonemes`,
// every sound of the text as one character each with nothing between sentences, and `phoneme_ids`, its own
// numbers for them, a sentence at a time: 1, 0, then each sound's number and a 0, then 2. Its numbers are
// for older voices, so only how many sounds each sentence has is read off them.
export function sentencesOf({ phonemes, phoneme_ids: ids }) {
  const sentences = [];
  let at = 0;
  for (let i = 0; i < ids.length;) {
    if (ids[i] !== 1 || ids[i + 1] !== 0) throw new Error('the phonemizer answered in a way this was not written for');
    let n = 0;
    for (i += 2; i < ids.length && ids[i] !== 2; i += 2) n++;
    i++;
    sentences.push(phonemes.slice(at, at + n));
    at += n;
  }
  if (at !== phonemes.length) throw new Error('the phonemizer gave a sound it has no number for');
  return sentences.filter(s => s.length);
}

// One sentence's sounds as the voice's own numbers, from the table in its config (phoneme_id_map): the start
// mark, then each sound with a pad after it, then the end mark, as Piper does it (phoneme_ids.py). This
// voice has single numbers for five pairs of vowel sounds (config.vowel_clusters: the "i" of "time" is one
// sound to it, not "a" then "ɪ"), so those pairs are joined first, the longest that fits.
export function phonemeIds(phonemes, config) {
  const map = config.phoneme_id_map, pad = map._;
  const clusters = new Set((config.vowel_clusters || []).map(c => c.join('')));
  const longest = Math.max(1, ...(config.vowel_clusters || []).map(c => c.length));
  const ids = [...map['^'], ...pad];
  for (let i = 0; i < phonemes.length;) {
    let sound = phonemes[i], took = 1;
    for (let n = Math.min(longest, phonemes.length - i); n > 1; n--) {
      const joined = phonemes.slice(i, i + n).join('');
      if (clusters.has(joined)) { sound = joined; took = n; break; }
    }
    i += took;
    if (map[sound]) ids.push(...map[sound], ...pad); // a sound the voice has no number for is left out, as Piper leaves it
  }
  ids.push(...map.$);
  return ids;
}

// The phonemizer, ready to be asked: `glue` is the text of piper_phonemize.js as published, `wasm` its
// program and `data` espeak-ng's data for English, as a tar. The published program can't be asked many
// times over (it keeps what it used, and stops after about seventy texts), so each asking gets a fresh
// copy of it; the program is compiled once and the data unpacked once, and a fresh copy takes a few
// hundredths of a second. The glue expects its own package of every language's data (18 MB) and is given
// one of that size with nothing in it; the data that is read goes in a folder of its own.
// Answers, for each text, its sentences as lists of sounds. (`require` is Node's, for the tests.)
export function phonemizer({ glue, wasm, data, require }) {
  const make = new Function('require', '__filename', '__dirname', `${glue}\nreturn createPiperPhonemize;`)(require, 'piper_phonemize.js', '.');
  const nothing = new ArrayBuffer(+/"remote_package_size":\s*(\d+)/.exec(glue)[1]);
  const files = untar(data), DIR = '/english';
  let compiled = null;
  return async function sounds(texts, voice) {
    compiled = compiled || await WebAssembly.compile(wasm);
    const answers = [], said = [];
    const program = await make({
      instantiateWasm(imports, done) { WebAssembly.instantiate(compiled, imports).then(instance => done(instance)); return {}; },
      getPreloadedPackage: () => nothing,
      print: line => answers.push(line), printErr: line => said.push(line),
      noInitialRun: true,
    });
    for (const { name, bytes } of files) {
      const path = `${DIR}/${name}`;
      program.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      program.FS.writeFile(path, bytes);
    }
    program.callMain(['-l', voice, '--input', JSON.stringify(texts.map(text => ({ text }))), '--espeak_data', DIR]);
    if (answers.length !== texts.length) throw new Error(said.join(' ') || 'the phonemizer gave no answer');
    return answers.map(a => sentencesOf(JSON.parse(a)));
  };
}

// ---------------------------------------------------------------- the model's sound to a line

// The clips the voice was chosen from were made a sentence at a time, and so is a line here. Each sentence
// is brought up to full scale (Piper does that itself), cut down to its speech, and the sentences of a line
// are set 200 ms apart, from the end of one's speech to the start of the next's. Then the whole line is
// brought to one loudness, with a limiter for the few peaks that would be over the top.
const BEFORE = 0.040, AFTER = 0.080; // seconds of the model's own sound kept before a sentence's speech and after it
const FADE_IN = 0.005, FADE_OUT = 0.020;
const BETWEEN = 0.200;               // from the end of one sentence's speech to the start of the next's
export const LOUDNESS = -18;         // LUFS: the loudness of every line
export const CEILING = -1.5;         // dB of full scale: no sample of a line is over this

// One sentence cut to its speech: from the first sample within 40 dB of its loudest to the last, with a
// little of what's either side, faded. `lead` and `trail` are how much, in seconds.
export function trimToSpeech(sound, rate) {
  let peak = 0;
  for (let i = 0; i < sound.length; i++) { const a = Math.abs(sound[i]); if (a > peak) peak = a; }
  if (!(peak > 1e-8)) return { samples: new Float32Array(0), lead: 0, trail: 0 };
  const floor = 0.01; // of the loudest, once that's full scale
  let first = 0, last = sound.length - 1;
  while (Math.abs(sound[first]) <= peak * floor) first++;
  while (Math.abs(sound[last]) <= peak * floor) last--;
  const from = Math.max(0, first - Math.round(BEFORE * rate)), to = Math.min(sound.length, last + 1 + Math.round(AFTER * rate));
  const samples = new Float32Array(to - from);
  for (let i = 0; i < samples.length; i++) samples[i] = sound[from + i] / peak;
  const up = Math.min(samples.length, Math.round(FADE_IN * rate)), down = Math.min(samples.length, Math.round(FADE_OUT * rate));
  for (let i = 0; i < up; i++) samples[i] *= i / up;
  for (let i = 0; i < down; i++) samples[samples.length - 1 - i] *= i / down;
  return { samples, lead: (first - from) / rate, trail: (to - 1 - last) / rate };
}

// A line from its sentences (each as trimToSpeech gives it).
export function joinSentences(pieces, rate) {
  const spoken = pieces.filter(p => p.samples.length);
  const gaps = spoken.map((p, i) => (i ? Math.round(Math.max(0, BETWEEN - spoken[i - 1].trail - p.lead) * rate) : 0));
  const out = new Float32Array(spoken.reduce((n, p, i) => n + gaps[i] + p.samples.length, 0));
  let at = 0;
  spoken.forEach((p, i) => { at += gaps[i]; out.set(p.samples, at); at += p.samples.length; });
  return out;
}

// How loud a sound is, in LUFS, the broadcasters' measure (ITU-R BS.1770-4: the sound through a filter that
// weighs it as an ear does, its power in 400 ms blocks a quarter apart, the quiet blocks left out). ffmpeg's
// loudnorm measured the clips the same way; the test sets this beside ffmpeg's own figures.
export function loudness(sound, rate) {
  // The two filters of the standard, worked out for this sample rate (the standard gives them at 48 kHz).
  const stage = (f0, q, gainDb, shelf) => {
    const k = Math.tan(Math.PI * f0 / rate), vh = Math.pow(10, gainDb / 20), vb = Math.pow(vh, 0.4996667741545416);
    const a0 = 1 + k / q + k * k;
    return shelf
      ? { b: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0], a: [2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0] }
      : { b: [1, -2, 1], a: [2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0] };
  };
  const filters = [stage(1681.974450955533, 0.7071752369554196, 3.999843853973347, true), stage(38.13547087602444, 0.5003270373238773, 0, false)];
  let x = Float64Array.from(sound);
  for (const { b, a } of filters) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    x = y;
  }
  const block = Math.round(0.4 * rate), step = Math.round(0.1 * rate), powers = [];
  for (let from = 0; from + block <= x.length; from += step) {
    let sum = 0;
    for (let i = from; i < from + block; i++) sum += x[i] * x[i];
    powers.push(sum / block);
  }
  if (!powers.length) { // shorter than one block: all of it
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    powers.push(x.length ? sum / x.length : 0);
  }
  const lufs = p => -0.691 + 10 * Math.log10(p);
  const mean = list => list.reduce((s, p) => s + p, 0) / list.length;
  const heard = powers.filter(p => p > 0 && lufs(p) > -70);
  if (!heard.length) return -Infinity;
  const gate = lufs(mean(heard)) - 10;
  return lufs(mean(heard.filter(p => lufs(p) > gate)));
}

// A line at the one loudness: one gain for the whole of it, so the voice's own louds and softs stay, and a
// limiter that looks 3 ms ahead and lets go over 50 ms for the peaks the gain would put over the ceiling.
// Nothing comes out over the ceiling. Holding the peaks down takes a little off the loudness, so the gain
// is set again from what came out, twice at most. `limited` is how much the limiter had to do: of the
// hundredths of a second that have speech in them, the share with a peak it turned down.
export function atLoudness(sound, rate, { target = LOUDNESS, ceiling = CEILING } = {}) {
  const was = loudness(sound, rate);
  if (!Number.isFinite(was)) return { samples: Float32Array.from(sound), gain: 1, loudness: was, limited: 0 };
  let gain = Math.pow(10, (target - was) / 20), line = null;
  for (let go = 0; go < 3; go++) {
    line = limited(sound, rate, gain, Math.pow(10, ceiling / 20));
    if (!line.limited) break;
    const off = target - loudness(line.samples, rate);
    if (Math.abs(off) < 0.15) break;
    if (go < 2) gain *= Math.pow(10, off / 20);
  }
  return { samples: line.samples, gain, loudness: was, limited: line.limited };
}
function limited(sound, rate, gain, top) {
  const n = sound.length;
  const ahead = Math.max(1, Math.round(0.003 * rate)), letGo = Math.exp(-1 / (0.050 * rate));
  // What each sample needs turning down to, at least: 1 for most of them.
  const need = new Float32Array(n);
  const tick = Math.max(1, Math.round(0.01 * rate));
  let spoken = 0, over = 0;
  for (let from = 0; from < n; from += tick) {
    let peak = 0;
    for (let i = from; i < Math.min(n, from + tick); i++) { const a = Math.abs(sound[i]) * gain; need[i] = a > top ? top / a : 1; if (a > peak) peak = a; }
    if (peak > 0.01 * gain) spoken++;
    if (peak > top) over++;
  }
  const samples = new Float32Array(n);
  if (!over) {
    for (let i = 0; i < n; i++) samples[i] = sound[i] * gain;
    return { samples, limited: 0 };
  }
  // The least of them over the next 3 ms, so the turning down begins before the peak; let go slowly after
  // it; then smoothed over the same 3 ms. Every sample's own need is in each of the values averaged for
  // it, so the average is never more than it needs.
  const least = new Float32Array(n);
  const queue = new Int32Array(n); let head = 0, tail = 0; // the samples ahead that could be the least, in order
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[queue[tail - 1]] >= need[i]) tail--;
    queue[tail++] = i;
    while (queue[head] > i + ahead) head++;
    least[i] = need[queue[head]];
  }
  for (let i = 1; i < n; i++) least[i] = Math.min(least[i], 1 - (1 - least[i - 1]) * letGo);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += least[i];
    if (i > ahead) sum -= least[i - ahead - 1];
    samples[i] = sound[i] * gain * Math.min(need[i], sum / Math.min(i + 1, ahead + 1));
  }
  return { samples, limited: over / Math.max(1, spoken) };
}

// ---------------------------------------------------------------- the files

// The files in a plain tar (espeak-ng's data comes as one): [{ name, bytes }].
export function untar(buffer) {
  const all = new Uint8Array(buffer), text = new TextDecoder(), files = [];
  const field = (at, length) => text.decode(all.subarray(at, at + length)).replace(/\0.*$/, '');
  for (let at = 0; at + 512 <= all.length;) {
    const name = field(at, 100);
    if (!name) break;
    const size = parseInt(field(at + 124, 12), 8);
    if (all[at + 156] === 0 || all[at + 156] === 48) files.push({ name, bytes: all.subarray(at + 512, at + 512 + size) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

// A file's SHA-256, in hex.
export async function sha256(bytes) {
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(sum, b => b.toString(16).padStart(2, '0')).join('');
}
// True when `bytes` is the file the manifest lists as `entry`: its length and its SHA-256.
export async function isFile(entry, bytes) {
  return bytes.byteLength === entry.bytes && await sha256(bytes) === entry.sha256;
}
// A manifest read from the network or the cache is trusted only as far as this: it lists files inside the
// voice's folder, each with a size and a sum, and its total is theirs.
export function soundManifest(m) {
  const ok = m && typeof m.cache === 'string' && Array.isArray(m.files) && m.files.length > 0
    && m.files.every(f => f && typeof f.path === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(f.path) && !f.path.includes('..')
      && Number.isInteger(f.bytes) && f.bytes >= 0 && /^[0-9a-f]{64}$/.test(f.sha256))
    && m.bytes === m.files.reduce((n, f) => n + f.bytes, 0);
  return !!ok;
}
