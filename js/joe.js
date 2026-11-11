// The caller's downloaded voice, the page's side of it: whether it can work here, the download and where it
// is kept, and the worker that makes the sound (js/joe-worker.js).
//
// The voice is Piper's "Joe". A browser's own voices differ from one device to the next, and sped up they
// go up in pitch; this one is the same everywhere, and talks faster because its model does. It is about
// 76 MB, so nothing of it is fetched until the player asks for it in the menu. What arrives is checked
// against the list of files in voice/manifest.json and kept in a cache of its own, which the offline
// worker (sw.js) leaves alone when the game is updated: the download is the player's, like their meet.
// A download that was cut off carries on from the files that had arrived.
import { isFile, soundManifest } from './joe-speech.js';

export const JOE = {
  name: 'Joe',
  // The cache the files are kept in, and how much is downloaded. Both are voice/manifest.json's (the tests
  // check), written here so that nothing has to be fetched to show them. A different set of files goes in
  // a cache with a different name, and this one is cleared once that one is whole.
  cache: 'post-time-voice-joe-1',
  bytes: 76448447,
  // How fast it talks when the call opens, in times its own speed, and so for the menu's Hear it.
  opens: 1.15,
};
const OURS = /^post-time-voice-joe-/; // every cache this voice has ever been kept in
const DONE = 'complete';              // kept in the cache once every file is in it
const singleFile = typeof __SINGLE_FILE__ !== 'undefined';
const base = () => new URL('voice/', document.baseURI).href;

// Can it work here? It needs a worker, WebAssembly, somewhere to keep the files and a way to play them, and
// the files beside the page: so not in the one-file copy of the game, and not in a viewer's sandbox.
export function offered() {
  try {
    return !singleFile && typeof window !== 'undefined' && typeof Worker === 'function' && typeof WebAssembly === 'object'
      && window.isSecureContext && /^https?:$/.test(location.protocol) && typeof window.caches === 'object'
      && typeof crypto === 'object' && !!crypto.subtle && !!(window.AudioContext || window.webkitAudioContext);
  } catch { return false; }
}

// ---------------------------------------------------------------- what is on this device

// state: 'none' (nothing here), 'partial' (some of it), 'downloading', 'ready'. `have` of `total` bytes.
// `problem` says why the last download stopped, when it wasn't the player who stopped it.
let now = { state: 'none', have: 0, total: JOE.bytes, problem: '' };
let changed = null;
let stopper = null; // a download is running while this is set
let turn = 0;       // goes up when a download or a removal begins or ends: a look begun before then is out of date
function set(more) {
  const next = { ...now, ...more };
  if (next.state === now.state && next.have === now.have && next.problem === now.problem) return;
  now = next;
  if (changed) changed();
}
export const status = () => ({ ...now });
export function onChange(fn) { changed = fn; }

// Looks in the cache. (Never opens one that isn't there: that would make it.)
export async function look() {
  if (!offered() || stopper) return status();
  const mine = turn;
  let state = 'none', have = 0;
  try {
    if (await caches.has(JOE.cache)) {
      const store = await caches.open(JOE.cache), from = base();
      if (await store.match(from + DONE)) { state = 'ready'; have = JOE.bytes; }
      else {
        const kept = await store.match(from + 'manifest.json');
        const manifest = kept ? await kept.json() : null;
        if (soundManifest(manifest)) for (const file of manifest.files) if (await store.match(from + file.path)) have += file.bytes;
        if (have) state = 'partial';
      }
    }
  } catch { /* a browser that won't say: as good as nothing here */ }
  if (!stopper && mine === turn) set({ state, have });
  return status();
}

// ---------------------------------------------------------------- the download

class Problem extends Error {}
// Why a download stopped, in words for the menu.
function why(error) {
  if (error instanceof Problem) return error.message;
  if (error && error.name === 'QuotaExceededError') return "this device hasn't room for it";
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "there's no connection";
  return 'the connection dropped';
}

// One file from the site, all of it, with `sofar(bytes)` called as it comes. Straight from the server, and
// not kept by the browser as well: the cache is where it's kept.
async function fetched(url, size, signal, sofar) {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Problem(`the site answered ${res.status} for one of the files`);
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  let bytes = new Uint8Array(size), got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > bytes.length) { const more = new Uint8Array(Math.max(got + value.length, bytes.length * 2)); more.set(bytes.subarray(0, got)); bytes = more; }
    bytes.set(value, got);
    got += value.length;
    sofar(got);
  }
  return bytes.subarray(0, got);
}

