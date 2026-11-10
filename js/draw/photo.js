// The photo finish. A real finish camera is a slit: it looks only at the line and records it over
// time, so the picture's left-right is time, not space. This builds one the same way, one column at
// a time, from the recorded race. Horses that cross first are on the right; the stretched and squashed
// legs are what a real finish photo looks like. The top strip is the mirror on the far side.

import { drawHorse, noseAt } from './horse.js';
import { stateAt } from '../sim.js';
import { CLOTH } from '../data.js';

const TALL = 2.5;   // a horse and rider, to the top of the cap, in metres
const LIFT = 0.25;  // the camera is high in the stands: a metre nearer the rail is this much of a metre up the picture
const SPREAD = 5;   // metres between the inside and outside horse that get the full lift; wider than that is squeezed
const MIRROR = 0.5; // the mirror's picture is at most this size

// `marks: false` leaves off the line and the numbers, for checking the picture itself.
export function photoFinish(canvas, { run, runners, width = 360, height = 220, grey = true, marks = true }) {
  const D = run.distance;
  const win = run.results[0];
  const tWin = run.t0 + win.time;
  canvas.width = width;
  canvas.height = height;
  const out = canvas.getContext('2d');
  const img = out.createImageData(width, height);
  const slice = document.createElement('canvas');
  slice.width = 3; slice.height = height;
  const sx = slice.getContext('2d', { willReadFrequently: true });
  const mirrorH = Math.round(height * 0.26);
  const speed = win.finishSpeed || 16;
  // The winner's nose is on the line at column lineX. Columns count from the left; time runs right to left.
  const lineX = width - 1 - Math.round(width * 0.14);
  // The numbers over the noses (see markNoses) have a row of their own above the horses.
  const chip = Math.max(11, Math.round(height * 0.052)) + 3;
  const base = height - Math.max(6, Math.round(height * 0.035)); // the outside horse's feet
  const room = base - mirrorH - chip - 6;

  // Seen from high in the stands, a horse nearer the rail is higher up the picture, which is what lets one
  // nose be told from another when they cross together. The horses whose noses are in the picture are
  // spread between the outside one, at the bottom, and the inside one, a quarter of a metre up for each
  // metre between them. The picture is as big as that leaves room for: k pixels to the metre, with a
  // column's time chosen so a horse is about as long as it is tall. (A bigger picture shows less time, so
  // which horses are in it is worked out again until it settles.)
  const states = [];
  const crossing = r => stateAt(run, run.t0 + r.time, states)[r.h];
  let k, dtCol, outer, spread, shown = 1;
  for (let was = 0; was !== shown;) {
    was = shown;
    const paths = run.results.slice(0, shown).map(r => crossing(r).o);
    outer = Math.max(...paths);
    spread = outer - Math.min(...paths);
    k = room / (TALL + LIFT * Math.min(spread, SPREAD));
    dtCol = 1.05 / (k * speed);
    shown = Math.max(shown, run.results.filter(r => r.time - win.time <= lineX * dtCol).length);
  }
  const tAt = c => tWin + (lineX - c) * dtCol;
  const lift = spread > 0 ? LIFT * k * Math.min(spread, SPREAD) / spread : 0; // pixels up, a metre toward the rail
  const feet = o => base - Math.max(0, Math.min(spread, outer - o)) * lift;
  // The track is as deep as the paths the horses are in, and comes up behind the inside one to about its
  // back, with the far rail over the top of it.
  const trackTop = Math.round(Math.max(mirrorH + chip + 6, feet(outer - spread) - 1.35 * k));
  // In the mirror, on the rail, the inside horse is the near one.
  const mk = k * Math.min(MIRROR, (mirrorH - 4) / (TALL * k));
  const mirrorBase = mirrorH - 3;
  const mirrorLift = spread > 0 ? Math.min(0.08 * k, Math.max(0, mirrorBase - 1 - TALL * mk) / spread) : 0;
  const mirrorFeet = o => mirrorBase - Math.max(0, Math.min(spread, o - (outer - spread))) * mirrorLift;

  for (let c = 0; c < width; c++) {
    const st = stateAt(run, tAt(c), states);
    sx.setTransform(1, 0, 0, 1, 0, 0);
    // Background: the far rail and the track, which a slit camera smears into stripes.
    sx.fillStyle = '#d9d6cc';
    sx.fillRect(0, 0, 3, height);
    sx.fillStyle = '#b9ab95';
    sx.fillRect(0, trackTop, 3, height);
    sx.fillStyle = '#f4f2ec';
    sx.fillRect(0, trackTop - Math.round(k * 0.3), 3, Math.max(2, Math.round(k * 0.06)));
    sx.fillStyle = '#6d6a63';
    sx.fillRect(0, 0, 3, mirrorH);
    // Horses on the line now. The race follows a horse by its nose, and the nose in the drawing moves
    // with the stride, so each horse is placed by where its nose is drawn: the nose reaches the line in
    // the column for the moment the race says it did. (Placed by a fixed distance from the nose, the
    // picture put the wrong nose in front in the closest finishes, and the winner's past the line.)
    const on = [];
    st.forEach((s, i) => {
      const mid = s.p - noseAt(s.phase).x; // its middle, where the drawing is centred
      if (mid > D - 1.9 && mid < D + 1.8) on.push({ ...s, i, mid });
    });
    // Outside ones nearest the camera.
    on.sort((a, b) => a.o - b.o);
    for (const h of on) {
      const r = runners[h.i];
      sx.save();
      sx.translate(1.5 + (h.mid - D) * k, feet(h.o));
      sx.scale(k, -k);
      drawHorse(sx, { phase: h.phase, coat: r.coat, marks: r.marks, silks: r.silks, number: r.number, urge: 1 });
      sx.restore();
    }
    // The mirror: the same moment seen from the other side, inside horses nearest.
    for (const h of on.slice().reverse()) {
      const r = runners[h.i];
      sx.save();
      sx.translate(1.5 + (h.mid - D) * mk, mirrorFeet(h.o));
      sx.scale(mk, -mk);
      drawHorse(sx, { phase: h.phase, coat: r.coat, marks: r.marks, silks: { ...r.silks }, number: r.number, urge: 1, noRider: false });
      sx.restore();
    }
    const col = sx.getImageData(1, 0, 1, height).data;
    for (let y = 0; y < height; y++) {
      const i = (y * width + c) * 4, j = y * 4;
      img.data[i] = col[j]; img.data[i + 1] = col[j + 1]; img.data[i + 2] = col[j + 2]; img.data[i + 3] = 255;
    }
  }
  if (grey) {
    // Black and white, warm paper.
    for (let i = 0; i < img.data.length; i += 4) {
      const l = 0.3 * img.data[i] + 0.59 * img.data[i + 1] + 0.11 * img.data[i + 2];
      const v = Math.max(0, Math.min(255, (l - 128) * 1.25 + 128));
      img.data[i] = Math.min(255, v * 1.02 + 6); img.data[i + 1] = v; img.data[i + 2] = Math.max(0, v * 0.93 - 4);
    }
  }
  out.putImageData(img, 0, 0);
  // Divider between the mirror and the main picture.
  out.fillStyle = '#1b1a18';
  out.fillRect(0, mirrorH - 1, width, 2);

  // Where the first three noses are in the picture.
  const noses = run.results.slice(0, 3).map(r => {
    const s = crossing(r);
    return { h: r.h, number: runners[r.h].number, x: lineX - (r.time - win.time) / dtCol, y: feet(s.o) - noseAt(s.phase).y * k };
  }).filter(n => n.x >= 0);
  if (marks) markNoses(out, noses, { width, height, mirrorH, lineX, chip });
  return { dtCol, lineX, noses };
}

