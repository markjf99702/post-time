// Small helpers for building the page.

import { CLOTH } from '../data.js';
import { drawSilksIcon } from '../draw/horse.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'data') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function money(n, { sign = false, cents = true } = {}) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}$${s}`;
}

export function cloth(num, size = '') {
  const [bg, fg] = CLOTH[num] || CLOTH[1];
  return h('span', { class: `cloth ${size}`, style: { background: bg, color: fg }, 'aria-label': `number ${num}` }, String(num));
}

export function silksCanvas(silks, px = 30) {
  const c = h('canvas', { width: px * 2, height: px * 2, 'aria-hidden': 'true' });
  const ctx = c.getContext('2d');
  drawSilksIcon(ctx, silks, 0, 0, px * 2);
  return c;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

export function ago(mins) {
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
}
