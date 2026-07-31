# Turnamen 17-an Tennis Casman

Mobile-first tournament board. One link for everyone: spectators watch the
progress, organizers unlock with a PIN and enter scores on the same page.

**17 August 2026 · one court · two sequential blocks, not concurrent**

| Division | Format | Pairs | Matches | Starts |
|---|---|---|---|---|
| Ganda Putri | Round robin + bronze + final | 4 | 8 | 07:00 |
| Ganda Putra | Knockout + bronze | 7 | 7 | 17:00 |

Women's plays to completion first (finishes ~11:30), then a long gap, then
Men's runs 17:00 → 20:30 — comfortably inside the court's 21:00 closing time,
with 30 minutes of slack. Men's has an odd pair count, so the top seed
(Irfan/Agoes) gets a bye straight to the semifinal — a bye plays no match and
costs no schedule slot.

A 4-team round robin has a mathematical quirk worth knowing: it's provably
impossible to schedule all 6 matches back-to-back on one court without at
least two of them repeating a pair with zero rest — every match has exactly
one non-overlapping "safe" partner match, so some adjacent pair must always
clash. The scheduler detects the two unavoidable clashes and inserts a
15-minute breather right before each, rather than letting a pair walk off one
match straight into another.

Requirements are in [PRD.md](PRD.md).

---

## Run it locally

No build step. Any static server works — it just needs to serve over HTTP,
because ES modules do not load from `file://`.

```bash
python -m http.server 5599
```

Then open `http://localhost:5599`.

---

## Two modes

**Local mode (default).** `js/config.js` is empty, so everything lives in
`localStorage` in one browser. Fully working — good for setting up the event and
trying it out — but nothing is shared, so spectators would see nothing.

**Shared mode.** Fill in `js/config.js` and the same app reads and writes
Firestore, with scores appearing live on every phone. Setup below.

---

## Going live on Firebase

### 1. Create the project

You've already done this ("Turnamen Tennis" in the Firebase console). Two
things to enable inside it:

- **Firestore Database** — Build → Firestore Database → Create database.
  Start in production mode (the rules below replace the defaults).
- **Authentication → Sign-in method → Anonymous** — toggle it on. The app uses
  this to tell browsers apart when granting write access; nobody sees a login
  screen or creates an account.

Both are available on the free **Spark** plan. This app never needs Cloud
Functions, so there's no reason to enable the paid **Blaze** plan.

### 2. Deploy the security rules

[`firestore.rules`](firestore.rules) locks the database down: anyone can read,
nobody can write directly. Writes to match scores go through a session check
instead — see the comments at the top of the file for exactly how, and the
note on PIN security below for the trade-off it makes.

Easiest path: **Firestore Database → Rules** tab in the console, paste the
contents of `firestore.rules`, click Publish. (Or use the Firebase CLI —
`firebase deploy --only firestore:rules` — if you have it installed.)

### 3. Seed the event

The seed script writes the tournament, both divisions, all 11 pairs, and all
16 match documents (15 of which are real matches — the men's bracket has one
bye) in one shot, and sets your PINs as hashes (never plaintext).

1. **Project Settings → Service Accounts → Generate new private key.** Save
   the downloaded file as `service-account.json` in this folder. It's already
   in `.gitignore` — never commit it, it's a full-access credential.
2. `npm install`
3. First time: `node seed.mjs --admin-pin=YOUR6DIGITS --scorer-pin=YOUR4DIGITS`

Re-run it any time the roster or schedule changes (edit `js/seed-data.js`
first, then re-run). It's a full replace, not an append — every existing
division, player, team, and match document is deleted and rewritten fresh, so
there's never stale data left behind from a previous seed. Run it with no
flags — `node seed.mjs` — to keep your existing PINs; only pass
`--admin-pin`/`--scorer-pin` again if you actually want to change them.

### 4. Connect the app

**Project Settings → General → Your apps → Add app (Web)** if you haven't
registered one yet. Copy the config object it gives you into
[`js/config.js`](js/config.js):

```js
export const FIREBASE = {
  apiKey: "...",
  authDomain: "turnamen-tennis.firebaseapp.com",
  projectId: "turnamen-tennis",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  tournamentId: 'turnamen-17an-tennis-casman',
};
```

This is safe to publish in the client — it identifies the project, it doesn't
grant access on its own.

### 5. Deploy

Deploy the folder to Netlify (drag-and-drop, or connect the repo). No build
command, publish directory `.`.

---

## PINs

| PIN | Who gets it | Can do |
|---|---|---|
| Admin | You | Everything the app currently supports write access for |
| Scorer | Whoever runs the court | Enter and fix scores only |

