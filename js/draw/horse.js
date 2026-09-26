// A racehorse and rider, drawn from a few bones. Each leg is placed by where its hoof should be at
// this point in the stride (on the ground for part of it, tucked and swinging for the rest), and the
// joints are worked out from that. Units are metres, the horse faces right, and y points up.

import { CLOTH } from '../data.js';

// The sim tracks a horse by its nose; drawings are centred on its middle, this far back.
export const NOSE = 1.55;

export const COATS = {
  bay: { body: '#8a4f2a', shade: '#61361d', light: '#a9683c', points: '#1f1612', mane: '#1a120f' },
  'dark bay': { body: '#4d2d1b', shade: '#331e12', light: '#6a412a', points: '#15100d', mane: '#120d0b' },
  chestnut: { body: '#a95b2b', shade: '#7c401e', light: '#c6773f', points: '#94501f', mane: '#8b4a22' },
  grey: { body: '#b8b6b0', shade: '#8f8d88', light: '#dddbd4', points: '#5f5d5a', mane: '#7d7b77' },
  black: { body: '#27201c', shade: '#171210', light: '#3d332d', points: '#110d0b', mane: '#0e0a08' },
  roan: { body: '#937a6d', shade: '#6d584e', light: '#b09486', points: '#2c211c', mane: '#2c211c' },
};

// Phase offsets through the stride for a gallop on the right lead:
// far hind, near hind, far fore, near fore. Each hoof is down for DUTY of the stride.
const OFF = { fh: 0.0, nh: 0.12, ff: 0.33, nf: 0.45 };
const DUTY = 0.22;

const FORE = { root: [0.5, 1.06], l1: 0.54, l2: 0.53, bend: 1 };
const HIND = { root: [-0.55, 1.14], l1: 0.62, l2: 0.57, bend: -1 };

// Where a hoof is, relative to the leg's root, at stride position u (0..1 since touchdown).
function hoofPath(fore, u, groundY) {
  const [c, l] = fore ? [0.5, -0.5] : [0.52, -0.52];
  if (u < DUTY) {
    const k = u / DUTY;
    return [c + (l - c) * k, groundY];
  }
  const k = (u - DUTY) / (1 - DUTY);
  // Lift behind, tuck, swing through, reach, and down.
  const pts = fore
    ? [[l, groundY], [-0.46, groundY + 0.3], [-0.2, groundY + 0.6], [0.22, groundY + 0.64], [0.74, groundY + 0.36], [0.64, groundY + 0.1], [c, groundY]]
    : [[l, groundY], [-0.7, groundY + 0.26], [-0.45, groundY + 0.5], [0.05, groundY + 0.52], [0.45, groundY + 0.3], [0.6, groundY + 0.1], [c, groundY]];
  return catmull(pts, k);
}

function catmull(pts, t) {
  const n = pts.length - 1;
  const f = Math.min(n - 1e-6, t * n);
  const i = Math.floor(f);
  const u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const q = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u);
  return [q(0), q(1)];
}

function ik(rx, ry, tx, ty, l1, l2, bend) {
  let dx = tx - rx, dy = ty - ry;
  let d = Math.hypot(dx, dy);
  const max = (l1 + l2) * 0.999;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; tx = rx + dx; ty = ry + dy; }
  const a = Math.atan2(dy, dx);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const ang = a + bend * A;
  return { jx: rx + l1 * Math.cos(ang), jy: ry + l1 * Math.sin(ang), tx, ty };
}

// The body's pose at a point in the stride.
export function pose(phase, gait = 'gallop') {
  if (gait === 'stand') return { bob: 0, pitch: 0, neck: 0.72, headDrop: 1.15, stand: true };
  if (gait === 'walk') {
    const s = Math.sin(phase * Math.PI * 2);
    return { bob: 0.01 * s, pitch: 0, neck: 0.62 + 0.04 * s, headDrop: 1.1, walk: true };
  }
  const tau = Math.PI * 2;
  return {
    bob: 0.05 * Math.cos(tau * (phase - 0.83)),
    pitch: -0.05 * Math.sin(tau * (phase - 0.2)),
    neck: 0.36 + 0.13 * Math.sin(tau * (phase - 0.7)),
    headDrop: 1.12,
  };
}

