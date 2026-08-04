// ui.js — render functions. Each returns an HTML string; app.js wires events
// through delegation, so re-rendering is always safe.

import { store, summarise } from './store.js';
import { makeT } from './i18n.js';
import { STAGE, stageRank } from './engine.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const t = () => makeT(store.lang);

/** What to show when a slot isn't decided yet -- "Winner QF1", "#1", "Bye". */
function unresolvedLabel(src) {
  const T = t();
  if (!src) return T('bye');
  if (src.type === 'winner') return `${T('winnerOf')} ${T.stageShort(srcStage(src.label))}${srcNum(src.label)}`;
  if (src.type === 'loser') return `${T('loserOf')} ${T.stageShort(srcStage(src.label))}${srcNum(src.label)}`;
  return src.label;
}

/**
 * A team's display name as one string ("Augtri / Vebi"), or — when the slot
 * is undecided — a label saying where its occupant comes from. Used wherever
 * a single line is enough (bracket cards, the sheet header).
 */
function sideName(match, slot) {
  const id = match[`${slot}TeamId`];
  if (id) return esc(store.team(id)?.name ?? '?');
  return `<span class="tbd">${esc(unresolvedLabel(match[`${slot}Source`]))}</span>`;
}

/**
 * A doubles team as two separate lines, one player per line, for layouts that
 * put the two sides side by side rather than stacked -- there's no need to
 * squeeze both players onto one line when they each get their own row.
 */
function teamLines(match, slot) {
  const id = match[`${slot}TeamId`];
  if (id) {
    const team = store.state.teams.find((x) => x.id === id);
    const p1 = esc(store.player(team?.player1Id)?.name ?? '?');
    const p2 = esc(store.player(team?.player2Id)?.name ?? '?');
    return `<span class="team-line">${p1}</span><span class="team-line">${p2}</span>`;
  }
  return `<span class="tbd">${esc(unresolvedLabel(match[`${slot}Source`]))}</span>`;
}

const srcStage = (label) => label.replace(/\d/g, '');
const srcNum = (label) => label.replace(/\D/g, '');

