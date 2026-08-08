// store.js — state, persistence, and the two adapters.
//
// `local` keeps everything in localStorage so the app is fully usable before
// any backend exists. `firebase` swaps in once config.js has a project — same
// calls, same shapes, so nothing above this file needs to know which is active.

import {
  propagate, seedRRPlayoffs, standings, reflowDivision, fmt, STAGE, uid,
} from './engine.js';
import { buildSeed } from './seed-data.js';
import { FIREBASE } from './config.js';

const KEY = 'casman17.v1';

export { buildSeed };

/* ------------------------------------------------------------------ *
 * Local adapter
 * ------------------------------------------------------------------ */

const localAdapter = {
  name: 'local',
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupt or unavailable — fall through to a fresh seed */ }
    const seed = buildSeed();
    await this.save(seed);
    return seed;
  },
  async save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode */ }
    return state;
  },
  async reset() {
    localStorage.removeItem(KEY);
    return this.load();
  },
  // Local mode has no separate event log store -- the entry already lives in
  // state.eventLog by the time this is called, and save() persists the whole
  // state object, so there's nothing extra to do here.
  async appendEvent() {},
  // PIN checks run client-side here. Fine for local mode, which has nothing
  // shared to protect. The Firebase adapter verifies against a stored hash.
  async verifyPin(state, pin) {
    if (pin === state.tournament.adminPin) return 'admin';
    if (state.tournament.scorerPin && pin === state.tournament.scorerPin) return 'scorer';
    return null;
  },
  subscribe() { return () => {}; },
};

/* ------------------------------------------------------------------ *
 * Firebase adapter — activated by filling in config.js
 *
 * Security model (chosen deliberately over Cloud Functions, which need the
 * paid Blaze plan): PIN hashes live in a public `pins/{tournamentId}` document
 * — SHA-256, unsalted, since a 6-digit PIN's keyspace is small enough that
 * salting buys nothing against brute force. The browser hashes the entered PIN
 * and compares it itself.
 *
 * That alone would be too weak to gate writes with, because a plain field
 * value could be read back and replayed by anyone. So writes are gated
 * differently: on a correct PIN, the browser signs in anonymously (Firebase
 * Auth, free, unlimited) and writes a session document keyed by its own
 * unforgeable auth uid. Firestore rules check `request.auth.uid` — which the
 * server itself verifies from the ID token — never a value the client sends,
 * so there is nothing to steal from a public read. See firestore.rules.
 * ------------------------------------------------------------------ */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function firebaseAdapter() {
  let db, auth;
  let fns = {};

  const ready = (async () => {
    const [{ initializeApp }, firestore, authMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    ]);
    const app = initializeApp(FIREBASE);
    db = firestore.getFirestore(app);
    auth = authMod.getAuth(app);
    fns = { ...firestore, ...authMod };
  })();

  const tRef = () => fns.doc(db, 'tournaments', FIREBASE.tournamentId);
  const sub = (name) => fns.collection(db, 'tournaments', FIREBASE.tournamentId, name);

  const hydrate = async () => {
    // divisions is explicitly ordered -- Firestore's default (no orderBy) is
    // by document ID, and 'div_m' sorts before 'div_w' alphabetically, which
    // silently put Men's before Women's everywhere division order matters
    // (tabs, Info's schedule line) despite Women's playing first.
    const [tSnap, dSnap, pSnap, tmSnap, mSnap, eSnap] = await Promise.all([
      fns.getDoc(tRef()),
      fns.getDocs(fns.query(sub('divisions'), fns.orderBy('order'))),
      fns.getDocs(sub('players')),
      fns.getDocs(sub('teams')),
      fns.getDocs(fns.query(sub('matches'), fns.orderBy('playOrder'))),
      fns.getDocs(fns.query(sub('eventLog'), fns.orderBy('at', 'desc'), fns.limit(50))),
    ]);
    const asRows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return {
      tournament: { id: tSnap.id, ...tSnap.data() },
      divisions: asRows(dSnap),
      players: asRows(pSnap),
      teams: asRows(tmSnap),
      matches: asRows(mSnap),
      eventLog: asRows(eSnap),
      log: [],
    };
  };

  return {
    name: 'firebase',
    async load() { await ready; return hydrate(); },

    async save(state) {
      await ready;
      // Scoring one match can change several others — a winner advancing, a bye
      // resolving, playoff slots seeding off the table. Rather than diff which
      // ones moved, write every match each time; at 16 documents this is cheap
      // and it keeps the client's recomputed view authoritative everywhere.
      const batch = fns.writeBatch(db);
      for (const m of state.matches) {
        batch.set(fns.doc(db, 'tournaments', FIREBASE.tournamentId, 'matches', m.id), {
          homeTeamId: m.homeTeamId ?? null,
          awayTeamId: m.awayTeamId ?? null,
          // Fixed at seed time and never changes afterward -- included here
          // for completeness alongside the rest of the match doc.
          homeSource: m.homeSource ?? null,
          awaySource: m.awaySource ?? null,
          status: m.status,
          score: m.score ?? null,
          winnerTeamId: m.winnerTeamId ?? null,
          isBye: !!m.isBye,
          playOrder: m.playOrder ?? null,
          startTime: m.startTime ?? null,
        }, { merge: true });
      }
      await batch.commit();
      return state;
    },

    /** One quarterfinal-draw event, appended to the shared, append-only
     * eventLog collection so every browser sees the same draw history. */
    async appendEvent(entry) {
      await ready;
      await fns.setDoc(fns.doc(db, 'tournaments', FIREBASE.tournamentId, 'eventLog', entry.id), entry);
    },

    async reset() {
      // Local-only concept. A live event's data is seeded and reset with
      // seed.mjs (which uses the Admin SDK and bypasses these rules on
      // purpose) — the browser has no permission to wipe tournament data.
      return this.load();
    },

    async verifyPin(_state, pin) {
      await ready;
      const hash = await sha256Hex(pin);
      const pinsSnap = await fns.getDoc(fns.doc(db, 'pins', FIREBASE.tournamentId));
      if (!pinsSnap.exists()) return null;
      const { adminHash, scorerHash } = pinsSnap.data();
      const role = hash === adminHash ? 'admin' : hash === scorerHash ? 'scorer' : null;
      if (!role) return null;

      if (!auth.currentUser) await fns.signInAnonymously(auth);
      const uidAuth = auth.currentUser.uid;
      await fns.setDoc(fns.doc(db, 'sessions', uidAuth), {
        tournamentId: FIREBASE.tournamentId,
        role,
        pinHash: hash,
        expiresAt: fns.Timestamp.fromMillis(Date.now() + 12 * 60 * 60 * 1000),
      });
      return role;
    },

    subscribe(onChange) {
      let unsub = () => {};
      ready.then(() => { unsub = fns.onSnapshot(sub('matches'), () => onChange()); });
      return () => unsub();
    },
  };
}

