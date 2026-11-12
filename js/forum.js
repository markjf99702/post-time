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
    // (A figure is always quoted as "#4 Name: 82" or "#4 (82)", the way the tests read them back.)
    if (a === undefined || figs[a] === null) {
      return { pick: idx.slice(0, 3), pass: true, text: say(race, 'sheets', [
        'Not a figure on any of these. No numbers, no opinion. Passing.',
        "Nobody in here has run a number I can use. Passing.",
        "No figures, no bet. I'll watch this one.",
        "Blank sheet. I don't bet blank sheets.",
        'Nothing on paper here. Sitting it out.',
      ]) };
    }
    const A = `${label(race, a)} ${nm(world, race, a)}: ${quote(a)}`;
    // One horse with a number: the only one in the race, or the only one that has run.
    if (b === undefined || figs[b] === null) {
      return { pick: idx.slice(0, 3), text: say(race, 'sheets', [
        `Top fig belongs to ${A}. Nobody else in here has a number. Single.`,
        `${A}. Only number in the race. Single.`,
        `One figure on the page, ${A}. The rest are guesses. Single.`,
        `${A}, and nobody else has run a number. Easiest call of the day.`,
        `${A}. Everybody else is a blank. I'll take the horse with the number.`,
      ]) };
    }
    const gap = figs[a] - figs[b];
    const apart = gap === 0 ? 'even on the numbers' : `${gap} point${gap === 1 ? '' : 's'} apart on the numbers`;
    const pa = `${label(race, a)} (${quote(a)})`, pb = `${label(race, b)} (${quote(b)})`, la = label(race, a), lb = label(race, b);
    const text = gap >= 4 ? say(race, 'sheets', [
      `Top fig belongs to ${A}, and that's ${gap} clear of the next best. Single.`,
      `${A}. ${gap} points better than anything else in here. Single.`,
      `It's not close. ${A}, ${gap} clear on the numbers. Single.`,
      `${A}. The next best is ${gap} back. Single, and I'm not apologizing.`,
      `The sheet says ${A}, ${gap} clear. I just do what the sheet says.`,
    ]) : say(race, 'sheets', [
      `${pa} and ${pb} are ${apart}. ${la} on top, ${lb} underneath.`,
      `${pa} against ${pb}, ${apart}. Exacta, ${la} over ${lb}.`,
      `Two horses, ${apart}: ${pa} and ${pb}. ${la} on top, both in the exacta.`,
      `${pa} and ${pb}, ${apart}. Close on paper, so ${la} on top and ${lb} underneath.`,
      `It's between ${pa} and ${pb}, ${apart}. ${la} to win, ${lb} saver.`,
    ]);
    return { pick: idx.slice(0, 3), text };
  },

  // He backs whoever is favourite when the gate opens, and says so: the horse he names is only the
  // favourite as he posts, with the betting half done. His pick is set from the final board at the off
  // (favouriteAtTheOff, below), which `atTheOff` asks for.
  chalk(world, race, ctx) {
    const idx = byOdds(ctx.odds);
    const a = idx[0];
    const A = `${label(race, a)} ${nm(world, race, a)}`, at = ctx.text[a];
    return { pick: idx.slice(0, 3), atTheOff: true, text: say(race, 'chalk', [
      `Whoever's favorite at the bell. Right now that's ${A} at ${at}. Don't overthink it.`,
      `The favorite at the bell, same as every race. Right now ${label(race, a)} at ${at}. The crowd is right more often than this forum is.`,
      `I'll have whatever's favorite when the gate opens. Right now ${label(race, a)} at ${at}. Boring? Sure. Boring pays the rent.`,
      `Same as always: the favorite when the gate opens. Right now that's ${A} at ${at}. Not complicated.`,
      `The favorite at the bell wins about a third of the time. Right now that's ${A} at ${at}. I'll take a third.`,
      `Whoever's the favorite at the bell, I'm on. Right now ${label(race, a)} at ${at}. You all can show your work. I'll show my ticket.`,
    ]) };
  },

  pace(world, race) {
    const styles = race.entries.map(e => runStyle(world.horses[e.hid]));
    const speed = styles.map((s, i) => [s, i]).filter(([s]) => s === 'E').map(([, i]) => i);
    const ratings = race.entries.map(e => formRating(world.horses[e.hid], race));
    if (speed.length === 1) {
      const a = speed[0];
      const rest = rankBy(ratings).filter(i => i !== a);
      const A = `${label(race, a)} ${nm(world, race, a)}`;
      return { pick: [a, ...rest.slice(0, 2)], text: say(race, 'pace', [
        `${A} is the only real speed in here. Loose on the lead, and nobody's going to go with them. Goodnight.`,
        `Only one horse in here wants the lead: ${A}. Nobody to go with them. That's the race.`,
        `${A} gets the lead for free. Lone speed, and I'll take lone speed every time.`,
        `Look at the early calls: ${A} is the only one that goes. Uncontested on the front end.`,
        `${A} is lone speed. They'll be clear before anybody wakes up.`,
      ]) };
    }
    if (speed.length >= 3) {
      const closers = rankBy(ratings.map((r, i) => (styles[i] === 'S' || styles[i] === 'P') ? r : r - 20));
      const a = closers[0];
      const list = speed.map(i => label(race, i)).join(', '), A = `${label(race, a)} ${nm(world, race, a)}`;
      return { pick: closers.slice(0, 3), text: say(race, 'pace', [
        `${speed.length} of these need the lead: ${list}. They'll cook each other. I want the one sitting back: ${A}.`,
        `${list}: ${COUNT_WORD[speed.length] || speed.length} speed horses and one lead. Meltdown up front, and ${A} picks up the pieces.`,
        `Speed duel coming: ${list} all want the front. I want ${A}, sitting off it.`,
        `Too much speed: ${list}. They'll run each other into the ground, and ${A} will be there at the end.`,
        `${list} all have to have the lead. Somebody's going too fast early, and ${A} comes late.`,
      ]) };
    }
    if (speed.length === 0) {
      const presser = rankBy(ratings.map((r, i) => styles[i] === 'E/P' ? r + 3 : r));
      const a = presser[0];
      // He names a horse as the one to go only if it's one that runs close to the pace. (Four times in
      // ten "the likeliest" was a horse wearing the Closer chip.)
      // (Every line for one names it "the likeliest", and every line for the other gives it "an easy trip".)
      const L = label(race, a), A = `${L} ${nm(world, race, a)}`;
      const text = styles[a] === 'E/P' ? say(race, 'pace', [
        `No speed at all in this field. Somebody has to go, and ${L} is the likeliest. Slow pace favors whoever's up front.`,
        `No speed in here. ${A} is the likeliest to take them along, and a slow pace makes that a big edge.`,
        `Nobody wants the lead. ${L} is the likeliest to go, and nobody will bother them.`,
        `Crawl of a pace coming. ${A} is the likeliest leader, and slow fractions up front are hard to run down.`,
        `No speed at all. ${L} is the likeliest to inherit the lead. Wire job.`,
      ]) : say(race, 'pace', [
        `No speed in this field, so the best horse gets an easy trip: ${A}.`,
        `Nobody wants to go, so it's about who's best with an easy trip. That's ${A}.`,
        `No speed, no pace, no excuses. The best horse gets an easy trip: ${A}.`,
        `Slow pace and an easy trip for the class of the field: ${A}.`,
        `No real speed in here. ${A} gets an easy trip and should be best.`,
      ]);
      return { pick: presser.slice(0, 3), text };
    }
    const [x, y] = speed;
    const a = ratings[x] >= ratings[y] ? x : y;
    const rest = rankBy(ratings).filter(i => i !== a);
    const X = label(race, x), Y = label(race, y), L = label(race, a);
    return { pick: [a, ...rest.slice(0, 2)], text: say(race, 'pace', [
      `${X} and ${Y} will hook up early. ${L} is the better of the two and should put the other away.`,
      `${X} and ${Y} both want it. They duel for a half, then ${L} puts the other away.`,
      `Two speed horses, ${X} and ${Y}. ${L} is the better one and wins the fight.`,
      `${X} and ${Y} go together early. I want the better of the two: ${L}.`,
      `${X} against ${Y} up front. ${L} has more class, and that's the race.`,
    ]) };
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
    const A = `${label(race, a)} ${h.name}`, S = h.sire;
    let lines;
    if (wet && s && s.mud > 0.2) {
      lines = [
        `${A} is by ${S}, and those love it wet. Look at the sky and bet accordingly.`,
        `Wet track, mud pedigree: ${A}, by ${S}. Easy.`,
        `It's wet, and ${A} is by ${S}. Those were made for days like this.`,
        `${A}: by ${S}, and a wet track is exactly what they want.`,
        `Everybody's complaining about the weather. I'm on ${A}, by ${S}.`,
      ];
    } else if (race.surface === 'turf' && s && s.turf > 0.4) {
      lines = firstTurf ? [
        `${A} is by ${S}, trying grass for the first time. The pedigree says this is what it was bred for.`,
        `${A} tries grass for the first time, and it's by ${S}. About time.`,
        `${A}, by ${S}, on grass for the first time. This is the day it was bred for.`,
      ] : [
        `${A} is by ${S}. Grass in the blood.`,
        `${A}, by ${S}. Turf sire, turf race. Next question.`,
        `On the grass I want a grass pedigree: ${A}, by ${S}.`,
        `${A} is by ${S}, and his foals run on the turf. Simple as that.`,
      ];
    } else if (s) {
      // (What she says of the distance is bredFor's, word for word: the tests read it back.)
      const fit = bredFor(s, f);
      lines = /fits/.test(fit) ? [
        `${A} is by ${S}, ${fit}`,
        `${A}: by ${S}, ${fit} That's half of it.`,
        `Pedigree first. ${A} is by ${S}, ${fit}`,
      ] : [
        `${A} is by ${S}, ${fit} I'm taking it anyway.`,
        `${A} is by ${S}, ${fit} Still the best pedigree in here.`,
        `${A} is by ${S}, ${fit} Not ideal. The rest are worse.`,
      ];
    } else return null;
    return { pick: idx.slice(0, 3), text: say(race, 'pam', lines) };
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
    if (!cands.length) {
      return { pick: [], pass: true, text: say(race, 'lou', [
        'Nothing here at a price. Saving my money for later.',
        'All short prices in this one. Pass.',
        'No value in here. Sitting it out.',
        'Not a price worth having. Next race.',
        "I don't bet favorites, and there's nothing else worth it. Pass.",
      ]) };
    }
    const c = cands[0];
    const A = `${label(race, c.i)} ${nm(world, race, c.i)}`, at = ctx.text[c.i];
    // (The angles always come as ". Angle." and ". Also angle.": the tests read them back.)
    const why = `${cap(c.angles[0])}.${c.angles[1] ? ` Also ${c.angles[1]}.` : ''}`;
    return { pick: [c.i], text: say(race, 'lou', [
      `Nobody's looking at ${A} at ${at}. ${why} I'm in.`,
      `${A}, ${at} on the board. ${why} That's my bet.`,
      `Here's one: ${A} at ${at}. ${why} Price is right.`,
      `${at} on ${A}? Somebody hasn't read the form. ${why} Win only.`,
      `The crowd forgot about ${A}. ${at}. ${why} Love it at the price.`,
    ]) };
  },

  ruth(world, race) {
    const score = race.entries.map(e => (e.pdk.kind === 'good' ? 5 : e.pdk.kind === 'poor' ? -6 : 0) + JOCKEYS[e.j].skill * 4 + formRating(world.horses[e.hid], race) * 0.3);
    const idx = rankBy(score);
    const a = idx[0];
    const e = race.entries[a];
    const bad = race.entries.findIndex(x => x.pdk.kind === 'poor');
    const B = bad >= 0 && bad !== a ? label(race, bad) : null, looks = B && race.entries[bad].pdk.text;
    const warn = B ? say(race, 'ruth-warn', [` Stay away from ${B}: ${looks.toLowerCase()}.`, ` And ${B}? ${looks}. No thanks.`, ` Don't touch ${B}: ${looks.toLowerCase()}.`]) : '';
    // (She says "no fuss" only of a horse that didn't look good: the tests hold her winning lines to it.)
    const note = e.pdk.kind === 'good' ? `${e.pdk.text} in the paddock` : 'no fuss in the paddock';
    const A = `${label(race, a)} ${nm(world, race, a)}`, J = JOCKEYS[e.j].name;
    return { pick: idx.slice(0, 3), text: say(race, 'ruth', [
      `${A}: ${note}, and ${J} is riding. That'll do me.`,
      `I like ${A}. ${cap(note)}, and ${J} up.`,
      `${A}, ${note}. ${J} rides. Good enough for me.`,
      `Went down to the ring. ${A}: ${note}, and ${J} has the mount.`,
      `${A}. ${cap(note)}. ${J} on top. Done.`,
    ]) + warn };
  },

  greg(world, race) {
    const greys = race.entries.map((e, i) => [world.horses[e.hid], i]).filter(([h]) => h.coat === 'grey').map(([, i]) => i);
    if (greys.length) {
      const a = greys[0];
      // He counts them: "TWO greys" stood over three and four.
      const others = greys.slice(1).map(i => label(race, i));
      // (Two or more always begins with the count, "TWO greys.", and only one grey is "a grey in here".)
      const A = `${label(race, a)} ${nm(world, race, a)}`, L = label(race, a);
      const many = `${COUNT[greys.length] || greys.length} greys.`;
      const rest = greys.length === 2 ? `${others[0]} to place` : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]} underneath`;
      const text = greys.length === 1 ? say(race, 'greg', [
        `There's a grey in here. ${A}. You know the rules.`,
        `${A}. Grey. That's the whole system.`,
        `Found the grey: ${A}. To win, like always.`,
        `One grey in the field, ${A}, and one bet on my ticket.`,
        `There's a grey in here, ${A}. Don't need to read anything else.`,
      ]) : say(race, 'greg', [
        `${many} Christmas came early. ${L} to win, ${rest}.`,
        `${many} ${L} to win, ${rest}. I've waited all day for this.`,
        `${many} Can't believe my luck. ${L} on top, ${rest}.`,
      ]);
      return { pick: [a], text };
    }
    const R = rng(`greg:${race.seed}`);
    const a = R.int(0, race.entries.length - 1);
    const A = `${label(race, a)} ${nm(world, race, a)}`;
    return { pick: [a], text: say(race, 'greg', [
      `No grey in this one. I'm going with the name I like best: ${A}.`,
      `No grey. So, the name: ${A}. Don't ask.`,
      `No grey in the field. ${A}, because I like the sound of it.`,
      `No grey here. Fine. ${A}, for the name.`,
    ]) };
  },
};

