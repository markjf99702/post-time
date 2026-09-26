// The race itself. Every horse has a speed it can hold all day (its cruising speed) and a reserve of
// extra it can spend above that. Going faster costs reserve, and going much faster costs a lot more,
// so a pace duel wears both horses out and a horse left alone on the lead can dawdle and still have a kick.
// Horses save ground on the rail, lose it going wide round the turns, get stuck behind tiring horses,
// and swing out to find room. The race is run once, start to finish, and recorded for playback.

import { rng } from './rng.js';
import { coursePath, segmentAt, LENGTH, FURLONG } from './track.js';

export const LIVE_DT = 1 / 30;  // recorded races, for smooth playback
const QUICK_DT = 1 / 12;        // races nobody watches
const Q = 0.3;                // how much extra a burst of speed costs
const LANE = 1.0;             // one path, in metres
const RAIL = 0.55;            // a horse's middle, on the rail
const HALF = 0.78;            // two horses closer than this side by side are touching
const REACH = 1.12 * LENGTH;  // nose to nose closer than this, the one behind is in the way

// Average speed for an 80 figure at each distance, and seconds per point.
export function parTime(distance, surface = 'dirt', cond = 'fast') {
  const v = 28.714 - 1.624 * Math.log(distance);
  return distance / v / condSpeed(surface, cond);
}
export function secondsPerPoint(distance) {
  return 0.071 * Math.pow(distance / 1207, 0.95);
}
export function condSpeed(surface, cond) {
  const t = {
    dirt: { fast: 1, good: 0.995, muddy: 0.986, sloppy: 0.99 },
    turf: { firm: 1.004, good: 0.994, yielding: 0.984, soft: 0.975 },
  };
  return t[surface][cond] ?? 1;
}
// The figure a time earns.
export function figureFor(time, distance, surface, cond) {
  return Math.round(80 + (parTime(distance, surface, cond) - time) / secondsPerPoint(distance));
}

const START_LOSS = 0.33; // seconds lost breaking from a standstill (calibrated in test/sim.test.mjs)

// Turn a horse's figure for the day into its cruising speed and reserve.
function engine(e, distance, surface, cond) {
  const T = parTime(distance, surface, cond) - (e.rating - 80) * secondsPerPoint(distance) - START_LOSS;
  const W = e.reserve;                       // metres of reserve: sprinters carry more, stayers less
  const v = distance / T;
  const X = W / T;
  const d = (-1 + Math.sqrt(1 + 4 * Q * X)) / (2 * Q);
  const vc = v - d;
  return { vc, W, vtop: vc + Math.max(2.6, d * 2.6) };
}

// A horse in this one's path, not far ahead and going slower.
function slowerAhead(hs, h) {
  for (const o of hs) {
    const dp = o.p - h.p;
    if (o !== h && dp > 0 && dp < 3.2 * LENGTH && Math.abs(o.o - h.o) < HALF && o.v < h.v - 0.15) return true;
  }
  return false;
}

// Nobody within a length of `off` across the track.
function clearAt(hs, h, off, room = 1.05) {
  for (const o of hs) if (o !== h && Math.abs(o.p - h.p) <= REACH * room && Math.abs(o.o - off) <= HALF) return false;
  return true;
}

const byProgress = (a, b) => b.p - a.p;

function drain(v, vc) {
  const d = v - vc;
  return d > 0 ? d + Q * d * d : d * 0.35;
}

// The steady speed that spends `W` of reserve over `dist` metres.
function paceFor(W, dist, vc) {
  if (dist <= 0) return vc;
  const X = Math.max(-0.5, W / dist);
  const b = 1 - X;
  const d = (-b + Math.sqrt(Math.max(0, b * b + 4 * Q * X * vc))) / (2 * Q);
  return vc + d;
}