export const adapter = FIREBASE.apiKey && FIREBASE.projectId ? firebaseAdapter() : localAdapter;

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const store = {
  state: null,
  role: null,          // null | 'scorer' | 'admin'
  lang: localStorage.getItem('casman.lang') || 'id',
  listeners: new Set(),

  async init() {
    this.state = await adapter.load();
    this.recompute();
    const role = sessionStorage.getItem('casman.role');
    if (role) this.role = role;
    adapter.subscribe(async () => {
      this.state = await adapter.load();
      this.recompute();
      this.emit();
    });
    return this.state;
  },

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) fn(this.state); },

  async persist() {
    await adapter.save(this.state);
    this.emit();
  },

  /** Re-derive everything downstream of the match results. */
  recompute() {
    const { matches, teams } = this.state;
    propagate(matches);
    for (const d of this.state.divisions) {
      if (d.format !== 'round_robin') continue;
      seedRRPlayoffs(matches.filter((m) => m.divisionId === d.id), this.teamsOf(d.id));
    }
    // Division status follows its matches. Optional matches (Women's
    // bronze/final, skippable if it's too hot) don't block completion --
    // the round robin standings are a legitimate result on their own.
    for (const d of this.state.divisions) {
      const ms = matches.filter((m) => m.divisionId === d.id);
      const required = ms.filter((m) => !m.optional);
      const done = required.length > 0 && required.every((m) => m.status === 'completed');
      const started = ms.some((m) => m.status !== 'scheduled');
      d.status = done ? 'completed' : started ? 'live' : d.status === 'draft' ? 'draft' : 'open';
    }
    const requiredAll = matches.filter((m) => !m.optional);
    const all = requiredAll.length > 0 && requiredAll.every((m) => m.status === 'completed');
    const any = matches.some((m) => m.status !== 'scheduled');
    if (this.state.tournament.status !== 'draft') {
      this.state.tournament.status = all ? 'completed' : any ? 'live' : 'open';
    }
    void teams;
  },

  /* -------- selectors -------- */

  teamsOf(divisionId) { return this.state.teams.filter((t) => t.divisionId === divisionId); },
  matchesOf(divisionId) { return this.state.matches.filter((m) => m.divisionId === divisionId); },
  division(id) { return this.state.divisions.find((d) => d.id === id); },
  player(id) { return this.state.players.find((p) => p.id === id); },

  team(id) {
    const t = this.state.teams.find((x) => x.id === id);
    if (!t) return null;
    return { ...t, name: this.teamName(t) };
  },

  teamName(team) {
    if (!team) return null;
    const a = this.player(team.player1Id)?.name ?? '?';
    const b = this.player(team.player2Id)?.name ?? '?';
    return `${a} / ${b}`;
  },

  /** Ordered queue across both divisions. */
  orderOfPlay() {
    return [...this.state.matches]
      .filter((m) => !m.isBye)
      .sort((a, b) => (a.playOrder ?? 999) - (b.playOrder ?? 999));
  },

  liveMatch() { return this.orderOfPlay().find((m) => m.status === 'in_progress') ?? null; },
  nextMatch() { return this.orderOfPlay().find((m) => m.status === 'scheduled') ?? null; },

  standingsOf(divisionId) {
    const rr = this.matchesOf(divisionId).filter((m) => m.stage === STAGE.RR);
    return standings(this.teamsOf(divisionId), rr);
  },

  /**
   * Who won the division, or null if that isn't decided yet. Two paths to a
   * result: the final was actually played, or (for an optional final that
   * was explicitly skipped) the round-robin standings serve as the result --
   * never guessed while the match is merely still sitting unplayed, since an
   * organizer might still choose to play it.
   */
  championOf(divisionId) {
    const div = this.division(divisionId);
    const fin = this.matchesOf(divisionId).find((m) => m.stage === STAGE.F);
    if (!fin) return null;
    if (fin.status === 'completed' && fin.winnerTeamId) {
      return { teamId: fin.winnerTeamId, viaStandings: false };
    }
    if (fin.optional && fin.status === 'skipped' && div?.format === 'round_robin') {
      const top = this.standingsOf(divisionId)[0];
      return top ? { teamId: top.teamId, viaStandings: true } : null;
    }
    return null;
  },

  progress() {
    const all = this.state.matches.filter((m) => !m.isBye);
    const done = all.filter((m) => m.status === 'completed' || m.status === 'skipped').length;
    return { done, total: all.length };
  },

  /* -------- mutations -------- */

  async unlock(pin) {
    const role = await adapter.verifyPin(this.state, pin);
    if (role) {
      this.role = role;
      sessionStorage.setItem('casman.role', role);
      this.emit();
    }
    return role;
  },

  lock() {
    this.role = null;
    sessionStorage.removeItem('casman.role');
    this.emit();
  },

  can(action) {
    if (this.state?.tournament.locked && this.role !== 'admin') return false;
    if (action === 'score') return this.role === 'scorer' || this.role === 'admin';
    return this.role === 'admin';
  },

  logEvent(action, detail) {
    this.state.log.unshift({
      id: uid('log'),
      at: new Date().toISOString(),
      actor: this.role ?? 'anon',
      action, detail,
    });
    this.state.log = this.state.log.slice(0, 200);
  },

  /**
   * Re-derive the schedule for one division from its current state -- a
   * recreational event, players arrive late or leave early, so the true
   * order on court drifts from the printed playOrder. Safe to call any time
   * something might have changed: a match beginning out of order, a match
   * completing (which can unblock a dependent that was left TBD -- see
   * engine.js's reflowDivision), or nothing relevant at all (a no-op).
   */
  _reflowDivision(divisionId) {
    const divMatches = this.matchesOf(divisionId);
    const block = this.state.tournament.blocks?.find((b) => b.divisionId === divisionId);
    reflowDivision(divMatches, {
      slotMinutes: this.state.tournament.slotMinutes,
      defaultStart: block?.start ?? '00:00',
    });
    this._renumberPlayOrder();
  },

  /** playOrder always follows actual startTime, recomputed after a reflow. */
  _renumberPlayOrder() {
    const real = this.state.matches.filter((m) => !m.isBye);
    real.sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'));
    real.forEach((m, i) => { m.playOrder = i + 1; });
  },

  /**
   * Pin `m` to whatever slot is actually next right now, then reflow the
   * rest of its division. Called from every path that moves a match off
   * 'scheduled' (the Start button, the first live point, or saving a
   * quick-entry score directly), so this happens exactly once regardless of
   * which one a referee actually uses. No-op if already begun.
   */
  _beginMatch(m) {
    if (m.status !== 'scheduled') return;
    const divMatches = this.matchesOf(m.divisionId);
    const occupied = divMatches.filter((x) => x.id !== m.id && x.status !== 'scheduled' && !x.isBye);
    const block = this.state.tournament.blocks?.find((b) => b.divisionId === m.divisionId);
    const lastEnd = occupied.length
      ? Math.max(...occupied.map((x) => fmt.toMin(x.startTime) + this.state.tournament.slotMinutes))
      : fmt.toMin(block?.start ?? '00:00');
    m.startTime = fmt.toHHMM(lastEnd);
    m.status = 'in_progress';
    this._reflowDivision(m.divisionId);
  },

  async startMatch(matchId) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m || m.status !== 'scheduled') return;
    this._beginMatch(m);
    m.score = { sets: [{ home: 0, away: 0 }] };
    this.logEvent('start', m.label);
    this.recompute();
    await this.persist();
  },

  async setScore(matchId, sets, { complete = true } = {}) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m) return;
    this._beginMatch(m);
    const before = m.score ? summarise(m.score) : '—';
    m.score = { sets };
    if (complete) {
      const h = sets.reduce((n, s) => n + (Number(s.home) || 0), 0);
      const a = sets.reduce((n, s) => n + (Number(s.away) || 0), 0);
      if (h !== a) {
        m.status = 'completed';
        m.winnerTeamId = h > a ? m.homeTeamId : m.awayTeamId;
        // Completing a match can unblock a dependent left TBD -- e.g. a
        // semifinal whose own time couldn't be known until this one's
        // winner was decided. Re-check now that it is.
        this._reflowDivision(m.divisionId);
      }
    } else {
      m.status = 'in_progress';
      m.winnerTeamId = null;
    }
    this.logEvent('score', `${m.label} ${before} → ${summarise(m.score)}`);
    this.recompute();
    await this.persist();
  },

  async reopen(matchId) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m) return;
    m.status = 'scheduled'; m.score = null; m.winnerTeamId = null;
    this.logEvent('reopen', m.label);
    this.recompute();
    await this.persist();
  },

  /**
   * Explicitly mark an optional match as not being played (e.g. Women's
   * bronze/final, skipped for heat). Distinct from leaving it "scheduled" --
   * a scheduled match still looks like something waiting to happen, which
   * would leave `nextMatch()` pointing at it forever if nobody ever starts
   * it. Skipping is a real decision with a visible record, not a limbo state.
   */
  async skipOptional(matchId) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m?.optional) return;
    m.status = 'skipped'; m.score = null; m.winnerTeamId = null;
    this.logEvent('skip', m.label);
    this.recompute();
    await this.persist();
  },

  async unskip(matchId) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m || m.status !== 'skipped') return;
    m.status = 'scheduled';
    this.logEvent('unskip', m.label);
    this.recompute();
    await this.persist();
  },

  async reset() {
    this.state = await adapter.reset();
    this.recompute();
    this.emit();
  },

  setLang(lang) {
    this.lang = lang;
    localStorage.setItem('casman.lang', lang);
    this.emit();
  },
};

export function summarise(score) {
  if (!score?.sets?.length) return '—';
  return score.sets.map((s) => `${s.home}-${s.away}`).join(' ');
}

/** Dumps the current state as JSON — handy for a manual backup or for diffing
 * against what seed.mjs would write. Not used by the app itself. */
export function exportSeedJson(state = store.state) {
  return JSON.stringify(state, null, 2);
}
