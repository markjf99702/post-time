// Larkspur Downs: a one-mile dirt oval with a seven-furlong turf course inside it.
// Distances are in metres. Horses run counterclockwise. The homestretch runs along the bottom of the map,
// left to right, past the grandstand; the finish line is 38 m before the clubhouse turn.

export const FURLONG = 201.168;
export const LENGTH = 2.45;           // a horse's length, in metres, for margins
export const STRAIGHT = 440;          // each straight
export const FINISH_FROM_TOP = 402;   // from the top of the stretch to the wire
const DIRT_R = (1609.344 - 2 * STRAIGHT) / (2 * Math.PI);
const TURF_R = DIRT_R - 26;

export const COURSES = {
  dirt: { R: DIRT_R, lap: 2 * STRAIGHT + 2 * Math.PI * DIRT_R },
  turf: { R: TURF_R, lap: 2 * STRAIGHT + 2 * Math.PI * TURF_R },
};

// The loop, starting at the wire and going the way the horses run.
function loop(surface) {
  const { R } = COURSES[surface];
  const turn = Math.PI * R;
  return [
    { kind: 'straight', len: STRAIGHT - FINISH_FROM_TOP, name: 'stretch' },
    { kind: 'turn', len: turn, R, name: 'clubhouse turn' },
    { kind: 'straight', len: STRAIGHT, name: 'backstretch' },
    { kind: 'turn', len: turn, R, name: 'far turn' },
    { kind: 'straight', len: FINISH_FROM_TOP, name: 'stretch' },
  ];
}

// Lays out the path a race of `distance` metres takes, from the gate to the wire, as a list of segments.
// Sprints that would start on the clubhouse turn start in a chute instead: a straight run into the backstretch.
export function coursePath(surface, distance) {
  const segs = loop(surface);
  const out = [];
  let need = distance;
  // Walk backwards from the wire.
  let i = segs.length - 1;
  while (need > 0.01) {
    const s = segs[i];
    if (s.kind === 'turn' && s.name === 'clubhouse turn' && need < s.len && distance < COURSES[surface].lap) {
      out.unshift({ kind: 'straight', len: need, name: 'chute', chute: true });
      need = 0;
      break;
    }
    const take = Math.min(need, s.len);
    out.unshift({ ...s, len: take, partial: take < s.len - 0.01 });
    need -= take;
    i = (i - 1 + segs.length) % segs.length;
  }
  let at = 0;
  for (const s of out) { s.start = at; at += s.len; s.end = at; }
  return out;
}

// Where along the loop a point `fromWire` metres before the finish is, and which way it faces.
// Returns map coordinates (metres, y up) for the rail at that point plus an outward normal.
export function railPoint(surface, fromWire) {
  const { R, lap } = COURSES[surface];
  // Position measured forward from the wire, 0..lap
  let s = ((lap - fromWire) % lap + lap) % lap;
  const segs = loop(surface);
  const h = STRAIGHT / 2;
  // Finish line x on the homestretch (y = -R)
  const finishX = -h + FINISH_FROM_TOP;
  for (const seg of segs) {
    if (s <= seg.len + 1e-9) return place(seg, s);
    s -= seg.len;
  }
  return place(segs[segs.length - 1], segs[segs.length - 1].len);

  function place(seg, d) {
    const idx = segs.indexOf(seg);
    if (idx === 0) return { x: finishX + d, y: -R, hx: 1, hy: 0, nx: 0, ny: -1, seg: seg.name };
    if (idx === 1) { // clubhouse turn, centre (h, 0), from angle -90° to +90°
      const a = -Math.PI / 2 + d / R;
      return { x: h + R * Math.cos(a), y: R * Math.sin(a), hx: -Math.sin(a), hy: Math.cos(a), nx: Math.cos(a), ny: Math.sin(a), seg: seg.name };
    }
    if (idx === 2) return { x: h - d, y: R, hx: -1, hy: 0, nx: 0, ny: 1, seg: seg.name };
    if (idx === 3) { // far turn, centre (-h, 0), from 90° to 270°
      const a = Math.PI / 2 + d / R;
      return { x: -h + R * Math.cos(a), y: R * Math.sin(a), hx: -Math.sin(a), hy: Math.cos(a), nx: Math.cos(a), ny: Math.sin(a), seg: seg.name };
    }
    return { x: -h + d, y: -R, hx: 1, hy: 0, nx: 0, ny: -1, seg: seg.name };
  }
}

