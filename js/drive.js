// Saving to Google Drive, so a meet can be carried on from another phone or computer.
//
// The game goes on working from this browser's storage exactly as before. Turned on in the menu, the meet goes
// into one file, "Post Time meet.json", in a "Post Time" folder in the player's own Google Drive: the same copy
// of the meet that Save a copy downloads (js/game.js meetCopy), with which copy it is and how far on it is. A
// device that opens behind Drive (it hasn't moved on since it last matched Drive) takes Drive's meet. A meet is
// one running world, every race coming from the ones before it, so two meets can't be merged: when the meet
// here and Drive's have both moved on since they last matched, the player chooses which to carry on with, and
// the other is downloaded as a file before it's replaced. Each device keeps its own sound and voice settings.
//
// Like every junkdrawer.works project it uses the one shared Google sign-in, asks only for drive.file (it can
// see only the files it made), finds its folder and file by their appProperties and never by name, never
// revokes the permission (that would sign every project out), and shows nothing away from its own address.

import { game, meetCopy, readCopy, adopt, progressMark, untouched, whereIs } from './game.js';
import { download, fileName, describe } from './copy.js';

// Google accepts the junkdrawer.works OAuth client only from the addresses on its list. Anywhere else
// (localhost, the one-file copy, the Artifact copy) nothing about Drive shows.
export const ORIGINS = ['https://post-time.junkdrawer.works'];
const CLIENT_ID = '897653851078-p5jrh2bto6h3bj0lc4jist3k1vsc1pj4.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file', API = 'https://www.googleapis.com/';
const FOLDER = { name: 'Post Time', mimeType: 'application/vnd.google-apps.folder', appProperties: { postTime: 'folder' } };
const FILE = { name: 'Post Time meet.json', mimeType: 'application/json', appProperties: { postTime: 'meet' } };
// KT is every junkdrawer.works project's sign-in: { token, exp, scope, email }. (These names don't start with
// "post-time/", which the page takes to mean another tab saved the meet: js/app.js.)
const KS = 'post-time.drive', KT = 'junkdrawer.google', KD = 'post-time.device';
const RETRY = { retry: true };

// What a sync does, from the file in Drive (null when there's none), where this device last matched it
// (`base`: the file, its version, which copy was in it and how far on the meet here was then), and the meet
// here (`here`: how far on it is, its seed, and whether it's a meet nobody has played). `sent` is a copy
// this device sent that it hasn't seen land. Without `remote` (the copy in Drive, read) the answer may be
// 'read': it can't be told without it.
//   make    no file yet: make one from the meet here
//   same    nothing to do
//   push    Drive is as this device left it, and the meet here has moved on: send it
//   ours    the copy in Drive is the one this device sent (only the file's version moved): note it, then
//           same or push
//   match   Drive's is the meet here, at the same place: note it
//   take    Drive's has moved on and the meet here hasn't (or was never played, or can't be read): take it
//   choose  both have moved on since they last matched: the player picks
export function decide({ file, base, sent, here, remote }) {
  if (!file) return here.seed ? 'make' : 'same';
  if (base && file.id === base.fileId && String(file.version) === String(base.version)) return !here.seed || here.mark === base.mark ? 'same' : 'push';
  if (!remote) return 'read';
  if (base && (remote.rev === base.rev || (sent && remote.rev === sent.rev))) return 'ours';
  if (!here.seed) return 'take';
  if (remote.world.seed === here.seed && remote.mark === here.mark) return 'match';
  if (base ? here.mark === base.mark : here.untouched) return 'take';
  return 'choose';
}

// A name for this device, shown with the copies it sends.
export function deviceLabel(ua, touch = 0) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'browser';
}

const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const fresh = () => ({ on: false, email: '', name: '', base: null, sent: null, last: 0 });
const newRev = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const ON = typeof location === 'object' && ORIGINS.includes(location.origin);

