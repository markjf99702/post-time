// Names and people. Everything here is made up except the stallions, which are real sires
// (the ones marked `bl` are in Bloodlines, the drawer's racehorse family tree, so their names link there).

export const TRACK = { name: 'Larkspur Downs', short: 'Lrk' };

// dist: the distance (furlongs) their foals like best; turf and mud: -1..1; speed: how quick they are early.
export const SIRES = [
  { name: 'Into Mischief', dist: 6.5, turf: -0.4, mud: 0.3, speed: 0.8, q: 3, bl: 1 },
  { name: 'Gun Runner', dist: 8.5, turf: -0.3, mud: 0.4, speed: 0.6, q: 3, bl: 1 },
  { name: 'Curlin', dist: 9.5, turf: 0, mud: 0.6, speed: 0.35, q: 2.5, bl: 1 },
  { name: 'Tapit', dist: 9, turf: 0.1, mud: 0.1, speed: 0.4, q: 2, bl: 1 },
  { name: 'Justify', dist: 8, turf: 0.3, mud: 0.2, speed: 0.65, q: 1.5, bl: 1 },
  { name: 'American Pharoah', dist: 8, turf: 0.5, mud: 0.1, speed: 0.55, q: 1, bl: 1 },
  { name: "Medaglia d'Oro", dist: 8.5, turf: 0.5, mud: 0, speed: 0.5, q: 1, bl: 1 },
  { name: 'Candy Ride', dist: 8, turf: 0, mud: 0.2, speed: 0.55, q: 1, bl: 1 },
  { name: 'Street Sense', dist: 8, turf: 0.5, mud: 0, speed: 0.45, q: 0.5, bl: 1 },
  { name: 'Arrogate', dist: 9.5, turf: -0.2, mud: 0.2, speed: 0.4, q: 1, bl: 1 },
  { name: 'Ghostzapper', dist: 7, turf: -0.1, mud: 0.4, speed: 0.7, q: 0.5, bl: 1 },
  { name: 'Good Magic', dist: 9, turf: 0, mud: 0.4, speed: 0.45, q: 1, bl: 1 },
  { name: 'Authentic', dist: 8.5, turf: 0, mud: 0.1, speed: 0.75, q: 0.5, bl: 1 },
  { name: 'Kingman', dist: 8, turf: 0.9, mud: -0.2, speed: 0.5, q: 1.5, bl: 1 },
  { name: 'Frankel', dist: 10, turf: 1, mud: -0.3, speed: 0.35, q: 2, bl: 1 },
  { name: 'Sea the Stars', dist: 11, turf: 1, mud: 0, speed: 0.3, q: 1, bl: 1 },
  { name: 'Invincible Spirit', dist: 6, turf: 0.8, mud: 0, speed: 0.75, q: 0.5, bl: 1 },
  { name: 'Speightstown', dist: 6.5, turf: 0.3, mud: 0.2, speed: 0.8, q: 1 },
  { name: 'Uncle Mo', dist: 7.5, turf: -0.1, mud: 0.3, speed: 0.65, q: 1 },
  { name: 'Quality Road', dist: 8, turf: 0, mud: 0.3, speed: 0.6, q: 1.5 },
  { name: 'War Front', dist: 7.5, turf: 0.9, mud: -0.1, speed: 0.6, q: 1 },
  { name: 'Munnings', dist: 6.5, turf: 0.2, mud: 0.3, speed: 0.8, q: 0 },
  { name: 'Not This Time', dist: 7, turf: 0.1, mud: 0.2, speed: 0.75, q: 1 },
  { name: 'Constitution', dist: 8.5, turf: 0, mud: 0.2, speed: 0.55, q: 0.5 },
];

