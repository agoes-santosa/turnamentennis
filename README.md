# Turnamen 17-an Tennis Casman

Mobile-first tournament board. One link for everyone: spectators watch the
progress, organizers unlock with a PIN and enter scores on the same page.

**17 August 2026 · one court · two sequential blocks, not concurrent**

| Division | Format | Pairs | Matches | Starts |
|---|---|---|---|---|
| Ganda Putri | Round robin + **optional** bronze/final | 4 | 6 required + 2 optional | 07:00 |
| Ganda Putra | Knockout + bronze | 8 | 8 | 17:00 |

Women's plays to completion first (the 6 required group matches finish
~10:30), then a long gap, then Men's runs 17:00 → **21:00** — landing exactly
on the court's closing time, with **zero slack**. Men's is now a clean field
of 8 (no bye) — one more real match than the original 7-pair roster, and that
extra match used up the 30 minutes of buffer the schedule used to have. Any
delay, dispute, or a final that runs long pushes past closing time. Worth
deciding before the event: start Men's earlier than 17:00, or accept the
risk.

**Women's bronze and final are optional**, condensed to a quick 9-point
decider (~10 min) if played at all — matches 7 and 8 would otherwise land
right in the hottest part of late morning. The round-robin table is a
legitimate result on its own: an admin can tap **Skip (optional)** on either
match, and the champion is then read straight off the standings instead
(shown with a "(from standings)" note wherever it's displayed). See §4.6 of
the PRD for why the standings are ranked the way they are — it matters more
now that they might be the actual final result, not just a tiebreak feeding
into a match.

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

The seed script writes the tournament, both divisions, all 12 pairs, and all
16 real matches in one shot, and sets your PINs as hashes (never plaintext).

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

- [x] Real player names in `js/seed-data.js` — 4 women's pairs, 8 men's pairs
- [ ] Confirm the date — 17 Aug 2026 is assumed from "17-an"
- [ ] Fill in the venue name, address, and Google Maps link (also in
      `seed-data.js`, or added later once an in-app admin editor exists)
- [ ] **Decide on the men's zero-slack final.** With 8 pairs the men's final
      now ends at exactly 21:00, the court's closing time — no buffer for a
      delay, dispute, or a long final. Either start Men's earlier than 17:00,
      or accept the risk. If a 9th pair ever joins, the field goes back to
      having a bye (7-of-8 shape) and gets 30 minutes of slack back.
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

- **Standings** rank by wins → game difference → head-to-head → ratio.
  Differential sits above head-to-head deliberately: it rewards how a pair
  performed across all their matches, not just the one result between two
  tied pairs (which can turn on a single bad game) — and it matters more now
  that the standings might be the actual final result for Women's, not just a
  tiebreak feeding into a match.
- **Standings are derived**, never stored, so the table cannot disagree with the
  match results.
- **The bracket auto-advances.** Scoring a semifinal fills the final and drops
  the loser into the bronze match. Byes resolve immediately.
- **The women's playoffs seed themselves** once all six group matches are in —
  even if they end up being skipped, so the "would-be" matchup is still shown.
- **Skipping an optional match** (`store.skipOptional()`) is a real decision
  with a visible record, not just leaving it unplayed — a match left merely
  "scheduled" forever would leave the app waiting on something that's never
  coming. `store.championOf(divisionId)` resolves the winner from the final if
  it was played, or from the table if the final was explicitly skipped —
  never from a match that's just sitting unplayed, since an organizer might
  still choose to play it.
- **Quick-entry score fields start blank**, not pre-filled with "0". A field
  already containing "0" puts the cursor in an unpredictable spot on mobile —
  tapping "1" can land it before the existing digit and produce "10" instead
  of "1". Blank only applies when there's no score yet; reopening a match that
  already has a real score still shows it, since that's genuine data to edit.
- **Reset** (same underlying action as reopen, `store.reopen()`) is available
  for any match that isn't still sitting untouched — both a completed match
  (labelled "Reopen") and one a referee accidentally started scoring
  (labelled "Reset score"), so a stray tap on the wrong match doesn't need a
  developer to undo. Open to scorer or admin — it's a courtside undo, not a
  structural change like skip — and asks for confirmation first.
- **Play doesn't have to follow the printed order.** This is a recreational
  event — someone arrives late, someone leaves early, and the actual sequence
  on court will drift from `playOrder`. `store.startMatch()` flags *any*
  scheduled match as live immediately (score 0-0, status `in_progress`),
  regardless of where it sits in the schedule, via a **Start** button on that
  match's sheet. `liveMatch()` already searches every match for whichever one
  is `in_progress` rather than assuming it's the next one in sequence, so "Now
  On Court" reflects whichever match actually gets started, not the plan.
  Starting a second match while another is still marked live asks for
  confirmation first, in case the previous one was just left unfinished by
  mistake. `nextMatch()` still suggests the next untouched match in printed
  order — a reasonable default, not a constraint anyone has to follow.
- **Score entry and the match list both avoid showing a team's name twice.**
  Both quick-entry and live-scoring modes lay team names either side of their
  own scoring widget — team A left, team B right — rather than repeating a
  separate header block above. Live mode specifically: each name sits
  directly above its own `+1` button, not both names stacked together on one
  side. The Matches list shows each doubles pair as two stacked player lines
  (one per row) rather than the whole pair joined into one string, with the
  two sides sitting left and right instead of stacked top and bottom.
  `sideName()` (one joined string — bracket cards, the sheet header) and
  `teamLines()` (two separate lines — these two spots) share the same
  placeholder logic
  (`unresolvedLabel()`) for an undecided slot, so "Winner QF1" reads the same
  wherever it shows up.
- **Order of play** runs as sequential blocks (`tournament.blocks` in
  `js/seed-data.js` — currently Women's at 07:00, then Men's at 17:00), each
  with its own start clock. Within a block, knockout dependencies are
  respected and a pair is never scheduled into two consecutive slots unless
  that's mathematically unavoidable (see the 4-team round robin note above),
  in which case a short rest gap is inserted instead of a silent clash.
- **`_headers`** tells Netlify to send `Cache-Control: no-cache` on every
  file. This app has no build step and no hashed filenames, so without it a
  returning visitor's browser could keep running yesterday's JS after a
  deploy until they happened to hard-refresh.

---

## Roadmap

Built: live "Now On Court" hero, per-division standings and bracket (each
tab is its own complete schedule for that division — no separate combined
order-of-play view, removed as redundant once divisions stopped
interleaving), quick and live scoring, optional/skippable matches, PIN
unlock via Firebase, bilingual UI.

Next: admin screens for editing players and pairs in-app (right now that means
editing `seed-data.js` and re-running the seed script), drag-to-reorder the
schedule, the `/screen` projector view, and per-stage scoring config in the UI
(the data model already carries it).