let st = fresh(), tok = null;
let status = 'off', note = '', busy = null, again = false, client = null, gisLoading = false, pushT = null;
// The choice between two meets, while it's waiting for the player: Drive's copy (read, and its text, which is
// downloaded if the meet here is kept) and the file it came from. `later` hides it until the cloud is tapped.
let choice = null, later = false;
// Drive's meet is to be taken, but a race is being watched: it's taken when the race is over.
let waitingToTake = false;
// What was taken from Drive last, said in a line under the header for a few seconds.
let taken = null, takenT = null;
// Goes up whenever saving stops, here or in another tab, so a sync under way then leaves everything alone.
let gen = 0;
const watchers = [];
let hooks = { canTake: () => true, onTaken: () => {} };

const saveSt = () => put(KS, st);
const good = t => !!(t && t.token && t.exp - 60000 > Date.now() && String(t.scope || '').includes(SCOPE));
const sameAccount = (a, b) => !!a && String(a).toLowerCase() === String(b).toLowerCase();
// A sign-in this device can use: more than a minute left, and for the account this device saves to (until it
// knows its account, any will do).
const usable = t => good(t) && (!st.email || sameAccount(t.email, st.email));
const live = () => usable(tok) || (usable(get(KT)) && !!(tok = get(KT)));
function setStatus(s, n = '') { status = s; note = n; for (const f of watchers) { try { f(); } catch { /* a piece of page that's gone */ } } }

function device() {
  const label = deviceLabel(navigator.userAgent, navigator.maxTouchPoints || 0);
  let id = get(KD);
  if (typeof id !== 'string' || !id) { id = newRev(); put(KD, id); }
  return { id, label };
}

// ------------------------------------------------------------------ Drive's REST calls

async function api(method, path, body, type, { t = tok, text = false } = {}) {
  if (!t) throw { auth: true };
  const headers = { Authorization: 'Bearer ' + t.token };
  if (type) headers['Content-Type'] = type;
  const r = await fetch(API + path, { method, headers, body });
  // Google refused the sign-in: forget it here, and for the other projects unless one has a newer one already.
  if (r.status === 401) { if (get(KT)?.token === t.token) put(KT, null); if (tok?.token === t.token) tok = null; throw { auth: true }; }
  if (!r.ok) throw { http: r.status };
  if (text) return r.text();
  return r.status === 204 ? null : r.json();
}
const query = meta => {
  const [k, v] = Object.entries(meta.appProperties)[0];
  return encodeURIComponent(`appProperties has { key='${k}' and value='${v}' } and trashed=false`);
};
async function findAll(meta, fields) {
  const x = await api('GET', `drive/v3/files?spaces=drive&orderBy=createdTime&pageSize=10&fields=${encodeURIComponent('files(' + fields + ')')}&q=${query(meta)}`);
  return x?.files || [];
}
async function folder() { // the "Post Time" folder, made the first time (or again, if it was deleted)
  const [f] = await findAll(FOLDER, 'id');
  return f ? f.id : (await api('POST', 'drive/v3/files?fields=id', JSON.stringify(FOLDER), 'application/json')).id;
}
async function create(body) {
  const dir = await folder(), b = 'post-time-' + Date.now().toString(36);
  return api('POST', 'upload/drive/v3/files?uploadType=multipart&fields=id,version',
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ ...FILE, parents: [dir] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
    `multipart/related; boundary=${b}`);
}
// Whose a sign-in is, from Google itself.
function account(t) {
  return api('GET', 'drive/v3/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'), null, null, { t })
    .then(x => ({ email: x?.user?.emailAddress || '', name: x?.user?.displayName || '' }));
}
async function learnAccount(g) {
  const t = tok, who = await account(t);
  if (!who.email) throw { http: 0 };
  if (g !== gen) return;
  st.email = who.email; st.name = who.name; saveSt();
  t.email = who.email; // and for the next junkdrawer.works project, so it can skip Google's account chooser
  if (get(KT)?.token === t.token) put(KT, t);
}

// ------------------------------------------------------------------ one sync