export const DAMSIRES = [
  'Tiznow', 'Scat Daddy', 'Galileo', "Giant's Causeway", 'Empire Maker', 'Street Cry', 'Malibu Moon', 'A.P. Indy',
  "Unbridled's Song", 'Distorted Humor', 'Smart Strike', 'Awesome Again', 'Storm Cat', 'Pulpit', 'Harlan\'s Holiday',
  'Kingmambo', 'Deputy Minister', 'Candy Ride', "Medaglia d'Oro", 'Tapit', 'Curlin', 'Speightstown', 'Ghostzapper',
];
export const IN_BLOODLINES = new Set([
  ...SIRES.filter(s => s.bl).map(s => s.name),
  'Tiznow', 'Scat Daddy', 'Galileo', "Giant's Causeway", 'Empire Maker', 'Street Cry', 'Malibu Moon', 'A.P. Indy',
  "Unbridled's Song", 'Distorted Humor', 'Smart Strike', 'Awesome Again', 'Storm Cat', 'Pulpit', "Harlan's Holiday",
  'Kingmambo', 'Deputy Minister',
]);

export const JOCKEYS = [
  ['R. Ibarra', 0.9], ['M. Okafor', 0.8], ['T. Beaumont', 0.7], ['L. Ferreira', 0.6], ['S. Villaseñor', 0.5],
  ['A. Nakamura', 0.45], ['K. Delaney', 0.35], ['E. Solano', 0.3], ['C. Whitlock', 0.2], ['P. Arceneaux', 0.15],
  ['G. Mahon', 0.05], ['N. Tovar', 0], ['B. Kincaid', -0.1], ['H. Oyelaran', -0.15], ['J. Pickard', -0.25], ['D. Amaro', -0.35],
].map(([name, skill]) => ({ name, skill }));

export const TRAINERS = [
  'M. Hale', 'O. Brandt', 'R. Valdivia', 'H. Greer', 'D. Pickett', 'I. Okonkwo', 'W. Brennan', 'J. Tallis',
  'C. Menard', 'P. Raman', 'F. Harlow', 'N. Quist', 'B. Lyle', 'A. Sorensen',
];

export const OWNERS = [
  'Blue Door Stable', 'Harrow Hill Farm', 'Two Sisters Racing', 'Pocket Change LLC', 'Late Bloomer Stable',
  'Mudroom Racing', 'Seven Oaks Stable', 'Sawdust & Sons', 'Brass Tack Stable', 'Lucky Penny Partners',
  'Crooked Fence Farm', 'Kettle Creek Stable', 'Odd Socks Racing', 'Hilltop Hundred', 'Rainwater Farm',
  'Porchlight Stable', 'Tin Roof Racing', 'Maple Row Farm', 'Wishbone Stable', 'Paper Moon Racing',
  'Old Barn Partners', 'Starling Stables', 'Copperline Farm', 'Juniper Lane Racing', 'The Back Forty',
  'Loose Ends LLC', 'Rusty Hinge Racing', 'Spare Parts Stable', 'Candle End Farm', 'Top Drawer Racing',
];

// Racing silks: a jacket colour, a pattern in a second colour, and a cap.
export const SILK_COLORS = {
  red: '#c62828', scarlet: '#e53935', maroon: '#7b1f2b', pink: '#f06ba8', orange: '#ef7d1a', gold: '#e3b21b',
  yellow: '#f5d90a', lime: '#9ccc3c', green: '#2e7d32', emerald: '#0f8f6a', teal: '#128c8c', lightblue: '#6ec1ea',
  royal: '#2350c4', navy: '#1c2a5a', purple: '#6a3aa8', lavender: '#b39ddb', white: '#f7f5ef', black: '#1d1d1f',
  grey: '#9aa0a6', brown: '#6d4c2f', tan: '#cfa56a',
};
export const PATTERNS = ['solid', 'hoops', 'sash', 'stripes', 'halves', 'quarters', 'diamonds', 'chevrons', 'spots', 'star', 'cross', 'braces', 'sleeves'];