function statusClass(m) {
  if (m.status === 'completed') return 'done';
  if (m.status === 'skipped') return 'skipped';
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
      ${tn.venueName ? `<div class="hdr-sub"><span>${esc(tn.venueName)}</span></div>` : ''}
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
      const champ = store.championOf(d.id);
      if (!champ) return '';
      const note = champ.viaStandings
        ? `<span class="champ-note">${store.lang === 'id' ? '(dari klasemen)' : '(from standings)'}</span>` : '';
      return `<div class="champ-row">
          <span class="champ-div" style="--c:${d.colour}">${esc(d.short[store.lang] ?? d.short.en)}</span>
          <span class="champ-name">🏆 ${esc(store.team(champ.teamId)?.name ?? '')}</span>
          ${note}
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
        <div class="now-team now-team-home">${sideName(m, 'home')}</div>
        <div class="now-score">${isLive
    ? `<b>${hs}</b><span class="now-vs">–</span><b>${as}</b>`
    : `<span class="now-vs">–</span>`}</div>
        <div class="now-team now-team-away">${sideName(m, 'away')}</div>
      </div>
      ${upNext ? `<div class="now-next">${T('upNext')} · ${esc(upNext.startTime ?? '')} — ${sideName(upNext, 'home')} v ${sideName(upNext, 'away')}</div>` : ''}
      ${store.can('score') ? `<button class="now-cta" data-act="open-match" data-id="${m.id}">${T('tapToScore')}</button>` : ''}
    </section>`;
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
    ? 'Urutan: menang → selisih game → head-to-head → rasio.'
    : 'Ranked by wins → game difference → head-to-head → ratio.'}</p>
      ${finIsOptionalNote(divisionId)}
    </section>`;
}

/** Note explaining that this division's champion may come straight from the
 * table if its final is optional and gets skipped -- shown only where that's
 * actually possible, so it doesn't clutter a division with a mandatory final. */
function finIsOptionalNote(divisionId) {
  const fin = store.matchesOf(divisionId).find((m) => m.stage === STAGE.F);
  if (!fin?.optional) return '';
  return `<p class="card-note">${store.lang === 'id'
    ? 'Final di sini opsional (lihat Info) — jika dilewati, juara diambil dari peringkat #1 klasemen ini.'
    : "This division's final is optional (see Info) — if skipped, the champion is the table's #1."}</p>`;
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
        ${ms.map((m) => {
    const winner = m.winnerTeamId;
    return `
          <li class="ml-row ${statusClass(m)}" data-act="open-match" data-id="${m.id}" tabindex="0" role="button">
            <div class="ml-meta">
              <span class="ml-stage">${t().stage(m.stage)}${m.optional ? ` · ${T('optional')}` : ''}</span>
              <span class="ml-score">${m.status === 'completed' ? esc(summarise(m.score))
      : m.status === 'skipped' ? T('skipped') : esc(m.startTime ?? '')}</span>
            </div>
            <div class="ml-matchup">
              <div class="ml-team ${winner && winner === m.homeTeamId ? 'won' : ''}">${teamLines(m, 'home')}</div>
              <span class="ml-vs">–</span>
              <div class="ml-team ml-team-away ${winner && winner === m.awayTeamId ? 'won' : ''}">${teamLines(m, 'away')}</div>
            </div>
          </li>`;
  }).join('')}
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
        ${tn.venueName ? `<dt>${T('venue')}</dt><dd>${esc(tn.venueName)}</dd>` : ''}
        <dt>${T('court')}</dt><dd>${tn.courts}</dd>
        <dt>${T('schedule')}</dt><dd>${(tn.blocks ?? []).map((b) => {
    const bd = store.division(b.divisionId);
    return `${esc(bd?.name[store.lang] ?? bd?.name.en ?? '')} ${T('startsAt')} ${esc(b.start)}`;
  }).join(' · ')} · ${tn.slotMinutes} min/${id ? 'partai' : 'match'}</dd>
      </dl>
    </section>
    <section class="card"><div class="info-divs">${divs}</div></section>
    <section class="card">
      <h2 class="card-title">${T('help')}</h2>
      <ol class="help-steps">
        <li>${id ? 'Ketuk <b>Masukkan PIN</b> di atas, isi PIN panitia.' : 'Tap <b>Enter PIN</b> above and type the organizer PIN.'}</li>
        <li>${id ? 'Ketuk pertandingan mana pun untuk mengisi skor.' : 'Tap any match to enter its score.'}</li>
        <li>${id
    ? 'Urutan main boleh berubah (ada yang datang telat/pulang duluan) — ketuk pertandingan yang benar-benar sedang main, lalu tekan <b>Mulai</b>.'
    : 'Play order can shift (someone arrives late or leaves early) — tap whichever match is actually being played and hit <b>Start</b>.'}</li>
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
  // Quick-entry fields start blank rather than pre-filled "0" -- typing into a
  // field that already contains "0" can land the new digit on either side of
  // it depending on where the cursor happens to be, turning a tapped "1" into
  // "10" instead of "1". Only pre-fill when there's a real score to edit.
  const hsInput = m.score ? hs : '';
  const asInput = m.score ? as : '';

  const skipRow = m.optional && store.role === 'admin'
    ? m.status === 'skipped'
      ? `<div class="sheet-actions"><button class="btn ghost" data-act="unskip">${T('unskip')}</button></div>`
      : m.status !== 'completed'
        ? `<div class="sheet-actions"><button class="btn ghost skip" data-act="skip">${T('skipMatch')}</button></div>`
        : ''
    : '';

  // Reset covers two real situations: undoing a completed match to fix a
  // mistake, and clearing an in-progress one a referee started by accident.
  // Available to scorer or admin -- it's the courtside undo, not a
  // structural change like skip.
  const canReset = canScore && (m.status === 'completed' || m.status === 'in_progress');
  const resetRow = canReset
    ? `<div class="sheet-actions"><button class="btn ghost reset" data-act="reopen">${m.status === 'completed' ? T('reopen') : T('resetMatch')}</button></div>`
    : '';

  const body = m.status === 'skipped'
    ? `<p class="sheet-note">${T('skipHint')}</p>`
    : !canScore
      ? `<p class="sheet-note">${store.lang === 'id'
        ? 'Masukkan PIN panitia untuk mengisi skor.' : 'Enter the organizer PIN to score.'}</p>`
      : !bothKnown
        ? `<p class="sheet-note">${store.lang === 'id'
          ? 'Pasangan belum ditentukan — selesaikan pertandingan sebelumnya dulu.'
          : 'Pairs not decided yet — finish the feeding matches first.'}</p>`
        : mode === 'live'
          ? `<div class="live-names">
               <div class="live-name">${sideName(m, 'home')}</div>
               <div class="live-name live-name-away">${sideName(m, 'away')}</div>
             </div>
             <div class="live-pad">
               <button class="pt" data-act="pt" data-side="home">+1</button>
               <div class="pt-score"><b>${hs}</b><span>–</span><b>${as}</b></div>
               <button class="pt" data-act="pt" data-side="away">+1</button>
             </div>
             <div class="sheet-actions">
               <button class="btn ghost" data-act="undo">${T('undo')}</button>
               <button class="btn" data-act="finish">${T('saveScore')}</button>
             </div>`
          : `<div class="quick">
               <div class="quick-team quick-team-home">${sideName(m, 'home')}</div>
               <div class="quick-inputs">
                 <input type="number" inputmode="numeric" min="0" max="99" id="sc-home" placeholder="0" value="${hsInput}">
                 <span class="quick-vs">–</span>
                 <input type="number" inputmode="numeric" min="0" max="99" id="sc-away" placeholder="0" value="${asInput}">
               </div>
               <div class="quick-team quick-team-away">${sideName(m, 'away')}</div>
             </div>
             <div class="sheet-actions">
               ${m.status === 'scheduled' ? `<button class="btn ghost start" data-act="start">${T('startMatch')}</button>` : ''}
               <button class="btn ghost" data-act="mode" data-mode="live">${T('liveScoring')}</button>
               <button class="btn" data-act="save">${T('saveScore')}</button>
             </div>`;

  // Both quick-entry and live mode lay team names either side of the scoring
  // widget itself now, so showing them a second time above would just repeat
  // what's already on screen. Only the remaining states -- not-yet-scoreable,
  // no PIN, skipped -- have no other place names appear, so it stays for those.
  const showTeamsBlock = !(canScore && bothKnown && m.status !== 'skipped');

  return `
    <div class="sheet-backdrop" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" style="--c:${div.colour}">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span class="sheet-div">${esc(div.short[store.lang] ?? div.short.en)} · ${t().stage(m.stage)}${m.optional ? ` · ${T('optional')}` : ''}</span>
        <span class="sheet-time">${esc(m.startTime ?? '')}</span>
      </div>
      ${showTeamsBlock ? `
        <div class="sheet-teams">
          <div>${sideName(m, 'home')}</div>
          <div>${sideName(m, 'away')}</div>
        </div>` : ''}
      ${body}
      ${resetRow}
      ${skipRow}
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