Set at seed time (`node seed.mjs --admin-pin=... --scorer-pin=...`). Hand out
the *scorer* PIN, not the admin one.

### How PIN security actually works here — read this before the event

There's no server backend running (no Cloud Functions — they need the paid
Blaze plan), so PIN verification happens **in the browser**: the entered PIN
is hashed with SHA-256 and compared against a hash stored in Firestore, which
is *publicly readable* because the browser has to read it to do that
comparison itself.

That alone wouldn't be enough to protect writes — a plain value in a public
document could be read and reused by anyone. So write access uses a second,
separate mechanism: a correct PIN makes the browser sign in anonymously
(a free, accountless Firebase Auth session) and register itself as a session
tied to *that specific browser's* unforgeable identity. Firestore's security
rules check that identity server-side — it's not something a client can fake
by reading data back or editing JavaScript, unlike the PIN hash. Full detail
in the comments at the top of `firestore.rules`.

Net effect: **the PIN hash itself is exposed** (by design — nothing sensitive
depends on it staying secret, since a 6-digit PIN's entire keyspace is a
million values and crackable in under a second regardless of hashing), but
**write access cannot be forged or replayed** by someone who only has read
access to the database. That is a meaningfully different, and much better,
guarantee than "the PIN looks obscured," even though it started from a
weaker starting point than a server-verified design would have.

What this setup still doesn't give you: an audit trail identifying *people*
(the event log records browser sessions, not names), and revocation (a leaked
PIN is valid for anyone until you reseed with a new one). Fine for a club
event; not a substitute for real authentication if this ever needs to protect
something with higher stakes.

---

## Before the event

- [x] Real player names in `js/seed-data.js` — 4 women's pairs, 7 men's pairs
- [ ] Confirm the date — 17 Aug 2026 is assumed from "17-an"
- [ ] Fill in the venue name, address, and Google Maps link (also in
      `seed-data.js`, or added later once an in-app admin editor exists)
- [ ] If an 8th men's pair shows up, add it to `MEN` in `seed-data.js` and
      re-run `node seed.mjs` — the bracket goes back to a clean field of 8
      (no bye), which shifts the schedule later by one 30-minute slot
- [ ] Share the link and QR (the Share button in the header) to the venue wall

---

## How it fits together

```
index.html        shell
app.css            all styling, mobile-first, dark + light
js/config.js       the only file you edit to switch to Firestore
js/seed-data.js    the event itself — pairs, divisions, scoring config
js/engine.js       pure logic — fixtures, brackets, standings, order of play
js/store.js        state, persistence, local + Firebase adapters
js/ui.js           render functions (HTML strings)
js/app.js          bootstrap, tabs, event delegation
js/i18n.js         Bahasa + English
firestore.rules    Firestore security rules — public read, session-gated write
seed.mjs           Node script (Admin SDK) that writes the event into Firestore
package.json       only for seed.mjs's one dependency, firebase-admin
```

`engine.js` and `seed-data.js` have no DOM, storage, or backend dependency, so
the tournament maths can be exercised straight from the console:

```js
const e = await import('./js/engine.js');
e.seedOrder(8);          // [1,8,4,5,2,7,3,6] — seeds 1 and 2 meet only in the final
```

or from Node, which is exactly what `seed.mjs` does with `buildSeed()`.

### Notes on the logic

- **Standings** rank by wins → head-to-head → game difference → ratio.
  Head-to-head sits above game difference deliberately: in a 4-pair table it is
  the fairest split and the one players expect.
- **Standings are derived**, never stored, so the table cannot disagree with the
  match results.
- **The bracket auto-advances.** Scoring a semifinal fills the final and drops
  the loser into the bronze match. Byes resolve immediately.
- **The women's playoffs seed themselves** once all six group matches are in.
- **Order of play** runs as sequential blocks (`tournament.blocks` in
  `js/seed-data.js` — currently Women's at 07:00, then Men's at 17:00), each
  with its own start clock. Within a block, knockout dependencies are
  respected and a pair is never scheduled into two consecutive slots unless
  that's mathematically unavoidable (see the 4-team round robin note above),
  in which case a short rest gap is inserted instead of a silent clash.

---

## Roadmap

Built: order of play, live "Now On Court" hero, standings, bracket, quick and
live scoring, PIN unlock via Firebase, bilingual UI.

Next: admin screens for editing players and pairs in-app (right now that means
editing `seed-data.js` and re-running the seed script), drag-to-reorder the
schedule, the `/screen` projector view, and per-stage scoring config in the UI
(the data model already carries it).