const COUNT = ['', '', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
const COUNT_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

// What PedigreePam says of the distance, from the sire's own (the distance his runners do best at): a
// sprinter's sire, a router's, or one in between. She says the distance fits only when it does, and
// otherwise that it doesn't. (It used to go by the race alone: a son of Tapit was "bred for speed. The
// distance fits" at five furlongs.)
function bredFor(sire, f) {
  const [kind, fits] = sire.dist <= 7 ? ['speed', f <= 7] : sire.dist >= 8 ? ['a route of ground', f >= 8] : ['seven furlongs or a mile', Math.abs(f - sire.dist) <= 1];
  if (fits) return `bred for ${kind}. The distance fits.`;
  return `whose runners want ${sire.dist > f ? 'more' : 'less'} ground than this.`;
}

// A horse's age on the day of the race: every horse turns a year older on 1 January.
function ageOn(race, h) { return +race.date.slice(0, 4) - h.foaled; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
function rankBy(scores) { return scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i); }
// Shortest price first.
function byOdds(odds) { return rankBy(odds.map(o => -o)); }
// One of a regular's ways of saying a thing, the same each time the race's thread is made. Each regular draws
// from his own stream, apart from the one that decides who posts and when (`forum:`), so what they say can
// change without changing who posts or what they pick.
function say(race, who, lines) { return lines[rng(`line:${race.seed}:${who}`).int(0, lines.length - 1)]; }

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
    // A losing run of three today, five or seven gets a word; every post of a long one would wear thin.
    const cold = res.pass ? 0 : losingRun(world, race, t.id);
    if (cold === 3 || cold === 5 || cold === 7) res.text += ` ${say(race, `${t.id}-cold`, VOICES[t.id].cold(cold))}`;
    posts.push({ who: t.id, mins: R.int(3, 58), ...res });
  }
  posts.sort((a, b) => b.mins - a.mins);
  return posts;
}

