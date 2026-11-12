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

// What a ticket is for, as a bettor says it: "$2", "$10", and under a dollar "50¢". (The amount buttons and
// the tickets used to print every amount as "$" and the number, which would be "$0.5".)
export function stake(n) {
  if (n < 1) return `${Math.round(n * 100)}¢`;
  return Number.isInteger(n) ? money(n, { cents: false }) : money(n);
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

// The line every junkdrawer.works project carries: on the race card and in How to play, never over a race.
export function jdFoot() {
  return h('footer', { class: 'jd-foot' },
    h('a', { href: 'https://junkdrawer.works/' }, 'Part of junkdrawer.works'), ' ',
    h('span', { 'aria-hidden': 'true' }, '·'), ' ',
    h('a', { href: 'https://junkdrawer.works/privacy.html' }, 'Privacy'),
  );
}

// The pieces of a line with a dot between them ("1 mile · Dirt · 7 horses"), each in a box of its own with
// its dot in front, so the line breaks only between pieces: no "purse" alone on a second line, and no dot
// left hanging at the end of the first.
export function dotted(bits) {
  return bits.filter(Boolean).flatMap((bit, k) => [k ? ' ' : null, h('span', { class: 'bit' }, k ? '· ' : '', bit)]);
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

export function ago(mins) {
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
}

// A part of the page drawn again where it is keeps the keyboard's place. The control that had the focus is
// found again in what's drawn by its key (data-k), or else by the first of `instead(key)` that's there, and
// given the focus back. (Every choice in the betting slip, and every tab, drew its part of the page again and
// left the focus on nothing: the next Tab started again from the top. One $2 exacta took 70 presses of Tab
// where 31 would do.)
export function keepFocus(box, draw, instead = () => []) {
  const was = document.activeElement;
  const key = was && was !== document.body && box.contains(was) ? was.dataset.k : undefined;
  draw();
  if (key === undefined) return;
  const now = document.activeElement;
  if (now && now.isConnected && now !== document.body && now.dataset?.k === key) return;
  for (const k of [key, ...instead(key)]) {
    const el = box.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (el) { el.focus({ preventScroll: true }); return; }
  }
}

