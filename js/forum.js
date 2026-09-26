// The forum: a handful of regulars, each with a system, posting picks before every race and
// reacting after. Their systems only use what you can see too, and their records are real.

import { rng } from './rng.js';
import { TIPSTERS, SIRES, JOCKEYS } from './data.js';
import { formRating } from './handicap.js';
import { FURLONG } from './track.js';

// How a horse usually runs, read from its past performances: E (need the lead) .. S (closer).
export function runStyle(h) {
  const lines = h.pps.slice(-4).map(p => p.line[0] && p.line[0][0]).filter(Boolean);
  if (!lines.length) return null;
  const avg = lines.reduce((a, b) => a + b, 0) / lines.length;
  return avg <= 1.6 ? 'E' : avg <= 3 ? 'E/P' : avg <= 5 ? 'P' : 'S';
}

function label(race, i) { return `#${race.entries[i].pp}`; }
function nm(world, race, i) { return world.horses[race.entries[i].hid].name; }

// Each system returns { pick: [entry indexes, best first], text } or null to sit the race out.
const SYSTEMS = {
  sheets(world, race) {
    const figs = race.entries.map(e => {
      const h = world.horses[e.hid];
      const recent = h.pps.slice(-3).map(p => p.fig + (p.surf === race.surface[0] ? 0 : -3));
      return recent.length ? Math.max(...recent) : null;
    });
    const idx = rankBy(figs.map(f => f ?? -99));
    const a = idx[0], b = idx[1];
    if (figs[a] === null) return { pick: idx.slice(0, 3), text: 'All first-timers. No numbers, no opinion. Passing.', pass: true };
    const gap = figs[a] - figs[b];
    const text = gap >= 4
      ? `Top fig belongs to ${label(race, a)} ${nm(world, race, a)}, ${figs[a]}, ${gap} clear of the next best. Single.`
      : `${label(race, a)} (${figs[a]}) and ${label(race, b)} (${figs[b]}) are a point or two apart on the numbers. ${label(race, a)} on top, ${label(race, b)} underneath.`;
    return { pick: idx.slice(0, 3), text };
  },

  chalk(world, race, ctx) {
    const odds = ctx.odds;
    const idx = rankBy(odds.map(o => -o));
    const a = idx[0];
    const lines = [
      `It's ${label(race, a)} ${nm(world, race, a)}. ${ctx.text[a]}. Don't overthink it.`,
      `Favorite ${label(race, a)}. The crowd is right more often than this forum is.`,
      `${label(race, a)} at ${ctx.text[a]}. Boring? Sure. Boring pays the rent.`,
    ];
    return { pick: idx.slice(0, 3), text: pickLine(lines, race) };
  },

  pace(world, race) {
    const styles = race.entries.map(e => runStyle(world.horses[e.hid]));
    const speed = styles.map((s, i) => [s, i]).filter(([s]) => s === 'E').map(([, i]) => i);
    const ratings = race.entries.map(e => formRating(world.horses[e.hid], race));
    if (speed.length === 1) {
      const a = speed[0];
      const rest = rankBy(ratings).filter(i => i !== a);
      return { pick: [a, ...rest.slice(0, 2)], text: `${label(race, a)} ${nm(world, race, a)} is the only real speed in here. Loose on the lead, and nobody's going to go with them. Goodnight.` };
    }
    if (speed.length >= 3) {
      const closers = rankBy(ratings.map((r, i) => (styles[i] === 'S' || styles[i] === 'P') ? r : r - 20));
      const a = closers[0];
      return { pick: closers.slice(0, 3), text: `${speed.length} of these need the lead: ${speed.map(i => label(race, i)).join(', ')}. They'll cook each other. I want the one sitting back: ${label(race, a)} ${nm(world, race, a)}.` };
    }
    if (speed.length === 0) {
      const presser = rankBy(ratings.map((r, i) => styles[i] === 'E/P' ? r + 3 : r));
      const a = presser[0];
      return { pick: presser.slice(0, 3), text: `No speed at all in this field. Somebody has to go, and ${label(race, a)} is the likeliest. Slow pace favors whoever's up front.` };
    }
    const [x, y] = speed;
    const a = ratings[x] >= ratings[y] ? x : y;
    const rest = rankBy(ratings).filter(i => i !== a);
    return { pick: [a, ...rest.slice(0, 2)], text: `${label(race, x)} and ${label(race, y)} will hook up early. ${label(race, a)} is the better of the two and should put the other away.` };
  },

  pam(world, race) {
    const wet = ['sloppy', 'muddy', 'yielding', 'soft'].includes(race.cond);
    const f = race.distance / FURLONG;
    const score = race.entries.map(e => {
      const h = world.horses[e.hid];
      const s = SIRES.find(x => x.name === h.sire) || { dist: 8, turf: 0, mud: 0, q: 0 };
      let v = formRating(h, race) * 0.4;
      if (race.surface === 'turf') v += s.turf * 6;
      if (wet) v += s.mud * 6;
      v -= Math.abs(f - s.dist) * 1.2;
      return v;
    });
    const idx = rankBy(score);
    const a = idx[0];
    const h = world.horses[race.entries[a].hid];
    const s = SIRES.find(x => x.name === h.sire);
    const firstTurf = race.surface === 'turf' && !h.pps.some(p => p.surf === 't');
    let why;
    if (wet && s && s.mud > 0.2) why = `by ${h.sire}, and those love it wet. Look at the sky and bet accordingly.`;
    else if (race.surface === 'turf' && s && s.turf > 0.4) why = firstTurf ? `by ${h.sire}, trying grass for the first time. The pedigree says this is what it was bred for.` : `by ${h.sire}. Grass in the blood.`;
    else if (s) why = `by ${h.sire}, bred for ${f >= 8 ? 'a route of ground' : 'speed'}. The distance fits.`;
    else return null;
    return { pick: idx.slice(0, 3), text: `${label(race, a)} ${h.name} is ${why}` };
  },

  lou(world, race, ctx) {
    const cands = race.entries.map((e, i) => {
      const h = world.horses[e.hid];
      if (ctx.odds[i] < 7) return null;
      const last = h.pps[h.pps.length - 1];
      const angles = [];
      if (last && /Blocked|Checked|Stumbled|Broke slowly|Bumped|wide/.test(last.cm)) angles.push(`${last.cm.toLowerCase()} last time and still ran a ${last.fig}`);
      if (last && last.clm && race.claim && race.claim < last.clm) angles.push(`dropping from $${(last.clm / 1000).toFixed(0)}k to $${(race.claim / 1000).toFixed(0)}k`);
      const bullet = h.works.find(w => w.rank === 1);
      if (bullet) angles.push(`worked the fastest ${bullet.f} furlongs of the morning on ${bullet.dt.slice(5).replace('-', '/')}`);
      if (last && last.claimed) angles.push('first start for a new barn after the claim');
      if (h.pps.length && h.pps.length <= 2 && ageNum(world, h) === 3) angles.push('lightly raced and still improving');
      if (!angles.length) return null;
      return { i, angles, odds: ctx.odds[i] };
    }).filter(Boolean).sort((a, b) => b.angles.length - a.angles.length || b.odds - a.odds);
    if (!cands.length) return { pick: [], text: 'Nothing here at a price. Saving my money for later.', pass: true };
    const c = cands[0];
    return { pick: [c.i], text: `Nobody's looking at ${label(race, c.i)} ${nm(world, race, c.i)} at ${ctx.text[c.i]}. ${cap(c.angles[0])}.${c.angles[1] ? ` Also ${c.angles[1]}.` : ''} I'm in.` };
  },

  ruth(world, race) {
    const score = race.entries.map(e => (e.pdk.kind === 'good' ? 5 : e.pdk.kind === 'poor' ? -6 : 0) + JOCKEYS[e.j].skill * 4 + formRating(world.horses[e.hid], race) * 0.3);
    const idx = rankBy(score);
    const a = idx[0];
    const e = race.entries[a];
    const bad = race.entries.findIndex(x => x.pdk.kind === 'poor');
    const warn = bad >= 0 && bad !== a ? ` Stay away from ${label(race, bad)}: ${race.entries[bad].pdk.text.toLowerCase()}.` : '';
    const note = e.pdk.kind === 'good' ? `${e.pdk.text} in the paddock` : 'no fuss in the paddock';
    return { pick: idx.slice(0, 3), text: `${label(race, a)} ${nm(world, race, a)}: ${note}, and ${JOCKEYS[e.j].name} is riding. That'll do me.${warn}` };
  },

  greg(world, race) {
    const greys = race.entries.map((e, i) => [world.horses[e.hid], i]).filter(([h]) => h.coat === 'grey').map(([, i]) => i);
    if (greys.length) {
      const a = greys[0];
      return { pick: [a], text: greys.length > 1 ? `TWO greys. Christmas came early. ${label(race, a)} to win, ${label(race, greys[1])} to place.` : `There's a grey in here. ${label(race, a)} ${nm(world, race, a)}. You know the rules.` };
    }
    const R = rng(`greg:${race.seed}`);
    const a = R.int(0, race.entries.length - 1);
    return { pick: [a], text: `No grey in this one. I'm going with the name I like best: ${label(race, a)} ${nm(world, race, a)}.` };
  },
};

