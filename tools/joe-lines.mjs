// The lines the caller's downloaded voice is checked on, one to a line of JSON:  node tools/joe-lines.mjs > lines.json
// Every different line, as it's spoken, of the calls of 64 races the game makes (eight seeds' first cards,
// by the game's own code), the line the menu's Hear it says, and the fourteen lines of the race call the
// voices were listened to on. tools/joe-reference.py turns them into test/joe.fixture.json.
import { createWorld, simulateRace } from '../js/world.js';
import { raceCall, SAMPLE, aloud } from '../js/call.js';

// The call Mark heard the voices read (meet "voice-g", 7 November 2026, race 7), with its time as spoken.
const HEARD = [
  'The field is in the gate.', "And they're off!",
  'Crimson Cadence and Proper Maverick vie for the early lead, Royal Doorbell right there.',
  'Down the backstretch, Crimson Cadence leads by a half length. Proper Maverick second. Royal Doorbell is third, and Last Outlaw brings up the rear.',
  'The quarter in 23 and 1.',
  "Around the far turn, Crimson Cadence leads by a length. Proper Maverick second. Royal Doorbell is third, and Gambit's Lantern brings up the rear.",
  'The half in 47 flat.',
  "Turning for home, it's Proper Maverick by a head. Royal Doorbell is flying on the outside!",
  'Proper Maverick goes by and takes the lead!',
  'A furlong to go, Proper Maverick leads by a length, Royal Doorbell chasing.',
  'Loose Duchess closing fast, but Proper Maverick still in front!',
  'Loose Duchess goes by and takes the lead!',
  "Loose Duchess and Proper Maverick hit the wire together. It's a photo!",
  'Proper Maverick in the photo, Royal Doorbell third. The time, one ten flat.',
];
const RACES = 64;
const lines = new Set();
let races = 0;
for (let seed = 0; races < RACES; seed++) {
  const world = createWorld(`joe-${seed}`, '2026-11-07');
  for (const race of world.cards[world.day].races) {
    const names = race.entries.map(e => world.horses[e.hid].name);
    for (const line of raceCall(race, simulateRace(race, world), names).lines) lines.add(line.say || aloud(line.text));
    races++;
  }
}
const sample = aloud(SAMPLE.text);
console.log(JSON.stringify({ races, sample, lines: [...new Set([...HEARD, sample, ...[...lines].sort()])] }));
