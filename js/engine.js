// engine.js — pure tournament logic. No DOM, no storage.
// Round-robin fixtures, knockout brackets, standings, and the single-court order of play.

export const STAGE = {
  RR: 'RR', R32: 'R32', R16: 'R16', QF: 'QF', SF: 'SF', F: 'F', P3: '3P',
};

// Stage order for display and dependency sorting.
const STAGE_RANK = { RR: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3P': 5, F: 6 };
export const stageRank = (s) => STAGE_RANK[s] ?? 0;

let _uid = 0;
export const uid = (p = 'm') => `${p}_${Date.now().toString(36)}_${(_uid++).toString(36)}`;

/* ------------------------------------------------------------------ *
 * Round robin
 * ------------------------------------------------------------------ */

export function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

/**
 * Circle method. Returns an array of rounds; each round is an array of [a, b] pairs.
 * With an odd count one team sits out each round.
 */
export function roundRobinRounds(ids) {
  const t = [...ids];
  if (t.length % 2) t.push(null);
  const n = t.length;
  if (n < 2) return [];
  const half = n / 2;
  let rot = t.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const list = [t[0], ...rot];
    const round = [];
    for (let i = 0; i < half; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) round.push([a, b]);
    }
    rounds.push(round);
    rot.unshift(rot.pop());
  }
  // Reverse so the first fixture involves the first two teams — friendlier to read.
  return rounds.reverse();
}

