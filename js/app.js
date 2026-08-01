// app.js — bootstrap, tab routing, and event delegation.

import { store, exportSeedJson } from './store.js';
import { makeT } from './i18n.js';
import {
  renderHeader, renderNowOnCourt, renderOrderOfPlay, renderDivision,
  renderInfo, renderSheet, renderPin,
} from './ui.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');

const ui = {
  tab: new URLSearchParams(location.search).get('tab') || 'op',
  sheet: null,          // { type:'match'|'pin', id?, mode? }
  pinError: null,
  attempts: 0,
  lockedUntil: 0,
  toast: null,
};

/* ------------------------------------------------------------------ */

function tabs() {
  const T = makeT(store.lang);
  const items = [
    { key: 'op', label: T('orderOfPlay') },
    ...store.state.divisions.map((d) => ({
      key: d.id,
      label: d.short[store.lang] ?? d.short.en,
      colour: d.colour,
    })),
    { key: 'info', label: T('info') },
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
  if (ui.tab === 'op') return renderOrderOfPlay();
  if (ui.tab === 'info') return renderInfo();
  if (store.division(ui.tab)) return renderDivision(ui.tab);
  return renderOrderOfPlay();
}

function render() {
  const focusId = document.activeElement?.id;
  app.innerHTML = renderHeader() + renderNowOnCourt() + tabs() + `<main class="main">${body()}</main>`;

  layer.innerHTML = ui.sheet
    ? (ui.sheet.type === 'pin' ? renderPin(ui.pinError) : renderSheet(ui.sheet.id, ui.sheet.mode))
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

  mode(el) { ui.sheet = { ...ui.sheet, mode: el.dataset.mode }; render(); },

  async save() {
    const h = Number(document.getElementById('sc-home')?.value) || 0;
    const a = Number(document.getElementById('sc-away')?.value) || 0;
    if (h === a) return toast(makeT(store.lang).lang === 'id' ? 'Skor tidak boleh seri' : 'Score cannot be a draw');
    await store.setScore(ui.sheet.id, [{ home: h, away: a }]);
    ui.sheet = null;
    render();
  },

  async pt(el) {
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const s = m.score?.sets?.[0] ?? { home: 0, away: 0 };
    const next = { home: Number(s.home) || 0, away: Number(s.away) || 0 };
    next[el.dataset.side]++;
    await store.setScore(ui.sheet.id, [next], { complete: false });
    render();
  },

  async undo() {
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const s = m.score?.sets?.[0] ?? { home: 0, away: 0 };
    const next = { home: Math.max(0, (Number(s.home) || 0)), away: Math.max(0, (Number(s.away) || 0)) };
    // Step back whichever side moved last is unknowable, so step the larger one.
    if (next.home >= next.away && next.home > 0) next.home--;
    else if (next.away > 0) next.away--;
    await store.setScore(ui.sheet.id, [next], { complete: false });
    render();
  },

  async finish() {
    const T = makeT(store.lang);
    const m = store.state.matches.find((x) => x.id === ui.sheet.id);
    const s = m.score?.sets?.[0] ?? { home: 0, away: 0 };
    if (s.home === s.away) return toast(store.lang === 'id' ? 'Skor tidak boleh seri' : 'Score cannot be a draw');
    const winner = s.home > s.away ? m.homeTeamId : m.awayTeamId;
    const name = store.team(winner)?.name ?? '';
    if (!confirm(`${T('endMatch')}\n\n${T('winnerIs')}: ${name}\n${s.home}–${s.away}`)) return;
    await store.setScore(ui.sheet.id, [s]);
    ui.sheet = null;
    render();
  },

  async reopen() {
    await store.reopen(ui.sheet.id);
    ui.sheet = null;
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