// entrants: [{ rating, style (0 closer .. 1 need-the-lead), reserve, gate, jockey, heart }]
// race: { distance, surface, cond, seed }
export function runRace(race, entrants, { record = true } = {}) {
  const DT = record ? LIVE_DT : QUICK_DT;
  const R = rng(`race:${race.seed}`);
  const path = race.path || coursePath(race.surface, race.distance);
  const D = race.distance;
  const n = entrants.length;
  // The gate sits a little behind the start; the clock starts when the first horse reaches it.
  const runup = D < 1300 ? 14 : 18;
  let t0 = null;
  const hs = entrants.map((e, i) => {
    const eng = engine(e, D, race.surface, race.cond);
    const kickBase = D < 1300 ? 360 : D < 1650 ? 470 : 560;
    const reserveAtKick = 0.5 - 0.3 * e.style + R.range(-0.05, 0.05);
    const slow = R.chance(0.04 + 0.1 * (1 - e.gate));
    const stumble = !slow && R.chance(0.018);
    return {
      i, e, vc: eng.vc, vtop: eng.vtop,
      W0: eng.W, W: eng.W,
      p: -runup, o: RAIL + i * 0.88 + (i > 7 ? 0.3 : 0), v: 0, phase: R(), stride: R.range(6.9, 7.5),
      react: 0.04 + Math.abs(R.gauss()) * 0.05 * (1.4 - e.gate) + (slow ? R.range(0.35, 0.7) : 0),
      slow, stumble, stumbleT: stumble ? R.range(0.5, 1.2) : 0,
      kick: kickBase * (1 + 0.1 * (0.5 - e.style)) * R.range(0.9, 1.12),
      reserveAtKick: Math.max(0.12, reserveAtKick), reserveCap: Math.max(0.12, reserveAtKick) + 0.14,
      empty: 0, finished: false, time: 0, blocked: 0, blockedT: 0, wideSum: 0, turnT: 0,
      targetO: null, noise: 0, stuckT: 0, checkT: 0, wantOut: false, bumped: false, lastBlockedAt: -99, ledT: 0, duelT: 0,
      trace: [], fin: 0, isBlocked: false, restrained: false, boxed: false, finishSpeed: 0, checked: false,
    };
  });

  // A couple of horses in the middle of the gate sometimes come out and bump.
  if (n > 4 && R.chance(0.22)) {
    const a = R.int(1, n - 2);
    hs[a].bumped = true; hs[a + 1].bumped = true;
    hs[a].react += 0.18; hs[a + 1].react += 0.12;
  }

  const frames = [];
  const events = [];
  let t = 0;
  let leaderIdx = -1;
  const callPoints = D < 1300 ? [FURLONG * 2, FURLONG * 4, D - FURLONG] : [FURLONG * 4, FURLONG * 6, D - FURLONG];
  const calls = callPoints.map(() => null);
  const fractions = [];
  const quarter = FURLONG * 2;
  let nextFrac = quarter;
  let allDone = 0;
  const order = hs.slice();

  const maxT = 60 + D / 10;
  while (t < maxT) {
    t += DT;
    order.sort(byProgress);
    const lead = order[0];

    for (const h of hs) {
      const seg = segmentAt(path, h.p);
      const toGo = D - h.p;
      // What the rider wants.
      let want;
      if (h.finished) {
        want = Math.max(8, h.v - 2.2 * DT * 10); // pulling up after the wire
      } else if (t < h.react) {
        want = 0;
      } else if (toGo <= h.kick) {
        want = paceFor(h.W, toGo, h.vc) * (1.005 + 0.01 * h.e.jockey);
        // Head to head in the stretch, the game ones find a little more.
        if (toGo < 260 && h.W > 0) {
          let pal = false;
          for (const o of hs) if (o !== h && !o.finished && Math.abs(o.p - h.p) < 0.6 * LENGTH && Math.abs(o.o - h.o) < 2.2) { pal = true; break; }
          if (pal) { want *= 1 + 0.014 * h.e.heart; h.duelT += DT; }
        }
      } else {
        const toKick = toGo - h.kick;
        const spare = h.W - h.reserveAtKick * h.W0;
        // Everyone goes a bit quicker early, to get a position.
        const own = paceFor(spare, toKick, h.vc) * (h.p < 420 ? 1.02 : 1);
        want = own;
        const rushing = h.p < 450 && h.e.style > 0.72;
        if (rushing) {
          // Speed horses want the lead early and will fight for it.
          const ahead = lead !== h && lead.p - h.p > -0.6 * LENGTH;
          want *= ahead ? 1.035 + 0.02 * h.e.style : 1.012;
        } else if (h.p < 450 && h.e.style < 0.35) {
          want *= 0.985;
        }
        // Riders place their horses relative to the leader: speed horses up close, closers well back.
        // So when the leader goes slowly the whole field goes slowly behind it, and when the leaders
        // go too fast the rest let them go.
        if (lead !== h && h.p > 150 && !rushing) {
          const gap = (lead.p - h.p) / LENGTH;
          const gapWant = (1 - h.e.style) * (D < 1300 ? 8 : 10);
          const follow = lead.v + (gap - gapWant) * 0.1;
          want = Math.max(own * 0.955, Math.min(own * 1.03, follow));
        }
        // A lone leader clear of the rest gets a breather, and the rider saves some for later.
        const second = order[1];
        if (lead === h && second && h.p - second.p > 1.2 * LENGTH && h.p > 150) {
          want *= 0.99;
          h.reserveAtKick = Math.min(h.reserveCap, h.reserveAtKick + 0.02 * DT);
        }
        // Horses that like to be in front don't let others go by without a fight.
        if (h.e.style > 0.55 && h.p > 150) {
          for (const o of hs) {
            if (o !== h && o.v > h.v && h.p - o.p > -0.3 * LENGTH && h.p - o.p < 0.9 * LENGTH && Math.abs(o.o - h.o) < 2.5) {
              want = Math.max(want, Math.min(o.v, own * 1.025));
              break;
            }
          }
        }
        // Two speed horses head to head keep pushing each other.
        if (h.e.style > 0.72 && h.p < 0.62 * D && h.W > 0.3 * h.W0) {
          for (const o of hs) {
            if (o !== h && o.e.style > 0.6 && Math.abs(o.p - h.p) < 0.6 * LENGTH && (o === lead || h === lead)) { want *= 1.008; h.duelT += DT; break; }
          }
        }
      }
      if (h.stumbleT > 0 && t > h.react) { want *= 0.55; h.stumbleT -= DT; }
      if (!h.finished) {
        if (Math.floor(t * 2) !== Math.floor((t - DT) * 2)) h.noise = R.gauss() * 0.004;
        want *= 1 + h.noise;
      }

      // Tired horses can't hold their speed.
      let cap = h.vtop;
      if (h.W <= 0) cap = h.vc * (0.992 - 0.075 * Math.min(1, h.empty / 220));
      want = Math.min(want, cap);

      // Someone in the way?
      let blocker = null;
      for (const o of hs) {
        if (o === h) continue;
        const dp = o.p - h.p;
        if (dp > 0 && dp < REACH && Math.abs(o.o - h.o) < HALF) {
          if (!blocker || dp < blocker.p - h.p) blocker = o;
        }
      }
      // Sitting behind a horse going the same speed is just tracking it. Wanting to go
      // noticeably faster and not being able to is being blocked.
      h.isBlocked = false;
      h.restrained = false;
      const keen = blocker ? want - blocker.v : 0;
      if (blocker && !h.finished && t > 3 && want > blocker.v + 0.05) {
        h.restrained = true;
        const eager = toGo <= h.kick || (h.p < 450 && h.e.style > 0.72);
        h.isBlocked = want > blocker.v + (eager ? 0.2 : 0.7);
        want = Math.min(want, blocker.v + 0.03);
      }
      // Stuck with nowhere to go: take a hold, drop back and go round.
      if (h.checkT > 0) {
        want = Math.min(want, h.v - 0.8);
        h.checkT -= DT;
        if (h.checkT <= 0) h.wantOut = false;
      } else if (h.isBlocked && h.boxed && keen > 0.45) {
        h.stuckT += DT;
        // Early on there's time to sort it out; later, a rider stuck for a couple of seconds takes a hold.
        if (h.stuckT > 3.2 && toGo > 60 && (toGo <= h.kick + 150 || h.p > 0.4 * D)) {
          h.checkT = 1.1; h.stuckT = 0; h.wantOut = true;
          events.push({ t, type: 'checked', h: h.i, p: h.p });
        }
      } else h.stuckT = 0;

      // Accelerate or ease.
      const acc = t < 5 ? 6.8 * (1 - h.v / (h.vtop + 3)) : 1.6;
      const dec = h.isBlocked ? 5 : 1.4;
      if (want > h.v) h.v = Math.min(want, h.v + acc * DT);
      else h.v = Math.max(want, h.v - dec * DT);

      // Drafting behind a horse costs a little less.
      let draft = 1;
      if (!h.finished) {
        for (const o of hs) {
          const dp = o.p - h.p;
          if (o !== h && dp > 0 && dp < 2.4 * LENGTH && Math.abs(o.o - h.o) < 0.9) { draft = 0.94; break; }
        }
      }
      if (!h.finished && t > h.react) {
        h.W -= drain(h.v, h.vc) * DT * draft;
        if (h.W < 0) { h.empty += h.v * DT; h.W = 0; }
        if (h.W > h.W0) h.W = h.W0;
      }

      // Round a turn wide and you run further.
      let gain = h.v * DT;
      if (seg.kind === 'turn' && h.p < D) {
        gain *= seg.R / (seg.R + h.o - RAIL);
        h.wideSum += (h.o - RAIL) * DT; h.turnT += DT;
      }
      const before = h.p;
      h.p += gain;
      if (!h.finished && h.p >= D) {
        h.finished = true;
        h.time = t - DT + (D - before) / gain * DT - t0;
        h.fin = ++allDone;
        h.finishSpeed = h.v;
      }
      const sl = Math.max(2.4, Math.min(h.stride, 2.2 + 0.32 * h.v));
      h.phase = (h.phase + h.v * DT / sl) % 1;
      if (h.isBlocked) {
        h.blockedT += DT;
        if (t - h.lastBlockedAt > 3 && !h.finished) events.push({ t, type: 'blocked', h: h.i, p: h.p });
        h.lastBlockedAt = t;
      }
    }

    // Moving across the track.
    for (const h of order) {
      if (t < h.react) continue;
      const toGo = D - h.p;
      const kicking = toGo <= h.kick;
      const step = (t < 6 ? 0.55 : 0.8) * DT;
      if (h.finished) continue;
      h.boxed = false;
      if (h.wantOut) {
        const out = h.o + LANE;
        if (clearAt(hs, h, out) && out < 14) { h.targetO = out; h.wantOut = false; h.checkT = 0; }
      } else if (h.isBlocked && t > 6) {
        // Look for room: outside first when making a run, the rail if it opens up.
        // A rider looking for room will squeeze through a smaller gap.
        const out = h.o + LANE, inn = h.o - LANE;
        if (clearAt(hs, h, out, 0.8) && out < 14) h.targetO = out;
        else if (inn >= RAIL && clearAt(hs, h, inn, 0.8)) h.targetO = inn;
        else h.boxed = true;
      } else if (kicking && h.targetO === null && slowerAhead(hs, h) && clearAt(hs, h, h.o + LANE) && h.o + LANE < 14) {
        // Making a run: angle out before getting stuck behind a tiring horse.
        h.targetO = h.o + LANE;
      } else if (h.targetO === null || Math.abs(h.targetO - h.o) < 0.02) {
        h.targetO = null;
        // Save ground: drift in toward the rail when nobody's there.
        const tired = h.W <= 0 && segmentAt(path, h.p).kind === 'turn';
        if (tired) h.targetO = Math.min(14, h.o + 0.35);
        else if (h.o - step >= RAIL && clearAt(hs, h, h.o - 0.3)) h.targetO = Math.max(RAIL, h.o - 0.3);
      }
      if (h.targetO !== null) {
        const d = h.targetO - h.o;
        const mv = Math.sign(d) * Math.min(Math.abs(d), step * (h.isBlocked ? 1.6 : 1));
        // Don't move into someone.
        const next = h.o + mv;
        let hit = false;
        for (const o of hs) if (o !== h && Math.abs(o.p - h.p) < LENGTH * 0.95 && Math.abs(o.o - next) < HALF && Math.abs(o.o - h.o) >= Math.abs(o.o - next)) { hit = true; break; }
        if (!hit) h.o = next; else h.targetO = null;
      }
    }

    // Leader, fractions and the calls.
    order.sort(byProgress);
    const L = order[0];
    if (t0 === null && L.p >= 0) t0 = t - L.p / Math.max(1, L.v);
    if (L.i !== leaderIdx && t > 2) {
      events.push({ t, type: 'lead', h: L.i, p: L.p, prev: leaderIdx });
      leaderIdx = L.i;
    }
    L.ledT += DT;
    while (L.p >= nextFrac && nextFrac < D - 1) {
      // exact time the leader passed the point
      const over = (L.p - nextFrac) / Math.max(1, L.v);
      fractions.push({ at: nextFrac, t: t - over - t0 });
      nextFrac += quarter;
    }
    for (let k = 0; k < callPoints.length; k++) {
      if (!calls[k] && L.p >= callPoints[k]) calls[k] = order.map(h => ({ h: h.i, behind: (L.p - h.p) / LENGTH, o: h.o }));
    }

    if (race.debug && Math.floor(t) !== Math.floor(t - DT)) for (const h of hs) h.trace.push([Math.round(t), +(h.W / h.W0).toFixed(2), +h.v.toFixed(2), Math.round(h.p)]);
    if (record) {
      const f = new Float32Array(n * 4);
      for (const h of hs) {
        f[h.i * 4] = h.p; f[h.i * 4 + 1] = h.o; f[h.i * 4 + 2] = h.v; f[h.i * 4 + 3] = h.phase;
      }
      frames.push(f);
    }
    if (allDone === n) {
      const lastT = Math.max(...hs.map(h => h.time));
      if (t > lastT + (record ? 4 : 0)) break;
    }
  }

  const finishOrder = hs.slice().sort((a, b) => a.time - b.time);
  const winner = finishOrder[0];
  // Margins: time behind the winner at the winner's finishing speed, in lengths.
  const lps = winner.finishSpeed / LENGTH;
  const results = finishOrder.map((h, k) => {
    const behind = (h.time - winner.time) * lps;
    const prev = k === 0 ? null : finishOrder[k - 1];
    const toPrev = k === 0 ? 0 : (h.time - prev.time) * lps;
    return {
      h: h.i, pos: k + 1, time: h.time, behind, toPrev,
      slow: h.slow, stumble: h.stumble, bumped: h.bumped,
      wide: h.turnT > 0 ? h.wideSum / h.turnT : 0,
      blocked: h.blockedT, led: h.ledT, emptied: h.empty, duel: h.duelT,
      checked: events.filter(ev => ev.type === 'checked' && ev.h === h.i).length,
      finishSpeed: h.finishSpeed,
    };
  });
  const finalTime = winner.time;
  fractions.push({ at: D, t: finalTime });
  if (race.debug) race.traces = hs.map(h => h.trace);
  return { dt: DT, frames, n, results, fractions, calls, callPoints, events, finalTime, distance: D, path, t0, runup };
}

// Where each horse is at time t (interpolated), for drawing.
export function stateAt(run, t, out = []) {
  const f = t / run.dt - 1;
  const i = Math.max(0, Math.min(run.frames.length - 2, Math.floor(f)));
  const a = run.frames[i], b = run.frames[i + 1] || a;
  const k = Math.max(0, Math.min(1, f - i));
  for (let h = 0; h < run.n; h++) {
    const j = h * 4;
    let ph = b[j + 3] - a[j + 3];
    if (ph < -0.5) ph += 1;
    out[h] = {
      p: a[j] + (b[j] - a[j]) * k,
      o: a[j + 1] + (b[j + 1] - a[j + 1]) * k,
      v: a[j + 2] + (b[j + 2] - a[j + 2]) * k,
      phase: (a[j + 3] + ph * k + 1) % 1,
    };
  }
  return out;
}

export function runDuration(run) { return run.frames.length * run.dt; }