async function run(tries, g) {
  try {
    if (!st.email) await learnAccount(g);
    if (g !== gen) return 'stopped';
    const files = await findAll(FILE, 'id,version');
    const file = files[0] || null;
    // Two devices that each made the file at the same moment: the first one made stays, and the others go to
    // Drive's bin. Nothing is lost by it: the devices that made them still have their meets, and meet the
    // first file's at their next sync.
    for (const extra of files.slice(1)) await api('PATCH', `drive/v3/files/${extra.id}`, JSON.stringify({ trashed: true }), 'application/json');
    const here = { mark: progressMark(), seed: game.world?.seed || '', untouched: untouched() };
    let step = decide({ file, base: st.base, sent: st.sent, here }), remote = null, text = '';
    if (step === 'read') {
      text = await api('GET', `drive/v3/files/${file.id}?alt=media`, null, null, { text: true });
      remote = readCopy(text);
      if (!remote.ok) throw { unreadable: true };
      step = decide({ file, base: st.base, sent: st.sent, here, remote });
    }
    if (g !== gen) return 'stopped';
    if (step === 'ours' || step === 'match') {
      st.base = { fileId: file.id, version: String(file.version), rev: remote.rev, mark: step === 'ours' ? remote.mark : here.mark };
      st.sent = null;
      saveSt();
      step = here.mark === st.base.mark ? 'same' : 'push';
    }
    if (step === 'make' || step === 'push') await push(file, g);
    else if (step === 'take') {
      if (!hooks.canTake()) { waitingToTake = true; return 'waiting'; }
      if (progressMark() !== here.mark) throw RETRY; // played meanwhile: look again
      take(remote, file);
    } else if (step === 'choose') {
      choice = { remote, text, file };
      later = false;
      return 'choose';
    }
    st.last = Date.now();
    saveSt();
    return step;
  } catch (e) {
    if (e === RETRY && tries < 4 && g === gen) return run(tries + 1, g);
    throw e;
  }
}

// Sends the meet here. Drive can't refuse a write that was based on an older version, so the version is
// checked before and after: another device that wrote in between means looking again, which is a choice
// between the two meets if both have moved on.
async function push(file, g) {
  if (!game.world) return;
  const rev = newRev(), mark = progressMark();
  const body = meetCopy({ device: device().label, rev, mark });
  st.sent = { rev, mark };
  saveSt();
  let wrote;
  if (!file) wrote = await create(body);
  else {
    const v = await api('GET', `drive/v3/files/${file.id}?fields=version`);
    if (String(v.version) !== String(file.version)) throw RETRY;
    wrote = await api('PATCH', `upload/drive/v3/files/${file.id}?uploadType=media&fields=id,version`, body, 'application/json');
    const after = await api('GET', `drive/v3/files/${file.id}?fields=version`);
    if (String(after.version) !== String(wrote.version)) throw RETRY;
  }
  if (g !== gen) return;
  st.base = { fileId: wrote.id || file.id, version: String(wrote.version), rev, mark };
  st.sent = null;
  saveSt();
}

// Drive's meet takes the place of the one here.
function take(remote, file) {
  if (!adopt(remote)) throw { refused: true };
  st.base = { fileId: file.id, version: String(file.version), rev: remote.rev, mark: progressMark() };
  st.sent = null;
  saveSt();
  taken = remote;
  clearTimeout(takenT);
  takenT = setTimeout(() => { taken = null; setStatus(status, note); }, 10000);
  hooks.onTaken(remote);
}

function sync() {
  if (!ON || !st.on) return Promise.resolve(false);
  if (!live()) { setStatus('tap'); return Promise.resolve(false); }
  if (busy) { again = true; return busy; }
  clearTimeout(pushT);
  pushT = null;
  waitingToTake = false;
  setStatus('busy');
  const g = gen;
  busy = run(0, g).then(step => {
    if (g !== gen) return;
    if (step === 'choose') setStatus('choose');
    else setStatus('ok');
  }, e => {
    if (g !== gen) return;
    if (e?.auth) setStatus('tap');
    else if (e?.unreadable) setStatus('error', "The meet in your Google Drive can't be read, so it was left alone. Save a copy of the meet here, then delete Post Time meet.json from the Post Time folder in your Drive to start it again from this one.");
    else if (e?.refused) setStatus('error', "This browser wouldn't keep the meet from your Google Drive, so the one here is as it was.");
    else setStatus('error', e === RETRY ? 'Another device kept saving. Try again in a moment.' : "Couldn't reach Google Drive. Check the connection and try again.");
  }).then(() => {
    busy = null;
    if (again) { again = false; return sync(); }
  });
  return busy;
}

