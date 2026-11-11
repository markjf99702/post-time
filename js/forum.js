// The forum: a handful of regulars, each with a system, posting picks before every race and
// reacting after. Their systems only use what you can see too, and their records are real.

import { rng } from './rng.js';
import { TIPSTERS, SIRES, JOCKEYS } from './data.js';
import { formRating, recentBullet, lastPrice, TROUBLE } from './handicap.js';
import { tripComment } from './chart.js';
import { FURLONG } from './track.js';

// How a horse usually runs, read from its past performances: E (need the lead) .. S (closer). A horse
// that's first or second at the first call, on average, is one that needs the lead.
export function runStyle(h) {
  const lines = h.pps.slice(-4).map(p => p.line[0] && p.line[0][0]).filter(Boolean);
  if (!lines.length) return null;
  const avg = lines.reduce((a, b) => a + b, 0) / lines.length;
  return avg <= 2 ? 'E' : avg <= 3.2 ? 'E/P' : avg <= 5 ? 'P' : 'S';
}

function label(race, i) { return `#${race.entries[i].pp}`; }
function nm(world, race, i) { return world.horses[race.entries[i].hid].name; }

// Each system returns { pick: [entry indexes, best first], text } or null to sit the race out.
const SYSTEMS = {
  sheets(world, race) {
    // His number for a horse is the best of its last three figures, each marked down 3 if it was earned on
    // the other surface. He ranks on his number and quotes the figure as the card has it, saying when he
    // has marked it down. (He used to print his own number as the figure: one in four was on nobody's card.)
    const today = race.surface[0];
    const best = race.entries.map(e => world.horses[e.hid].pps.slice(-3)
      .map(p => ({ fig: p.fig, surf: p.surf, his: p.fig - (p.surf === today ? 0 : 3) }))
      .sort((x, y) => y.his - x.his || (y.surf === today) - (x.surf === today))[0] || null);
    const figs = best.map(x => (x ? x.his : null));
    const quote = i => (best[i].his === best[i].fig ? `${best[i].fig}` : `${best[i].fig} on the ${best[i].surf === 't' ? 'turf' : 'dirt'}, call it ${best[i].his} here`);
    const idx = rankBy(figs.map(f => f ?? -99));
    const a = idx[0], b = idx[1];
    // (A horse without a figure isn't always a first-time starter: it may have raced somewhere else.)
    if (a === undefined || figs[a] === null) return { pick: idx.slice(0, 3), text: 'Not a figure on any of these. No numbers, no opinion. Passing.', pass: true };
    // One horse with a number: the only one in the race, or the only one that has run.
    if (b === undefined || figs[b] === null) return { pick: idx.slice(0, 3), text: `Top fig belongs to ${label(race, a)} ${nm(world, race, a)}: ${quote(a)}. Nobody else in here has a number. Single.` };
    const gap = figs[a] - figs[b];
    const apart = gap === 0 ? 'even on the numbers' : `${gap} point${gap === 1 ? '' : 's'} apart on the numbers`;
    const text = gap >= 4
      ? `Top fig belongs to ${label(race, a)} ${nm(world, race, a)}: ${quote(a)}, and that's ${gap} clear of the next best. Single.`
      : `${label(race, a)} (${quote(a)}) and ${label(race, b)} (${quote(b)}) are ${apart}. ${label(race, a)} on top, ${label(race, b)} underneath.`;
    return { pick: idx.slice(0, 3), text };
  },

  // He backs whoever is favourite when the gate opens, and says so: the horse he names is only the
  // favourite as he posts, with the betting half done. His pick is set from the final board at the off
  // (favouriteAtTheOff, below), which `atTheOff` asks for.
  chalk(world, race, ctx) {
    const idx = byOdds(ctx.odds);
    const a = idx[0];
    const lines = [
      `Whoever's favorite at the bell. Right now that's ${label(race, a)} ${nm(world, race, a)} at ${ctx.text[a]}. Don't overthink it.`,
      `The favorite at the bell, same as every race. Right now ${label(race, a)} at ${ctx.text[a]}. The crowd is right more often than this forum is.`,
      `I'll have whatever's favorite when the gate opens. Right now ${label(race, a)} at ${ctx.text[a]}. Boring? Sure. Boring pays the rent.`,
    ];
    return { pick: idx.slice(0, 3), text: pickLine(lines, race), atTheOff: true };
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
      // He names a horse as the one to go only if it's one that runs close to the pace. (Four times in
      // ten "the likeliest" was a horse wearing the Closer chip.)
      const text = styles[a] === 'E/P'
        ? `No speed at all in this field. Somebody has to go, and ${label(race, a)} is the likeliest. Slow pace favors whoever's up front.`
        : `No speed in this field, so the best horse gets an easy trip: ${label(race, a)} ${nm(world, race, a)}.`;
      return { pick: presser.slice(0, 3), text };
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
    // The first time on grass only if every start it has made is on its card, and none of them on turf.
    const firstTurf = race.surface === 'turf' && h.life.starts <= h.pps.length && !h.pps.some(p => p.surf === 't');
    let why;
    if (wet && s && s.mud > 0.2) why = `by ${h.sire}, and those love it wet. Look at the sky and bet accordingly.`;
    else if (race.surface === 'turf' && s && s.turf > 0.4) why = firstTurf ? `by ${h.sire}, trying grass for the first time. The pedigree says this is what it was bred for.` : `by ${h.sire}. Grass in the blood.`;
    else if (s) why = `by ${h.sire}, ${bredFor(s, f)}`;
    else return null;
    return { pick: idx.slice(0, 3), text: `${label(race, a)} ${h.name} is ${why}` };
  },

  lou(world, race, ctx) {
    const cands = race.entries.map((e, i) => {
      const h = world.horses[e.hid];
      if (ctx.odds[i] < 7) return null;
      const last = h.pps[h.pps.length - 1];
      const angles = [];
      // Only the trouble from a trip note, not what came after it: "Checked in traffic", and not
      // "checked in traffic; weakened last time and still ran a 51".
      const trouble = last ? last.cm.split('; ').filter(x => TROUBLE.test(x) || /wide/.test(x)) : [];
      if (trouble.length) angles.push(`${trouble.join(', ').toLowerCase()} last time and still ran ${/^(8|11|18)/.test(last.fig) ? 'an' : 'a'} ${last.fig}`);
      // A drop in price among winners. (A maiden claimer's winner meeting winners isn't dropping.)
      const price = lastPrice(h);
      if (price && race.claim && race.claim < price) angles.push(`dropping from $${(price / 1000).toFixed(0)}k to $${(race.claim / 1000).toFixed(0)}k`);
      // The newest bullet, if it's since the horse last ran and in the last three weeks. (He took the
      // oldest of its last five works, months old as often as not.)
      const bullet = recentBullet(h, race);
      if (bullet) angles.push(`worked the fastest ${bullet.f} furlongs of the morning on ${bullet.dt.slice(5).replace('-', '/')}`);
      if (last && last.claimed) angles.push('first start for a new barn after the claim');
      // (Two starts in its life, not two lines on its card: horses arrive with a record.)
      if (h.pps.length && h.life.starts <= 2 && ageOn(race, h) === 3) angles.push('lightly raced and still improving');
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
      // He counts them: "TWO greys" stood over three and four.
      const others = greys.slice(1).map(i => label(race, i));
      const text = greys.length === 1 ? `There's a grey in here. ${label(race, a)} ${nm(world, race, a)}. You know the rules.`
        : greys.length === 2 ? `TWO greys. Christmas came early. ${label(race, a)} to win, ${others[0]} to place.`
        : `${COUNT[greys.length] || greys.length} greys. Christmas came early. ${label(race, a)} to win, ${others.slice(0, -1).join(', ')} and ${others[others.length - 1]} underneath.`;
      return { pick: [a], text };
    }
    const R = rng(`greg:${race.seed}`);
    const a = R.int(0, race.entries.length - 1);
    return { pick: [a], text: `No grey in this one. I'm going with the name I like best: ${label(race, a)} ${nm(world, race, a)}.` };
  },
};

const COUNT = ['', '', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];

// What PedigreePam says of the distance, from the sire's own (the distance his runners do best at): a
// sprinter's sire, a router's, or one in between. She says the distance fits only when it does, and
// otherwise that it doesn't. (It used to go by the race alone: a son of Tapit was "bred for speed. The
// distance fits" at five furlongs.)
function bredFor(sire, f) {
  const [kind, fits] = sire.dist <= 7 ? ['speed', f <= 7] : sire.dist >= 8 ? ['a route of ground', f >= 8] : ['seven furlongs or a mile', Math.abs(f - sire.dist) <= 1];
  if (fits) return `bred for ${kind}. The distance fits.`;
  return `whose runners want ${sire.dist > f ? 'more' : 'less'} ground than this. I'm taking it anyway.`;
}

// A horse's age on the day of the race: every horse turns a year older on 1 January.
function ageOn(race, h) { return +race.date.slice(0, 4) - h.foaled; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function rankBy(scores) { return scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i); }
// Shortest price first.
function byOdds(odds) { return rankBy(odds.map(o => -o)); }
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

// ChalkEater's pick is whoever is favourite when the gate opens: set it from the final board, before the
// reactions and the scoring. (It was the favourite when he posted, with the betting half done, which in
// more than half of all races wasn't the favourite at the off; "Chalk holds" greeted winners that weren't.)
// A post of his saved before he said so named one horse ("It's #4. Don't overthink it."), and keeps it.
export function favouriteAtTheOff(posts, odds) {
  const chalk = posts.find(p => p.who === 'chalk' && p.atTheOff);
  if (chalk) chalk.pick = byOdds(odds).slice(0, 3);
  return posts;
}

// What a regular says of a beaten horse, by its trip note: the complaint is the one the chart makes, so
// the forum and the form can't disagree. Trouble in the running first, then the start, then the trip.
const BEATEN = [
  [/Checked/, ['Had to check in traffic. Robbed.', 'Nowhere to go. Rider should be fined.', 'Had horse, had no room. Next time.', 'Stuck behind a wall of horses. Unbelievable.']],
  [/Blocked/, ['Blocked the whole stretch. Robbed.', 'Nowhere to go. Rider should be fined.', 'Had horse, had no room. Next time.', 'Stuck behind a wall of horses. Unbelievable.']],
  [/Stumbled/, ['Stumbled at the break. Throw it out.', 'Lost it at the break. Throw it out.']],
  [/Broke slowly/, ['Missed the start. Race over right there.', 'Lost it at the break. Throw it out.']],
  [/Bumped/, ['Got hit coming out of the gate. Throw it out.', 'Knocked sideways at the start. Next time.']],
  [/(\d) wide/, [`Parked $1 wide on the turn. Can't win like that.`]],
  [/Dueled/, ['Cooked in a speed duel. Classic.']],
  [/Set pace/, ['Had the lead and gave it up. Hate to see it.']],
  [/Chased/, ['Chased the pace and came up empty.']],
  [/Late gain|[Ii]mproved position/, ['Running at the end. Too late.', 'Too little, too late.']],
];
const NOTHING = ['Never fired. Moving on.', 'Nothing. Tossing that one.', 'Ugh.', 'I need a new hobby.', 'Well, that was expensive.'];
function beatenLines(note) {
  for (const [re, lines] of BEATEN) {
    const m = note.match(re);
    if (m) return lines.map(l => l.replace('$1', m[1]));
  }
  return NOTHING;
}

// After the race: who was right, who's complaining.
export function reactions(world, race, posts, order, pay, run) {
  const win = order[0];
  const out = [];
  const said = new Set(); // two regulars don't post the same line about one race
  for (const p of posts) {
    const R = rng(`react:${race.seed}:${p.who}`);
    if (p.pass || !p.pick.length) continue;
    const fresh = lines => { const left = lines.filter(l => !said.has(l)); return left.length ? R.pick(left) : null; };
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
        // What she says is what she wrote: "looked good" only of a horse she said looked good.
        ruth: race.entries[win].pdk.kind === 'good' ? `Said it looked good in the ring. $${$}.` : `No fuss in the paddock, none in the race. $${$}.`,
        greg: world.horses[race.entries[win].hid].coat === 'grey' ? `THE GREY. $${$}. I'll never stop.` : `The name I liked came in. $${$}. The system works.`,
      }[p.who];
    } else if (res && res.pos <= 3) {
      text = fresh([`Second guessed myself on the exacta. Ran ${ordinalWord(res.pos)}.`, `${ordinalWord(res.pos, true)}. Close enough to hurt.`, `Hit the board at least. ${ordinalWord(res.pos, true)}.`]);
    } else if (res) {
      text = fresh(beatenLines(tripComment(run, top, race.entries.length)));
    }
    if (text && (top === win || R.chance(0.75))) { out.push({ who: p.who, text, won: top === win }); said.add(text); }
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
