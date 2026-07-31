// config.js — the only file you edit to go from local mode to a shared backend.
//
// Leave `apiKey` empty and the app runs entirely in this browser (localStorage).
// Everything works, but nothing is shared — good for setting the event up and
// trying it out before anyone else needs to see it.
//
// Fill this in from Firebase Console -> Project Settings -> General ->
// Your apps -> SDK setup and configuration, and the same app reads and writes
// Firestore instead, so spectators see scores live on their own phones.
// Setup steps, including running the seed script, are in README.md.

export const FIREBASE = {
  apiKey: 'AIzaSyDrgHQlTytyxHpZMS8DaSI_N9vOig1bl1k',
  authDomain: 'turnamen-tennis.firebaseapp.com',
  projectId: 'turnamen-tennis',
  storageBucket: 'turnamen-tennis.firebasestorage.app',
  messagingSenderId: '471826842440',
  appId: '1:471826842440:web:b1f105c41999056a54697d',
  // Firestore document id for the tournament -- must match seed.mjs and
  // firestore.rules. Fixed since this is a standalone, single-event app.
  tournamentId: 'turnamen-17an-tennis-casman',
};