/** Flat list of RR match objects for a division. */
export function buildRoundRobin(divisionId, teamIds) {
  const rounds = roundRobinRounds(teamIds);
  const out = [];
  rounds.forEach((round, ri) => {
    round.forEach(([home, away]) => {
      out.push({
        id: uid('rr'),
        divisionId,
        stage: STAGE.RR,
        rrRound: ri + 1,
        label: `RR${out.length + 1}`,
        homeTeamId: home,
        awayTeamId: away,
        homeSource: null,
        awaySource: null,
        deps: [],
        status: 'scheduled',
        score: null,
        winnerTeamId: null,
        isBye: false,
        nextMatchId: null,
        nextSlot: null,
      });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Knockout
 * ------------------------------------------------------------------ */

/**
 * Standard bracket seeding order, built by recursive reflection:
 * [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6] ...
 * Guarantees seed 1 and seed 2 can only meet in the final, and that byes
 * (seeds beyond the entry count) land on the strongest seeds.
 */
export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

function roundStages(rounds) {
  // Name rounds from the final backwards.
  const back = [STAGE.F, STAGE.SF, STAGE.QF, STAGE.R16, STAGE.R32];
  const out = [];
  for (let i = 0; i < rounds; i++) out.unshift(back[i] ?? `R${2 ** (i + 1)}`);
  return out;
}

/**
 * Build a full single-elimination bracket in one pass.
 * `teamIds` is in seed order (index 0 = seed 1). Missing slots become byes.
 * Returns { matches } with next-match links already wired and byes pre-advanced.
 *
 * `seeded: false` builds the full bracket structure -- every round, every
 * dependency link -- but leaves round 1 genuinely undetermined (`TBA` on
 * both sides) instead of seating teamIds immediately. Use this when the
 * actual matchups haven't been decided yet; the schedule (which stage plays
 * when) doesn't depend on who's in it, so there's nothing else to defer.
 */
export function buildKnockout(divisionId, teamIds, { thirdPlace = false, seeded = true } = {}) {
  const n = teamIds.length;
  if (n < 2) return [];
  const size = nextPow2(n);
  const order = seedOrder(size);
  const slots = order.map((seed) => teamIds[seed - 1] ?? null); // null = bye
  const rounds = Math.log2(size);
  const stages = roundStages(rounds);

  const byRound = [];
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1);
    const row = [];
    for (let i = 0; i < count; i++) {
      row.push({
        id: uid('ko'),
        divisionId,
        stage: stages[r],
        label: `${stages[r]}${count > 1 ? i + 1 : ''}`,
        homeTeamId: null,
        awayTeamId: null,
        homeSource: null,
        awaySource: null,
        deps: [],
        status: 'scheduled',
        score: null,
        winnerTeamId: null,
        isBye: false,
        nextMatchId: null,
        nextSlot: null,
      });
    }
    byRound.push(row);
  }

  // Seat round 1 -- or leave it TBA if the draw hasn't happened yet.
  if (seeded) {
    byRound[0].forEach((m, i) => {
      m.homeTeamId = slots[i * 2];
      m.awayTeamId = slots[i * 2 + 1];
    });
  } else {
    for (const m of byRound[0]) {
      m.homeSource = { type: 'tba' };
      m.awaySource = { type: 'tba' };
    }
  }

  // Wire each match to its parent.
  for (let r = 0; r < rounds - 1; r++) {
    byRound[r].forEach((m, i) => {
      const parent = byRound[r + 1][Math.floor(i / 2)];
      m.nextMatchId = parent.id;
      m.nextSlot = i % 2 === 0 ? 'home' : 'away';
      parent.deps.push(m.id);
      const slot = m.nextSlot === 'home' ? 'homeSource' : 'awaySource';
      parent[slot] = { type: 'winner', matchId: m.id, label: m.label };
    });
  }

  const matches = byRound.flat();

  // Third-place match, fed by the two semifinal losers.
  if (thirdPlace && rounds >= 2) {
    const semis = byRound[rounds - 2];
    matches.push({
      id: uid('ko'),
      divisionId,
      stage: STAGE.P3,
      label: '3P',
      homeTeamId: null,
      awayTeamId: null,
      homeSource: { type: 'loser', matchId: semis[0].id, label: semis[0].label },
      awaySource: { type: 'loser', matchId: semis[1].id, label: semis[1].label },
      deps: semis.map((s) => s.id),
      status: 'scheduled',
      score: null,
      winnerTeamId: null,
      isBye: false,
      nextMatchId: null,
      nextSlot: null,
    });
  }

  // Walk byes forward: a round-1 match with exactly one team is already decided.
  for (const m of byRound[0]) {
    const hasHome = !!m.homeTeamId, hasAway = !!m.awayTeamId;
    if (hasHome !== hasAway) {
      m.isBye = true;
      m.status = 'completed';
      m.winnerTeamId = m.homeTeamId || m.awayTeamId;
    }
  }
  propagate(matches);
  return matches;
}

/**
 * Push completed-match winners (and 3rd-place losers) into their next slots.
 * Idempotent — safe to run after every score change.
 */
export function propagate(matches) {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const ordered = [...matches].sort((a, b) => stageRank(a.stage) - stageRank(b.stage));

  for (const m of ordered) {
    if (m.status !== 'completed' || !m.winnerTeamId) continue;
    if (m.nextMatchId) {
      const parent = byId.get(m.nextMatchId);
      if (parent) parent[m.nextSlot === 'home' ? 'homeTeamId' : 'awayTeamId'] = m.winnerTeamId;
    }
  }

  // Losers into the third-place match. Note the loop: `matches` may span several
  // divisions, so every 3P match needs handling, not just the first one found.
  for (const third of matches.filter((m) => m.stage === STAGE.P3)) {
    for (const slot of ['home', 'away']) {
      const src = third[`${slot}Source`];
      if (!src || src.type !== 'loser') continue;
      const feeder = byId.get(src.matchId);
      if (feeder?.status === 'completed' && feeder.winnerTeamId) {
        const loser = feeder.homeTeamId === feeder.winnerTeamId ? feeder.awayTeamId : feeder.homeTeamId;
        third[`${slot}TeamId`] = loser || null;
      }
    }
  }

  // A bye that only resolves once its feeder does.
  for (const m of matches) {
    if (m.stage === STAGE.RR || m.status === 'completed') continue;
    const hasHome = !!m.homeTeamId, hasAway = !!m.awayTeamId;
    const homeDecided = !m.homeSource || hasHome;
    const awayDecided = !m.awaySource || hasAway;
    if (homeDecided && awayDecided && hasHome !== hasAway && m.deps.length === 0) {
      m.isBye = true;
      m.status = 'completed';
      m.winnerTeamId = m.homeTeamId || m.awayTeamId;
    }
  }
  return matches;
}

/* ------------------------------------------------------------------ *
 * Playoffs for a round-robin division
 * ------------------------------------------------------------------ */

/**
 * Bronze (#3 v #4) and final (#1 v #2), both fed by the completed RR table.
 *
 * `optional: true` marks these as not required to close out the division —
 * the RR standings alone are a legitimate final result (see §4.4/§4.6 of the
 * PRD). Used for Women's, where playing them risks pushing into the hottest
 * part of the late morning; skip-if-hot rather than mandatory.
 */
export function buildRRPlayoffs(divisionId, rrMatches, { thirdPlace = true, final = true, optional = false } = {}) {
  const deps = rrMatches.map((m) => m.id);
  const out = [];
  const mk = (stage, label, hs, as) => ({
    id: uid('po'),
    divisionId,
    stage,
    label,
    homeTeamId: null,
    awayTeamId: null,
    homeSource: { type: 'standing', rank: hs, label: `#${hs}` },
    awaySource: { type: 'standing', rank: as, label: `#${as}` },
    deps: [...deps],
    status: 'scheduled',
    score: null,
    winnerTeamId: null,
    isBye: false,
    optional,
    nextMatchId: null,
    nextSlot: null,
  });
  if (thirdPlace) out.push(mk(STAGE.P3, '3P', 3, 4));
  if (final) out.push(mk(STAGE.F, 'F', 1, 2));
  return out;
}

/** Fill playoff slots once every RR match is complete. */
export function seedRRPlayoffs(matches, teams) {
  const rr = matches.filter((m) => m.stage === STAGE.RR);
  if (!rr.length || rr.some((m) => m.status !== 'completed')) return matches;
  const table = standings(teams, rr);
  for (const m of matches) {
    for (const slot of ['home', 'away']) {
      const src = m[`${slot}Source`];
      if (src?.type !== 'standing') continue;
      m[`${slot}TeamId`] = table[src.rank - 1]?.teamId ?? null;
    }
  }
  return matches;
}

/* ------------------------------------------------------------------ *
 * Standings
 * ------------------------------------------------------------------ */

/** Games won/lost from a score object: { sets: [{home, away}], retired? }. */
function tally(score) {
  let h = 0, a = 0;
  for (const s of score?.sets ?? []) { h += Number(s.home) || 0; a += Number(s.away) || 0; }
  return [h, a];
}

export function matchWinner(match) {
  if (!match.score) return null;
  const [h, a] = tally(match.score);
  if (h === a) return null;
  return h > a ? match.homeTeamId : match.awayTeamId;
}

/**
 * Standings from completed matches only. Playoff matches are excluded by the
 * caller — the table reflects the round robin, not the knockout on top of it.
 *
 * Ranked by: wins -> point/game differential -> head-to-head (among any still
 * tied on both) -> ratio. Differential sits above head-to-head deliberately:
 * it rewards how a pair performed across all their matches, not just the one
 * result between two tied pairs (which can turn on a single bad game).
 * This matters more now that the decider matches are optional for Women's —
 * the table itself may be the final result, not just a tiebreak feeding into
 * one.
 */
export function standings(teams, matches) {
  const rows = new Map();
  for (const t of teams) {
    rows.set(t.id, {
      teamId: t.id, played: 0, wins: 0, losses: 0, gf: 0, ga: 0, beat: new Set(),
    });
  }

  for (const m of matches) {
    if (m.status !== 'completed' || m.isBye) continue;
    const home = rows.get(m.homeTeamId), away = rows.get(m.awayTeamId);
    if (!home || !away) continue;
    const [h, a] = tally(m.score);
    home.played++; away.played++;
    home.gf += h; home.ga += a;
    away.gf += a; away.ga += h;
    const w = m.winnerTeamId ?? matchWinner(m);
    if (w === m.homeTeamId) { home.wins++; away.losses++; home.beat.add(m.awayTeamId); }
    else if (w === m.awayTeamId) { away.wins++; home.losses++; away.beat.add(m.homeTeamId); }
  }

  const list = [...rows.values()].map((r) => ({
    ...r,
    diff: r.gf - r.ga,
    ratio: r.gf + r.ga > 0 ? r.gf / (r.gf + r.ga) : 0,
  }));

  // Sort on everything except head-to-head first: wins, then differential, then ratio.
  list.sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.ratio - a.ratio);

  // Then resolve blocks still tied on BOTH wins and differential by head-to-head.
  const out = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j + 1 < list.length && list[j + 1].wins === list[i].wins && list[j + 1].diff === list[i].diff) j++;
    const block = list.slice(i, j + 1);
    if (block.length > 1) {
      const h2h = new Map(block.map((r) => [
        r.teamId,
        block.reduce((n, o) => n + (o.teamId !== r.teamId && r.beat.has(o.teamId) ? 1 : 0), 0),
      ]));
      block.sort((a, b) => (h2h.get(b.teamId) - h2h.get(a.teamId)) || b.ratio - a.ratio);
    }
    out.push(...block);
    i = j + 1;
  }

  return out.map((r, idx) => ({ ...r, rank: idx + 1, beat: undefined }));
}

