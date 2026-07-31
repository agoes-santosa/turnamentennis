// seed.mjs — writes (or rewrites) the tournament into Firestore.
//
// Run this once before the event, and again any time the roster changes. It
// uses the Firebase Admin SDK, which authenticates with a service account and
// bypasses firestore.rules entirely -- that's expected: this is the one place
// structural data (players, teams, the schedule) is allowed to be written
// from outside the console.
//
// Re-running is a full replace, not an append: every existing division,
// player, team and match document is deleted first, then the current
// js/seed-data.js content is written fresh. PINs are left untouched unless
// you pass --admin-pin / --scorer-pin explicitly.
//
// Setup:
//   1. Firebase Console -> Project Settings -> Service Accounts
//      -> Generate new private key. Save the file as service-account.json
//      in this folder. (It's in .gitignore -- never commit it.)
//   2. npm install
//   3. node seed.mjs                                   -- keeps existing PINs
//      node seed.mjs --admin-pin=170826 --scorer-pin=1717   -- sets/changes PINs
//
// PINs are hashed with SHA-256 before they touch Firestore, and the plaintext
// is never written anywhere or logged back to the terminal.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildSeed } from './js/seed-data.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
);

if (!existsSync('./service-account.json')) {
  console.error(
    '\nservice-account.json not found.\n' +
    'Firebase Console -> Project Settings -> Service Accounts -> Generate new private key,\n' +
    'save the download as service-account.json in this folder, then run this again.\n',
  );
  process.exit(1);
}

const adminPin = args['admin-pin'];
const scorerPin = args['scorer-pin'];

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function clearCollection(path) {
  const snap = await db.collection(path).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  return snap.size;
}

async function main() {
  const { tournament, divisions, players, teams, matches } = buildSeed();
  const tid = tournament.id;

  const cleared = {
    divisions: await clearCollection(`tournaments/${tid}/divisions`),
    players: await clearCollection(`tournaments/${tid}/players`),
    teams: await clearCollection(`tournaments/${tid}/teams`),
    matches: await clearCollection(`tournaments/${tid}/matches`),
  };

  const batch = db.batch();

  // adminPin/scorerPin are local-mode-only fields on the seed object --
  // strip them before writing; Firebase mode keeps hashes in `pins` instead.
  const { adminPin: _a, scorerPin: _s, ...tournamentDoc } = tournament;
  batch.set(db.doc(`tournaments/${tid}`), tournamentDoc);

  for (const d of divisions) batch.set(db.doc(`tournaments/${tid}/divisions/${d.id}`), d);
  for (const p of players) batch.set(db.doc(`tournaments/${tid}/players/${p.id}`), p);
  for (const t of teams) batch.set(db.doc(`tournaments/${tid}/teams/${t.id}`), t);
  for (const m of matches) batch.set(db.doc(`tournaments/${tid}/matches/${m.id}`), m);

  if (adminPin) {
    batch.set(db.doc(`pins/${tid}`), {
      adminHash: sha256Hex(adminPin),
      scorerHash: scorerPin ? sha256Hex(scorerPin) : null,
    });
  }

  await batch.commit();

  const clearedTotal = Object.values(cleared).reduce((a, b) => a + b, 0);
  console.log(`\nSeeded "${tournament.name}" (${matches.length} matches) into Firestore.`);
  if (clearedTotal) {
    console.log(`Replaced previous data: ${cleared.divisions} divisions, ${cleared.players} players, ${cleared.teams} teams, ${cleared.matches} matches.`);
  }
  console.log(`Tournament document: tournaments/${tid}`);
  console.log(adminPin ? (scorerPin ? 'Admin and scorer PINs set.' : 'Admin PIN set; no scorer PIN.') : 'PINs unchanged.');
  console.log('\nOpen index.html to see it live.\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