// Joint positions for one leg in body coordinates.
function leg(which, phase, gait, bodyY, pitch) {
  const fore = which[1] === 'f';
  const spec = fore ? FORE : HIND;
  const [rx, ry] = spec.root;
  // The ground, in body coordinates (the body rides bodyY above its standing height, tilted by pitch).
  const groundY = -ry - bodyY - Math.sin(pitch) * rx;
  let hx, hy;
  if (gait === 'stand') {
    const x = { ff: 0.06, nf: -0.02, fh: 0.02, nh: -0.06 }[which];
    [hx, hy] = [x, groundY];
  } else if (gait === 'walk') {
    const off = { nh: 0, nf: 0.25, fh: 0.5, ff: 0.75 }[which];
    const u = ((phase - off) % 1 + 1) % 1;
    if (u < 0.6) { const k = u / 0.6; hx = 0.28 - 0.56 * k; hy = groundY; }
    else { const k = (u - 0.6) / 0.4; hx = -0.28 + 0.56 * k; hy = groundY + Math.sin(k * Math.PI) * (fore ? 0.2 : 0.16); }
  } else {
    const u = ((phase - OFF[which]) % 1 + 1) % 1;
    [hx, hy] = hoofPath(fore, u, groundY);
  }
  const j = ik(0, 0, hx, hy, spec.l1, spec.l2, spec.bend);
  return { fore, rx, ry, jx: rx + j.jx, jy: ry + j.jy, hx: rx + j.tx, hy: ry + j.ty };
}