// US saddle-cloth colours by program number: [cloth, number].
export const CLOTH = [
  null,
  ['#d62828', '#ffffff'], ['#f4f4f0', '#111111'], ['#1f4fd1', '#ffffff'], ['#f5d400', '#111111'],
  ['#1e8a3a', '#ffffff'], ['#111111', '#f5d400'], ['#f27b1a', '#111111'], ['#f59ac5', '#111111'],
  ['#35c9c9', '#111111'], ['#6a2ea0', '#ffffff'], ['#9a9a9a', '#d62828'], ['#9bd13a', '#111111'],
];

export const STAKES = [
  { name: 'Brass Pull Stakes', surface: 'dirt', f: 8.5 },
  { name: 'Spare Key Stakes', surface: 'turf', f: 8 },
  { name: 'Odds and Ends Handicap', surface: 'dirt', f: 9 },
  { name: 'Twist Tie Mile', surface: 'turf', f: 8 },
  { name: 'Tape Measure Sprint', surface: 'dirt', f: 6 },
  { name: 'Loose Change Stakes', surface: 'dirt', f: 7 },
  { name: 'Rubber Band Stakes', surface: 'turf', f: 8.5 },
  { name: 'Birthday Candle Stakes', surface: 'dirt', f: 8.5 },
  { name: 'Thumbtack Stakes', surface: 'turf', f: 5.5 },
  { name: 'Matchbook Handicap', surface: 'dirt', f: 9 },
];
export const BIG_STAKES = { name: 'Larkspur Handicap', surface: 'dirt', f: 9 };

// ------------------------------------------------------------------ horse names

const ADJ = [
  'Midnight', 'Golden', 'Silver', 'Copper', 'Velvet', 'Rusty', 'Quiet', 'Royal', 'Lucky', 'Wild', 'Brave', 'Sly',
  'Dusty', 'Rowdy', 'Secret', 'Northern', 'Southern', 'Distant', 'Crimson', 'Lonesome', 'Early', 'Fancy', 'Plain',
  'Lazy', 'Restless', 'Stormy', 'Sunny', 'Tuesday', 'Borrowed', 'Second', 'Honest', 'Humble', 'Handsome', 'Saucy',
  'Clever', 'Stubborn', 'Proper', 'Wicked', 'Gentle', 'Mighty', 'Little', 'Big Town', 'Back Porch', 'Blue Moon',
  'Paper', 'Iron', 'Hometown', 'Rolling', 'Runaway', 'Pocket', 'Hidden', 'Last', 'Spare', 'Loose',
];
const NOUN = [
  'Ledger', 'Kettle', 'Lantern', 'Harbor', 'Echo', 'Ribbon', 'Anthem', 'Promise', 'Ticket', 'Tempo', 'Comet',
  'Meadow', 'Rumor', 'Verdict', 'Rascal', 'Maverick', 'Minstrel', 'Envoy', 'Sonnet', 'Monarch', 'Outlaw', 'Riddle',
  'Bounty', 'Gambit', 'Parade', 'Flurry', 'Cadence', 'Voyage', 'Spark', 'Whisper', 'Thunder', 'Ramble', 'Fortune',
  'Engine', 'Ballad', 'Compass', 'Charm', 'Warrant', 'Dividend', 'Refund', 'Receipt', 'Bargain', 'Alibi', 'Shortcut',
  'Detour', 'Hunch', 'Sermon', 'Rodeo', 'Jubilee', 'Satchel', 'Nickel', 'Penny', 'Button', 'Candle', 'Doorbell',
];
const FILLY_NOUN = ['Belle', 'Duchess', 'Rose', 'Dancer', 'Queen', 'Lady', 'Sister', 'Darling', 'Diva', 'Countess', 'Ballerina', 'Madame'];
const PHRASES = [
  'Tell Aunt Ruth', 'Not Tonight Dear', 'Pay the Man', 'Just Ask Joe', 'Ask Me Later', 'Who Is Frank', "Where's My Hat",
  'Two Left Feet', 'Mind the Gap', 'Call Your Mother', 'Back in Five', 'Fair Enough', 'Keep the Change', 'No Refunds',
  'Sweet Talker', 'Worth the Wait', 'Twice as Nice', 'Ready Set Go', 'Up All Night', 'Say Less', 'Hold My Beer',
  'Bless Your Heart', 'Nothing Doing', 'All the Way Home', 'Off the Record', 'Out of Office', 'Reply All',
  'Batteries Included', 'Some Assembly', 'Spare Key', 'Rubber Band Man', 'Twist Tie', 'Takeout Menu', 'Allen Wrench',
  'Mystery Key', 'Paper Clip', 'Soy Sauce Packet', 'Birthday Candle', 'Dead Battery', 'Tape Measure', 'Thumbtack',
  'Warranty Card', 'Loose Change', 'Scotch Tape', 'Rain Check', 'Junk Mail', 'Sharpie', 'Matchbook', 'Pencil Stub',
  'Grandpa Joe', 'Uncle Buck', 'Cousin Vinny', 'Dr. Fizz', 'Sir Loin', 'Lady Grey', 'Miss Tuesday', 'Mister Bojangles',
  'Kitchen Sink', 'Front Porch', 'Spring Fever', 'Summer Storm', 'Fall Guy', 'Winter Coat', 'Sunday Driver',
  'Easy Money', 'Hot Streak', 'Cold Case', 'Long Shot Larry', 'Photo Op', 'Wire Service', 'Late Scratch',
];

