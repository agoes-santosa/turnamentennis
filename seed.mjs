// seed.mjs — writes (or rewrites) the tournament into Firestore.
//
// Run this once before the event, and again any time you want to reset it
// back to the placeholder data. It uses the Firebase Admin SDK, which
// authenticates with a service account and bypasses firestore.rules entirely
// -- that's expected: this is the one place structural data (players, teams,
// the schedule) is allowed to be written from outside the console.
//
// Setup:
//   1. Firebase Console -> Project Settings -> Service Accounts
//      -> Generate new private key. Save the file as service-account.json
//      in this folder. (It's in .gitignore -- never commit it.)
//   2. npm install
//   3. node seed.mjs --admin-pin=YOUR6DIGITS --scorer-pin=YOUR4DIGITS
//
// Both PINs are hashed with SHA-256 before they touch Firestore, and the
// plaintext is never written anywhere or logged back to the terminal.

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
if (!adminPin) {
  console.error('\nUsage: node seed.mjs --admin-pin=170826 --scorer-pin=1717\n' +
    '(scorer PIN is optional -- omit it and only the admin PIN can score)\n');
  process.exit(1);
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const { tournament, divisions, players, teams, matches } = buildSeed();
  const tid = tournament.id;
  const batch = db.batch();

  // adminPin/scorerPin are local-mode-only fields on the seed object --
  // strip them before writing; Firebase mode keeps hashes in `pins` instead.
  const { adminPin: _a, scorerPin: _s, ...tournamentDoc } = tournament;
  batch.set(db.doc(`tournaments/${tid}`), tournamentDoc);

  for (const d of divisions) batch.set(db.doc(`tournaments/${tid}/divisions/${d.id}`), d);
  for (const p of players) batch.set(db.doc(`tournaments/${tid}/players/${p.id}`), p);
  for (const t of teams) batch.set(db.doc(`tournaments/${tid}/teams/${t.id}`), t);
  for (const m of matches) batch.set(db.doc(`tournaments/${tid}/matches/${m.id}`), m);

  batch.set(db.doc(`pins/${tid}`), {
    adminHash: sha256Hex(adminPin),
    scorerHash: scorerPin ? sha256Hex(scorerPin) : null,
  });

  await batch.commit();

  console.log(`\nSeeded "${tournament.name}" (${matches.length} matches) into Firestore.`);
  console.log(`Tournament document: tournaments/${tid}`);
  console.log(scorerPin ? 'Admin and scorer PINs set.' : 'Admin PIN set; no scorer PIN.');
  console.log('\nNext: fill in js/config.js with your web app config, then open index.html.\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