/* ------------------------------------------------------------------ *
 * Order of play — one court, one queue
 * ------------------------------------------------------------------ */

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Schedule one division's matches into a sequential run on the shared court,
 * starting its own clock at `start`. Blocks don't overlap or interleave —
 * each is used when divisions play in strict sequence (e.g. "finish all of
 * Women's, then start Men's") rather than alternating.
 *
 * Two different kinds of gap are handled, deliberately differently:
 *
 *  - Dependency gap (`gapMinutes`, default 0): time between a match's last
 *    feeder finishing and the match itself starting. Zero by default because
 *    results are computed by the app the instant a score is saved — there is
 *    no human tally to wait on, unlike a manually-kept paper standings table.
 *
 *  - Rest gap (`restMinutes`, default 15): only inserted when the SAME pair
 *    would otherwise play two matches with literally zero break between them.
 *    For a 4-team round robin this is mathematically unavoidable at least
 *    twice — each match has exactly one "safe" non-overlapping partner match,
 *    so some adjacent pair in any ordering must repeat a team. Rather than
 *    let that repeat happen with zero rest, a short breather is inserted
 *    right before it. (A knockout bracket doesn't have this problem: entrants
 *    are disjoint within a round by construction.)
 *
 * A bye has no match to play, so it consumes no schedule slot at all — its
 * result is known the moment the bracket is built, not on the day.
 */
function scheduleBlock(matches, {
  start, slotMinutes, gapMinutes = 0, restMinutes = 15, resolved = [], prevMatch = null,
}) {
  const byes = matches.filter((m) => m.isBye);
  const real = matches.filter((m) => !m.isBye);
  for (const m of real) { m.playOrder = undefined; m.startTime = undefined; }

  const doneAt = new Map(byes.map((m) => [m.id, -Infinity]));
  // `resolved` seeds already-known results (from a live reflow -- see
  // reflowAfterStart) so matches depending on them see the real finish time,
  // not just what the original once-at-seed-time plan assumed.
  for (const m of resolved) {
    if (m.status === 'completed' && m.startTime) doneAt.set(m.id, toMin(m.startTime) + slotMinutes);
  }
  const teamsOf = (m) => [m.homeTeamId, m.awayTeamId].filter(Boolean);
  const readyAt = (m) => (m.deps.length
    ? Math.max(...m.deps.map((d) => (doneAt.get(d) ?? Infinity) + gapMinutes))
    : -Infinity);

  const pending = [...real].sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
  const placed = [];
  let clock = toMin(start);

  while (placed.length < real.length) {
    const ready = pending.filter((m) => !doneAt.has(m.id) && readyAt(m) <= clock);
    if (!ready.length) {
      const upcoming = pending.filter((m) => !doneAt.has(m.id));
      const nextReady = Math.min(...upcoming.map(readyAt));
      // Nothing left can ever become ready in this pass -- it's waiting on a
      // match that's in progress but not yet resolved (a live reflow only,
      // never at seed time), so its winner genuinely isn't known yet. Leave
      // it TBD -- undefined startTime, same as its still-unresolved team
      // slots -- rather than looping forever or computing NaN:NaN.
      if (!Number.isFinite(nextReady)) break;
      clock = nextReady;
      continue;
    }

    const prev = placed[placed.length - 1] ?? prevMatch;
    const prevTeams = prev ? teamsOf(prev) : [];
    const safe = ready.find((m) => !teamsOf(m).some((t) => prevTeams.includes(t)));
    const pick = safe ?? ready[0];
    if (!safe && prev && teamsOf(pick).some((t) => prevTeams.includes(t))) clock += restMinutes;

    pick.startTime = toHHMM(clock);
    doneAt.set(pick.id, clock + slotMinutes);
    placed.push(pick);
    clock += slotMinutes;
  }

  return { placed, endTime: toHHMM(clock) };
}

/**
 * Re-flow the still-`scheduled` matches in one division against whatever's
 * actually happened so far -- a recreational event where players arrive late
 * or leave early, so the true sequence on court drifts from what was
 * printed. Reads the division's *current* state rather than needing to be
 * told what just changed, so it's safe to call after any of: a match begins
 * out of order, a match completes (which can unblock a dependent that was
 * previously TBD -- see scheduleBlock's early-exit), or nothing relevant
 * changed at all (a no-op, since nothing pending needs to move). Matches
 * already completed or in progress keep their own times untouched.
 */
export function reflowDivision(divisionMatches, { slotMinutes, gapMinutes = 0, restMinutes = 15, defaultStart }) {
  const resolved = divisionMatches.filter((m) => m.isBye || m.status === 'completed');
  const occupied = divisionMatches.filter((m) => m.status !== 'scheduled' && !m.isBye);
  const pending = divisionMatches.filter((m) => m.status === 'scheduled' && !m.isBye);
  if (!pending.length) return [];

  const lastEnd = occupied.length
    ? Math.max(...occupied.map((m) => toMin(m.startTime) + slotMinutes))
    : toMin(defaultStart);
  const prevMatch = occupied.length
    ? occupied.reduce((a, b) => (toMin(a.startTime) > toMin(b.startTime) ? a : b))
    : null;

  const { placed } = scheduleBlock(pending, {
    start: toHHMM(lastEnd), slotMinutes, gapMinutes, restMinutes, resolved, prevMatch,
  });
  return placed;
}

/**
 * Build the full day's order of play from one or more sequential blocks.
 * `blocks`: [{ divisionId, start, slotMinutes, gapMinutes?, restMinutes? }],
 * scheduled in the order given — each is a fully separate run on the court,
 * not interleaved with any other block. Returns the combined, globally
 * renumbered queue plus a per-block summary (useful for a feasibility check,
 * e.g. confirming a hard end-of-day cutoff isn't exceeded).
 */
export function buildOrderOfPlay(matches, blocks) {
  const queue = [];
  const summary = [];

  for (const block of blocks) {
    const divMatches = matches.filter((m) => m.divisionId === block.divisionId);
    const { placed, endTime } = scheduleBlock(divMatches, block);
    queue.push(...placed);
    summary.push({ divisionId: block.divisionId, start: block.start, endTime, count: placed.length });
  }

  queue.forEach((m, i) => { m.playOrder = i + 1; });

  return { queue, blocks: summary };
}

/** Capacity check for the feasibility line in the wizard. */
export function feasibility({ count, slotMinutes, start, dayEnd, breakMinutes = 0 }) {
  const need = count * slotMinutes + breakMinutes;
  const have = toMin(dayEnd) - toMin(start);
  const slack = Math.floor((have - need) / slotMinutes);
  return {
    need, have, slack,
    finish: toHHMM(toMin(start) + need),
    level: slack < 0 ? 'bad' : slack <= 1 ? 'warn' : 'ok',
  };
}

export const fmt = { toMin, toHHMM };
