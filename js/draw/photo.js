// The photo finish. A real finish camera is a slit: it looks only at the line and records it over
// time, so the picture's left-right is time, not space. This builds one the same way, one column at
// a time, from the recorded race. Horses that cross first are on the right; the stretched and squashed
// legs are what a real finish photo looks like. The top strip is the mirror on the far side.

import { drawHorse, NOSE } from './horse.js';
import { stateAt } from '../sim.js';

export function photoFinish(canvas, { run, runners, width = 360, height = 220, grey = true }) {
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
  // Pixels per metre, vertically; and seconds per column, chosen so a horse is about as long as it is tall.
  const mirrorH = Math.round(height * 0.3);
  const k = (height - mirrorH) / 3.4;
  const speed = win.finishSpeed || 16;
  const dtCol = 1 / (k * speed) * 1.05;
  const rightPad = Math.round(width * 0.14);
  const states = [];
  const ground = height - 10;
  for (let c = 0; c < width; c++) {
    // Column c counts from the left; time runs right to left.
    const t = tWin - (rightPad - (width - 1 - c)) * dtCol;
    const st = stateAt(run, t, states);
    sx.setTransform(1, 0, 0, 1, 0, 0);
    // Background: the far rail and the track, which a slit camera smears into stripes.
    sx.fillStyle = '#d9d6cc';
    sx.fillRect(0, 0, 3, height);
    sx.fillStyle = '#b9ab95';
    sx.fillRect(0, mirrorH + (height - mirrorH) * 0.55, 3, height);
    sx.fillStyle = '#f4f2ec';
    sx.fillRect(0, mirrorH + (height - mirrorH) * 0.38, 3, 3);
    sx.fillStyle = '#6d6a63';
    sx.fillRect(0, 0, 3, mirrorH);
    // Horses on the line now, outside ones nearest the camera.
    const on = st.map((s, i) => ({ ...s, i, p: s.p - NOSE })).filter(s => s.p > D - 1.9 && s.p < D + 1.8).sort((a, b) => a.o - b.o);
    for (const h of on) {
      const r = runners[h.i];
      const depthShift = h.o * 2.2;
      sx.save();
      sx.translate(1.5 + (h.p - D) * k, ground - depthShift * 0.4);
      sx.scale(k, -k);
      drawHorse(sx, { phase: h.phase, coat: r.coat, marks: r.marks, silks: r.silks, number: r.number, urge: 1 });
      sx.restore();
    }
    // The mirror: the same moment seen from the other side, inside horses nearest.
    for (const h of on.slice().reverse()) {
      const r = runners[h.i];
      sx.save();
      sx.translate(1.5 + (h.p - D) * k * 0.62, mirrorH - 4 - h.o * 0.5);
      sx.scale(k * 0.62, -k * 0.62);
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
  // The line through the winner's nose, and the order.
  const x = width - 1 - rightPad;
  out.strokeStyle = 'rgba(255,255,255,.9)';
  out.lineWidth = 1;
  out.beginPath(); out.moveTo(x + 0.5, 0); out.lineTo(x + 0.5, height); out.stroke();
  out.font = '600 11px "IBM Plex Sans Condensed", sans-serif';
  out.fillStyle = 'rgba(20,20,18,.8)';
  out.fillRect(0, height - 16, width, 16);
  out.fillStyle = '#f4f1e8';
  out.textBaseline = 'middle';
  const order = run.results.slice(0, 3);
  order.forEach((r, k2) => {
    const behindPx = (r.time - win.time) / dtCol;
    const xx = x - behindPx;
    if (xx > 12) {
      out.fillText(String(runners[r.h].number), xx - 10, height - 8);
    }
  });

  return { dtCol };
}
