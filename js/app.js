// app.js — bootstrap, tab routing, and event delegation.

import { store, exportSeedJson } from './store.js?v=2';
import { makeT } from './i18n.js?v=2';
import { setsWon } from './engine.js?v=2';
import {
  renderHeader, renderNowOnCourt, renderDivision,
  renderInfo, renderSheet, renderPin,
} from './ui.js?v=2';

const app = document.getElementById('app');
const layer = document.getElementById('layer');

const ui = {
  tab: new URLSearchParams(location.search).get('tab') || 'info',
  sheet: null,          // { type:'match'|'pin', id?, mode? }
  pinError: null,
  attempts: 0,
  lockedUntil: 0,
  toast: null,
};

/* ------------------------------------------------------------------ */

function tabs() {
  const T = makeT(store.lang);
  // Info first (read this before anything else), then divisions in the order
  // they're actually played -- Women's (07:00), then Men's (16:00).
  const items = [
    { key: 'info', label: T('info') },
    ...store.state.divisions.map((d) => ({
      key: d.id,
      label: d.short[store.lang] ?? d.short.en,
      colour: d.colour,
    })),
  ];
  return `<nav class="tabs" role="tablist">
      ${items.map((i) => `
        <button role="tab" aria-selected="${ui.tab === i.key}"
                class="tab ${ui.tab === i.key ? 'on' : ''}"
                ${i.colour ? `style="--c:${i.colour}"` : ''}
                data-act="tab" data-tab="${i.key}">${i.label}</button>`).join('')}
    </nav>`;
}

function body() {
  if (store.division(ui.tab)) return renderDivision(ui.tab);
  return renderInfo();
}

function render() {
  const focusId = document.activeElement?.id;
  app.innerHTML = renderHeader() + renderNowOnCourt() + tabs() + `<main class="main">${body()}</main>`;

  layer.innerHTML = ui.sheet
    ? (ui.sheet.type === 'pin' ? renderPin(ui.pinError) : renderSheet(ui.sheet.id, ui.sheet.mode, ui.sheet.points))
    : '';
  layer.hidden = !ui.sheet;

  if (ui.toast) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = ui.toast;
    layer.appendChild(el);
    setTimeout(() => { ui.toast = null; el.remove(); }, 1800);
  }

  if (focusId) document.getElementById(focusId)?.focus();
  const pin = document.getElementById('pin-input');
  if (pin && document.activeElement !== pin) pin.focus();
}

const toast = (msg) => { ui.toast = msg; render(); };

/** Split a match's recorded sets into the finished ones and the set still
 * being played (or about to start) -- the +1/+15/undo buttons only ever
 * touch that last one, leaving earlier finished sets untouched. */
