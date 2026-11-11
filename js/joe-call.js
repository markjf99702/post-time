// Joe calling a race. He is the caller's downloaded voice (js/joe.js), and his sound is made a line at a
// time in a worker, some three times faster than it's said. So a race's call is made ahead: while the form
// is being read, at the gate and, if it comes to that, during the running, each line in the order it will
// be said. Here are the pace he is asked for, about how long he takes over a line (the call is planned
// with that: js/call.js), the clips of a race's call and the holding of them to the plan, whether this
// device can make them in time, and his part in the caller's queue (js/audio.js), which plays them.
//
// Nothing here touches the page, so the tests run it in plain Node with clips of known lengths.
import { JOE } from './joe.js';

// ---------------------------------------------------------------- his pace

// The speed a line is asked of him at, in times his own: the speed the call opens at until about half a
// minute from the wire, and up from there to the top speed at the wire (`k` is how far up that climb the
// line is, 0 to 1: climb() in js/call.js). In steps of a twentieth, so a line is the same clip whenever
// it's planned. The model itself talks faster; nothing is ever played back faster.
export function joeSpeed(k = 0) {
  const speed = JOE.opens + (JOE.top - JOE.opens) * Math.max(0, Math.min(1, k || 0));
  return +(Math.round(speed / JOE.step) * JOE.step).toFixed(2);
}

// ---------------------------------------------------------------- how long he takes over a line

// About how long his sound of a line runs, in seconds, from its words alone: so much a letter, a word, a
// comma and a full stop inside the line. It is a fit to his own clips of 438 different lines of the game's
// calls, made in the worker and timed (test/joe-times.fixture.json, made by tools/joe-times.mjs; the tests
// hold this to it). At the speed the call opens at it is within 0.15 s of the clip for seven lines in ten
// and 0.25 s for nine in ten, and 0.46 s out at the worst; a line runs 2.5 s on average. Asked
// to talk faster he shortens a line by less than the speed asked: at 1.4 a line is 0.95 of its length at
// 1.3, and at 1.5, 0.895. He draws each sound's length at random, so the same line is never twice the same
// length, and no sum over letters knows how a horse's name is said. So the call is planned with this plus
// SPARE, and each clip, once made, is held to the room the plan left it (raceClips below).
const FIT = { base: 0.2387, letter: 0.042, word: 0.0325, comma: 0.2605, stop: 0.264 };
const SPEEDS = [[1.3, 1], [1.4, 0.9496], [1.5, 0.8949]]; // a line's length at each speed, against its length at 1.3
export const SPARE = 0.15; // seconds
function speedFactor(speed) {
  let k = 1;
  while (k < SPEEDS.length - 1 && speed > SPEEDS[k][0]) k++;
  const [s0, f0] = SPEEDS[k - 1], [s1, f1] = SPEEDS[k];
  return f0 + (f1 - f0) * (speed - s0) / (s1 - s0); // a straight line between the speeds measured, and on past them
}
export function joeSeconds(text, speed = JOE.opens) {
  const letters = (text.match(/[a-z]/gi) || []).length, words = text.trim().split(/\s+/).length;
  const commas = (text.match(/[,;:]/g) || []).length, stops = Math.max(0, (text.match(/[.!?](\s|$)/g) || []).length - 1);
  const own = FIT.base + FIT.letter * letters + FIT.word * words + FIT.comma * commas + FIT.stop * stops;
  return Math.max(0.3, own * speedFactor(speed));
}
// What the call is planned with.
export const joeLineSeconds = (text, speed) => joeSeconds(text, speed) + SPARE;

// The call is planned (liveCall in js/call.js) with this for its `lineSeconds`, given that file's climb().
export const planSeconds = climb => (line, toWire) => joeLineSeconds(line.say, joeSpeed(climb(line, toWire)));
// What a plan of a race asks of him, for raceClips below: each line as he's given it, the speed it's said
// at, how long from the screen opening until it comes up, the room it has before the next line does, and
// whether that next line is the call at the wire (the plan's timetable()). `fin` is the race's final time.
// After a photo the winner's line is wanted too, last of all: `official` is that line as he's given it.
export function jobsFor(call, fin, climb, official = null) {
  const jobs = call.timetable().map(({ line, at, room, wire }) => ({ say: line.say, speed: joeSpeed(climb(line, fin - line.t)), at, room, wire }));
  if (official) jobs.push({ say: official, speed: joeSpeed(0), at: jobs[jobs.length - 1].at + 3, room: Infinity, wire: false });
  return jobs;
}

// ---------------------------------------------------------------- the clips of a race's call

const EDGE = 0.05;  // seconds: a clip is to be over this long before the next line comes up
const FASTER = 0.1; // a clip too long for its room is made again this much faster, as far as the top speed
const HEAD = 0.25;  // seconds: a clip is to be made this long before it's needed
const SLACK = 1.15; // the making is taken to be this much slower than it has been, when asking if it will keep up
const RECENT = 30;  // clips: how many the measure of this device's speed goes back

// How fast this device makes his sound: seconds of work for a second of speech, over the last clips made
// in this visit, whichever race they were for. Null until one has been made.
const pace = [];
export function makingRate() {
  if (!pace.length) return null;
  let work = 0, sound = 0;
  for (const [w, s] of pace) { work += w; sound += s; }
  return work / sound;
}
export function madeClip(work, sound) {
  if (!(work > 0) || !(sound > 0)) return;
  pace.push([work, sound]);
  if (pace.length > RECENT) pace.shift();
}
export function forgetRate() { pace.length = 0; }

