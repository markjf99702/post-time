// A copy of the meet the player keeps themselves: Save a copy downloads one file, and Open a copy reads one
// back in place of the meet here. And asking the browser to keep what's stored here.
//
// The whole meet lives in one browser, and nothing else brings it back if the browser clears it: Safari on
// an iPhone deletes a site's storage after seven days of use without a visit to the site, unless it's on
// the Home Screen. A file is the player's own, and opens on any device.

import { game, meetCopy, readCopy, whereIs } from './game.js';

// Not in a frame, such as the Artifact copy of the game, where a download can't start.
export function offered() {
  try { return window.self === window.top && typeof URL.createObjectURL === 'function'; } catch { return false; }
}

// "Post Time, meet 1, race day 7.json". (A save from before meets ended has no race day of the meet yet: its
// date stands in.)
export function fileName(world = game.world, player = game.player) {
  const at = whereIs(world, player);
  return `Post Time, meet ${at.meet}, ${at.raceDay ? `race day ${at.raceDay}` : at.date}.json`;
}

// Starts a download of `text` as a file. Inside the tap that asked for it, or an iPhone won't.
export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function saveCopy() {
  if (!game.world) return false;
  download(meetCopy(), fileName());
  return true;
}

// The copy in a file the player picked, checked: readCopy's answer.
export async function openCopy(file) {
  if (!file) return { ok: false, why: 'No file was picked.' };
  // A meet is about half a megabyte at the start, a megabyte or so after sixty race days: a file many times
  // that isn't one, and reading it would only hold the page up.
  if (file.size > 40e6) return { ok: false, why: "That file isn't a copy of a Post Time meet." };
  let text;
  try { text = await file.text(); } catch { return { ok: false, why: "That file couldn't be read." }; }
  return readCopy(text);
}

// "Meet 1, race day 7, Saturday, December 19: 3 races run, $312.40". What a copy is, said on the button that
// opens it, and in the choice between two meets.
export function describe(at) {
  const day = new Date(at.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const races = at.run === at.of ? 'all races run' : at.run ? `${at.run} race${at.run === 1 ? '' : 's'} run` : 'no races run';
  return `Meet ${at.meet}, ${at.raceDay ? `race day ${at.raceDay}, ` : ''}${day}: ${races}, $${at.bank.toFixed(2)}`;
}

// Once a ticket has been bought there's a meet worth keeping, so the browser is asked to keep this site's
// storage when it runs short of room, rather than clear it with the rest. Chrome and Safari decide without
// asking the player. Firefox would put up a question of its own, and isn't asked. Once a visit.
let asked = false;
export function keepData() {
  if (asked) return;
  asked = true;
  try {
    if (/Firefox\//.test(navigator.userAgent) || !navigator.storage || typeof navigator.storage.persist !== 'function') return;
    const ask = () => navigator.storage.persist().catch(() => {});
    if (typeof navigator.storage.persisted === 'function') navigator.storage.persisted().then(yes => { if (!yes) ask(); }, ask);
    else ask();
  } catch { /* not asked */ }
}

// A ticket has been bought in this meet: one is on the card, or one has been settled.
export const hasTicket = (p = game.player) => !!p && ((p.ledger || []).length > 0 || Object.values(p.bets || {}).some(l => Array.isArray(l) && l.length));