function currentAndFinished(m) {
  const existing = m.score?.sets ?? [{ home: 0, away: 0 }];
  return { finished: existing.slice(0, -1), current: existing[existing.length - 1] ?? { home: 0, away: 0 } };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const actions = {
  tab(el) {
    ui.tab = el.dataset.tab;
    const url = new URL(location.href);
    url.searchParams.set('tab', ui.tab);
    history.replaceState(null, '', url);
    render();
  },

  lang() {
    store.setLang(store.lang === 'id' ? 'en' : 'id');
  },

  async share() {
    const T = makeT(store.lang);
    const data = { title: store.state.tournament.name, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); toast(T('linkCopied')); }
    } catch { /* user dismissed the share sheet */ }
  },

  pin() { ui.sheet = { type: 'pin' }; ui.pinError = null; render(); },

  lock() { store.lock(); },

  'close-sheet'() { ui.sheet = null; ui.pinError = null; render(); },

  async 'submit-pin'() {
    const T = makeT(store.lang);
    if (Date.now() < ui.lockedUntil) { ui.pinError = T('lockedOut'); return render(); }
    const val = document.getElementById('pin-input')?.value?.trim();
    const role = await store.unlock(val);
    if (role) {
      ui.sheet = null; ui.pinError = null; ui.attempts = 0;
      render();
    } else {
      ui.attempts++;
      if (ui.attempts >= 5) { ui.lockedUntil = Date.now() + 15 * 60 * 1000; ui.pinError = T('lockedOut'); }
      else ui.pinError = T('wrongPin');
      render();
    }
  },

  'open-match'(el) {
    ui.sheet = { type: 'match', id: el.dataset.id, mode: 'quick' };
    render();
  },

  mode(el) {
    ui.sheet = { ...ui.sheet, mode: el.dataset.mode };
    if (el.dataset.mode === 'live' && !ui.sheet.points) ui.sheet.points = { home: 0, away: 0 };
    render();
  },

  async start() {
    const already = store.liveMatch();
    if (already && already.id !== ui.sheet.id) {
      const msg = store.lang === 'id'
        ? `${already.label} masih ditandai berlangsung. Mulai pertandingan ini juga?`
        : `${already.label} is still marked live. Start this match too?`;
      if (!confirm(msg)) return;
    }
    await store.startMatch(ui.sheet.id);
    ui.sheet = { ...ui.sheet, mode: 'live', points: { home: 0, away: 0 } };
    render();
  },

  async save() {
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const setsToWin = store.division(m.divisionId).scoring?.setsToWin ?? 1;
    const maxSets = setsToWin * 2 - 1;
    const sets = [];
    for (let i = 0; i < maxSets; i++) {
      const hEl = document.getElementById(`sc-home-${i}`);
      const aEl = document.getElementById(`sc-away-${i}`);
      if (!hEl || !aEl) break;
      const hv = hEl.value.trim();
      const av = aEl.value.trim();
      if (hv === '' && av === '') break; // trailing set row never touched -- not played
      const hn = Number(hv) || 0, an = Number(av) || 0;
      if (hn === an) return toast(store.lang === 'id' ? 'Skor tidak boleh seri' : 'Score cannot be a draw');
      sets.push({ home: hn, away: an });
    }
    if (!sets.length) return;
    const [h, a] = setsWon({ sets });
    await store.setScore(ui.sheet.id, sets, { complete: h >= setsToWin || a >= setsToWin });
    ui.sheet = null;
    render();
  },

  async pt(el) {
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const { finished, current } = currentAndFinished(m);
    const next = { home: Number(current.home) || 0, away: Number(current.away) || 0 };
    next[el.dataset.side]++;
    await store.setScore(ui.sheet.id, [...finished, next], { complete: false });
    ui.sheet = { ...ui.sheet, points: { home: 0, away: 0 } };
    render();
  },

  /**
   * Point-by-point reminder for the current game (no-ad, so 0-15-30-40 with
   * no advantage stage) -- purely a courtside display, not persisted, since
   * only games (the `pt` action above) count toward the recorded set score.
   * Pressing +15 for a side already at 40 means they've just won the next
   * point, which under no-ad wins the game outright regardless of the other
   * side's point tally -- so it advances the real game score instead and
   * resets both sides back to 0.
   */
  async pt15(el) {
    const side = el.dataset.side;
    const points = ui.sheet.points ?? { home: 0, away: 0 };
    if (points[side] === 40) {
      const m = store.state.matches.find((x) => x.id === ui.sheet.id);
      const { finished, current } = currentAndFinished(m);
      const next = { home: Number(current.home) || 0, away: Number(current.away) || 0 };
      next[side]++;
      await store.setScore(ui.sheet.id, [...finished, next], { complete: false });
      ui.sheet = { ...ui.sheet, points: { home: 0, away: 0 } };
    } else {
      const steps = [0, 15, 30, 40];
      const nextVal = steps[steps.indexOf(points[side]) + 1];
      ui.sheet = { ...ui.sheet, points: { ...points, [side]: nextVal } };
    }
    render();
  },

  async undo() {
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const { finished, current } = currentAndFinished(m);
    const next = { home: Math.max(0, Number(current.home) || 0), away: Math.max(0, Number(current.away) || 0) };
    // Step back whichever side moved last is unknowable, so step the larger one.
    if (next.home >= next.away && next.home > 0) next.home--;
    else if (next.away > 0) next.away--;
    await store.setScore(ui.sheet.id, [...finished, next], { complete: false });
    render();
  },

  /**
   * Ends the current set. If that's enough sets for either side to reach
   * the division's setsToWin (e.g. 2 of 3), the match itself is over --
   * same confirm-then-close flow as before. Otherwise the match continues:
   * the just-finished set is locked in and a fresh empty set starts, with
   * the game and point trackers both reset to 0.
   */
  async finish() {
    const T = makeT(store.lang);
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const setsToWin = store.division(m.divisionId).scoring?.setsToWin ?? 1;
    const { finished, current } = currentAndFinished(m);
    if (current.home === current.away) return toast(store.lang === 'id' ? 'Skor tidak boleh seri' : 'Score cannot be a draw');
    const sets = [...finished, current];
    const [h, a] = setsWon({ sets });
    if (h >= setsToWin || a >= setsToWin) {
      const winner = h > a ? m.homeTeamId : m.awayTeamId;
      const name = store.team(winner)?.name ?? '';
      const scoreLine = sets.map((s) => `${s.home}–${s.away}`).join(' ');
      if (!confirm(`${T('endMatch')}\n\n${T('winnerIs')}: ${name}\n${scoreLine}`)) return;
      await store.setScore(ui.sheet.id, sets);
      ui.sheet = null;
    } else {
      const msg = store.lang === 'id'
        ? `Set selesai (${current.home}–${current.away}). Lanjut ke set berikutnya?`
        : `Set finished (${current.home}–${current.away}). Move to the next set?`;
      if (!confirm(msg)) return;
      await store.setScore(ui.sheet.id, [...sets, { home: 0, away: 0 }], { complete: false });
      ui.sheet = { ...ui.sheet, points: { home: 0, away: 0 } };
    }
    render();
  },

  async reopen() {
    const T = makeT(store.lang);
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    // Reopening a completed match keeps every set it already played (see
    // store.reopen), so there's nothing to lose and nothing to warn about.
    // An in_progress match's full wipe genuinely does discard any already-
    // finished sets, so that warning only needs teeth once there's
    // something real to lose.
    const finishedCount = m?.status === 'in_progress' ? Math.max(0, (m.score?.sets?.length ?? 0) - 1) : 0;
    const msg = m?.status === 'completed'
      ? `${T('reopen')}?`
      : finishedCount > 0
        ? (store.lang === 'id'
          ? `Ini akan menghapus semua ${finishedCount} set yang sudah selesai dan mengembalikan pertandingan ke belum mulai. Lanjutkan?`
          : `This will erase all ${finishedCount} set(s) already finished and return the match to not-started. Continue?`)
        : `${T('resetMatch')}?`;
    if (!confirm(msg)) return;
    await store.reopen(ui.sheet.id);
    ui.sheet = null;
    render();
  },

  async 'reset-set'() {
    const T = makeT(store.lang);
    if (!confirm(`${T('resetSet')}?`)) return;
    await store.resetCurrentSet(ui.sheet.id);
    ui.sheet = { ...ui.sheet, points: { home: 0, away: 0 } };
    render();
  },

  'reset-points'() {
    ui.sheet = { ...ui.sheet, points: { home: 0, away: 0 } };
    render();
  },

  async skip() {
    const T = makeT(store.lang);
    if (!confirm(T('skipMatch') + '?')) return;
    await store.skipOptional(ui.sheet.id);
    ui.sheet = null;
    render();
  },

  async unskip() {
    await store.unskip(ui.sheet.id);
    ui.sheet = null;
    render();
  },

  'toggle-row'(el) {
    const next = el.nextElementSibling;
    if (next?.classList.contains('st-detail')) next.hidden = !next.hidden;
  },
};

/* ------------------------------------------------------------------ */

function onEvent(e) {
  if (e.type === 'keydown') {
    if (e.key === 'Escape' && ui.sheet) { actions['close-sheet'](); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.tagName === 'INPUT' && e.key === ' ') return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el);
}

document.addEventListener('click', onEvent);
document.addEventListener('keydown', onEvent);

store.on(render);

store.init().then(() => {
  render();
  document.body.classList.remove('loading');
}).catch((err) => {
  console.error(err);
  app.innerHTML = `<div class="fatal">Gagal memuat / Failed to load.<br><small>${err.message}</small></div>`;
});

// Console helpers, documented in README.md.
window.resetTournament = () => store.reset();
window.exportSeedJson = () => { const s = exportSeedJson(); console.log(s); return s; };