// The clips of one race's call, kept in memory for that race only. `make(text, speed)` answers with a clip
// ({ samples, rate, seconds, ms }: joe.speak in js/joe.js); `idle()` is called when there's nothing left
// to make, so the worker can be ended and its memory given back.
//
// want(jobs) says what the call needs now, in the order it will be said: each job is { say, speed, room,
// wire, at }, where `room` is the real seconds the line has before the next one comes up, `wire` says that
// next one is the call at the wire, and `at` is how long from the gate until the line comes up. They are
// made one at a time, in that order. A clip that comes out too long for its room is made again faster,
// as far as his top speed: the plan is held to the real clips, not to the guess they were planned with.
// Asked again (the watching speed has changed, the race was skipped ahead), it keeps the clips it has that
// are still wanted and lets the rest go.
export function raceClips({ make, idle = () => {} }) {
  const clips = new Map(); // what's said -> its clip
  let jobs = [];
  let making = null;   // the job being made
  let held = false;    // the page has ended the worker (it's out of sight): nothing is made until resume()
  let broken = null;   // why the voice failed, if it has
  let gone = false;
  let seconds = 0;     // how long the making has taken in all, for the measures

  const fits = (clip, job) => clip.seconds <= job.room - EDGE;
  const fastEnough = clip => clip.speed >= JOE.top - 1e-9;
  // The next thing to make: the first line with no clip, or with one too long for its room that hasn't
  // been tried at the top speed.
  function next() {
    for (const job of jobs) {
      const clip = clips.get(job.say);
      if (!clip) return { job, speed: job.speed };
      if (!fits(clip, job) && !fastEnough(clip)) return { job, speed: Math.min(JOE.top, +(clip.speed + FASTER).toFixed(2)) };
    }
    return null;
  }
  function pump() {
    if (making || held || broken || gone) return;
    const todo = next();
    if (!todo) { idle(); return; }
    making = todo;
    const got = clip => {
      if (making !== todo) return;
      making = null;
      if (gone) return;
      const was = clips.get(todo.job.say);
      // Made again faster, a clip only takes the other's place if it came out shorter (he draws at random).
      if (!was || clip.seconds < was.seconds) clips.set(todo.job.say, { ...clip, speed: todo.speed });
      else was.speed = todo.speed;
      madeClip(clip.ms / 1000, clip.seconds);
      seconds += clip.ms / 1000;
      pump();
    };
    const failed = error => {
      if (making !== todo) return;
      making = null;
      if (gone) return;
      // The page ended the worker itself (out of sight): that isn't the voice failing.
      if (error && error.shutdown) held = true;
      else { broken = String((error && error.message) || error); idle(); }
    };
    let work;
    try { work = make(todo.job.say, todo.speed); } catch (error) { failed(error); return; }
    if (work && typeof work.then === 'function') work.then(got, failed); else got(work);
  }

  return {
    want(list) {
      jobs = list.slice();
      const wanted = new Set(jobs.map(j => j.say));
      for (const say of [...clips.keys()]) if (!wanted.has(say)) clips.delete(say);
      // (A clip being made for a line that's no longer wanted is let finish, and let go by the next call.)
      pump();
    },
    clip: say => clips.get(say) || null,
    // Every clip made, and none of them still to be made again?
    ready: () => !broken && jobs.length > 0 && !next(),
    // Will each clip be made before its line comes up, at the rate this device has been making them?
    // `start` is how long until the worker can begin (it may have to be started first).
    keepsUp(start = 0) {
      if (broken) return false;
      const rate = makingRate();
      let t = start;
      for (const job of jobs) {
        const clip = clips.get(job.say);
        if (clip && (fits(clip, job) || fastEnough(clip))) continue;
        if (rate === null) return false;
        t += joeSeconds(job.say, job.speed) * rate * SLACK;
        if (t > job.at - HEAD) return false;
      }
      return true;
    },
    // The page is back in sight: carry on from where the making stopped.
    resume() { if (held) { held = false; pump(); } },
    drop() { gone = true; clips.clear(); jobs = []; },
    broken: () => broken,
    busy: () => !!making,
    measures: () => ({ clips: clips.size, wanted: jobs.length, seconds, sound: [...clips.values()].reduce((s, c) => s + c.seconds, 0) }),
  };
}

// ---------------------------------------------------------------- his part in the caller's queue

// Joe as the queue's voice (callQueue in js/audio.js). `clipFor(line)` is the clip made for a line, or
// null if it isn't made yet; `play(clip, { onstart, onend })` plays one and returns a function that stops
// it. Unlike a browser's voice he knows to the sample how long a line runs, and whether its sound is there
// at all: the queue asks, and a line whose clip isn't there when its time comes is left out, not said
// late, as is one that would still be going when the call at the wire is due.
export function clipVoice({ clipFor, play }) {
  let stop = null;
  return {
    fastest: JOE.top,
    prepare() {},
    ready: line => !!clipFor(line),
    seconds(line) { const clip = clipFor(line); return clip ? clip.seconds : null; },
    speak(line, { onstart, onend, onerror }) {
      const clip = clipFor(line);
      if (!clip) { onerror(); return; }
      let over = false, halt = null;
      halt = play(clip, { onstart, onend: () => { over = true; if (stop === halt) stop = null; onend(); } });
      stop = over ? null : halt;
    },
    stop() { const s = stop; stop = null; if (s) s(); },
  };
}
