// store.js — state, persistence, and the two adapters.
//
// `local` keeps everything in localStorage so the app is fully usable before
// any backend exists. `firebase` swaps in once config.js has a project — same
// calls, same shapes, so nothing above this file needs to know which is active.

import {
  propagate, seedRRPlayoffs, standings, STAGE, uid,
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
    const [tSnap, dSnap, pSnap, tmSnap, mSnap] = await Promise.all([
      fns.getDoc(tRef()),
      fns.getDocs(sub('divisions')),
      fns.getDocs(sub('players')),
      fns.getDocs(sub('teams')),
      fns.getDocs(fns.query(sub('matches'), fns.orderBy('playOrder'))),
    ]);
    const asRows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return {
      tournament: { id: tSnap.id, ...tSnap.data() },
      divisions: asRows(dSnap),
      players: asRows(pSnap),
      teams: asRows(tmSnap),
      matches: asRows(mSnap),
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

  async setScore(matchId, sets, { complete = true } = {}) {
    const m = this.state.matches.find((x) => x.id === matchId);
    if (!m) return;
    const before = m.score ? summarise(m.score) : '—';
    m.score = { sets };
    if (complete) {
      const h = sets.reduce((n, s) => n + (Number(s.home) || 0), 0);
      const a = sets.reduce((n, s) => n + (Number(s.away) || 0), 0);
      if (h !== a) {
        m.status = 'completed';
        m.winnerTeamId = h > a ? m.homeTeamId : m.awayTeamId;
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
