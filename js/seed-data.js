// seed-data.js — the event data itself, kept free of any browser or backend
// dependency. Only engine.js is imported, so this module runs identically in
// the browser (via store.js) and in Node (via seed.mjs, which writes it
// straight to Firestore with the Admin SDK).

import {
  buildRoundRobin, buildKnockout, buildRRPlayoffs, buildOrderOfPlay, uid,
} from './engine.js';

// The real roster. Order is seed order — pair 1 is the top seed, and for the
// men's knockout that matters: with an odd count of pairs, the top seed gets
// the bye straight to the semifinal (see buildKnockout's byte distribution).
const WOMEN = [
  ['Augtri', 'Vebi'],
  ['Ocha', 'Novi'],
  ['Kheren', 'Bu Tuti'],
  ['Puspita', 'Dhonna'],
];

// 7 pairs, not 8 -- one bye. buildKnockout handles this (bracket of 8, seed 1
// advances without playing); buildOrderOfPlay no longer burns a schedule slot
// on a bye match, so the day's real match count and finish time both shift.
const MEN = [
  ['Irfan', 'Agoes'],
  ['Daniel', 'Josh'],
  ['Lucas', 'Zaky'],
  ['Dimas', 'Lius'],
  ['Ambo', 'Nassar'],
  ['Krisna', 'Firman'],
  ['Lucky', 'Kiki'],
];

export const SCORING = {
  short: { setsToWin: 1, gamesPerSet: 4, tiebreak: true, noAd: true, label: '1 set ke 4 · no-ad' },
  standard: { setsToWin: 1, gamesPerSet: 6, tiebreak: true, noAd: true, label: '1 set ke 6 · no-ad' },
  final: { setsToWin: 1, gamesPerSet: 6, tiebreak: true, noAd: false, superTiebreak: true, label: '1 set ke 6 + super TB' },
};

// The Firestore document ID for the tournament. Fixed and human-readable
// since this is a standalone, single-event app — no need for a generated id.
export const TOURNAMENT_ID = 'turnamen-17an-tennis-casman';

export function buildSeed() {
  const tournament = {
    id: TOURNAMENT_ID,
    slug: TOURNAMENT_ID,
    name: 'Turnamen 17-an Tennis Casman',
    description: '',
    sport: 'tennis',
    status: 'open',
    date: '2026-08-17',
    venueName: '',
    venueCity: '',
    venueAddress: '',
    mapsUrl: '',
    courts: 1,
    slotMinutes: 30,
    // Women's and Men's play as two separate sequential blocks on the one
    // court -- Women's runs to completion first, Men's starts fresh later.
    // Kept on the tournament doc (not hardcoded in the scheduler) so the
    // Info tab and any future admin UI can read the plan directly.
    blocks: [
      { divisionId: 'div_w', start: '07:00' },
      { divisionId: 'div_m', start: '17:00' },
    ],
    // Hard constraint: the court closes at 21:00, so Men's (starting 17:00)
    // must fit in that window. Checked below after scheduling.
    courtCloses: '21:00',
    // Local-mode only. Firebase mode stores hashes in a separate `pins`
    // collection instead — see seed.mjs and firestore.rules.
    adminPin: '170826',
    scorerPin: '1717',
    locked: false,
  };

  const divisions = [
    {
      id: 'div_w', tournamentId: tournament.id, order: 1, key: 'womens',
      name: { en: "Women's Doubles", id: 'Ganda Putri' },
      short: { en: "Women's", id: 'Putri' },
      format: 'round_robin', colour: '#e0568a', status: 'open',
      thirdPlace: true, finalBetweenTopTwo: true,
      scoring: SCORING.short, finalScoring: SCORING.standard,
    },
    {
      id: 'div_m', tournamentId: tournament.id, order: 2, key: 'mens',
      name: { en: "Men's Doubles", id: 'Ganda Putra' },
      short: { en: "Men's", id: 'Putra' },
      format: 'knockout', colour: '#2f7fe0', status: 'open',
      thirdPlace: true, finalBetweenTopTwo: false,
      scoring: SCORING.standard, finalScoring: SCORING.final,
    },
  ];

  const players = [];
  const teams = [];

  const addPairs = (divisionId, pairs) => pairs.forEach(([a, b], i) => {
    const p1 = { id: uid('p'), tournamentId: tournament.id, name: a };
    const p2 = { id: uid('p'), tournamentId: tournament.id, name: b };
    players.push(p1, p2);
    teams.push({ id: uid('tm'), divisionId, player1Id: p1.id, player2Id: p2.id, seed: i + 1 });
  });

  addPairs('div_w', WOMEN);
  addPairs('div_m', MEN);

  const wTeams = teams.filter((t) => t.divisionId === 'div_w');
  const mTeams = teams.filter((t) => t.divisionId === 'div_m');

  const wRR = buildRoundRobin('div_w', wTeams.map((t) => t.id));
  const wPlayoffs = buildRRPlayoffs('div_w', wRR, { thirdPlace: true, final: true });
  const mKO = buildKnockout('div_m', mTeams.map((t) => t.id), { thirdPlace: true });

  const matches = [...wRR, ...wPlayoffs, ...mKO];
  const { blocks } = buildOrderOfPlay(
    matches,
    tournament.blocks.map((b) => ({ ...b, slotMinutes: tournament.slotMinutes })),
  );

  const menBlock = blocks.find((b) => b.divisionId === 'div_m');
  if (menBlock && menBlock.endTime > tournament.courtCloses) {
    // eslint-disable-next-line no-console
    console.warn(
      `Men's block ends ${menBlock.endTime}, after the ${tournament.courtCloses} court closing time. `
      + 'Move its start earlier or shorten match formats.',
    );
  }

  return { tournament, divisions, players, teams, matches, log: [] };
}
