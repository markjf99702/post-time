// The race, as a camera beside the track sees it. The camera sits outside the outer rail looking in
// across the infield, and slides along with the leaders. Everything is placed with a real perspective
// projection: the track unrolled into a straight line along x, depth measured away from the camera.
// Round the turns the camera swings, so the distant scenery (hills, barns, the grandstand across the
// infield) sweeps past while the near things keep their places.

import { drawHorse, NOSE } from './horse.js';
import { stateAt } from '../sim.js';
import { poles, headingAt, mapPoint, COURSES, STRAIGHT, FINISH_FROM_TOP } from '../track.js';
import { CLOTH } from '../data.js';
import { rng } from '../rng.js';

const C = 26;            // camera to the outer rail
const DIRT_W = 24;
const GAP = 3;
const TURF_W = 20;
const Z_DIRT_IN = C + DIRT_W;
const Z_TURF_OUT = Z_DIRT_IN + GAP;
const Z_TURF_IN = Z_TURF_OUT + TURF_W;

export function skyFor(no, wx) {
  const k = Math.max(0, Math.min(1, (no - 1) / 7));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = a => `rgb(${a.join(',')})`;
  let top = mix([96, 150, 206], [120, 132, 190], k);
  let low = mix([196, 222, 238], [246, 196, 142], k * k);
  let haze = mix([178, 200, 208], [226, 190, 160], k);
  if (wx.sky === 'overcast' || wx.sky === 'rain' || wx.sky === 'showers') {
    const g = wx.sky === 'overcast' ? [150, 158, 166] : [118, 126, 136];
    top = mix(top, g, 0.85); low = mix(low, [196, 200, 204], 0.8); haze = mix(haze, [170, 176, 180], 0.8);
  } else if (wx.sky === 'partly cloudy') {
    top = mix(top, [140, 170, 205], 0.3);
  }
  return { top: rgb(top), low: rgb(low), haze: rgb(haze), warm: k, dim: wx.sky === 'rain' ? 0.8 : wx.sky === 'overcast' || wx.sky === 'showers' ? 0.9 : 1 };
}

export class RaceScene {
  constructor(canvas, { race, run, runners, wx }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.race = race;
    this.run = run;
    this.runners = runners;
    this.wx = wx;
    this.turf = race.surface === 'turf';
    this.zRail = this.turf ? Z_TURF_IN : Z_DIRT_IN;
    this.sky = skyFor(race.no, wx);
    this.focus = null;
    this.cam = null;
    this.lastT = null;
    this.states = [];
    this.dust = [];
    this.R = rng(`scene:${race.seed}`);
    this.buildScenery();
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(50, r.width);
    this.H = Math.max(50, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.dpr = dpr;
    this.cam = null;
  }

  buildScenery() {
    const R = rng(`scenery:${this.race.seed}`);
    const D = this.race.distance;
    this.infield = [];
    for (let x = -260; x < D + 260; x += R.range(18, 46)) {
      const kind = R.weighted([['tree', 5], ['hedge', 3], ['flowers', 2], ['flag', 1.2], ['bush', 3]]);
      const z = kind === 'flowers' || kind === 'flag' ? Z_TURF_IN + R.range(6, 14) : kind === 'tree' ? Z_TURF_IN + R.range(50, 200) : Z_TURF_IN + R.range(14, 120);
      this.infield.push({ kind, x, z, s: R.range(0.8, 1.3), c: R.int(0, 3) });
    }
    // The tote board and the lake sit across from the stretch.
    this.infield.push({ kind: 'lake', x: D - 330, z: Z_TURF_IN + 60, w: 180, s: 1 });
    this.infield.push({ kind: 'tote', x: D - 190, z: Z_TURF_IN + 75, s: 1 });
    this.infield.sort((a, b) => b.z - a.z);
    this.clouds = [...Array(7)].map(() => ({ az: R.range(0, Math.PI * 2), el: R.range(0.06, 0.22), w: R.range(0.12, 0.3), h: R.range(0.02, 0.05) }));
    this.crowdSeed = R.int(0, 1e6);
  }

  setFocus(i) { this.focus = i; }

  // Where the camera looks at sim time t.
  target(t, st) {
    const run = this.run;
    const aspect = this.W / this.H;
    const maxSpan = aspect > 1.4 ? 34 : aspect > 0.9 ? 24 : 20;
    const minSpan = aspect > 1.4 ? 22 : 13;
    const gateX = -run.runup;
    if (t < 1.2) {
      const n = this.runners.length;
      const span = Math.max(aspect > 1.4 ? 20 : aspect > 0.9 ? 15 : 12, n * 1.25 + 7);
      return { x: gateX + n * 0.55 - 0.5, span };
    }
    const order = st.map((s, i) => ({ ...s, i })).sort((a, b) => b.p - a.p);
    const lead = order[0];
    if (this.focus !== null && st[this.focus]) {
      const me = st[this.focus];
      const span = Math.max(minSpan, Math.min(maxSpan, 18));
      return { x: me.p + 1.5, span };
    }
    const D = this.race.distance;
    // Keep the front of the field in the picture: the leaders, and whoever is close to them.
    const toGo = D - lead.p;
    const reach = toGo < 450 ? 12 : 22;
    let tail = lead.p;
    order.slice(0, toGo < 450 ? 4 : 6).forEach(h => { if (lead.p - h.p < reach) tail = Math.min(tail, h.p); });
    const cap = toGo < 450 ? Math.min(maxSpan, aspect > 1.4 ? 26 : aspect > 0.9 ? 17 : 15) : maxSpan;
    let span = Math.max(minSpan, Math.min(cap, lead.p - tail + 13));
    let x = lead.p + 5 - span / 2;
    // After the wire, let them run out of the picture.
    if (lead.p > D + 30) x = Math.min(x, D + 30 + (lead.p - D - 30) * 0.3);
    return { x, span };
  }

  draw(t) {
    const { ctx, W, H, dpr } = this;
    const st = stateAt(this.run, Math.max(0, t), this.states);
    const tg = this.target(t, st);
    // Smooth the camera relative to the leader, so it doesn't trail behind a moving field.
    let ref = -Infinity;
    for (const s of st) ref = Math.max(ref, s.p);
    const off = tg.x - ref;
    const realDt = this.lastT === null ? 0 : Math.abs(t - this.lastT);
    if (!this.cam || this.lastT === null || realDt > 1.5) this.cam = { off, span: tg.span };
    else {
      const k = 1 - Math.exp(-realDt * 2.5);
      this.cam.off += (off - this.cam.off) * k;
      this.cam.span += (tg.span - this.cam.span) * k * 0.7;
    }
    this.cam.x = ref + this.cam.off;
    this.lastT = t;
    // At the gate the camera looks along the stalls at an angle, so every horse shows; it swings
    // round to the side as they break.
    this.oblique = t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 1.6);
    this.oblique = this.oblique * this.oblique * (3 - 2 * this.oblique);
    const zF = this.zRail - 3;
    const f = W * zF / this.cam.span;
    // Horses two-thirds of the way down. The camera is high enough to see over the crowd at the rail.
    const camH = Math.max(4.6, 0.38 * H * this.cam.span / W);
    const hor = 0.68 * H - f * camH / zF;
    this.fp = Math.min(f, W * 1.5); // the far scenery is drawn through a wider lens
    this.f = f; this.camH = camH; this.hor = hor; this.camX = this.cam.x;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.drawSky(t);
    this.drawPanorama();
    this.drawInfield();
    this.drawTrack(t);
    this.drawRunners(t, st);
    this.drawNear(t);
    if (this.wx.sky === 'rain' || this.wx.sky === 'showers') this.drawRain(t);
  }