// The choice between two meets. Each is in a tap, so the download of the one that goes can start.
function keepDrive() {
  const c = choice;
  if (!c) return;
  choice = null;
  if (game.world) download(meetCopy(), fileName());
  try { take(c.remote, c.file); } catch { setStatus('error', "This browser wouldn't keep the meet from your Google Drive, so the one here is as it was."); return; }
  setStatus('ok');
}
function keepHere() {
  const c = choice;
  if (!c) return;
  choice = null;
  download(c.text, fileName(c.remote.world, c.remote.player));
  // As if this device had last matched Drive as it is now, and moved on since: the meet here goes up (or, if
  // Drive has moved on again meanwhile, the choice is put again with the newer one).
  st.base = { fileId: c.file.id, version: String(c.file.version), rev: c.remote.rev, mark: '' };
  saveSt();
  sync();
}

// ------------------------------------------------------------------ signing in (Google Identity Services, in a pop-up)

function loadGis() {
  if (!ON || client) return;
  if (window.google?.accounts?.oauth2) { init(); return; }
  if (gisLoading) return;
  gisLoading = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = init;
  s.onerror = () => { gisLoading = false; setStatus(st.on ? 'tap' : 'off', "Google sign-in didn't load. Check the connection."); };
  document.head.append(s);
}
function init() {
  if (client) return;
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE, callback: gotToken,
    error_callback: e => {
      // Google says nothing to the page when it turns down the address the sign-in came from: its window just
      // shows the error until it's closed. So a window closed before this device has ever synced says what to
      // look for.
      const closed = e?.type === 'popup_closed';
      setStatus(st.on ? 'tap' : 'off', closed && !st.last ? "Google's window closed before it finished. If it said “Error 400: origin_mismatch”, Google doesn't take sign-ins from this address yet: post-time.junkdrawer.works has to be added to the junkdrawer.works sign-in's Authorized JavaScript origins in the Google Cloud console, and it can take a few hours to start working once it is."
        : closed ? '' : e?.type === 'popup_failed_to_open' ? "Google's sign-in window didn't open. If the browser blocks pop-ups, allow them for this page." : "Google sign-in didn't finish.");
    },
  });
  setStatus(status, note);
}
function gotToken(r) {
  if (!r || r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
    setStatus(st.on ? 'tap' : 'off', "Google Drive wasn't allowed, so nothing was saved there. Try again and leave the Drive box ticked.");
    return;
  }
  const t = { token: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000, scope: r.scope || SCOPE, email: '' }, g = gen;
  setStatus('busy');
  // Google's window lets someone pick any account, whatever it was asked for, so ask Google whose this is
  // before using it or telling the other junkdrawer.works projects whose it is.
  account(t).then(who => {
    if (g !== gen) return;
    if (!who.email) throw { http: 0 };
    if (st.email && !sameAccount(who.email, st.email)) {
      setStatus('error', `You signed in as ${who.email}, but this device saves to ${st.email}, so nothing went to that Drive. Sign in as ${st.email}, or stop saving to Drive here to change accounts.`);
      return;
    }
    tok = { ...t, email: who.email };
    put(KT, tok);
    st.on = true;
    if (!st.email) { st.email = who.email; st.name = who.name; }
    saveSt();
    sync();
  }).catch(e => {
    if (g === gen) setStatus(st.on ? 'error' : 'off', e?.auth ? "Google sign-in didn't finish." : "Couldn't reach Google Drive. Check the connection and try again.");
  });
}
// Turn it on. With a sign-in from any junkdrawer.works project still good, no Google window at all.
function start() {
  tok = get(KT);
  if (!live()) { signIn(); return; }
  st.on = true;
  if (!st.email && tok.email) st.email = tok.email;
  saveSt();
  sync(); // which asks Google whose the sign-in is first, if it didn't say
}
// Google only opens its window from a tap, so this runs inside a click.
function signIn() {
  if (!client) { loadGis(); setStatus(status, 'Google sign-in is still loading. Tap again in a second.'); return; }
  const hint = st.email || tok?.email || get(KT)?.email || '';
  client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
}
// Stop on this device. The meet stays here and in Drive, and the shared sign-in stays for the other projects:
// nothing is revoked, since that would cancel Google's permission for every project on the client.
function stop() {
  clearTimeout(pushT);
  gen++;
  choice = null;
  st = fresh();
  saveSt();
  setStatus('off');
}
// The cloud, or Sync now: inside a tap.
function now() {
  if (!st.on) start();
  else if (choice) { later = false; setStatus('choose'); }
  else if (!live()) signIn();
  else sync();
}