function limb(ctx, L, color, hoofColor, sock, lightColor) {
  const { rx, ry, jx, jy, hx, hy, fore } = L;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Upper leg: thick, tapering into the joint.
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  taper(ctx, rx, ry, jx, jy, fore ? 0.24 : 0.34, 0.11);
  // Lower leg: fine, with a fetlock.
  const dx = hx - jx, dy = hy - jy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const fx = hx - ux * 0.16, fy = hy - uy * 0.16;
  taper(ctx, jx, jy, fx, fy, 0.1, 0.075);
  ctx.fillStyle = sock ? '#f1ece2' : color;
  if (sock) taper(ctx, jx + (fx - jx) * 0.45, jy + (fy - jy) * 0.45, fx, fy, 0.085, 0.078);
  // Pastern and hoof.
  const hoofAng = Math.atan2(uy, ux) + (Math.abs(uy) > 0.8 ? 0.35 : 0);
  ctx.beginPath();
  ctx.arc(fx, fy, 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(hoofAng);
  ctx.fillStyle = sock ? '#f1ece2' : color;
  ctx.fillRect(-0.16, -0.035, 0.1, 0.07);
  ctx.fillStyle = hoofColor;
  ctx.beginPath();
  ctx.moveTo(-0.07, -0.05); ctx.lineTo(0.02, -0.055); ctx.lineTo(0.03, 0.05); ctx.lineTo(-0.07, 0.045);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function taper(ctx, x1, y1, x2, y2, w1, w2) {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const cx = Math.cos(a), cy = Math.sin(a);
  ctx.beginPath();
  ctx.moveTo(x1 + cx * w1 / 2, y1 + cy * w1 / 2);
  ctx.lineTo(x2 + cx * w2 / 2, y2 + cy * w2 / 2);
  ctx.arc(x2, y2, w2 / 2, a, a + Math.PI);
  ctx.lineTo(x1 - cx * w1 / 2, y1 - cy * w1 / 2);
  ctx.arc(x1, y1, w1 / 2, a + Math.PI, a + Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

// Draw a horse and rider. ctx must already be translated to the spot on the ground under the horse's
// middle and scaled so 1 unit = 1 metre with y pointing up.
// o: { phase, gait, coat, marks, silks, number, urge (0..1), blinkers, flip, noRider, blanket, t }
export function drawHorse(ctx, o) {
  const c = COATS[o.coat] || COATS.bay;
  const gait = o.gait || 'gallop';
  const P = pose(o.phase, gait);
  ctx.save();
  if (o.flip) ctx.scale(-1, 1);
  ctx.translate(0, P.bob);
  ctx.rotate(P.pitch);
  const socks = o.marks?.socks || [false, false, false, false];

  // Far side legs first, in shadow.
  const legs = {};
  for (const w of ['fh', 'ff', 'nh', 'nf']) legs[w] = leg(w, o.phase, gait, P.bob, P.pitch);
  limb(ctx, legs.fh, c.shade, '#1b1512', socks[2] && '#cfc9bd');
  limb(ctx, legs.ff, c.shade, '#1b1512', socks[3] && '#cfc9bd');

  // Tail.
  const tau = Math.PI * 2;
  ctx.fillStyle = c.mane;
  ctx.beginPath();
  if (gait === 'gallop') {
    const w1 = Math.sin(tau * o.phase) * 0.06, w2 = Math.sin(tau * o.phase + 1.2) * 0.08;
    ctx.moveTo(-0.76, 1.54);
    ctx.bezierCurveTo(-1.0, 1.6 + w1, -1.25, 1.45 + w1, -1.62, 1.36 + w2);
    ctx.bezierCurveTo(-1.4, 1.3 + w2, -1.2, 1.26 + w1, -0.84, 1.36);
  } else {
    ctx.moveTo(-0.78, 1.52);
    ctx.bezierCurveTo(-0.95, 1.4, -0.92, 1.0, -0.9, 0.62);
    ctx.lineTo(-0.8, 0.64);
    ctx.bezierCurveTo(-0.8, 1.0, -0.8, 1.3, -0.72, 1.42);
  }
  ctx.closePath();
  ctx.fill();

  // Body.
  const g = ctx.createLinearGradient(0, 1.65, 0, 0.95);
  g.addColorStop(0, c.light);
  g.addColorStop(0.45, c.body);
  g.addColorStop(1, c.shade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0.42, 1.63);
  ctx.bezierCurveTo(0.2, 1.56, -0.05, 1.5, -0.3, 1.55);
  ctx.bezierCurveTo(-0.55, 1.62, -0.72, 1.6, -0.8, 1.5);
  ctx.bezierCurveTo(-0.9, 1.38, -0.9, 1.2, -0.78, 1.05);
  ctx.bezierCurveTo(-0.7, 0.96, -0.55, 0.98, -0.42, 1.0);
  ctx.bezierCurveTo(-0.2, 0.95, 0.2, 0.92, 0.42, 0.97);
  ctx.bezierCurveTo(0.6, 1.0, 0.75, 1.1, 0.76, 1.25);
  ctx.lineTo(0.72, 1.4);
  ctx.closePath();
  ctx.fill();

  // Near side legs.
  limb(ctx, legs.nh, c.body, '#1b1512', socks[0]);
  limb(ctx, legs.nf, c.body, '#1b1512', socks[1]);
  // Lower legs of a bay or black are black: repaint the cannons.
  if (o.coat === 'bay' || o.coat === 'dark bay' || o.coat === 'roan') {
    for (const [L, s, col] of [[legs.fh, socks[2], c.points], [legs.ff, socks[3], c.points], [legs.nh, socks[0], c.points], [legs.nf, socks[1], c.points]]) {
      if (s) continue;
      ctx.fillStyle = col;
      const k = 0.35;
      const dx = L.hx - L.jx, dy = L.hy - L.jy, len = Math.hypot(dx, dy);
      taper(ctx, L.jx + dx * k, L.jy + dy * k, L.hx - dx / len * 0.16, L.hy - dy / len * 0.16, 0.085, 0.078);
    }
  }

  // Neck and head.
  const a = P.neck;
  const nb1 = [0.42, 1.62], nb2 = [0.74, 1.28];
  const neckLen = gait === 'gallop' ? 0.82 : 0.7;
  const poll = [nb1[0] + 0.12 + Math.cos(a) * neckLen, nb1[1] + Math.sin(a) * neckLen];
  const ha = a - P.headDrop;
  const hl = 0.6;
  const muzzle = [poll[0] + Math.cos(ha) * hl, poll[1] + Math.sin(ha) * hl];
  const nx = Math.cos(ha + Math.PI / 2), ny = Math.sin(ha + Math.PI / 2);
  const throat = [poll[0] + Math.cos(ha) * 0.18 - nx * 0.2, poll[1] + Math.sin(ha) * 0.18 - ny * 0.2];
  const ng = ctx.createLinearGradient(nb1[0], nb1[1], nb2[0], nb2[1]);
  ng.addColorStop(0, c.light);
  ng.addColorStop(1, c.body);
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.moveTo(nb1[0] - 0.05, nb1[1] - 0.02);
  ctx.quadraticCurveTo((nb1[0] + poll[0]) / 2, (nb1[1] + poll[1]) / 2 + 0.1, poll[0], poll[1]);
  // head top to muzzle
  ctx.lineTo(poll[0] + Math.cos(ha) * 0.2 + nx * 0.05, poll[1] + Math.sin(ha) * 0.2 + ny * 0.05);
  ctx.quadraticCurveTo(muzzle[0] + nx * 0.07, muzzle[1] + ny * 0.07, muzzle[0] + Math.cos(ha) * 0.03, muzzle[1] + Math.sin(ha) * 0.03);
  ctx.quadraticCurveTo(muzzle[0] - nx * 0.09, muzzle[1] - ny * 0.09, muzzle[0] - Math.cos(ha) * 0.12 - nx * 0.1, muzzle[1] - Math.sin(ha) * 0.12 - ny * 0.1);
  ctx.quadraticCurveTo(throat[0] + Math.cos(ha) * 0.12, throat[1] + Math.sin(ha) * 0.12 - 0.02, throat[0], throat[1]);
  ctx.quadraticCurveTo((throat[0] + nb2[0]) / 2 + 0.02, (throat[1] + nb2[1]) / 2 - 0.06, nb2[0], nb2[1]);
  ctx.lineTo(0.7, 1.45);
  ctx.closePath();
  ctx.fill();
  // Ear.
  ctx.fillStyle = c.shade;
  ctx.beginPath();
  ctx.moveTo(poll[0] - 0.02, poll[1] - 0.01);
  ctx.lineTo(poll[0] - Math.cos(a) * 0.02 + 0.02, poll[1] + 0.15);
  ctx.lineTo(poll[0] + 0.07, poll[1] + 0.01);
  ctx.fill();
  // Mane along the crest, flying back.
  ctx.fillStyle = c.mane;
  ctx.beginPath();
  ctx.moveTo(poll[0] - 0.02, poll[1] + 0.02);
  const flow = gait === 'gallop' ? 0.08 + 0.03 * Math.sin(tau * o.phase) : 0.03;
  ctx.quadraticCurveTo((nb1[0] + poll[0]) / 2 - flow, (nb1[1] + poll[1]) / 2 + 0.16 + flow, nb1[0] - 0.08, nb1[1] + 0.02);
  ctx.quadraticCurveTo((nb1[0] + poll[0]) / 2, (nb1[1] + poll[1]) / 2 + 0.08, poll[0], poll[1] - 0.02);
  ctx.fill();
  // Face marking.
  const face = o.marks?.face;
  if (face && face !== 'none') {
    ctx.fillStyle = '#f3efe6';
    ctx.beginPath();
    const f0 = [poll[0] + Math.cos(ha) * 0.14 + nx * 0.035, poll[1] + Math.sin(ha) * 0.14 + ny * 0.035];
    const f1 = [muzzle[0] - Math.cos(ha) * (face === 'star' ? 0.4 : face === 'snip' ? 0.06 : 0.1) + nx * 0.05, muzzle[1] - Math.sin(ha) * (face === 'star' ? 0.4 : face === 'snip' ? 0.06 : 0.1) + ny * 0.05];
    if (face === 'star') { ctx.arc(f0[0], f0[1], 0.035, 0, tau); }
    else if (face === 'snip') { ctx.arc(f1[0], f1[1], 0.03, 0, tau); }
    else {
      ctx.moveTo(f0[0], f0[1]);
      ctx.lineTo(f1[0], f1[1]);
      ctx.lineWidth = face === 'blaze' ? 0.07 : 0.035;
      ctx.strokeStyle = '#f3efe6';
      ctx.stroke();
    }
    ctx.fill();
  }
  // Eye, nostril, bridle.
  const eye = [poll[0] + Math.cos(ha) * 0.17 - nx * 0.03, poll[1] + Math.sin(ha) * 0.17 - ny * 0.03];
  if (o.blinkers) {
    ctx.fillStyle = o.silks ? o.silks.trim : '#222';
    ctx.beginPath();
    ctx.arc(eye[0], eye[1], 0.07, 0, tau);
    ctx.fill();
  }
  ctx.fillStyle = '#0c0908';
  ctx.beginPath();
  ctx.arc(eye[0], eye[1], 0.028, 0, tau);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,10,.8)';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(poll[0] + 0.01, poll[1] - 0.02);
  ctx.lineTo(throat[0] + Math.cos(ha) * 0.1, throat[1] + Math.sin(ha) * 0.1);
  const bit = [muzzle[0] - Math.cos(ha) * 0.13 - nx * 0.05, muzzle[1] - Math.sin(ha) * 0.13 - ny * 0.05];
  ctx.moveTo(eye[0] + Math.cos(ha) * 0.08, eye[1] + Math.sin(ha) * 0.08);
  ctx.lineTo(bit[0], bit[1]);
  ctx.stroke();

  if (o.blanket) drawBlanket(ctx, o.blanket);

  // Saddle cloth with the program number.
  if (o.number) {
    const [cloth, ink] = CLOTH[o.number] || CLOTH[1];
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(-0.46, 1.56); ctx.lineTo(0.14, 1.58); ctx.lineTo(0.16, 1.16); ctx.lineTo(-0.44, 1.12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.save();
    ctx.translate(-0.16, 1.34);
    ctx.scale(0.01, -0.01);
    ctx.fillStyle = ink;
    ctx.font = '700 30px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(o.number), 0, 1, 50);
    ctx.restore();
  }

  if (!o.noRider) drawRider(ctx, o, P, gait);
  ctx.restore();
}

function drawBlanket(ctx, colors) {
  // A blanket of flowers over the withers for the stakes winner.
  ctx.fillStyle = colors.base;
  ctx.beginPath();
  ctx.moveTo(-0.45, 1.6); ctx.quadraticCurveTo(0.1, 1.66, 0.55, 1.62);
  ctx.lineTo(0.6, 1.05); ctx.quadraticCurveTo(0.1, 0.98, -0.45, 1.06);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 70; i++) {
    const x = -0.42 + ((i * 37) % 97) / 97 * 0.98;
    const y = 1.08 + ((i * 53) % 89) / 89 * 0.52;
    ctx.fillStyle = colors.flowers[i % colors.flowers.length];
    ctx.beginPath();
    ctx.arc(x, y, 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

// The jockey: crouched high over the withers, knees tucked, hands on the neck.
function drawRider(ctx, o, P, gait) {
  const s = o.silks || { body: '#c62828', trim: '#f7f5ef', pattern: 'solid', cap: '#f7f5ef', capTrim: '#c62828' };
  const tau = Math.PI * 2;
  const upright = gait !== 'gallop';
  const urge = gait === 'gallop' ? (o.urge || 0) : 0;
  const ph = o.phase || 0;
  // The rider floats: counter the horse's bob and pitch.
  ctx.save();
  ctx.rotate(-P.pitch * 0.8);
  ctx.translate(0, -P.bob * 0.7);
  const pump = urge * Math.sin(tau * ph * 2) * 0.07;
  const foot = upright ? [0.1, 1.28] : [0.2, 1.46];
  const knee = upright ? [0.3, 1.72] : [0.44, 1.82];
  const hip = upright ? [-0.02, 1.95] : [0.02 + pump * 0.3, 2.0 - urge * 0.03];
  const sh = upright ? [0.12, 2.5] : [0.52 + pump * 0.5, 2.14 + urge * 0.02];
  const head = upright ? [0.16, 2.72] : [0.74 + pump * 0.4, 2.24];
  const hand = upright ? [0.62, 1.84] : [0.9 + pump * 1.4, 1.74 + pump * 0.3];
  const elbow = upright ? [0.3, 2.12] : [0.62 + pump * 0.6, 1.92 - urge * 0.04];

  // Boots and breeches.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f2efe8';
  ctx.lineWidth = 0.17;
  ctx.beginPath();
  ctx.moveTo(hip[0], hip[1]);
  ctx.lineTo(knee[0], knee[1]);
  ctx.stroke();
  ctx.strokeStyle = '#1a1716';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(knee[0], knee[1]);
  ctx.lineTo(foot[0], foot[1]);
  ctx.lineTo(foot[0] + 0.1, foot[1] - 0.02);
  ctx.stroke();
  // Stirrup leather.
  ctx.strokeStyle = 'rgba(30,20,15,.7)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(foot[0] + 0.03, foot[1]);
  ctx.lineTo(0.02, 1.58);
  ctx.stroke();

  // Torso in silks.
  ctx.save();
  ctx.beginPath();
  const tw = 0.24;
  const ang = Math.atan2(sh[1] - hip[1], sh[0] - hip[0]);
  const px = -Math.sin(ang) * tw / 2, py = Math.cos(ang) * tw / 2;
  ctx.moveTo(hip[0] - px, hip[1] - py);
  ctx.lineTo(hip[0] + px, hip[1] + py);
  ctx.quadraticCurveTo((hip[0] + sh[0]) / 2 + px * 1.5, (hip[1] + sh[1]) / 2 + py * 1.5, sh[0] + px, sh[1] + py);
  ctx.arc(sh[0], sh[1], tw / 2 * 1.02, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.quadraticCurveTo((hip[0] + sh[0]) / 2 - px * 0.9, (hip[1] + sh[1]) / 2 - py * 0.9, hip[0] - px, hip[1] - py);
  ctx.closePath();
  ctx.fillStyle = s.body;
  ctx.fill();
  ctx.clip();
  silkPattern(ctx, s, hip, sh, ang);
  ctx.restore();

  // Arm, with sleeve.
  ctx.strokeStyle = s.pattern === 'sleeves' ? s.trim : s.body;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(sh[0], sh[1]);
  ctx.lineTo(elbow[0], elbow[1]);
  ctx.lineTo(hand[0], hand[1]);
  ctx.stroke();
  if (s.pattern === 'hoops' || s.pattern === 'stripes') {
    ctx.strokeStyle = s.trim;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(elbow[0] + (hand[0] - elbow[0]) * 0.4, elbow[1] + (hand[1] - elbow[1]) * 0.4);
    ctx.lineTo(elbow[0] + (hand[0] - elbow[0]) * 0.6, elbow[1] + (hand[1] - elbow[1]) * 0.6);
    ctx.stroke();
  }
  ctx.fillStyle = '#e9e4da';
  ctx.beginPath();
  ctx.arc(hand[0], hand[1], 0.05, 0, tau);
  ctx.fill();
  // Reins to the bit.
  ctx.strokeStyle = 'rgba(25,15,10,.8)';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(hand[0], hand[1]);
  const a = P.neck;
  ctx.lineTo(0.42 + 0.12 + Math.cos(a) * 0.82 + 0.25, 1.62 + Math.sin(a) * 0.82 - 0.32);
  ctx.stroke();
  // Whip, raised when driving hard.
  if (urge > 0.6) {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(hand[0], hand[1]);
    ctx.lineTo(hand[0] - 0.35, hand[1] + 0.25 + Math.sin(tau * ph * 2) * 0.1);
    ctx.stroke();
  }

  // Helmet with the cap in the owner's colours, and goggles.
  ctx.fillStyle = '#e8c9a8';
  ctx.beginPath();
  ctx.arc(head[0] + 0.05, head[1] - 0.04, 0.085, 0, tau);
  ctx.fill();
  ctx.fillStyle = s.cap;
  ctx.beginPath();
  ctx.arc(head[0], head[1], 0.12, Math.PI * 0.02, Math.PI * 1.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = s.capTrim;
  ctx.fillRect(head[0] + 0.02, head[1] - 0.005, 0.16, 0.035);
  ctx.fillStyle = '#20272c';
  ctx.fillRect(head[0] + 0.07, head[1] - 0.055, 0.07, 0.04);
  ctx.restore();
}

function silkPattern(ctx, s, hip, sh, ang) {
  ctx.fillStyle = s.trim;
  const cx = (hip[0] + sh[0]) / 2, cy = (hip[1] + sh[1]) / 2;
  const len = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]) + 0.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // Local frame: x along the torso (hip to shoulder), y across it.
  const L = len / 2, W = 0.2;
  switch (s.pattern) {
    case 'hoops': for (let x = -L; x < L; x += 0.14) ctx.fillRect(x, -W, 0.07, 2 * W); break;
    case 'stripes': for (let y = -W; y < W; y += 0.09) ctx.fillRect(-L, y, 2 * L, 0.04); break;
    case 'sash': ctx.save(); ctx.rotate(0.9); ctx.fillRect(-L, -0.05, 2 * L, 0.1); ctx.restore(); break;
    case 'cross': ctx.save(); ctx.rotate(0.9); ctx.fillRect(-L, -0.04, 2 * L, 0.08); ctx.rotate(-1.8); ctx.fillRect(-L, -0.04, 2 * L, 0.08); ctx.restore(); break;
    case 'halves': ctx.fillRect(-L, 0, 2 * L, W); break;
    case 'quarters': ctx.fillRect(-L, 0, L, W); ctx.fillRect(0, -W, L, W); break;
    case 'diamonds': for (let x = -L; x < L; x += 0.16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 0.06, 0.07); ctx.lineTo(x + 0.12, 0); ctx.lineTo(x + 0.06, -0.07); ctx.fill(); } break;
    case 'chevrons': for (let x = -L; x < L; x += 0.15) { ctx.beginPath(); ctx.moveTo(x, -W); ctx.lineTo(x + 0.08, 0); ctx.lineTo(x, W); ctx.lineTo(x + 0.05, W); ctx.lineTo(x + 0.13, 0); ctx.lineTo(x + 0.05, -W); ctx.fill(); } break;
    case 'spots': for (let x = -L + 0.05; x < L; x += 0.13) for (let y = -0.08; y <= 0.08; y += 0.16) { ctx.beginPath(); ctx.arc(x + (y > 0 ? 0.06 : 0), y, 0.035, 0, Math.PI * 2); ctx.fill(); } break;
    case 'star': { ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.045 : 0.1; const a = k * Math.PI / 5 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.fill(); break; }
    case 'braces': ctx.fillRect(-L, 0.05, 2 * L, 0.04); break;
    default: break;
  }
  ctx.restore();
}

// A small portrait of the silks, for lists and the program. Draws into a 2D context at (x, y), size w.
export function drawSilksIcon(ctx, s, x, y, w) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 40, w / 40);
  // Jacket body.
  ctx.beginPath();
  ctx.moveTo(10, 12); ctx.lineTo(30, 12); ctx.lineTo(38, 20); ctx.lineTo(34, 26); ctx.lineTo(30, 22); ctx.lineTo(30, 38);
  ctx.lineTo(10, 38); ctx.lineTo(10, 22); ctx.lineTo(6, 26); ctx.lineTo(2, 20); ctx.closePath();
  ctx.fillStyle = s.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = s.trim;
  switch (s.pattern) {
    case 'hoops': for (let yy = 16; yy < 40; yy += 7) ctx.fillRect(0, yy, 40, 3.5); break;
    case 'stripes': for (let xx = 3; xx < 40; xx += 6) ctx.fillRect(xx, 10, 3, 30); break;
    case 'sash': ctx.beginPath(); ctx.moveTo(10, 12); ctx.lineTo(16, 12); ctx.lineTo(30, 34); ctx.lineTo(30, 38); ctx.lineTo(26, 38); ctx.lineTo(10, 16); ctx.fill(); break;
    case 'cross': ctx.beginPath(); ctx.moveTo(10, 12); ctx.lineTo(15, 12); ctx.lineTo(30, 34); ctx.lineTo(30, 38); ctx.lineTo(26, 38); ctx.lineTo(10, 16); ctx.fill(); ctx.beginPath(); ctx.moveTo(30, 12); ctx.lineTo(25, 12); ctx.lineTo(10, 34); ctx.lineTo(10, 38); ctx.lineTo(14, 38); ctx.lineTo(30, 16); ctx.fill(); break;
    case 'halves': ctx.fillRect(20, 0, 20, 40); break;
    case 'quarters': ctx.fillRect(20, 0, 20, 25); ctx.fillRect(0, 25, 20, 15); break;
    case 'diamonds': for (const [dx, dy] of [[14, 20], [26, 20], [20, 30]]) { ctx.beginPath(); ctx.moveTo(dx, dy - 4); ctx.lineTo(dx + 4, dy); ctx.lineTo(dx, dy + 4); ctx.lineTo(dx - 4, dy); ctx.fill(); } break;
    case 'chevrons': for (let yy = 16; yy < 40; yy += 8) { ctx.beginPath(); ctx.moveTo(10, yy); ctx.lineTo(20, yy + 5); ctx.lineTo(30, yy); ctx.lineTo(30, yy + 3); ctx.lineTo(20, yy + 8); ctx.lineTo(10, yy + 3); ctx.fill(); } break;
    case 'spots': for (const [dx, dy] of [[15, 18], [25, 18], [15, 28], [25, 28], [20, 34], [20, 23]]) { ctx.beginPath(); ctx.arc(dx, dy, 2.3, 0, Math.PI * 2); ctx.fill(); } break;
    case 'star': { ctx.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 2.8 : 6.5; const a = k * Math.PI / 5 - Math.PI / 2; ctx.lineTo(20 + Math.cos(a) * r, 25 + Math.sin(a) * r); } ctx.fill(); break; }
    case 'braces': ctx.fillRect(13, 12, 3, 26); ctx.fillRect(24, 12, 3, 26); break;
    case 'sleeves': ctx.beginPath(); ctx.moveTo(30, 12); ctx.lineTo(38, 20); ctx.lineTo(34, 26); ctx.lineTo(30, 22); ctx.fill(); ctx.beginPath(); ctx.moveTo(10, 12); ctx.lineTo(2, 20); ctx.lineTo(6, 26); ctx.lineTo(10, 22); ctx.fill(); break;
    default: break;
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Cap.
  ctx.beginPath();
  ctx.arc(20, 8, 6, Math.PI, 0);
  ctx.lineTo(27, 9);
  ctx.lineTo(13, 9);
  ctx.closePath();
  ctx.fillStyle = s.cap;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = s.capTrim;
  ctx.fillRect(19, 2, 2, 6);
  ctx.restore();
}
