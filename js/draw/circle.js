// The winner's circle photograph: the horse, the rider, the groom, the connections, and a blanket of
// larkspurs for a stakes winner. If you cashed a win ticket, you're in the picture too.

import { drawHorse, COATS } from './horse.js';
import { rng } from '../rng.js';

const SKIN = ['#f3cfb3', '#e0b08c', '#c68c64', '#9a6443', '#6d4430', '#f0c19c'];
const HAIR = ['#2b1d14', '#5a3a22', '#8c6239', '#c9a26b', '#1a1a1a', '#b8b2a6', '#7a2e1d'];
const CLOTHES = ['#1f3b5a', '#7a1f2b', '#2e5d3a', '#e8d9b5', '#3c3c44', '#6a4c93', '#c75b39', '#f2efe6', '#355c7d', '#b88a2e', '#e4a6b8', '#4f7f8a'];

export function drawCircle(canvas, { horse, silks, number, stakes, you, seed, width = 360, height = 250 }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = rng(`circle:${seed}`);
  const k = width / 7.4;
  const groundY = height * 0.86;
  const M = (x, y) => [width / 2 + x * k, groundY - y * k];

  // Backdrop: the clubhouse wall with its arches and awning.
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, width, groundY);
  ctx.fillStyle = '#e2d6bc';
  for (let i = -4; i <= 4; i++) {
    const [ax, ay] = M(i * 1.7, 0);
    ctx.beginPath();
    ctx.moveTo(ax - 0.55 * k, ay - 0.9 * k);
    ctx.lineTo(ax - 0.55 * k, ay - 3.3 * k);
    ctx.arc(ax, ay - 3.3 * k, 0.55 * k, Math.PI, 0);
    ctx.lineTo(ax + 0.55 * k, ay - 0.9 * k);
    ctx.fill();
  }
  // Green awning with scallops.
  const [, awY] = M(0, 4.6);
  ctx.fillStyle = '#2f5a45';
  ctx.fillRect(0, awY - 0.5 * k, width, 0.5 * k);
  for (let x = 0; x < width; x += 0.5 * k) {
    ctx.beginPath(); ctx.arc(x + 0.25 * k, awY, 0.25 * k, 0, Math.PI); ctx.fill();
  }
  ctx.fillStyle = '#f2efe6';
  for (let x = 0; x < width; x += k) ctx.fillRect(x, awY - 0.5 * k, 0.5 * k, 0.5 * k);
  // Sign.
  const [sx, sy] = M(0, 5.35);
  ctx.fillStyle = '#1e3b2f';
  roundRect(ctx, sx - 2.1 * k, sy - 0.32 * k, 4.2 * k, 0.64 * k, 4);
  ctx.fill();
  ctx.strokeStyle = '#c9a646';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#e8c766';
  ctx.font = `600 ${Math.round(0.34 * k)}px Oswald, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText("WINNER'S CIRCLE", sx, sy + 1);
  // Hanging baskets.
  for (let i = -3; i <= 3; i += 2) {
    const [bx, by] = M(i * 1.7, 4.0);
    ctx.fillStyle = '#4c7a3a';
    ctx.beginPath(); ctx.arc(bx, by, 0.28 * k, 0, Math.PI * 2); ctx.fill();
    for (let j = 0; j < 9; j++) {
      ctx.fillStyle = ['#8a6fd6', '#e0567a', '#f2c14e', '#ffffff'][j % 4];
      ctx.beginPath(); ctx.arc(bx + Math.cos(j * 2.4) * 0.2 * k, by + Math.sin(j * 2.4) * 0.16 * k, 0.05 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Hedge and a white rail behind the circle.
  const [, hy] = M(0, 0.95);
  ctx.fillStyle = '#3f6b35';
  ctx.fillRect(0, hy, width, groundY - hy);
  for (let x = 0; x < width; x += 0.35 * k) {
    ctx.beginPath(); ctx.arc(x, hy, 0.22 * k, Math.PI, 0); ctx.fill();
  }
  ctx.fillStyle = '#f7f5ee';
  ctx.fillRect(0, groundY - 0.75 * k, width, 0.07 * k);
  // Ground: a brick circle on grass.
  ctx.fillStyle = '#6f9a4a';
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = '#a4644a';
  ctx.beginPath();
  ctx.ellipse(width / 2, groundY + 0.25 * k, 3.4 * k, 0.45 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,40,25,.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.ellipse(width / 2, groundY + 0.25 * k, 3.4 * k * i / 4, 0.45 * k * i / 4, 0, 0, Math.PI * 2); ctx.stroke();
  }

  // People behind the horse.
  const people = [];
  const back = R.int(2, 3);
  for (let i = 0; i < back; i++) people.push({ x: -2.6 + i * 0.8 + R.range(-0.1, 0.1), row: 'back' });
  // Shadow, then the horse and rider.
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(width / 2 + 0.1 * k, groundY + 0.05 * k, 1.6 * k, 0.16 * k, 0, 0, Math.PI * 2); ctx.fill();
  for (const p of people) drawPerson(ctx, M, k, R, { x: p.x, scale: 0.95 });

  ctx.save();
  ctx.translate(width / 2, groundY);
  ctx.scale(k, -k);
  drawHorse(ctx, {
    phase: 0, gait: 'stand', coat: horse.coat, marks: horse.marks, silks, number,
    blanket: stakes ? { base: '#2f5a2c', flowers: ['#5b4cc4', '#7c6be0', '#4232a6', '#9d8ff0', '#ffffff'] } : null,
  });
  ctx.restore();
  // Rider's arm up: a whip raised in celebration.
  const [hx, hy2] = M(0.34, 2.8);
  ctx.strokeStyle = silks.body;
  ctx.lineWidth = 0.1 * k;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(...M(0.14, 2.45)); ctx.lineTo(hx, hy2); ctx.stroke();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.025 * k;
  ctx.beginPath(); ctx.moveTo(hx, hy2); ctx.lineTo(hx - 0.2 * k, hy2 - 0.6 * k); ctx.stroke();

  // In front: the groom at the head, the trainer and owners, maybe a trophy, maybe you.
  drawPerson(ctx, M, k, R, { x: 1.75, scale: 1, groom: true });
  const front = R.int(2, 3);
  for (let i = 0; i < front; i++) drawPerson(ctx, M, k, R, { x: -1.9 + i * 0.75, scale: 1.03, trophy: stakes && i === front - 1 });
  if (you) drawPerson(ctx, M, k, R, { x: 2.9, scale: 1, you: true });

  // A little photographer's vignette.
  const v = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, width * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(40,25,10,.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, width, height);
}

function drawPerson(ctx, M, k, R, o) {
  const h = (R.range(1.62, 1.86)) * o.scale;
  const skin = R.pick(SKIN), hair = R.pick(HAIR);
  const top = o.groom ? '#2f5a45' : o.you ? '#c9463d' : R.pick(CLOTHES);
  const bottom = o.groom ? '#3a3a3a' : R.pick(['#2a2a30', '#3b4a5a', '#e8e2d0', '#5a4636', top]);
  const dress = !o.groom && !o.you && R.chance(0.4);
  const hat = o.groom ? 'cap' : R.weighted([['none', 4], ['fedora', 2], ['sunhat', dress ? 3 : 0.5], ['fascinator', dress ? 2 : 0]]);
  const x = o.x;
  const [fx, fy] = M(x, 0);
  const u = k;
  // Legs.
  ctx.fillStyle = bottom;
  if (dress) {
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(fx - 0.17 * u, fy - (h - 0.32) * u);
    ctx.lineTo(fx + 0.17 * u, fy - (h - 0.32) * u);
    ctx.lineTo(fx + 0.3 * u, fy - 0.42 * u);
    ctx.lineTo(fx - 0.3 * u, fy - 0.42 * u);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.fillRect(fx - 0.12 * u, fy - 0.42 * u, 0.07 * u, 0.4 * u);
    ctx.fillRect(fx + 0.05 * u, fy - 0.42 * u, 0.07 * u, 0.4 * u);
  } else {
    ctx.fillRect(fx - 0.15 * u, fy - h * 0.5 * u, 0.13 * u, h * 0.5 * u);
    ctx.fillRect(fx + 0.02 * u, fy - h * 0.5 * u, 0.13 * u, h * 0.5 * u);
    ctx.fillStyle = top;
    roundRect(ctx, fx - 0.2 * u, fy - (h - 0.3) * u, 0.4 * u, (h * 0.5 - 0.24) * u, 0.08 * u);
    ctx.fill();
  }
  ctx.fillStyle = '#1b1612';
  ctx.fillRect(fx - 0.17 * u, fy - 0.05 * u, 0.15 * u, 0.05 * u);
  ctx.fillRect(fx + 0.03 * u, fy - 0.05 * u, 0.15 * u, 0.05 * u);
  // Arms.
  ctx.strokeStyle = dress ? skin : top;
  ctx.lineWidth = 0.09 * u;
  ctx.lineCap = 'round';
  const sh = fy - (h - 0.36) * u;
  ctx.beginPath();
  if (o.groom) { ctx.moveTo(fx - 0.16 * u, sh); ctx.lineTo(fx - 0.45 * u, fy - 1.05 * u); }
  else if (o.you) { ctx.moveTo(fx + 0.16 * u, sh); ctx.lineTo(fx + 0.3 * u, sh - 0.45 * u); }
  else if (o.trophy) { ctx.moveTo(fx + 0.16 * u, sh); ctx.lineTo(fx + 0.32 * u, sh + 0.25 * u); }
  else { ctx.moveTo(fx + 0.18 * u, sh); ctx.lineTo(fx + 0.22 * u, sh + 0.5 * u); }
  ctx.moveTo(fx - 0.18 * u, sh);
  ctx.lineTo(fx - 0.22 * u, sh + 0.5 * u);
  ctx.stroke();
  if (o.groom) {
    // Lead shank to the bridle.
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 0.025 * u;
    ctx.beginPath(); ctx.moveTo(fx - 0.45 * u, fy - 1.05 * u); ctx.lineTo(fx - 0.55 * u, fy - 1.45 * u); ctx.stroke();
  }
  if (o.you) {
    // A winning ticket, held up.
    ctx.fillStyle = '#fbf6e3';
    ctx.save();
    ctx.translate(fx + 0.33 * u, sh - 0.55 * u);
    ctx.rotate(-0.2);
    ctx.fillRect(-0.14 * u, -0.08 * u, 0.28 * u, 0.16 * u);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-0.14 * u, -0.08 * u, 0.28 * u, 0.03 * u);
    ctx.restore();
  }
  if (o.trophy) {
    const [tx, ty] = [fx + 0.36 * u, sh + 0.05 * u];
    ctx.fillStyle = '#d9b24c';
    ctx.beginPath();
    ctx.moveTo(tx - 0.16 * u, ty - 0.3 * u); ctx.lineTo(tx + 0.16 * u, ty - 0.3 * u);
    ctx.quadraticCurveTo(tx + 0.15 * u, ty, tx, ty + 0.05 * u);
    ctx.quadraticCurveTo(tx - 0.15 * u, ty, tx - 0.16 * u, ty - 0.3 * u);
    ctx.fill();
    ctx.fillRect(tx - 0.03 * u, ty, 0.06 * u, 0.12 * u);
    ctx.fillRect(tx - 0.1 * u, ty + 0.12 * u, 0.2 * u, 0.05 * u);
  }
  // Head.
  const hy = fy - (h - 0.12) * u;
  ctx.fillStyle = skin;
  ctx.fillRect(fx - 0.04 * u, hy + 0.08 * u, 0.08 * u, 0.1 * u);
  ctx.beginPath(); ctx.ellipse(fx, hy, 0.1 * u, 0.12 * u, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.ellipse(fx, hy - 0.05 * u, 0.105 * u, 0.08 * u, 0, Math.PI, 0); ctx.fill();
  if (hat === 'fedora') {
    ctx.fillStyle = R.pick(['#3a3530', '#c8b48a', '#2d3d4f']);
    ctx.fillRect(fx - 0.19 * u, hy - 0.1 * u, 0.38 * u, 0.04 * u);
    ctx.fillRect(fx - 0.11 * u, hy - 0.22 * u, 0.22 * u, 0.12 * u);
  } else if (hat === 'sunhat') {
    ctx.fillStyle = R.pick(['#f3e7c9', '#e4a6b8', '#f7f5ee', '#b9d3ea']);
    ctx.beginPath(); ctx.ellipse(fx, hy - 0.09 * u, 0.3 * u, 0.05 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(fx, hy - 0.13 * u, 0.12 * u, 0.08 * u, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = R.pick(['#c0392b', '#6a4c93', '#2e5d3a']);
    ctx.fillRect(fx - 0.12 * u, hy - 0.14 * u, 0.24 * u, 0.03 * u);
  } else if (hat === 'fascinator') {
    ctx.fillStyle = R.pick(['#e0567a', '#6a4c93', '#f2c14e']);
    ctx.beginPath(); ctx.arc(fx + 0.07 * u, hy - 0.12 * u, 0.06 * u, 0, Math.PI * 2); ctx.fill();
  } else if (hat === 'cap') {
    ctx.fillStyle = '#2f5a45';
    ctx.beginPath(); ctx.ellipse(fx, hy - 0.08 * u, 0.11 * u, 0.07 * u, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(fx, hy - 0.09 * u, 0.16 * u, 0.03 * u);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { COATS };