// ------------------------------------------------------------------ the bits of page

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
};
const add = (host, ...kids) => { for (const kid of kids) if (kid != null && kid !== false) host.append(kid); };
const tap = fn => e => { e.stopPropagation(); fn(); };
function title() {
  return status === 'busy' ? 'Syncing with Google Drive'
    : status === 'tap' ? 'Sign in to Google again and sync'
      : status === 'choose' ? 'Two meets: choose which to keep'
        : status === 'error' ? 'Google Drive: something went wrong. Tap to try again.'
          : `Synced with Google Drive${st.last ? ' ' + ago(st.last) : ''}. Tap to sync now.`;
}
const CLOUD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.7 9.1 4.7 4.7 0 0 0 7 18.5z"/></svg>';

// The header's cloud: green when synced, amber while syncing, red when it wants a tap.
function cloud(btn) {
  btn.innerHTML = CLOUD + '<i class="dot"></i>';
  btn.addEventListener('click', tap(now));
  watchers.push(() => {
    btn.hidden = !st.on;
    btn.dataset.s = status;
    btn.title = title();
    btn.setAttribute('aria-label', title());
  });
}

// The menu's rows: turn it on, see where it's saving, sync now, or stop.
function row(host) {
  let armed = null;
  const draw = () => {
    while (host.firstChild) host.removeChild(host.firstChild);
    const err = (status === 'error' || status === 'off' || status === 'tap') && note ? el('p', { class: 'drive-err' }, note) : null;
    if (!st.on) {
      add(host, 
        el('p', { class: 'voice-note' }, 'Keep your meet in your own Google Drive, and carry it on from another phone or computer. It goes in a Post Time folder, and the junkdrawer.works games and tools can see nothing else in your Drive. ',
          el('a', { href: 'https://junkdrawer.works/privacy.html' }, 'Privacy')),
        err,
        el('button', { type: 'button', id: 'driveOn', onclick: tap(start) }, 'Save to Google Drive'),
      );
      return;
    }
    const where = status === 'busy' ? 'Syncing now.' : status === 'tap' ? 'Google signs you out after an hour: Sync now signs you back in.' : st.last ? `Last synced ${ago(st.last)}.` : '';
    add(host, 
      el('p', { class: 'voice-note' }, 'Your meet is saved to ', el('b', {}, st.email || 'your Google Drive'), `, in a Post Time folder. ${where}`),
      err,
      el('button', { type: 'button', id: 'driveNow', disabled: status === 'busy', onclick: tap(now) }, 'Sync now'),
      el('button', { type: 'button', id: 'driveOff', onclick: tap(() => {
        if (!armed) { armed = setTimeout(() => { armed = null; draw(); }, 4000); draw(); return; }
        clearTimeout(armed); armed = null; stop();
      }) }, armed ? 'Tap again to stop saving to Drive here' : 'Stop saving to Drive here'),
    );
  };
  watchers.push(draw);
}