// Downloads what isn't here yet. Each file is checked against the list as it arrives (its length and its
// SHA-256) and kept; one that arrives wrong is fetched once more. The files that are here from an earlier
// go are checked again and not fetched again. Resolves when it's over, however it ended: status() says how.
export async function download() {
  if (stopper || !offered()) return;
  const stop = stopper = new AbortController(), from = base();
  turn++;
  set({ state: 'downloading', problem: '' });
  try {
    // Ask the browser to keep what's stored here, the meet too, when it runs short of room. It may say no.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* not asked */ }
    const listed = await fetched(from + 'manifest.json', 4096, stop.signal, () => {});
    let manifest = null;
    try { manifest = JSON.parse(new TextDecoder().decode(listed)); } catch { /* not a list */ }
    if (!soundManifest(manifest)) throw new Problem("the site's list of the voice's files couldn't be read");
    // The list on the site is for another version of the game than this page: its files aren't these.
    if (manifest.cache !== JOE.cache || manifest.bytes !== JOE.bytes) throw new Problem('the game has been updated since this page was opened (load it again, then download)');
    // Keeping a file. A browser can refuse (a private window, or no room left), which is not the
    // connection's doing.
    const kept = work => work.catch(error => { throw error && error.name === 'QuotaExceededError' ? error : new Problem("this browser wouldn't keep the files"); });
    const store = await kept(caches.open(JOE.cache));
    await kept(store.put(from + 'manifest.json', new Response(listed, { headers: { 'content-type': 'application/json' } })));
    let have = 0;
    for (const file of manifest.files) {
      const here = await store.match(from + file.path);
      if (here && await isFile(file, await here.arrayBuffer())) { have += file.bytes; set({ have }); continue; }
      let bytes = null;
      for (let again = 0; ; again++) {
        const before = have;
        let told = 0; // the menu is told every quarter of a megabyte, not every packet
        bytes = await fetched(from + file.path, file.bytes, stop.signal, n => { if (n - told >= 250000) { told = n; set({ have: before + Math.min(n, file.bytes) }); } });
        if (await isFile(file, bytes)) break;
        set({ have: before });
        if (again) throw new Problem('one of the files arrived damaged, twice');
      }
      await kept(store.put(from + file.path, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(file.bytes) } })));
      have += file.bytes;
      set({ have });
    }
    await kept(store.put(from + DONE, new Response(JSON.stringify({ bytes: have }), { headers: { 'content-type': 'application/json' } })));
    for (const key of await caches.keys()) if (OURS.test(key) && key !== JOE.cache) await caches.delete(key);
    stopper = null;
    turn++;
    set({ state: 'ready', have: JOE.bytes, problem: '' });
  } catch (error) {
    stopper = null;
    const stopped = stop.signal.aborted; // the player's Stop, not a fault
    await look();
    if (now.state === 'downloading') set({ state: 'none', have: 0 });
    set({ problem: stopped ? '' : why(error) });
  }
}
export function stopDownload() { if (stopper) stopper.abort(); }

// Takes the voice off this device.
export async function remove() {
  stopDownload();
  shutdown();
  turn++;
  try { for (const key of await caches.keys()) if (OURS.test(key)) await caches.delete(key); } catch { /* nothing to take off */ }
  stopper = null;
  turn++;
  set({ state: 'none', have: 0, problem: '' });
}

// ---------------------------------------------------------------- the worker

// The worker is started when a line is first asked for (it takes the model about a second to load, and
// some hundreds of megabytes of memory while it's up) and stays until shutdown().
let worker = null, loading = null, asked = 0;
const waiting = new Map();

function ask(message) {
  return new Promise((resolve, reject) => {
    const id = ++asked;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
  });
}
function start() {
  if (loading) return loading;
  worker = new Worker('js/joe-worker.js', { type: 'module' });
  const mine = worker;
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id);
    if (!w) return;
    waiting.delete(data.id);
    if (data.error) w.reject(new Error(data.error)); else w.resolve(data);
  };
  // The worker itself has failed (a browser that can't run it, or one that has run out of memory).
  worker.onerror = event => { if (event.preventDefault) event.preventDefault(); if (worker === mine) shutdown(new Error(event.message || 'the voice stopped')); };
  loading = ask({ type: 'load', cache: JOE.cache, base: base() });
  loading.catch(error => { if (worker === mine) shutdown(error); });
  return loading;
}

// Gets the voice ready ahead of the first line: { ms, threads, rate } when it is.
export function ready() { return offered() ? start() : Promise.reject(new Error("the voice can't run here")); }
// A line of text as sound, at `speed` times the voice's own pace: { samples (a Float32Array), rate,
// seconds, sentences, ms (how long it took to make), loudness, limited }. `seconds` is exactly
// samples.length / rate. Lines asked for one after another are made in that order.
export async function speak(text, speed = 1, { ids = false } = {}) {
  await ready();
  return ask({ type: 'speak', text, speed, ids });
}
// Ends the worker and gives its memory back. Anything still being made is refused, with an error whose
// `shutdown` is true when that was the page's own doing and not the voice failing.
export function shutdown(reason = Object.assign(new Error('the voice was shut down'), { shutdown: true })) {
  if (worker) worker.terminate();
  worker = null; loading = null;
  for (const w of waiting.values()) w.reject(reason);
  waiting.clear();
}
export const running = () => !!worker;
