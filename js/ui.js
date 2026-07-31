// ui.js — render functions. Each returns an HTML string; app.js wires events
// through delegation, so re-rendering is always safe.

import { store, summarise } from './store.js';
import { makeT } from './i18n.js';
import { STAGE, stageRank } from './engine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const t = () => makeT(store.lang);

/**
 * A team's display name, or — when the slot is undecided — a label saying where
 * its occupant comes from ("Pemenang PF1", "#1"). Never a blank cell: a pending
 * slot must read as pending, not as broken.
 */
function sideName(match, slot) {
  const T = t();
  const id = match[`${slot}TeamId`];
  if (id) return esc(store.team(id)?.name ?? '?');

  const src = match[`${slot}Source`];
  if (!src) return `<span class="tbd">${T('bye')}</span>`;

  let label;
  if (src.type === 'winner') label = `${T('winnerOf')} ${T.stageShort(srcStage(src.label))}${srcNum(src.label)}`;
  else if (src.type === 'loser') label = `${T('loserOf')} ${T.stageShort(srcStage(src.label))}${srcNum(src.label)}`;
  else label = src.label;

  return `<span class="tbd">${esc(label)}</span>`;
}

const srcStage = (label) => label.replace(/\d/g, '');
const srcNum = (label) => label.replace(/\D/g, '');