  px(X, z) { return this.W / 2 + this.f * (X - this.camX) / z; }
  // Horses and the gate are shifted along the track by their distance from the rail while the camera is angled.
  hx(X, z) { return this.px(X + (this.zRail - z) * 1.25 * (this.oblique || 0), z); }
  py(Y, z) { return this.hor + this.f * (this.camH - Y) / z; }

  drawSky(t) {
    const { ctx, W, H, hor, sky } = this;
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(10, hor));
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.low);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, Math.max(0, hor) + 2);
    // Clouds at infinity.
    const viewAz = this.viewAz();
    const fp = this.fp;
    ctx.fillStyle = this.wx.sky === 'sunny' ? 'rgba(255,255,255,.55)' : 'rgba(235,238,242,.7)';
    const n = this.wx.sky === 'sunny' ? 3 : 7;
    for (const cl of this.clouds.slice(0, n)) {
      const a = wrap(cl.az + t * 0.002 - viewAz);
      const x = W / 2 + a * fp * 0.6;
      if (x < -400 || x > W + 400) continue;
      const y = hor - cl.el * fp * 0.35;
      const w = cl.w * fp * 0.5, h = cl.h * fp * 0.5;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.ellipse(x + (k - 1.5) * w * 0.3, y - (k % 2) * h * 0.4, w * 0.3, h * (0.8 + (k % 2) * 0.4), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  viewAz() {
    return headingAt(this.race, Math.max(0, Math.min(this.race.distance, this.camX))) + Math.PI / 2;
  }

  // Far scenery, by compass direction: hills all round, barns behind the backstretch, the grandstand
  // across from the backstretch, a town off to one side.
  drawPanorama() {
    const { ctx, W, hor } = this;
    const f = this.fp;
    const viewAz = this.viewAz();
    const ax = az => W / 2 + wrap(az - viewAz) * f;
    const haze = this.sky.haze;
    // Hills: a ridge line around the whole horizon.
    const hill = az => 0.022 + 0.014 * Math.sin(az * 3 + 1) + 0.009 * Math.sin(az * 7 + 2) + 0.005 * Math.sin(az * 17);
    ctx.fillStyle = mixColor(haze, '#6f8a6a', 0.35);
    ctx.beginPath();
    ctx.moveTo(0, hor + 2);
    for (let x = 0; x <= W + 8; x += 8) {
      const az = viewAz + (x - W / 2) / f;
      ctx.lineTo(x, hor - hill(az) * f);
    }
    ctx.lineTo(W, hor + 2);
    ctx.fill();
    ctx.fillStyle = mixColor(haze, '#4f6f4a', 0.55);
    ctx.beginPath();
    ctx.moveTo(0, hor + 2);
    for (let x = 0; x <= W + 8; x += 8) {
      const az = viewAz + (x - W / 2) / f;
      ctx.lineTo(x, hor - (0.008 + 0.006 * Math.sin(az * 11 + 4) + 0.004 * Math.sin(az * 23)) * f);
    }
    ctx.lineTo(W, hor + 2);
    ctx.fill();

    // Grandstand, seen across the infield from the backstretch.
    const gx = ax(1.5 * Math.PI);
    const gw = 0.8 * f, gh = 0.045 * f;
    if (gx + gw / 2 > -20 && gx - gw / 2 < W + 20) {
      const x0 = gx - gw / 2, base = hor + 0.004 * f;
      const wall = mixColor(haze, '#efe8d8', 0.55), roof = mixColor(haze, '#2f5a45', 0.45), shadow = mixColor(haze, '#8d8a80', 0.5);
      // Stands: a sloped seating deck under a long roof, on a pale base.
      ctx.fillStyle = wall;
      ctx.fillRect(x0, base - gh * 0.35, gw, gh * 0.35);
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.moveTo(x0, base - gh * 0.35); ctx.lineTo(x0 + gw, base - gh * 0.35); ctx.lineTo(x0 + gw, base - gh * 0.95); ctx.lineTo(x0, base - gh * 0.95);
      ctx.fill();
      // The crowd, in rows.
      const R = rng('stands');
      const cols = ['#c0392b', '#2c3e50', '#f1c40f', '#ecf0f1', '#8e44ad', '#16a085', '#d35400', '#2980b9'];
      const dot = Math.max(1, gw / 380);
      for (let row = 0; row < 5; row++) {
        const y = base - gh * (0.42 + row * 0.1);
        for (let x = x0 + 2; x < x0 + gw - 2; x += dot * 1.6) {
          if (R() < 0.25) continue;
          ctx.fillStyle = cols[R.int(0, cols.length - 1)];
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x, y, dot, dot);
        }
      }
      ctx.globalAlpha = 1;
      // Pillars and the roof.
      ctx.fillStyle = wall;
      for (let k = 0; k <= 10; k++) ctx.fillRect(x0 + gw * k / 10 - 1, base - gh * 1.05, 2, gh * 0.7);
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x0 - gw * 0.02, base - gh * 0.98); ctx.lineTo(x0 + gw * 1.02, base - gh * 0.98);
      ctx.lineTo(x0 + gw * 0.99, base - gh * 1.18); ctx.lineTo(x0 + gw * 0.01, base - gh * 1.18);
      ctx.fill();
      // Clubhouse cupola and flags.
      const tx = gx + gw * 0.2;
      ctx.fillStyle = wall;
      ctx.fillRect(tx - gw * 0.025, base - gh * 1.7, gw * 0.05, gh * 0.55);
      ctx.fillStyle = roof;
      ctx.beginPath(); ctx.moveTo(tx - gw * 0.035, base - gh * 1.7); ctx.lineTo(tx, base - gh * 2.1); ctx.lineTo(tx + gw * 0.035, base - gh * 1.7); ctx.fill();
      for (let k = 0; k < 7; k++) {
        const fx = x0 + gw * (0.08 + k * 0.14);
        ctx.strokeStyle = mixColor(haze, '#666', 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(fx, base - gh * 1.18); ctx.lineTo(fx, base - gh * 1.5); ctx.stroke();
        ctx.fillStyle = ['#b03a2e', '#2e86c1', '#f4d03f', '#27ae60'][k % 4];
        ctx.fillRect(fx, base - gh * 1.5, gw * 0.014, gh * 0.12);
      }
    }
    // Barns and trees behind the backstretch.
    for (let k = -3; k <= 3; k++) {
      const az = Math.PI / 2 + k * 0.17;
      const x = ax(az);
      if (x < -120 || x > W + 120) continue;
      const w = 0.12 * f, h = 0.016 * f;
      ctx.fillStyle = mixColor(haze, '#d9d1bf', 0.55);
      ctx.fillRect(x - w / 2, hor - h, w, h);
      ctx.fillStyle = mixColor(haze, '#2f5d46', 0.55);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.55, hor - h); ctx.lineTo(x, hor - h * 1.9); ctx.lineTo(x + w * 0.55, hor - h); ctx.fill();
    }
    // A water tower and a steeple, so the turns have landmarks.
    for (const [az, kind] of [[0.35, 'tower'], [2.6, 'steeple'], [3.7, 'tower'], [5.4, 'town']]) {
      const x = ax(az);
      if (x < -200 || x > W + 200) continue;
      ctx.fillStyle = mixColor(haze, '#8a8f93', 0.5);
      if (kind === 'tower') {
        const h = 0.07 * f;
        ctx.fillRect(x - 1, hor - h, 2, h);
        ctx.fillRect(x - 0.012 * f, hor - h, 2, h * 0.5);
        ctx.fillRect(x + 0.012 * f - 2, hor - h, 2, h * 0.5);
        ctx.beginPath(); ctx.ellipse(x, hor - h, 0.02 * f, 0.012 * f, 0, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'steeple') {
        const h = 0.06 * f;
        ctx.fillRect(x - 0.008 * f, hor - h * 0.5, 0.016 * f, h * 0.5);
        ctx.beginPath(); ctx.moveTo(x - 0.008 * f, hor - h * 0.5); ctx.lineTo(x, hor - h); ctx.lineTo(x + 0.008 * f, hor - h * 0.5); ctx.fill();
      } else {
        const R = rng('town');
        for (let i = 0; i < 12; i++) {
          const w = R.range(0.01, 0.025) * f, h = R.range(0.02, 0.07) * f;
          ctx.fillRect(x + (i - 6) * 0.022 * f, hor - h, w, h);
        }
      }
    }
    // Tree line along the far side.
    ctx.fillStyle = mixColor(haze, '#3e5f3a', 0.4);
    for (let x = -20; x < W + 20; x += 6) {
      const az = viewAz + (x - W / 2) / f;
      const h = (0.006 + 0.004 * (Math.sin(az * 40) + 1)) * f;
      ctx.beginPath();
      ctx.ellipse(x, hor - h * 0.5, 7, h * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawInfield() {
    const { ctx, W, H, hor } = this;
    const zNear = this.turf ? Z_TURF_IN : Z_TURF_IN;
    const yNear = this.py(0, zNear);
    const g = ctx.createLinearGradient(0, hor, 0, yNear);
    g.addColorStop(0, mixColor(this.sky.haze, '#6d9b58', 0.6));
    g.addColorStop(1, shade('#5d9444', this.sky.dim));
    ctx.fillStyle = g;
    ctx.fillRect(0, hor - 1, W, yNear - hor + 2);
    // The far side of the oval, across the infield: a strip of dirt with its white rails.
    const zFar = Z_DIRT_IN + 2 * COURSES.dirt.R;
    const yA = this.py(0, zFar), yB = this.py(0, zFar + DIRT_W);
    ctx.fillStyle = mixColor(this.sky.haze, '#b08a60', 0.55);
    ctx.fillRect(0, yB, W, Math.max(1, yA - yB));
    ctx.fillStyle = mixColor(this.sky.haze, '#ffffff', 0.6);
    ctx.fillRect(0, this.py(1, zFar), W, 1);
    ctx.fillRect(0, this.py(1, zFar + DIRT_W), W, 1);
    // Mowing stripes across the infield grass.
    ctx.fillStyle = 'rgba(255,255,255,.045)';
    const zA = Z_TURF_IN + 8, zB = zFar - 10;
    for (let X = Math.floor((this.camX - 400) / 30) * 30; X < this.camX + 400; X += 60) {
      const a = this.px(X, zA), b = this.px(X + 30, zA), c = this.px(X + 30 + 60, zB), d = this.px(X + 60, zB);
      if (Math.max(a, b, c, d) < 0 || Math.min(a, b, c, d) > W) continue;
      ctx.beginPath(); ctx.moveTo(a, this.py(0, zA)); ctx.lineTo(b, this.py(0, zA)); ctx.lineTo(c, this.py(0, zB)); ctx.lineTo(d, this.py(0, zB)); ctx.fill();
    }
    for (const o of this.infield) {
      const x = this.px(o.x, o.z);
      if (x < -300 || x > W + 300) continue;
      const k = this.f / o.z;
      const y0 = this.py(0, o.z);
      if (o.kind === 'tree') {
        ctx.fillStyle = '#4a3a2c';
        ctx.fillRect(x - 0.3 * k, y0 - 4 * k * o.s, 0.6 * k, 4 * k * o.s);
        ctx.fillStyle = shade(['#3f6b35', '#4d7a3c', '#35602f', '#557f3f'][o.c], this.sky.dim);
        ctx.beginPath();
        ctx.ellipse(x, y0 - 6 * k * o.s, 3.4 * k * o.s, 3.8 * k * o.s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.kind === 'bush' || o.kind === 'hedge') {
        ctx.fillStyle = shade(o.kind === 'hedge' ? '#3d6a33' : '#4b7a3a', this.sky.dim);
        const w = (o.kind === 'hedge' ? 12 : 3) * k * o.s, h = (o.kind === 'hedge' ? 1.4 : 1.6) * k * o.s;
        ctx.beginPath();
        ctx.ellipse(x, y0 - h * 0.5, w / 2, h * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.kind === 'flowers') {
        // A low bed of flowers: a green mound dotted with colour.
        const w = 9 * k * o.s, hgt = 0.9 * k;
        ctx.fillStyle = shade('#3f6f33', this.sky.dim);
        ctx.beginPath();
        ctx.ellipse(x, y0, w / 2, hgt, 0, Math.PI, 0);
        ctx.fill();
        const cols = [['#8a6fd6', '#b39ddb'], ['#e0567a', '#f7b2c4'], ['#f2c14e', '#fff3c4'], ['#ffffff', '#e0567a']][o.c];
        const R = rng(`bed:${o.x}`);
        for (let i = 0; i < 26; i++) {
          const a = R() * Math.PI, rr = Math.sqrt(R()) * 0.9;
          ctx.fillStyle = cols[i % 2];
          ctx.fillRect(x + Math.cos(a) * rr * w / 2, y0 - Math.sin(a) * rr * hgt, Math.max(1, 0.28 * k), Math.max(1, 0.2 * k));
        }
      } else if (o.kind === 'flag') {
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = Math.max(1, 0.12 * k);
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 - 8 * k); ctx.stroke();
        ctx.fillStyle = ['#b03a2e', '#2e86c1', '#f4d03f', '#27ae60'][o.c];
        ctx.fillRect(x, y0 - 8 * k, 2.2 * k, 1.4 * k);
      } else if (o.kind === 'lake') {
        const w = o.w * k;
        ctx.fillStyle = mixColor(this.sky.low, '#5f8fae', 0.55);
        ctx.beginPath();
        ctx.ellipse(x, y0, w / 2, Math.max(2, 5 * k), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(x - w * 0.2, y0 - 1, w * 0.4, 1);
        // Fountain.
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.beginPath(); ctx.ellipse(x + w * 0.1, y0 - 2 * k, 0.6 * k, 2.5 * k, 0, 0, Math.PI * 2); ctx.fill();
      } else if (o.kind === 'tote') {
        this.drawToteBoard(x, y0, k);
      }
    }
  }

  drawToteBoard(x, y0, k) {
    const { ctx } = this;
    const w = 26 * k, h = 10 * k, legs = 5 * k;
    const top = y0 - legs - h;
    ctx.fillStyle = '#2c4a3b';
    ctx.fillRect(x - w * 0.38, y0 - legs, 0.8 * k, legs);
    ctx.fillRect(x + w * 0.38 - 0.8 * k, y0 - legs, 0.8 * k, legs);
    ctx.fillStyle = '#23392e';
    ctx.fillRect(x - w / 2, top, w, h);
    ctx.fillStyle = '#0e120f';
    ctx.fillRect(x - w / 2 + 0.5 * k, top + 2.2 * k, w - k, h - 2.7 * k);
    ctx.fillStyle = '#e9e2cf';
    ctx.fillRect(x - w / 2 + 0.5 * k, top + 0.5 * k, w - k, 1.3 * k);
    // Program numbers in white, odds in amber, one column per horse.
    const n = Math.min(12, this.runners.length);
    const cw = (w - 2 * k) / n;
    for (let i = 0; i < n; i++) {
      const cx = x - w / 2 + k + cw * (i + 0.5);
      ctx.fillStyle = '#f2efe6';
      ctx.fillRect(cx - 0.35 * k, top + 2.8 * k, Math.max(1, 0.7 * k), Math.max(1, 1.1 * k));
      ctx.fillStyle = '#f6b53a';
      ctx.fillRect(cx - 0.45 * k, top + 4.6 * k, Math.max(1, 0.9 * k), Math.max(1, 1.1 * k));
      ctx.fillRect(cx - 0.45 * k, top + 6.4 * k, Math.max(1, 0.9 * k), Math.max(1, 0.6 * k));
    }
  }

  // Ground bands: the turf course, the dirt, their rails, the distance poles, the gate and the wire.
  drawTrack(t) {
    const { ctx, W } = this;
    const dim = this.sky.dim;
    const wet = ['sloppy', 'muddy'].includes(this.race.cond);
    const soft = ['yielding', 'soft'].includes(this.race.cond);
    // Turf band.
    const yTi = this.py(0, Z_TURF_IN), yTo = this.py(0, Z_TURF_OUT);
    ctx.fillStyle = shade(soft ? '#4f8436' : '#5a9a3c', dim);
    ctx.fillRect(0, yTi, W, yTo - yTi + 1);
    // Mowing stripes: bands across the course, fixed to the ground.
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    for (let X = Math.floor((this.camX - 120) / 8) * 8; X < this.camX + 160; X += 16) {
      const a = this.px(X, Z_TURF_IN), b = this.px(X + 8, Z_TURF_IN), c = this.px(X + 8, Z_TURF_OUT), d = this.px(X, Z_TURF_OUT);
      if (Math.max(b, c) < 0 || Math.min(a, d) > W) continue;
      ctx.beginPath(); ctx.moveTo(a, yTi); ctx.lineTo(b, yTi); ctx.lineTo(c, yTo); ctx.lineTo(d, yTo); ctx.fill();
    }
    // Grass strip between the courses.
    const yDi = this.py(0, Z_DIRT_IN);
    ctx.fillStyle = shade('#6aa24a', dim);
    ctx.fillRect(0, yTo, W, yDi - yTo + 1);
    // Dirt band.
    const yDo = this.py(0, C);
    const dg = this.ctx.createLinearGradient(0, yDi, 0, yDo);
    const dirt = wet ? ['#6e5037', '#7b5a3f'] : ['#b58a5c', '#c49a69'];
    dg.addColorStop(0, shade(dirt[0], dim));
    dg.addColorStop(1, shade(dirt[1], dim));
    ctx.fillStyle = dg;
    ctx.fillRect(0, yDi, W, yDo - yDi + 1);
    // Harrow lines, and the sheen of a wet track.
    ctx.strokeStyle = wet ? 'rgba(210,220,230,.18)' : 'rgba(90,60,30,.12)';
    ctx.lineWidth = 1;
    for (let z = Z_DIRT_IN - 1; z > C; z -= 1.6) {
      const y = this.py(0, z);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    if (wet) {
      ctx.fillStyle = 'rgba(200,215,230,.18)';
      const R = rng('puddles');
      for (let i = 0; i < 40; i++) {
        const X = Math.floor(this.camX / 60) * 60 + (i - 20) * 7 + R() * 5;
        const z = C + 2 + R() * (DIRT_W - 4);
        const x = this.px(X, z);
        if (x < -40 || x > W + 40) continue;
        ctx.beginPath(); ctx.ellipse(x, this.py(0, z), 2.2 * this.f / z, 0.25 * this.f / z, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Rails. The race's own inside rail carries the distance poles.
    this.drawRail(Z_TURF_IN, this.turf ? '#f4f1ea' : '#e9f0e4', true);
    this.drawRail(Z_TURF_OUT, '#eef2ea', false, 0.8);
    this.drawRail(Z_DIRT_IN, '#f6f3ec', true);
    const D = this.race.distance;
    for (const p of poles(D + 40)) {
      const X = D - p.fromWire;
      this.drawPole(X, this.zRail + 0.2, p.kind);
    }
    // The wire: a post and a line across the course.
    this.drawFinish(D);
    this.drawGate(t);
    this.drawDustBehind();
  }

  drawRail(z, color, posts, h = 1.05) {
    const { ctx, W } = this;
    const y0 = this.py(0, z), y1 = this.py(h, z);
    ctx.fillStyle = color;
    const th = Math.max(1, 0.12 * this.f / z);
    ctx.fillRect(0, y1 - th / 2, W, th);
    if (!posts) return;
    ctx.fillStyle = shade(color, 0.85);
    const step = 3;
    const w = Math.max(1, 0.1 * this.f / z);
    for (let X = Math.floor((this.camX - 0.6 * this.cam.span * z / 40) / step) * step; ; X += step) {
      const x = this.px(X, z);
      if (x > W + 5) break;
      if (x < -5) continue;
      ctx.fillRect(x - w / 2, y1, w, y0 - y1);
    }
  }

  drawPole(X, z, kind) {
    const { ctx, W } = this;
    const x = this.px(X, z);
    if (x < -20 || x > W + 20) return;
    const k = this.f / z;
    const y0 = this.py(0, z), top = this.py(3.2, z);
    const colors = { quarter: '#c0392b', eighth: '#2e8b57', sixteenth: '#222' }[kind];
    const w = Math.max(2, 0.22 * k);
    const seg = (y0 - top) / 8;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#f5f5f0' : colors;
      ctx.fillRect(x - w / 2, top + i * seg, w, seg + 0.5);
    }
    ctx.fillStyle = colors;
    ctx.beginPath();
    ctx.arc(x, top, Math.max(2, 0.4 * k), 0, Math.PI * 2);
    ctx.fill();
  }

  drawFinish(D) {
    const { ctx } = this;
    const zIn = this.zRail + 0.3;
    const zOut = this.turf ? Z_TURF_OUT : C;
    const x1 = this.px(D, zIn), x2 = this.px(D, zOut);
    if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > this.W + 40) return;
    // Line across the track.
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = Math.max(1, 0.15 * this.f / zOut);
    ctx.beginPath(); ctx.moveTo(x1, this.py(0, zIn)); ctx.lineTo(x2, this.py(0, zOut)); ctx.stroke();
    // The finish post, with its disc.
    const k = this.f / zIn;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(x1 - 0.14 * k, this.py(5, zIn), 0.28 * k, this.py(0, zIn) - this.py(5, zIn));
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.arc(x1, this.py(5.3, zIn), 0.75 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.arc(x1, this.py(5.3, zIn), 0.45 * k, 0, Math.PI * 2); ctx.fill();
  }

  drawGate(t) {
    this.gateInfo = null;
    const run = this.run;
    const X = -run.runup;
    const { ctx } = this;
    const n = this.runners.length;
    const xFront = X + 0.25, xBack = X - 3.4;
    const zOf = i => this.zRail - (0.55 + i * 0.88 + (i > 7 ? 0.3 : 0));
    if (this.hx(xBack, this.zRail) > this.W + 60 || this.hx(xFront + 12, zOf(n)) < -60) return;
    this.gateInfo = { xFront, xBack, zOf, n, open: t > 0 };
  }

  // The starting gate, drawn in slices so each horse sits inside its stall.
  gateParts(zMin, zMax) {
    if (!this.gateInfo) return;
    const { ctx } = this;
    const { xFront, xBack, zOf, n, open } = this.gateInfo;
    const metal = 'rgba(214,220,210,.95)', dark = 'rgba(60,92,76,.95)';
    for (let i = n; i >= 0; i--) {
      const z = zOf(i) + 0.44;
      if (z < zMin || z >= zMax) continue;
      const k = this.f / z;
      const a = this.hx(xBack, z), b = this.hx(xFront, z);
      const y0 = this.py(0, z), y1 = this.py(2.9, z);
      const bar = Math.max(1, 0.14 * k);
      // Partition: two posts, a top rail and a padded panel between them.
      ctx.fillStyle = 'rgba(180,196,186,.35)';
      ctx.fillRect(a, this.py(2.2, z), b - a, this.py(0.9, z) - this.py(2.2, z));
      ctx.fillStyle = metal;
      ctx.fillRect(a, y1, b - a, bar * 1.4);
      ctx.fillRect(a, this.py(0.9, z), b - a, bar);
      ctx.fillStyle = dark;
      ctx.fillRect(a, y1, bar, y0 - y1);
      ctx.fillRect(b - bar, y1, bar, y0 - y1);
      if (i < n) {
        const zc = zOf(i);
        const kc = this.f / zc;
        // Front doors, until they spring open.
        if (!open) {
          const xa = this.hx(xFront, zc + 0.42), xb = this.hx(xFront, zc - 0.42);
          ctx.fillStyle = 'rgba(232,236,228,.92)';
          ctx.fillRect(Math.min(xa, xb) - 0.05 * kc, this.py(2.1, zc), Math.abs(xb - xa) + 0.1 * kc, this.py(0.6, zc) - this.py(2.1, zc));
          ctx.fillStyle = 'rgba(192,57,43,.9)';
          ctx.fillRect(Math.min(xa, xb) - 0.05 * kc, this.py(1.5, zc), Math.abs(xb - xa) + 0.1 * kc, Math.max(1, 0.12 * kc));
        }
        // Stall number plate on the top rail.
        const xc = this.hx(xFront - 0.4, zc);
        ctx.fillStyle = '#f7f5ee';
        ctx.fillRect(xc - 0.34 * kc, this.py(3.45, zc), 0.68 * kc, 0.52 * kc);
        ctx.fillStyle = '#1d3a2e';
        ctx.font = `700 ${Math.max(6, 0.44 * kc)}px Oswald, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), xc, this.py(3.19, zc));
      }
    }
  }

  drawRunners(t, st) {
    const { ctx, W } = this;
    const order = st.map((s, i) => ({ ...s, i, p: s.p - NOSE, z: this.zRail - s.o })).sort((a, b) => b.z - a.z);
    const dustColor = this.turf ? 'rgba(90,140,60,' : ['sloppy', 'muddy'].includes(this.race.cond) ? 'rgba(80,58,40,' : 'rgba(185,150,110,';
    // Shadows first, all together.
    for (const h of order) {
      const x = this.hx(h.p, h.z), y = this.py(0, h.z);
      const k = this.f / h.z;
      if (x < -3 * k || x > W + 3 * k) continue;
      ctx.fillStyle = `rgba(20,15,10,${0.22 * this.sky.dim})`;
      ctx.beginPath();
      ctx.ellipse(x + 0.6 * k, y, 1.3 * k, 0.22 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    let zPrev = Infinity;
    for (const h of order) {
      this.gateParts(h.z, zPrev);
      zPrev = h.z;
      const x = this.hx(h.p, h.z), y = this.py(0, h.z);
      const k = this.f / h.z;
      if (x < -3 * k || x > W + 3 * k) continue;
      // Clods of dirt thrown up behind.
      if (h.v > 8 && t > 0) {
        ctx.fillStyle = dustColor + '0.35)';
        for (let j = 0; j < 4; j++) {
          const age = ((h.phase * 4 + j * 0.25) % 1);
          const dx = -(0.6 + age * 2.2), dy = Math.sin(age * Math.PI) * 0.7;
          ctx.globalAlpha = 1 - age;
          ctx.beginPath();
          ctx.arc(x + dx * k, y - dy * k, Math.max(1, (0.12 + age * 0.25) * k), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      const r = this.runners[h.i];
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, -k);
      const gait = h.v < 1 ? 'stand' : h.v < 5 ? 'walk' : 'gallop';
      const urge = this.urgeFor(h, st);
      drawHorse(ctx, { phase: h.phase, gait, coat: r.coat, marks: r.marks, silks: r.silks, number: r.number, urge, blinkers: r.blinkers });
      ctx.restore();
      // Highlight for the horse you're following or backed.
      if (r.mine || this.focus === h.i) {
        ctx.fillStyle = this.focus === h.i ? '#ffd23f' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.lineWidth = 1;
        const ty = this.py(3.5, h.z);
        ctx.beginPath();
        ctx.moveTo(x - 0.35 * k, ty - 0.5 * k); ctx.lineTo(x + 0.35 * k, ty - 0.5 * k); ctx.lineTo(x, ty);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    this.gateParts(-Infinity, zPrev);
  }

  urgeFor(h, st) {
    const toGo = this.race.distance - h.p;
    if (toGo > 420 || toGo < -5) return 0;
    return Math.min(1, (420 - toGo) / 250);
  }

  drawDustBehind() {}

  // The outer rail and whatever is between it and the camera.
  drawNear(t) {
    const { ctx, W, H } = this;
    const z = C;
    const y0 = this.py(0, z);
    ctx.fillStyle = shade('#6b9a4c', this.sky.dim);
    ctx.fillRect(0, y0, W, H - y0 + 1);
    this.drawRail(C, '#fbfaf5', true);
    // A crowd along the rail down the stretch.
    const D = this.race.distance;
    const stretchFrom = D - FINISH_FROM_TOP - 30;
    const R = rng(this.crowdSeed);
    const zc = C - 2.2;
    const colors = ['#c0392b', '#34495e', '#f1c40f', '#ecf0f1', '#8e44ad', '#16a085', '#d35400', '#2980b9', '#7f8c8d', '#e67e22'];
    const skin = ['#f1c7a4', '#d7a27c', '#a86f4c', '#6e4630', '#e8b894'];
    const step = 0.75;
    const x0 = Math.max(stretchFrom, this.camX - W / 2 * zc / this.f - 2);
    const x1 = Math.min(D + 60, this.camX + W / 2 * zc / this.f + 2);
    if (this.py(1.8, zc) < this.py(0, this.zRail - 6)) return;
    for (let X = Math.floor(x0 / step) * step; X < x1; X += step) {
      const hsh = Math.abs(Math.sin(X * 12.9898) * 43758.5453) % 1;
      const hsh2 = Math.abs(Math.sin(X * 78.233) * 12345.678) % 1;
      const zz = zc - hsh2 * 1.5;
      const k = this.f / zz;
      const x = this.px(X + hsh * 0.4, zz);
      const bob = Math.sin(t * 6 + X * 3) * 0.05 * (this.excite || 0);
      const top = this.py(1.62 + hsh * 0.2 + bob, zz);
      ctx.fillStyle = colors[Math.floor(hsh * colors.length)];
      ctx.fillRect(x - 0.22 * k, top + 0.25 * k, 0.44 * k, H);
      ctx.fillStyle = skin[Math.floor(hsh2 * skin.length)];
      ctx.beginPath();
      ctx.arc(x, top + 0.12 * k, 0.13 * k, 0, Math.PI * 2);
      ctx.fill();
      if (hsh > 0.8) { // a hat
        ctx.fillStyle = hsh2 > 0.5 ? '#f3e7c9' : '#2c3e50';
        ctx.fillRect(x - 0.2 * k, top, 0.4 * k, 0.07 * k);
      }
    }
    void R;
  }

  drawRain(t) {
    const { ctx, W, H } = this;
    ctx.strokeStyle = 'rgba(220,230,240,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = this.wx.sky === 'rain' ? 120 : 50;
    for (let i = 0; i < n; i++) {
      const x = (i * 97.3 + t * 40) % (W + 40) - 20;
      const y = (i * 53.7 + t * 900) % (H + 40) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12);
    }
    ctx.stroke();
  }

  // The little oval map: whole course, every horse as a dot in its saddle-cloth colour.
  drawMap(mctx, w, h, t) {
    const st = stateAt(this.run, Math.max(0, t), []);
    const { R } = COURSES.dirt;
    const spanX = STRAIGHT + 2 * R + 20, spanY = 2 * R + 20;
    const s = Math.min(w / spanX, h / spanY);
    const cx = w / 2, cy = h / 2;
    const P = (x, y) => [cx + x * s, cy - y * s];
    mctx.clearRect(0, 0, w, h);
    const oval = (rad, width, color) => {
      mctx.strokeStyle = color;
      mctx.lineWidth = width * s;
      mctx.beginPath();
      const hh = STRAIGHT / 2;
      mctx.moveTo(...P(-hh, -rad));
      mctx.lineTo(...P(hh, -rad));
      mctx.arc(...P(hh, 0), rad * s, Math.PI / 2, -Math.PI / 2, true);
      mctx.lineTo(...P(-hh, rad));
      mctx.arc(...P(-hh, 0), rad * s, -Math.PI / 2, Math.PI / 2, true);
      mctx.stroke();
    };
    oval(COURSES.dirt.R + 12, 24, this.turf ? 'rgba(190,150,105,.55)' : 'rgba(190,150,105,.95)');
    oval(COURSES.turf.R + 10, 20, this.turf ? 'rgba(96,160,70,.95)' : 'rgba(96,160,70,.55)');
    // Chute for sprints that start in it.
    if (this.race.path[0].chute) {
      mctx.strokeStyle = 'rgba(190,150,105,.95)';
      mctx.lineWidth = 24 * s;
      mctx.beginPath();
      mctx.moveTo(...P(STRAIGHT / 2, R + 12));
      mctx.lineTo(...P(STRAIGHT / 2 + this.race.path[0].len + 20, R + 12));
      mctx.stroke();
    }
    // The wire.
    const fin = -STRAIGHT / 2 + FINISH_FROM_TOP;
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.moveTo(...P(fin, -R + 2)); mctx.lineTo(...P(fin, -R - 28));
    mctx.stroke();
    // Horses, back to front.
    const order = st.map((x, i) => ({ ...x, i })).sort((a, b) => a.p - b.p);
    for (const hs of order) {
      const pos = mapPoint(this.race, Math.max(0, Math.min(this.race.distance + 60, hs.p)), 1 + hs.o * 1.6 + (this.turf ? 0 : 0));
      const off = this.turf ? 0 : 0;
      const [x, y] = P(pos.x, pos.y + off);
      const cloth = CLOTH[this.runners[hs.i].number] || CLOTH[1];
      mctx.fillStyle = cloth[0];
      mctx.strokeStyle = 'rgba(0,0,0,.6)';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.arc(x, y, this.runners[hs.i].mine || this.focus === hs.i ? 4.2 : 3.2, 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();
    }
  }
}

function wrap(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

function hexToRgb(c) {
  if (c.startsWith('rgb')) return c.match(/\d+/g).slice(0, 3).map(Number);
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export function mixColor(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
export function shade(c, k) {
  const A = hexToRgb(c);
  return `rgb(${A.map(v => Math.round(Math.min(255, v * k))).join(',')})`;
}