// A line under the header: the choice between two meets, a sign-in that's run out, what went wrong, or what
// was just brought from Drive.
function line(host) {
  watchers.push(() => {
    while (host.firstChild) host.removeChild(host.firstChild);
    let show = st.on;
    if (show && choice && status === 'choose' && !later) {
      const theirs = whereIs(choice.remote.world, choice.remote.player), mine = game.world ? whereIs() : null;
      const from = [choice.remote.device ? `saved on a${/^[AEIOU]/i.test(choice.remote.device) ? 'n' : ''} ${choice.remote.device}` : '', Date.parse(choice.remote.saved) ? ago(Date.parse(choice.remote.saved)) : ''].filter(Boolean).join(', ');
      host.className = 'drive-line choose';
      add(host, el('div', { class: 'drive-in' },
        el('p', { class: 'h3' }, 'Two meets'),
        el('p', {}, "The meet on this device and the one in your Google Drive have both moved on since they last matched, and they can't be put together. Choose the one to carry on with. The other is downloaded as a file first, and Open a copy in the menu brings it back."),
        el('button', { type: 'button', class: 'pick', id: 'keepDrive', onclick: tap(keepDrive) }, el('b', {}, "Keep Google Drive's"), el('span', {}, `${describe(theirs)}${from ? ` (${from})` : ''}`)),
        mine ? el('button', { type: 'button', class: 'pick', id: 'keepHere', onclick: tap(keepHere) }, el('b', {}, "Keep this device's"), el('span', {}, describe(mine))) : null,
        el('button', { type: 'button', class: 'later', onclick: tap(() => { later = true; setStatus(status, note); }) }, 'Decide later'),
      ));
    } else if (show && status === 'tap') {
      host.className = 'drive-line';
      add(host, el('p', {}, 'Google Drive signed you out, as it does after an hour, so this meet and the one in your Drive haven\'t been checked against each other. ',
        el('button', { type: 'button', class: 'link', onclick: tap(now) }, 'Sign in and sync')));
    } else if (show && status === 'error' && note) {
      host.className = 'drive-line bad';
      add(host, el('p', {}, note, ' ', el('button', { type: 'button', class: 'link', onclick: tap(now) }, 'Try again')));
    } else if (show && taken && game.world) {
      host.className = 'drive-line';
      add(host, el('p', {}, `Your meet from Google Drive: ${describe(whereIs())}.`));
    } else show = false;
    host.hidden = !show;
  });
}

// The page saved: if the meet has moved on, send it along shortly.
function changed() {
  if (!ON || !st.on || choice || !game.world || progressMark() === st.base?.mark) return;
  clearTimeout(pushT);
  if (live()) pushT = setTimeout(sync, 3000);
  else setStatus('tap');
}

export const drive = {
  available: ON,
  isOn: () => ON && st.on,
  changed,
  // The page has changed screens: Drive's meet may be waiting for a race to be over.
  idle() { if (waitingToTake && hooks.canTake()) sync(); },
  // Load Google's sign-in ahead of a tap (the menu is open).
  prepare() { if (ON) loadGis(); },
  mount({ cloud: c, row: r, line: l, canTake, onTaken }) {
    if (!ON) return;
    hooks = { canTake, onTaken };
    r.hidden = false;
    cloud(c); row(r); line(l);
    st = { ...fresh(), ...(get(KS) || {}) };
    tok = get(KT);
    if (st.on) loadGis(); // ready before the first tap
    setStatus(st.on ? (live() ? 'ok' : 'tap') : 'off');
    if (st.on && live()) setTimeout(sync, 0);
    document.addEventListener('visibilitychange', () => {
      if (!st.on) return;
      // Going: send what's waiting now. Back after a while: look for what another device did.
      if (document.hidden) { if (pushT && live()) sync(); }
      else if (live() && Date.now() - st.last > 30000 && !choice) sync();
    });
    setInterval(() => { if (!document.hidden && st.on && !choice) { if (live()) sync(); else if (status !== 'tap') setStatus('tap'); } }, 5 * 60000);
    window.addEventListener('storage', e => { // another tab signed in, stopped, or synced
      if (e.key !== KS && e.key !== KT) return;
      const was = st.on;
      st = { ...fresh(), ...(get(KS) || {}) };
      const t = get(KT);
      if (usable(t)) tok = t;
      else if (!t && e.key === KT && tok && (e.oldValue || '').includes(tok.token)) tok = null;
      if (was && !st.on) { gen++; choice = null; }
      setStatus(st.on ? (busy ? 'busy' : choice ? 'choose' : live() ? 'ok' : 'tap') : 'off');
    });
  },
};