// How many of today's races in a row, up to this one, a regular's top pick has lost. (Only today's: the
// threads of earlier race days aren't kept.)
function losingRun(world, race, who) {
  const today = world.cards?.[race.day]?.races || [];
  let n = 0;
  for (const r of today.filter(x => x.no < race.no && x.status === 'official' && Array.isArray(x.forum)).sort((x, y) => y.no - x.no)) {
    const p = r.forum.find(x => x.who === who);
    if (!p || p.pass || !p.pick.length) continue;
    if (r.result.order[0].k === p.pick[0]) break;
    n++;
  }
  return n;
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
// the forum and the form can't disagree. Trouble in the running first, then the start, then the trip. `again`
// is said when the horse's last race before this one had the same trouble: the regulars remember it.
const BEATEN = [
  [/Checked/, ['Had to check in traffic. Robbed.', 'Nowhere to go. Rider should be fined.', 'Had horse, had no room. Next time.', 'Stuck behind a wall of horses. Unbelievable.'],
    ['Nowhere to go again. Same as last time.', 'Had to check in traffic again. Twice running now.']],
  [/Blocked/, ['Blocked the whole stretch. Robbed.', 'Nowhere to go. Rider should be fined.', 'Had horse, had no room. Next time.', 'Stuck behind a wall of horses. Unbelievable.'],
    ['Nowhere to go again. Same as last time.', 'Blocked again. Somebody tell the rider there are other paths.']],
  [/Stumbled/, ['Stumbled at the break. Throw it out.', 'Lost it at the break. Throw it out.'], ['Lost it at the break again. Same as last time.']],
  [/Broke slowly/, ['Missed the start. Race over right there.', 'Lost it at the break. Throw it out.'], ['Missed the start again. Somebody school this horse in the gate.']],
  [/Bumped/, ['Got hit coming out of the gate. Throw it out.', 'Knocked sideways at the start. Next time.'], ['Got hit at the start again. Same as last time.']],
  [/(\d) wide/, [`Parked $1 wide on the turn. Can't win like that.`], [`Parked $1 wide on the turn again. Can't win like that.`]],
  [/Dueled/, ['Cooked in a speed duel. Classic.'], ['Cooked in a speed duel again. Same as last time.']],
  [/Set pace/, ['Had the lead and gave it up. Hate to see it.'], ['Had the lead and gave it up again.']],
  [/Chased/, ['Chased the pace and came up empty.'], ['Chased the pace and came up empty again.']],
  [/Late gain|[Ii]mproved position/, ['Running at the end. Too late.', 'Too little, too late.'], ['Running late again. Too late, same as last time.']],
];
function beatenAs(note) {
  for (const [re, lines, again] of BEATEN) {
    const m = note.match(re);
    if (m) return { re, lines: lines.map(l => l.replace('$1', m[1])), again: again.map(l => l.replace('$1', m[1])) };
  }
  return null;
}

// Each regular's own voice after a race: what he says when his horse wins (`won`), runs second or third
// (`placed`), or runs nowhere with no trouble in its note (`nothing`); a few words he adds after the chart's
// complaint (`tail`); and what he says before a race when his picks have lost three or more in a row today
// (`cold`, at three, five and seven). `x` is the race as he sees it: what the winner paid, his horse's odds and where it finished, its
// rider and sire, and whether it's a grey.
const VOICES = {
  sheets: {
    won: x => [`Numbers don't lie. $${x.$}.`, `Best figure, and it won. Funny how that works. $${x.$}.`, `The sheet had it. $${x.$}.`, `Top number, top of the board. $${x.$}.`],
    placed: x => [`${x.Ord}. The numbers had it close, and it was close.`, `${x.Ord}. Figure was right, the horse just didn't run it.`, `Ran ${x.ord}. Off by a point or two somewhere.`],
    nothing: () => ['Figure said yes, horse said no.', 'Nowhere. Back to the sheets.', "That one won't be on my sheet for a while."],
    tail: () => ['Throw out the figure.', 'The number from this one goes in the bin.'],
    cold: n => [`0 for ${n} today. The numbers will come around.`, `0 for ${n} today. Doesn't change the method.`],
  },
  chalk: {
    won: x => [`Chalk holds. $${x.$} for two. Boring and correct.`, `Chalk holds. $${x.$}. The crowd knew.`, `Chalk holds. $${x.$}. Try not to look so surprised.`, `Chalk holds. $${x.$}. Small money, but it spends.`],
    placed: x => [`Favorite ran ${x.ord}. Happens two times in three.`, `${x.Ord}. Chalk got beat. Back at it next race.`, `${x.Ord}. At least the crowd was close.`],
    nothing: () => ['Beaten favorite. Next race.', 'The crowd was wrong. It happens two times in three.', 'Ugh. Favorites, man.'],
    tail: () => ['Still the right bet.', 'Right horse, wrong trip.'],
    cold: n => [`0 for ${n} today. The crowd will come good.`, `0 for ${n} today. Even the favorites hate me.`],
  },
  pace: {
    won: x => [`Told you the pace would decide it. $${x.$}.`, `Pace makes the race. Every time. $${x.$}.`, `Set up exactly like I said. $${x.$}.`, `Read the pace, cash the ticket. $${x.$}.`],
    placed: x => [`${x.Ord}. Pace was right, the horse wasn't.`, `Ran ${x.ord}. Right shape of race, wrong horse.`, `${x.Ord}. Close enough to hurt.`],
    nothing: () => ["Race didn't shape up the way it should have. Happens.", "Pace was honest. My horse wasn't.", 'Read the pace right, picked the wrong horse.'],
    tail: () => ['Not how I drew it up.', "That's not the pace I signed up for."],
    cold: n => [`0 for ${n} today, but the pace doesn't lie forever.`, `0 for ${n} today. The races keep refusing to be run the way they should.`],
  },
  pam: {
    won: x => [`Blood tells. $${x.$}, thank you ${x.sire}.`, `Thank you, ${x.sire}. $${x.$}.`, `Pedigree, pedigree, pedigree. $${x.$}.`, `${x.sire} gets another one. $${x.$}.`],
    placed: x => [`${x.Ord}. Bred for it, just not good enough today.`, `Ran ${x.ord}. The blood got it close.`, `${x.Ord}. Ran to its pedigree, not past it.`],
    nothing: () => ['Bred for it and ran like it wasn\'t.', 'Pedigree only gets you so far.', 'Wrong family today.'],
    tail: () => ['The blood was there.', 'Pedigree can\'t steer.'],
    cold: n => [`0 for ${n} today. Blood will out.`, `0 for ${n} today. Breeding is a long game.`],
  },
  lou: {
    won: x => [`NOBODY WAS LOOKING. $${x.$}! Drinks are on me.`, `$${x.$}! Nobody was looking, and that's the point.`, `THERE it is. $${x.$}. That's why you bet a price.`, `$${x.$}. I'll be insufferable for a week.`],
    placed: x => [`Ran ${x.ord} at ${x.odds}. Should have bet it to place.`, `${x.Ord}. So close at that price.`, `${x.Ord}. At that price I'll take the moral victory.`],
    nothing: x => [`Nowhere. I suppose that's why it was ${x.odds}.`, 'Never fired. Moving on.', 'Ugh. One hit pays for ten of these.'],
    tail: x => [`At ${x.odds}, I'd take that chance any day.`, "That's the longshot life."],
    cold: n => [`0 for ${n} today. That's the job. One hit pays for all of it.`, `0 for ${n} today. Longshots come in bunches. Supposedly.`],
  },
  ruth: {
    // What she says is what she wrote: "looked good in the ring" only of a horse she said looked good.
    won: x => (x.looked ? [`Said it looked good in the ring. $${x.$}.`, `It looked good in the ring and ran like it. $${x.$}.`, `Forty years at the rail. It looked good in the ring, and it won. $${x.$}.`]
      : [`No fuss in the paddock, none in the race. $${x.$}.`, `Quiet in the ring, loud at the wire. $${x.$}.`, `${x.rider} brought it home. $${x.$}.`]),
    placed: x => [`${x.Ord}. Ran honest, I'll give it that.`, `Ran ${x.ord}. ${x.rider} rode it fine.`, `${x.Ord}. Gave everything it had.`],
    nothing: () => ['Forty years and they still fool me.', 'Nothing. Should have watched the warm-up closer.', 'Well, that was expensive.'],
    tail: x => [`Blame ${x.rider}.`, "I'll want a word with the rider."],
    cold: n => [`0 for ${n} today. Forty years, I've had worse afternoons.`, `0 for ${n} today. The horses look fine. It's me.`],
  },
  greg: {
    won: x => (x.grey ? [`THE GREY. $${x.$}. I'll never stop.`, `GREY HORSE! $${x.$}! What did I say?`, `The grey, $${x.$}. Never doubt the grey.`]
      : [`The name I liked came in. $${x.$}. The system works.`, `Picked it for the name. $${x.$}. Don't tell anyone.`, `$${x.$} on a name. I'll take it.`]),
    placed: x => (x.grey ? [`The grey ran ${x.ord}. I'll be on the next one.`, `${x.Ord}. Good effort from the grey.`] : [`${x.Ord}. Should have waited for a grey.`, `${x.Ord}. That's what a name gets you.`]),
    nothing: x => (x.grey ? ['Not the grey\'s day. There\'ll be another grey.', 'The grey never fired. Next grey, same bet.'] : ["That's what I get for betting a name. Waiting for a grey.", 'No grey, no luck.']),
    tail: x => (x.grey ? ['Next grey, same bet.'] : ['Serves me right without a grey.']),
    cold: n => [`0 for ${n} today. The greys owe me.`, `0 for ${n} today. Still not changing the system.`],
  },
};

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
    const e = race.entries[top], h = world.horses[e.hid];
    const v = VOICES[p.who];
    const x = {
      $: pay.win[win].toFixed(2), odds: race.result?.oddsText?.[top] || '', rider: JOCKEYS[e.j].name, sire: h.sire, grey: h.coat === 'grey',
      looked: e.pdk.kind === 'good', ord: res ? ordinalWord(res.pos) : '', Ord: res ? ordinalWord(res.pos, true) : '',
    };
    let text = null;
    if (top === win) text = fresh(v.won(x));
    else if (res && res.pos <= 3) text = fresh(v.placed(x));
    else if (res) {
      const as = beatenAs(tripComment(run, top, race.entries.length));
      if (!as) text = fresh(v.nothing(x));
      else {
        // The horse's race before this one, with the same trouble in its note and beaten: "again".
        const lines = h.pps.filter(l => !(l.d === race.day && l.no === race.no));
        const before = lines[lines.length - 1];
        const again = before && before.fin > 1 && as.re.test(before.cm) ? fresh(as.again) : null;
        text = again || fresh(as.lines);
        if (text && !again && R.chance(0.4)) { said.add(text); text = `${text} ${R.pick(v.tail(x))}`; }
      }
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