export function makeName(R, female, taken) {
  for (let tries = 0; tries < 200; tries++) {
    let name;
    const roll = R();
    if (roll < 0.22) name = R.pick(PHRASES);
    else if (female && roll < 0.42) name = `${R.pick(ADJ)} ${R.pick(FILLY_NOUN)}`;
    else if (roll < 0.9) name = `${R.pick(ADJ)} ${R.pick(NOUN)}`;
    else name = `${R.pick(NOUN)}'s ${R.pick(NOUN)}`;
    if (name.length <= 18 && !taken.has(name)) { taken.add(name); return name; }
  }
  const name = `${R.pick(ADJ)} ${R.pick(NOUN)} ${taken.size}`;
  taken.add(name);
  return name;
}

const DAM_A = ['Miss', 'Lady', 'Sweet', 'Pretty', 'Dixie', 'Carolina', 'Bonnie', 'Aunt', 'Little', 'Honey', 'Cotton', 'Maple', 'Silk', 'Starry', 'Whistling'];
const DAM_B = ['Annie', 'Marigold', 'Jolene', 'Clementine', 'Ruby', 'Sparrow', 'Maggie', 'Lark', 'Waltz', 'Pearl', 'Violet', 'Hattie', 'Willow', 'Penny', 'Bluebell', 'Mabel'];
export function damName(R) {
  return `${R.pick(DAM_A)} ${R.pick(DAM_B)}`;
}

// Regulars on the forum.
export const TIPSTERS = [
  { id: 'sheets', handle: 'SheetsAndSheets', color: '#2c5f8a', blurb: 'Speed figures. Only speed figures.' },
  { id: 'chalk', handle: 'ChalkEater', color: '#7a6f5a', blurb: 'The favorite wins a third of the time. I like those odds.' },
  { id: 'pace', handle: 'PaceMakesTheRace', color: '#8a4b2c', blurb: 'Who goes to the front, and can anyone stop them.' },
  { id: 'pam', handle: 'PedigreePam', color: '#6a3aa8', blurb: 'Blood tells, especially on grass and in the slop.' },
  { id: 'lou', handle: 'LongshotLou', color: '#1e7a4a', blurb: 'Nobody gets rich betting the favorite.' },
  { id: 'ruth', handle: 'RailbirdRuth', color: '#b0433a', blurb: 'Forty years at the rail. I watch the horses, not the paper.' },
  { id: 'greg', handle: 'GreyHorseGreg', color: '#6f7780', blurb: 'Always bet the grey.' },
];