// A map position for a horse `progress` metres into a race, `off` metres out from the rail.
export function mapPoint(race, progress, off) {
  const path = race.path;
  const toGo = race.distance - progress;
  const seg = segmentAt(path, progress);
  if (seg && seg.chute) {
    // The chute runs straight on from the start of the backstretch, backwards.
    const { R } = COURSES[race.surface];
    const back = seg.end - progress;
    return { x: STRAIGHT / 2 + back, y: R + off, hx: -1, hy: 0 };
  }
  const p = railPoint(race.surface, Math.max(-60, toGo));
  return { x: p.x + p.nx * off, y: p.y + p.ny * off, hx: p.hx, hy: p.hy };
}

export function segmentAt(path, progress) {
  if (progress <= 0) return path[0];
  for (const s of path) if (progress < s.end) return s;
  return path[path.length - 1];
}

// Heading, in radians, of the path at `progress` (0 = the homestretch direction). Used to turn the scenery.
export function headingAt(race, progress) {
  const path = race.path;
  if (progress >= race.distance) return 0;
  let h = 0;
  // Work out the heading at the start of the race, then add each turn's sweep.
  // The homestretch faces 0, the backstretch faces π.
  const first = path[0];
  const startHeading = { stretch: 0, chute: Math.PI, backstretch: Math.PI, 'clubhouse turn': 0, 'far turn': Math.PI }[first.name];
  h = startHeading;
  if (first.kind === 'turn' && first.partial) h += (Math.PI - first.len / first.R);
  for (const s of path) {
    if (progress <= s.start) break;
    if (s.kind === 'turn') h += Math.min(progress, s.end) - s.start > 0 ? (Math.min(progress, s.end) - s.start) / s.R : 0;
  }
  return h;
}

export function distanceName(m) {
  const f = Math.round(m / FURLONG * 2) / 2;
  const table = {
    5: '5 furlongs', 5.5: '5½ furlongs', 6: '6 furlongs', 6.5: '6½ furlongs', 7: '7 furlongs',
    8: '1 mile', 8.5: '1 1/16 miles', 9: '1⅛ miles', 10: '1¼ miles', 12: '1½ miles',
  };
  return table[f] || `${f} furlongs`;
}

export function distanceShort(m) {
  const f = Math.round(m / FURLONG * 2) / 2;
  const table = { 5: '5f', 5.5: '5½f', 6: '6f', 6.5: '6½f', 7: '7f', 8: '1m', 8.5: '1 1/16', 9: '1⅛', 10: '1¼', 12: '1½' };
  return table[f] || `${f}f`;
}

// Distance poles along the inside rail: [{ fromWire, kind }]. Quarter poles are red and white,
// eighth poles green and white, sixteenth poles black and white.
export function poles(maxFromWire) {
  const out = [];
  const sixteenth = FURLONG / 2;
  for (let k = 1; k * sixteenth <= maxFromWire + 1; k++) {
    const kind = k % 4 === 0 ? 'quarter' : k % 2 === 0 ? 'eighth' : 'sixteenth';
    out.push({ fromWire: k * sixteenth, kind, k });
  }
  return out;
}

// "the three-sixteenths pole" etc, for the caller.
export function poleName(k) {
  const names = { 1: 'sixteenth pole', 2: 'eighth pole', 3: 'three-sixteenths', 4: 'quarter pole', 6: 'three-eighths pole', 8: 'half-mile pole' };
  return names[k];
}