// The line through the winner's nose, and a chip with the saddle-cloth number over each of the first three
// noses, with a hairline down to the nose it belongs to. Chips that would touch go one under the other, so
// two numbers never print on each other however close the finish.
function markNoses(out, noses, { width, height, mirrorH, lineX, chip: tall }) {
  out.lineWidth = 1;
  out.strokeStyle = 'rgba(255,255,255,.9)';
  out.beginPath(); out.moveTo(lineX + 0.5, 0); out.lineTo(lineX + 0.5, height); out.stroke();
  out.font = `600 ${tall - 3}px Oswald, "IBM Plex Sans Condensed", sans-serif`;
  out.textAlign = 'center';
  out.textBaseline = 'middle';
  const placed = [];
  for (const n of noses) {
    const label = String(n.number);
    const wide = Math.max(tall, Math.ceil(out.measureText(label).width) + 7);
    const x = Math.max(wide / 2 + 1, Math.min(width - wide / 2 - 1, Math.round(n.x) + 0.5));
    let row = 0;
    while (placed.some(p => p.row === row && Math.abs(p.x - x) < (p.wide + wide) / 2 + 2)) row++;
    placed.push({ x, wide, row });
    const top = mirrorH + 3 + row * (tall + 2);
    // The hairline, from the chip to the nose, and a dot on the nose.
    const nx = Math.round(n.x) + 0.5;
    if (n.y > top + tall) {
      out.strokeStyle = 'rgba(255,255,255,.8)';
      out.beginPath(); out.moveTo(nx, top + tall); out.lineTo(nx, n.y); out.stroke();
    }
    out.fillStyle = '#fff';
    out.beginPath(); out.arc(nx, n.y, 1.6, 0, Math.PI * 2); out.fill();
    const [cloth, ink] = CLOTH[n.number] || CLOTH[1];
    out.fillStyle = cloth;
    out.fillRect(x - wide / 2, top, wide, tall);
    out.strokeStyle = 'rgba(20,20,18,.85)';
    out.strokeRect(x - wide / 2 + 0.5, top + 0.5, wide - 1, tall - 1);
    out.fillStyle = ink;
    out.fillText(label, x, top + tall / 2 + 1);
  }
}
