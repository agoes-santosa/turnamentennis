# Tournament Board — Product Requirements

**Status:** v1.0 — locked for build · 30 Jul 2026
**Owner:** Agoes
**Event:** Turnamen 17-an Tennis Casman
**Target:** live for 17 August 2026

**Changes in v1.0:** Event named and dated. One day confirmed. Both divisions get a bronze match and a final — 16 matches total, 30-minute slots, 08:00–16:45. Women's champion decided on court rather than by points (§4.4). Pairs display as `Player A / Player B`.

**Changes in v0.3:** Real event parameters — 1 court, 4 women's pairs (RR), 8 men's pairs (KO). Court-grid features cut and replaced with a single linear Order of Play; a live **Now On Court** hero becomes the centrepiece. Standalone app, bilingual.

---

## 1. Summary

A mobile-first web app to run and showcase a doubles tournament with two divisions playing concurrently on one court. Two audiences share one URL:

- **Spectators / players** open the link and watch progress — who's on court now, who's up next, standings, bracket — with no login and no PIN.
- **Organizers** enter a PIN on the same page and the UI unlocks editing in place.

Reference product: [recourt.id](https://recourt.id). We replicate its shape — public viewer plus organizer console, multiple divisions per event, round robin and knockout doubles, live standings, bracket diagram, preview-before-confirm draws — and drop accounts, clubs, billing, credits, streaming, and federation.

Standalone app. Firebase project ("Turnamen Tennis"), own repo, own Netlify site.

### The event

| | |
|---|---|
| Name | **Turnamen 17-an Tennis Casman** |
| Date | 17 August 2026 — one day *(confirm; "17-an" implies Independence Day)* |
| Venue | TBC |
| Divisions | **Women's Doubles** — 4 pairs, round robin + bronze + final · **Men's Doubles** — 8 pairs, knockout + bronze |
| Teams | Fixed pairs of two. Doubles only. Displayed as `Player A / Player B` — no team names. |
| Courts | **1** |
| Matches | 8 women's + 8 men's = **16** |
| Slot length | 30 min · 08:00–16:45 including a 45-min break |
| Language | Bahasa Indonesia + English |

Men's is "8 pairs so far," so the bracket must handle a changing entry count — 7 or 9 pairs needs byes. That logic stays in scope.

### Goals

1. Publish the tournament in under 5 minutes on a phone.
2. Anyone with the link can answer *"what's on court right now, and when do I play?"* in one glance, without tapping.
3. Score entry is fast enough to do courtside, one-handed, between games.
4. No account creation, ever — for anyone.
5. An organizer handed a PIN can start entering scores without being taught.

### Non-goals

Accounts, email, clubs, payments, sponsors, streaming/OBS, photo uploads, waivers, umpire invitations, singles matches, double-elimination, Swiss, cross-tournament seasons. **Also cut for this event specifically:** pools/groups (4 and 8 teams don't need them), multi-court scheduling grids, and court-conflict detection — one court makes all three meaningless.

---

## 2. Structure: one tournament, two divisions

Format lives on the **division**, not the tournament. That's what lets one event run a round robin and a knockout side by side.

```
Tournament — "<name TBC>", <dates TBC>, <venue TBC>
│   1 court · shared daily window · Admin PIN + Scorer PIN
│
├── Division: Women's Doubles          format: Round Robin
│   ├── 4 fixed pairs
│   ├── 6 fixtures — every pair plays every other once
│   └── Standings table (+ optional final between top 2)
│
└── Division: Men's Doubles            format: Knockout
    ├── 8 fixed pairs, optionally seeded
    ├── Bracket of 8 — 4 QF → 2 SF → Final (+ optional 3rd place)
    └── Winners
```

- **Players are tournament-level; teams are division-level.** Women's and men's rosters don't overlap here, but keeping this split costs nothing now and is painful to retrofit if a mixed division is ever added.
- Each division has its own **format, scoring config, status, and colour**. Colour is the primary wayfinding device everywhere — chips, match rows, order of play, bracket.
- Divisions share the one court and the daily time window. All 13 matches sit in **one sequential queue** (§4).
- Independent statuses: Women's RR can be complete while the men's final is still to come.

### Formats built

**Round Robin (Doubles)** — N pairs, N(N−1)/2 fixtures. Single or double RR. Fixture *ordering* is a real feature here, not an afterthought (§4.2). Optional final between the top two.

**Knockout (Doubles)** — single elimination, draw sizes 2–32. Non-powers-of-two get **byes** at standard bracket positions so top seeds get the walkover. Whole bracket generated in one action so every match can be scheduled before play starts. Positions assigned manually (tap slot, tap team; tap two filled slots to swap) or by **random draw with a spin animation** — cheap to build and genuinely good at the venue for an 8-pair draw. Winners auto-advance on completion; byes advance immediately. Optional 3rd-place match auto-filled from the semifinal losers.

Deferred, not needed for August: Pools → Knockout, Americano, Mexicano, League.

---

## 3. Access model — PINs instead of login

Three levels, per tournament:

| Level | How they get in | Can do |
|---|---|---|
| **Viewer** | Just the link | Read everything |
| **Scorer** | Scorer PIN | Enter and edit scores; nothing structural |
| **Admin** | Admin PIN | Everything: edit tournament and divisions, players, teams, generate fixtures, build the bracket, reorder play, publish, delete |

- PINs are 6 digits, set at creation. Admin PIN shown once with a copy button and a plain warning that losing it means losing edit access.
- **Use both.** Admin stays with you; Scorer goes to whoever is running the court. A mistyped score then can't delete a division.
- A PIN mints a short-lived device token (localStorage, 12-hour expiry). An `Admin mode · Exit` chip sits in the header while unlocked so nobody edits by accident.
- Verification is **server-side**; PINs stored hashed. The client never holds a PIN or decides its own permissions.
- Rate limit: 5 wrong attempts → 15-minute lockout per device + tournament.

### Handoff is a feature, since you're playing, not running it

- **Organizer quick-card** at `/help` — one screen, written for someone who has never seen the app: how to unlock, how to enter a score, how to fix a wrong one. Bilingual, shareable as a link or a screenshot into a WhatsApp group.
- **Degrade gracefully.** Assume partial maintenance. A missing score renders as a clean `—` with the match still listed — never a broken or empty screen. Standings compute from completed matches only, so a half-entered day still yields a correct table.
- **Event log** (`14:32 · MATCH 7 · score 6-4 → 6-3`) so mistakes are traceable rather than mysterious.
- **Lock tournament** switch to freeze all writes when the event ends.

**Honest note:** a 6-digit PIN is weak auth by design — the right trade-off here, but anyone who sees it in a group chat has edit rights, and the log identifies devices, not people. Handing out the Scorer PIN rather than the Admin PIN is the main mitigation; the log and the lock switch are the others.

---

## 4. The schedule — the hard constraint

One court, one day, 16 matches. Everything below follows from that.

### 4.1 Does it fit?

Match slots include changeover. Capacity on one court in a single day:

| Day window | 30 min slots | 45 min | 60 min |
|---|---|---|---|
| 08:00–17:00 (9 h) | 18 | 12 | 9 |
| 08:00–18:30 (10.5 h) | 21 | 14 | 10 |

Against demand of 16 matches:

- **60 min per match: does not fit.** Not close.
- **45 min: does not fit** — 16 matches would need 12 hours before breaks.
- **30 min: fits.** 16 × 30 = 8 h, plus a 45-min break → **08:00–16:45**, with three spare slots before dark.

**Match format is the lever that makes 30-minute slots real**, so it is a requirement, not a preference:

| Division | Stage | Format | Typical duration |
|---|---|---|---|
| Women's | RR, bronze | One set to 4, no-ad, tiebreak at 4–4 | 20–25 min |
| Women's | Final | One set to 6, no-ad, tiebreak at 6–6 | 25–30 min |
| Men's | QF, SF, bronze | One set to 6, no-ad, tiebreak at 6–6 | 25–30 min |
| Men's | Final | One set to 6 + 10-pt super tiebreak if needed | 30–40 min |

Per-stage scoring config is therefore **required**, not a stretch: a single best-of-three anywhere in the draw breaks the day.

### 4.2 Order of Play

With one court there are no parallel rounds — just a **single ordered queue**. Three things it must get right:

**Interleave the divisions.** Alternating women's and men's matches keeps both progressing, keeps the day varied for spectators, and buys every pair a rest slot for free.

**Respect dependencies.** All four quarterfinals must complete before a semifinal; the whole women's RR must complete before its bronze and final. A match whose entrants aren't decided cannot be scheduled ahead of its feeders, and needs a slot of buffer after them.

**Protect rest.** No pair plays consecutive slots.

Generated order:

| # | Time | Div | Match |
|---|---|---|---|
| 1 | 08:00 | M | QF1 |
| 2 | 08:30 | W | RR1 — A v B |
| 3 | 09:00 | M | QF2 |
| 4 | 09:30 | W | RR2 — C v D |
| 5 | 10:00 | M | QF3 |
| 6 | 10:30 | W | RR3 — A v C |
| 7 | 11:00 | M | QF4 |
| 8 | 11:30 | W | RR4 — B v D |
| — | 12:00 | | **break, 45 min** |
| 9 | 12:45 | M | SF1 — QF1 v QF2 winners |
| 10 | 13:15 | W | RR5 — A v D |
| 11 | 13:45 | M | SF2 — QF3 v QF4 winners |
| 12 | 14:15 | W | RR6 — B v C |
| 13 | 14:45 | M | 🥉 3rd place |
| 14 | 15:15 | W | 🥉 3rd place |
| 15 | 15:45 | W | 🏆 **Final** |
| 16 | 16:15 | M | 🏆 **Final** |

Ends **16:45**. Every quarterfinalist gets 90+ minutes before a semifinal. The women's table is final at 14:45, giving 30 minutes before the bronze match and an hour before the final. Both finals close the day back to back, men's last.

The generator produces this automatically; the admin can drag to reorder and the queue renumbers itself.

### 4.3 What replaces the court grid

v0.2 specced a court × time matrix and a cross-division conflict detector. With one court, a matrix with one column is just a list, and two courts can't clash. **Both are cut**, replaced by:

- **Order of Play** — the linear queue above, the scheduling surface for admins and the schedule view for everyone.
- **Rest check** — a warning when a reorder would put the same pair in consecutive slots. The only conflict that can actually occur on one court.
- **Feasibility line** instead of a grid: `16 matches × 30 min = 8 h + 45 min break · 08:00 → 16:45 · fits with 3 slots slack`. Green/amber/red, updating live, with the levers named (`shorten matches`, `add a day`, `drop the bronze matches`).

### 4.4 Deciding the women's champion

A 4-pair round robin is only 6 matches, and each pair plays 3. Left as a pure table, the title can be settled by a tiebreak calculation rather than a match — a flat way to end a tournament. **The women's division therefore mirrors the men's: round robin, then a 3rd-place playoff (#3 v #4) and a final (#1 v #2).** Eight matches, four per pair, both divisions closing with a bronze and a final.

Rejected alternatives:

| Approach | Why not |
|---|---|
| Pure RR, top of table | Title can land on a tiebreak calculation, not a match |
| Total points / games won | Rewards padding the score in dead rubbers, penalises pairs whose matches ran short, and can crown a pair that lost head-to-head. Looks objective, feels least fair. |
| Page playoff (#1 v #2 → final; #3 v #4 → eliminator; loser Q1 v winner E → final) | Genuinely the fairest for 4 teams — it rewards topping the table with a second chance — but needs 4 extra matches and a ~10-hour day on one court |

**Known weakness of the chosen format:** the RR leader gets no advantage in the final, so a pair can top the group and lose the title to someone they already beat. Accepted for this event; the Page playoff is the fix if it ever runs across two days.

Both are per-division flags (`third_place`, `final_between_top_two`), so this is a config change, not a rebuild.

---

## 5. Screens

Mobile-first at 375px; desktop is the same layout widened. Primary actions in thumb reach, 44px minimum targets, bottom tab bar. Dark mode included — venues are bright and phones are dim.

### 5.1 Now On Court — the hero

The single-court constraint turns into the best feature of the product: **there is exactly one live match at any moment**, so the whole page can point at it. Pinned at the top of the tournament page:

```
┌─────────────────────────────────┐
│ ● LIVE          Women's · RR 3  │
│                                 │
│   Sari / Dewi            6      │
│   Rina / Putri           4      │
│                                 │
│ NEXT  Men's QF3 · ~11:00        │
│       Budi/Anto v Rio/Hasan     │
└─────────────────────────────────┘
```

Division colour on the border. Score updates live via realtime — no refresh. When nothing is live it shows the next match and a countdown. When the event is over it shows the two champions.

This is what "spectators can see the progress" means in practice, and it's only this clean *because* there's one court.

### 5.2 Home — tournament list

Sections Live / Upcoming / Past. Card per tournament: status chip, sport chip, name, venue city, dates, division chips (`Women's RR` · `Men's KO`), and a progress bar for live events (`8/14 matches`). Floating **+ New tournament**.

With a single fixed event, home may simply redirect to it — decided at build time.

### 5.3 Create tournament — 4-step wizard

**Step 1 — Details.** Name, description, sport, start/end dates, Admin PIN (required), Scorer PIN, venue name, city/province, street address, Google Maps link (paste a `maps.app.goo.gl` link → renders an **Open in Maps** button), cover image.

**Step 2 — Divisions.** Add a division, repeat: name, format (cards with a diagram each), expected pairs, scoring config, colour. Each shows its projected match count immediately — `Round Robin · 4 pairs · 6 matches`, `Knockout · 8 pairs · 7 matches` — feeding step 4.

**Step 3 — Court & times.** Courts (default 1), days, daily start/end, default match duration (30/45/60/75/90/120).

**Step 4 — Feasibility.** The line from §4.3, plus the generated Order of Play preview. Saves as **Draft**.

### 5.4 Tournament page — one URL for everyone

**Header:** cover image, name, status chip, sport chip, dates, **Share** (copies link, shows a QR code for the venue wall), venue block with Open in Maps.

**Now On Court** hero (§5.1).

**Tabs:**

| Tab | Scope | Contents |
|---|---|---|
| **Order of Play** | both divisions | The default tab. The full queue in one list, division-coloured, split by day, with a `NOW` marker and `Done / Live / Upcoming` states. Answers "when do I play?" — the most-asked question at the venue. |
| **Women's** | division | Standings table, its 6 fixtures, its pairs. |
| **Men's** | division | Bracket diagram, its 7 matches, its pairs. |
| **Info** | tournament | Description, rules, per-division format and scoring, venue, participant list, both PINs' purpose explained (not the PINs). |

Division tabs are named after the actual divisions rather than sitting behind a switcher — with two of them, tabs are fewer taps than a switcher plus tabs.

Admin-only tabs when unlocked: **Players**, **Schedule**, **Settings**.

### 5.5 Standings table on a phone

Recourt's 7 numeric columns (M / W / L / WP / LP / Ratio / Pts) do not fit 375px, and with 4 pairs and 6 matches they're overkill. Collapsed by default:

| # | Pair | P | W–L | Pts |
|---|---|---|---|---|

Tap a row to expand the full detail — games for, games against, ratio, and that pair's results match by match. Full columns still render on desktop.

**Tiebreakers matter enormously in a 4-pair round robin** — 6 matches, and two pairs at 2–1 is a likely outcome. Order:

1. Wins
2. **Head-to-head** result between the tied pairs
3. Net games (games won − games lost)
4. Games-won ratio

Head-to-head is added ahead of net games — in a table this small it's the fairest and most defensible tiebreak, and it's what players will expect. Recourt goes straight to points; that suits a 20-team Americano, not this.

### 5.6 Bracket

Two-sided diagram: quarterfinals fanning out left and right, converging on the Final, 3rd-place match below. Pinch-zoom, fit-to-screen, drag-pan, and fullscreen for projecting. A slot pulses when a pair advances. Active match shows `● LIVE`. Status borders — green scheduled, red live, grey complete. A bracket of 8 fits a phone screen at fit-to-screen without panning, which is worth checking early.

### 5.7 Admin: players, teams, fixtures

- **Players** — add by name only. Bulk paste, one name per line. Optional avatar initial + auto colour.
- **Teams** — per division. Pair two players; auto-named `Player A / Player B`, editable. Optional seed, used for bracket placement and byes.
- **Fixtures** — **Preview → Regenerate → Confirm** always. Nothing saves until Confirm, which is what makes a random draw safe to run in front of a crowd. Round robin generates all 6 with rest-maximising order; knockout runs the 3-step wizard (select pairs → assign positions, spin or manual → schedule stages).
- **Schedule** — the Order of Play, drag to reorder, with the rest check and dependency guard.

### 5.8 Match detail & scoring

Teams, score by set, division chip, time, status. Two entry modes for admin and scorer:

1. **Quick entry** (default) — type the final score, tap Save. Two taps. What a busy organizer will actually use.
2. **Live mode** — big `+1` per side, score large in the middle, `Undo` (unlimited while in progress), confirm dialog on the match-winning point showing winner and final score. Scoring a `scheduled` match flips it to `in progress` automatically, which drives the Now On Court hero.

With one court, live mode costs nothing to staff — there's only ever one match to score — so it's worth using throughout, not just for finals.

First-serve indicator: tap a side to set who serves, persists across refresh.

### 5.9 Big screen (stretch)

A `/screen` URL, no PIN, for a venue TV: the live score huge, order of play beside it, women's table and men's bracket rotating. Auto-refreshing, dark, large type.

---

## 6. Status lifecycle

`draft` → `open` → `live` → `completed`, plus `locked`. Tracked per division; the tournament shows the aggregate.

- **draft** — admin-only, not publicly listed, everything editable
- **open** — publicly visible; pairs and order of play shown, no scores
- **live** — scoring active
- **completed** — standings and winners frozen; **Winners by Division** block appears at the top (Champion / 2nd / 3rd)
- **locked** — all writes frozen; reversible

Transitions are **reversible**, unlike Recourt's one-way start. Going back from live to open should not be a crisis at a mabar.

---

## 7. Data model

```
tournament   id, slug, name, description, sport, status,
             start_date, end_date, venue_{name,city,province,address,maps_url},
             cover_url, courts, days, daily_start, daily_end, match_duration,
             admin_pin_hash, scorer_pin_hash, locked, created_at

division     id, tournament_id, name, name_id, format, status, colour, order,
             scoring_config (jsonb), third_place, final_between_top_two, draw_size

player       id, tournament_id, name                      -- tournament-level
team         id, division_id, name, player1_id, player2_id, seed

match        id, tournament_id, division_id, stage, label,
             home_team_id, away_team_id,
             home_source_label, away_source_label,        -- "Winner QF1"
             play_order, day, start_time, status,
             score (jsonb: sets/games/points), winner_team_id, is_bye,
             next_match_id, next_slot,
             scoring_config (nullable per-stage override)

event_log    id, tournament_id, at, actor_label, action, detail
```

Notes:

- `play_order` is the single integer that drives the Order of Play across both divisions. `match.tournament_id` is denormalised beside `division_id` so that ordering query stays trivial.
- `division.name_id` holds the Bahasa name alongside the English `name`.
- **Standings are derived** from completed matches, never stored — the table cannot disagree with the matches.
- No `pool`, `round`, or `court` tables. Not needed at this size; `stage` on the match covers `RR` / `QF` / `SF` / `F` / `3P`.

---

## 8. Architecture

**Static frontend on Netlify + Firebase (Firestore + Anonymous Auth)**, standalone repo and project. Changed from the originally-specced Supabase after Agoes created a Firebase project directly; the shape is equivalent — public read, gated write, live updates — but the write-gating mechanism differs because Firebase's server-side-verified equivalent (Cloud Functions) requires the paid Blaze plan and this event doesn't need to pay for one.

- **Firestore** for data; **security rules** grant public read on every collection and deny direct writes.
- **PIN verification runs client-side**, not server-side. The browser hashes the entered PIN (SHA-256) and compares it against a hash stored in a public `pins/{tournamentId}` document. This is a real reduction from the original server-verified design — the hash is publicly readable — but it's a reduction with limited consequence, since a 6-digit PIN's keyspace (10⁶) is crackable in under a second regardless of whether the hash is exposed or not, so salting or hiding the hash wouldn't have added meaningful protection anyway.
- **Writes are gated separately from the PIN check**, and this is the part that still holds real weight. A correct PIN makes the browser sign in with Firebase Anonymous Auth (free, accountless) and write a session document keyed by its own auth `uid`. Firestore rules check `request.auth.uid` — a value the *server* asserts from the signed-in session, not one the client sends — so nothing publicly readable (including the PIN hash, or a session document read back by a spectator) can be replayed to forge write access. The asymmetry is deliberate: the weak link (a small PIN keyspace) is accepted as unfixable within this budget; the link that *can* be made unforgeable (proving which browser is writing) is.
- **Firestore's `onSnapshot` listeners** drive the Now On Court hero, the Order of Play, standings, and the bracket without a refresh — the equivalent of Supabase Realtime.
- Free **Spark** plan is far more than enough for 16 matches; no billing account needed.
- **Seeding and structural edits** (the roster, venue, schedule window) go through `seed.mjs`, a Node script using the Firebase Admin SDK, which authenticates with a service-account key and bypasses the security rules by design — the same role Supabase's `service_role` key or a migration script would have played.

**Bilingual.** Bahasa Indonesia and English, toggle in the header, choice remembered. Bahasa is the default given the audience. Content fields that need both (division names, description) store both; UI strings come from one dictionary file.

---

## 9. Build phases

| Phase | Ships |
|---|---|
| **1 — Skeleton** | Firestore schema + rules, create wizard with divisions, tournament page shell, players, teams, PIN unlock, Netlify deploy, real event data seeded |
| **2 — Women's RR** | Fixture generation with preview/confirm and rest-maximising order, match list, quick score entry, standings with head-to-head tiebreak |
| **3 — Men's KO** | Bracket wizard, seeding, byes, spin draw, bracket diagram, auto-advance, 3rd-place match, per-stage scoring |
| **4 — Live** | Order of Play with drag reorder, Now On Court hero, live `+1` scoring with undo, realtime, share QR, status lifecycle, event log, organizer quick-card, bilingual |
| **5 — After August** | Big screen, Americano/Mexicano port, pools, multi-court support |

Phases 1–4 are the August build.

---

## 10. Settled

- **Event:** Turnamen 17-an Tennis Casman · 17 Aug 2026 · one day · 1 court
- **Divisions:** Women's Doubles, 4 pairs, RR + bronze + final · Men's Doubles, 8 pairs, knockout + bronze — concurrent, one tournament
- **Teams:** fixed pairs of two, displayed `Player A / Player B`; no team names
- **Matches:** 16 · 30-minute slots · 08:00–16:45 with a 45-min break
- **App:** standalone, Firebase (Firestore + Anonymous Auth) + Netlify
- **Language:** Bahasa + English
- **Role:** Agoes sets up and hands PINs to organizers; handoff and graceful degradation are requirements
- **Scoring:** quick entry default, live `+1` available per match; per-stage scoring **required** to hold 30-minute slots
- **Cut:** pools, court grids, cross-court conflict detection

## 11. Still open — none blocking

1. **Date confirmation** — seeded as 17 Aug 2026 on the strength of "17-an". Editable in the app.
2. **Venue** — name, city, address, Maps link. Seeded blank.
3. **Player names** — the 4 women's pairs and 8 men's pairs. Seeded as placeholders; bulk-paste entry is built for exactly this.
4. **Start time** — seeded 08:00. A later start compresses the tail; the feasibility line will flag it.