function statusClass(m) {
  if (m.status === 'completed') return 'done';
  if (m.status === 'in_progress') return 'live';
  return 'sched';
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

export function renderHeader() {
  const { tournament: tn } = store.state;
  const T = t();
  const prog = store.progress();
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const dateStr = new Date(tn.date + 'T00:00:00').toLocaleDateString(
    store.lang === 'id' ? 'id-ID' : 'en-GB',
    { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <header class="hdr">
      <div class="hdr-top">
        <div class="hdr-meta">
          <span class="chip chip-${tn.status}">${statusWord(tn.status)}</span>
          <span class="hdr-date">${esc(dateStr)}</span>
        </div>
        <div class="hdr-actions">
          <button class="icon-btn" data-act="lang" title="Bahasa / English">${store.lang === 'id' ? 'ID' : 'EN'}</button>
          <button class="icon-btn" data-act="share" title="${T('share')}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>
            </svg>
          </button>
          ${store.role
    ? `<button class="pill pill-admin" data-act="lock">${store.role === 'admin' ? T('adminMode') : T('scorerMode')} · ${T('exit')}</button>`
    : `<button class="pill" data-act="pin">${T('enterPin')}</button>`}
        </div>
      </div>
      <h1 class="hdr-title">${esc(tn.name)}</h1>
      <div class="hdr-sub">
        ${tn.venueName ? `<span>${esc(tn.venueName)}</span>` : `<span class="muted">${T('noVenue')}</span>`}
        <span class="dot">·</span><span>${tn.courts} ${T('court').toLowerCase()}</span>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="progress-label">${prog.done} ${T('of')} ${prog.total} ${T('matchesDone')}</div>
    </header>`;
}

function statusWord(s) {
  const T = t();
  return { open: T('scheduled'), live: T('live'), completed: T('finished'), draft: 'Draft' }[s] ?? s;
}

/* ------------------------------------------------------------------ *
 * Now on court — the hero
 * ------------------------------------------------------------------ */

export function renderNowOnCourt() {
  const T = t();
  const live = store.liveMatch();
  const next = store.nextMatch();
  const m = live ?? next;

  if (!m) {
    const champs = store.state.divisions.map((d) => {
      const fin = store.matchesOf(d.id).find((x) => x.stage === STAGE.F);
      if (!fin?.winnerTeamId) return '';
      return `<div class="champ-row">
          <span class="champ-div" style="--c:${d.colour}">${esc(d.short[store.lang] ?? d.short.en)}</span>
          <span class="champ-name">🏆 ${esc(store.team(fin.winnerTeamId)?.name ?? '')}</span>
        </div>`;
    }).join('');
    return `<section class="now now-done">
        <div class="now-label">${T('finished')}</div>
        ${champs || `<div class="now-empty">${T('notStarted')}</div>`}
      </section>`;
  }

  const div = store.division(m.divisionId);
  const isLive = m.status === 'in_progress';
  const sets = m.score?.sets ?? [];
  const hs = sets.reduce((n, s) => n + (Number(s.home) || 0), 0);
  const as = sets.reduce((n, s) => n + (Number(s.away) || 0), 0);
  const upNext = isLive && next ? next : null;

  return `
    <section class="now ${isLive ? 'is-live' : ''}" style="--c:${div.colour}">
      <div class="now-label">
        ${isLive ? `<span class="pulse"></span>${T('live')}` : `${T('next')} · ${esc(m.startTime ?? '')}`}
        <span class="now-div">${esc(div.short[store.lang] ?? div.short.en)} · ${t().stage(m.stage)}</span>
      </div>
      <div class="now-teams">
        <div class="now-team"><span>${sideName(m, 'home')}</span><b>${isLive ? hs : ''}</b></div>
        <div class="now-team"><span>${sideName(m, 'away')}</span><b>${isLive ? as : ''}</b></div>
      </div>
      ${upNext ? `<div class="now-next">${T('upNext')} · ${esc(upNext.startTime ?? '')} — ${sideName(upNext, 'home')} v ${sideName(upNext, 'away')}</div>` : ''}
      ${store.can('score') ? `<button class="now-cta" data-act="open-match" data-id="${m.id}">${T('tapToScore')}</button>` : ''}
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Order of play
 * ------------------------------------------------------------------ */

export function renderOrderOfPlay() {
  const T = t();
  const queue = store.orderOfPlay();
  const rows = queue.map((m, i) => {
    const div = store.division(m.divisionId);
    // Divisions now play as separate sequential blocks, not interleaved, so a
    // new block starting is the meaningful divider -- it replaces the old
    // single mid-day break marker.
    const prevDiv = i > 0 ? queue[i - 1].divisionId : null;
    const block = m.divisionId !== prevDiv
      ? `<li class="op-block" style="--c:${div.colour}">
           ${esc(div.name[store.lang] ?? div.name.en)} · ${T('startsAt')} ${esc(m.startTime ?? '')}
         </li>` : '';
    const score = m.status === 'completed' ? summarise(m.score) : '';
    const winner = m.winnerTeamId;
    return `${block}
      <li class="op-row ${statusClass(m)}" style="--c:${div.colour}"
          data-act="open-match" data-id="${m.id}" tabindex="0" role="button">
        <div class="op-time">
          <span class="op-order">${m.playOrder}</span>
          <span>${esc(m.startTime ?? '')}</span>
        </div>
        <div class="op-body">
          <div class="op-meta">
            <span class="op-div">${esc(div.short[store.lang] ?? div.short.en)}</span>
            <span class="op-stage">${t().stage(m.stage)}</span>
            ${m.status === 'in_progress' ? `<span class="op-livetag"><span class="pulse"></span>${T('live')}</span>` : ''}
          </div>
          <div class="op-pair ${winner && winner === m.homeTeamId ? 'won' : ''}">${sideName(m, 'home')}</div>
          <div class="op-pair ${winner && winner === m.awayTeamId ? 'won' : ''}">${sideName(m, 'away')}</div>
        </div>
        <div class="op-score">${esc(score)}</div>
      </li>`;
  }).join('');

  return `<ul class="op">${rows}</ul>`;
}

/* ------------------------------------------------------------------ *
 * Division views
 * ------------------------------------------------------------------ */

export function renderDivision(divisionId) {
  const div = store.division(divisionId);
  return div.format === 'round_robin'
    ? renderStandings(divisionId) + renderMatchList(divisionId)
    : renderBracket(divisionId) + renderMatchList(divisionId);
}

function renderStandings(divisionId) {
  const T = t();
  const div = store.division(divisionId);
  const table = store.standingsOf(divisionId);
  const rows = table.map((r) => {
    const team = store.team(r.teamId);
    return `<tr data-act="toggle-row" tabindex="0">
        <td class="st-rank">${r.rank}</td>
        <td class="st-pair">${esc(team?.name ?? '')}</td>
        <td class="st-num">${r.played}</td>
        <td class="st-num">${r.wins}–${r.losses}</td>
        <td class="st-num st-pts">${r.diff > 0 ? '+' : ''}${r.diff}</td>
      </tr>
      <tr class="st-detail" hidden>
        <td colspan="5">
          <span>${T('gamesFor')} <b>${r.gf}</b></span>
          <span>${T('gamesAgainst')} <b>${r.ga}</b></span>
          <span>${T('ratio')} <b>${r.ratio.toFixed(2)}</b></span>
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="card" style="--c:${div.colour}">
      <h2 class="card-title">${T('standings')}</h2>
      <table class="standings">
        <thead><tr>
          <th>${T('rank')}</th><th>${T('pair')}</th>
          <th>${T('played')}</th><th>${T('winLoss')}</th><th>${T('points')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="card-note">${store.lang === 'id'
    ? 'Urutan: menang → head-to-head → selisih game → rasio.'
    : 'Ranked by wins → head-to-head → game difference → ratio.'}</p>
    </section>`;
}

function renderBracket(divisionId) {
  const T = t();
  const div = store.division(divisionId);
  const all = store.matchesOf(divisionId).filter((m) => m.stage !== STAGE.P3);
  const stages = [...new Set(all.map((m) => m.stage))].sort((a, b) => stageRank(a) - stageRank(b));

  const cols = stages.map((s) => {
    const ms = all.filter((m) => m.stage === s);
    return `<div class="bk-col">
        <div class="bk-head">${t().stage(s)}</div>
        ${ms.map((m) => bracketCard(m)).join('')}
      </div>`;
  }).join('');

  const third = store.matchesOf(divisionId).find((m) => m.stage === STAGE.P3);

  return `
    <section class="card" style="--c:${div.colour}">
      <h2 class="card-title">${T('bracket')}</h2>
      <div class="bk-scroll"><div class="bk">${cols}</div></div>
      ${third ? `<div class="bk-third">
          <div class="bk-head">🥉 ${T('thirdPlace')}</div>${bracketCard(third)}
        </div>` : ''}
    </section>`;
}

function bracketCard(m) {
  const sets = m.score?.sets ?? [];
  const hs = sets.reduce((n, s) => n + (Number(s.home) || 0), 0);
  const as = sets.reduce((n, s) => n + (Number(s.away) || 0), 0);
  const has = m.status !== 'scheduled' && sets.length;
  return `<div class="bk-match ${statusClass(m)}" data-act="open-match" data-id="${m.id}" tabindex="0" role="button">
      <div class="bk-side ${m.winnerTeamId === m.homeTeamId ? 'won' : ''}">
        <span>${sideName(m, 'home')}</span><b>${has ? hs : ''}</b>
      </div>
      <div class="bk-side ${m.winnerTeamId === m.awayTeamId ? 'won' : ''}">
        <span>${sideName(m, 'away')}</span><b>${has ? as : ''}</b>
      </div>
      ${m.startTime ? `<div class="bk-time">${esc(m.startTime)}</div>` : ''}
    </div>`;
}

function renderMatchList(divisionId) {
  const T = t();
  const ms = store.matchesOf(divisionId)
    .filter((m) => !m.isBye)
    .sort((a, b) => (a.playOrder ?? 999) - (b.playOrder ?? 999));

  return `<section class="card">
      <h2 class="card-title">${T('matches')}</h2>
      <ul class="ml">
        ${ms.map((m) => `
          <li class="ml-row ${statusClass(m)}" data-act="open-match" data-id="${m.id}" tabindex="0" role="button">
            <span class="ml-stage">${t().stage(m.stage)}</span>
            <span class="ml-pairs">${sideName(m, 'home')}<br>${sideName(m, 'away')}</span>
            <span class="ml-score">${m.status === 'completed' ? esc(summarise(m.score)) : esc(m.startTime ?? '')}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Info
 * ------------------------------------------------------------------ */

export function renderInfo() {
  const T = t();
  const tn = store.state.tournament;
  const id = store.lang === 'id';

  const divs = store.state.divisions.map((d) => {
    const teams = store.teamsOf(d.id);
    return `<div class="info-div" style="--c:${d.colour}">
        <h3>${esc(d.name[store.lang] ?? d.name.en)}</h3>
        <p class="muted">${d.format === 'round_robin'
    ? (id ? `Babak grup ${teams.length} pasangan` : `Round robin, ${teams.length} pairs`)
    : (id ? `Sistem gugur ${teams.length} pasangan` : `Knockout, ${teams.length} pairs`)}
          ${d.thirdPlace ? ` · ${T('thirdPlace')}` : ''}${d.finalBetweenTopTwo ? ` · ${T('final')}` : ''}</p>
        <p class="muted">${T('format')}: ${esc(d.scoring.label)}${d.finalScoring ? ` · ${T('final')}: ${esc(d.finalScoring.label)}` : ''}</p>
        <ol class="info-teams">
          ${teams.map((tm) => `<li>${esc(store.teamName(tm))}</li>`).join('')}
        </ol>
      </div>`;
  }).join('');

  return `
    <section class="card">
      <h2 class="card-title">${T('info')}</h2>
      <dl class="info-list">
        <dt>${T('date')}</dt><dd>${esc(tn.date)}</dd>
        <dt>${T('venue')}</dt><dd>${tn.venueName ? esc(tn.venueName) : `<span class="muted">${T('noVenue')}</span>`}</dd>
        <dt>${T('court')}</dt><dd>${tn.courts}</dd>
        <dt>${T('schedule')}</dt><dd>${(tn.blocks ?? []).map((b) => {
    const bd = store.division(b.divisionId);
    return `${esc(bd?.name[store.lang] ?? bd?.name.en ?? '')} ${T('startsAt')} ${esc(b.start)}`;
  }).join(' · ')} · ${tn.slotMinutes} min/${id ? 'partai' : 'match'}</dd>
      </dl>
    </section>
    <section class="card">${divs}</section>
    <section class="card">
      <h2 class="card-title">${T('help')}</h2>
      <ol class="help-steps">
        <li>${id ? 'Ketuk <b>Masukkan PIN</b> di atas, isi PIN panitia.' : 'Tap <b>Enter PIN</b> above and type the organizer PIN.'}</li>
        <li>${id ? 'Ketuk pertandingan mana pun untuk mengisi skor.' : 'Tap any match to enter its score.'}</li>
        <li>${id ? 'Salah isi? Buka lagi pertandingannya lalu ubah.' : 'Wrong score? Reopen the match and change it.'}</li>
      </ol>
      <p class="card-note">${id
    ? 'Klasemen dan bagan terisi otomatis. Pertandingan tanpa skor tampil sebagai —.'
    : 'Standings and the bracket fill themselves. Unplayed matches show as —.'}</p>
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Score sheet
 * ------------------------------------------------------------------ */

export function renderSheet(matchId, mode = 'quick') {
  const T = t();
  const m = store.state.matches.find((x) => x.id === matchId);
  if (!m) return '';
  const div = store.division(m.divisionId);
  const canScore = store.can('score');
  const bothKnown = m.homeTeamId && m.awayTeamId;
  const sets = m.score?.sets ?? [{ home: 0, away: 0 }];
  const hs = Number(sets[0]?.home) || 0;
  const as = Number(sets[0]?.away) || 0;

  const body = !canScore
    ? `<p class="sheet-note">${store.lang === 'id'
      ? 'Masukkan PIN panitia untuk mengisi skor.' : 'Enter the organizer PIN to score.'}</p>`
    : !bothKnown
      ? `<p class="sheet-note">${store.lang === 'id'
        ? 'Pasangan belum ditentukan — selesaikan pertandingan sebelumnya dulu.'
        : 'Pairs not decided yet — finish the feeding matches first.'}</p>`
      : mode === 'live'
        ? `<div class="live-pad">
             <button class="pt" data-act="pt" data-side="home">+1</button>
             <div class="pt-score"><b>${hs}</b><span>–</span><b>${as}</b></div>
             <button class="pt" data-act="pt" data-side="away">+1</button>
           </div>
           <div class="sheet-actions">
             <button class="btn ghost" data-act="undo">${T('undo')}</button>
             <button class="btn" data-act="finish">${T('saveScore')}</button>
           </div>`
        : `<div class="quick">
             <label><span>${sideName(m, 'home')}</span>
               <input type="number" inputmode="numeric" min="0" max="99" id="sc-home" value="${hs}"></label>
             <label><span>${sideName(m, 'away')}</span>
               <input type="number" inputmode="numeric" min="0" max="99" id="sc-away" value="${as}"></label>
           </div>
           <div class="sheet-actions">
             ${m.status === 'completed' ? `<button class="btn ghost" data-act="reopen">${T('reopen')}</button>` : ''}
             <button class="btn ghost" data-act="mode" data-mode="live">${T('liveScoring')}</button>
             <button class="btn" data-act="save">${T('saveScore')}</button>
           </div>`;

  return `
    <div class="sheet-backdrop" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" style="--c:${div.colour}">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span class="sheet-div">${esc(div.short[store.lang] ?? div.short.en)} · ${t().stage(m.stage)}</span>
        <span class="sheet-time">${esc(m.startTime ?? '')}</span>
      </div>
      <div class="sheet-teams">
        <div>${sideName(m, 'home')}</div>
        <div>${sideName(m, 'away')}</div>
      </div>
      ${body}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * PIN modal
 * ------------------------------------------------------------------ */

export function renderPin(error) {
  const T = t();
  return `
    <div class="sheet-backdrop" data-act="close-sheet"></div>
    <div class="sheet sheet-pin" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <h2>${T('enterPin')}</h2>
      <p class="muted">${T('pinHint')}</p>
      <input class="pin-input" type="password" inputmode="numeric" maxlength="6"
             autocomplete="off" id="pin-input" placeholder="••••••">
      ${error ? `<p class="pin-error">${esc(error)}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn ghost" data-act="close-sheet">${T('cancel')}</button>
        <button class="btn" data-act="submit-pin">${T('unlock')}</button>
      </div>
    </div>`;
}

export { esc, t };