function ageNum(world, h) { return new Date(world.start).getUTCFullYear() - h.foaled; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function rankBy(scores) { return scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i); }
function pickLine(lines, race) { return lines[rng(`line:${race.seed}`).int(0, lines.length - 1)]; }

// Posts for one race. `ctx` has the current board: { odds, text }.
export function forumPosts(world, race, ctx) {
  const R = rng(`forum:${race.seed}`);
  const wet = ['sloppy', 'muddy', 'yielding', 'soft'].includes(race.cond);
  const posts = [];
  for (const t of TIPSTERS) {
    const always = ['sheets', 'chalk', 'pace'].includes(t.id);
    const keen = t.id === 'pam' ? (race.surface === 'turf' || wet || R.chance(0.3))
      : t.id === 'greg' ? (race.entries.some(e => world.horses[e.hid].coat === 'grey') || R.chance(0.25))
      : R.chance(0.6);
    if (!always && !keen) continue;
    const res = SYSTEMS[t.id](world, race, ctx);
    if (!res) continue;
    posts.push({ who: t.id, mins: R.int(3, 58), ...res });
  }
  posts.sort((a, b) => b.mins - a.mins);
  return posts;
}

// After the race: who was right, who's complaining.
export function reactions(world, race, posts, order, pay, run) {
  const win = order[0];
  const out = [];
  for (const p of posts) {
    const R = rng(`react:${race.seed}:${p.who}`);
    if (p.pass || !p.pick.length) continue;
    const top = p.pick[0];
    const res = run.results.find(r => r.h === top);
    let text = null;
    if (top === win) {
      const $ = pay.win[win].toFixed(2);
      text = {
        sheets: `Numbers don't lie. $${$}.`,
        chalk: `Chalk holds. $${$} for two. Boring and correct.`,
        pace: `Told you the pace would decide it. $${$}.`,
        pam: `Blood tells. $${$}, thank you ${world.horses[race.entries[win].hid].sire}.`,
        lou: `NOBODY WAS LOOKING. $${$}! Drinks are on me.`,
        ruth: `Said it looked good in the ring. $${$}.`,
        greg: world.horses[race.entries[win].hid].coat === 'grey' ? `THE GREY. $${$}. I'll never stop.` : `The name I liked came in. $${$}. The system works.`,
      }[p.who];
    } else if (res && res.pos <= 3) {
      text = R.pick([`Second guessed myself on the exacta. Ran ${ordinalWord(res.pos)}.`, `${ordinalWord(res.pos, true)}. Close enough to hurt.`, `Hit the board at least. ${ordinalWord(res.pos, true)}.`]);
    } else if (res) {
      if (res.checked || res.blocked > 3.5) text = R.pick(['Blocked the whole stretch. Robbed.', 'Nowhere to go. Rider should be fined.', 'Had horse, had no room. Next time.', 'Stuck on the rail behind a wall of horses. Unbelievable.']);
      else if (res.stumble || res.slow) text = R.pick(['Lost it at the break. Throw it out.', 'Missed the start. Race over right there.']);
      else if (res.wide > 3) text = `Parked ${Math.round(res.wide) + 1} wide on the turn. Can't win like that.`;
      else if (res.duel > 6) text = 'Cooked in a speed duel. Classic.';
      else text = R.pick(['Never fired. Moving on.', 'Nothing. Tossing that one.', 'Ugh.', 'I need a new hobby.', 'Well, that was expensive.']);
    }
    if (text && (top === win || R.chance(0.75))) out.push({ who: p.who, text, won: top === win });
  }
  return out;
}

function ordinalWord(n, capital) {
  const w = ['', 'first', 'second', 'third'][n] || `${n}th`;
  return capital ? w[0].toUpperCase() + w.slice(1) : w;
}

// Keep score: picks and $2 win returns, per regular.
export function scoreTipsters(record, posts, order, pay) {
  for (const p of posts) {
    if (p.pass || !p.pick.length) continue;
    const r = record[p.who] || (record[p.who] = { picks: 0, wins: 0, back: 0 });
    r.picks++;
    if (p.pick[0] === order[0]) { r.wins++; r.back += pay.win[order[0]]; }
  }
  return record;
}
