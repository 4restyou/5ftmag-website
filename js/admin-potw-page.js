'use strict';

// 이주의 사진 관리 — 지난 선정 이력과 앞으로 걸릴 예약을 한 화면에서 본다.
//
// 선정 자체는 카탈로그·홈·투고 검토에서 사진을 보다가 그 자리에서 한다
// (js/potw-picker.js). 이 페이지는 그렇게 쌓인 것을 되돌아보고 일정을
// 손보는 자리다. 예약이 바닥나면 홈에 지난 사진이 계속 걸리는데, 그것을
// 알아챌 길이 없어서 만들었다.

const STATE = { user: null, rows: [], today: '' };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }

function todayStr() { return new Date().toISOString().slice(0, 10); }

// 게재일까지 며칠 남았는지. 지난 것은 음수가 아니라 "며칠 전" 으로 읽는다.
function relDays(dateStr, today) {
  const a = Date.parse(dateStr + 'T00:00:00Z');
  const b = Date.parse(today + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return '';
  const d = Math.round((a - b) / 86400000);
  if (d === 0) return '오늘';
  if (d === 1) return '내일';
  if (d === -1) return '어제';
  return d > 0 ? `${d}일 뒤` : `${-d}일 전`;
}

// 홈이 고르는 것과 같은 규칙 — 오늘 이하 중 가장 최근 하나.
// db-client 의 featuredCurrent() 와 판정이 어긋나면 화면이 거짓말을 하게 되므로
// 같은 기준을 쓴다.
function liveRow(rows, today) {
  return rows.find((r) => String(r.featured_at) <= today) || null;
}

function badge(r, today, live) {
  if (String(r.featured_at) > today) return '<span class="badge scheduled">예약</span>';
  if (live && r.id === live.id) return '<span class="badge live">홈에 걸림</span>';
  return '<span class="badge past">지남</span>';
}

function renderSummary() {
  const { rows, today } = STATE;
  const live = liveRow(rows, today);
  const upcoming = rows.filter((r) => String(r.featured_at) > today);
  const next = upcoming.length ? upcoming[upcoming.length - 1] : null; // 가장 가까운 예약

  if (live) {
    $('sumLive').textContent = live.submitter_name || '이름 없음';
    $('sumLiveSub').textContent = `${live.featured_at} 부터 (${relDays(live.featured_at, today)})`;
  } else {
    $('sumLive').textContent = '없음';
    $('sumLiveSub').textContent = '아직 한 장도 걸리지 않았습니다.';
  }

  if (next) {
    $('sumNext').textContent = next.submitter_name || '이름 없음';
    $('sumNextSub').textContent = `${next.featured_at} (${relDays(next.featured_at, today)})`;
  } else {
    $('sumNext').textContent = '없음';
    $('sumNextSub').textContent = '예약이 비어 있어 지금 사진이 계속 걸립니다.';
  }

  $('sumStock').textContent = `${upcoming.length}주`;
  $('sumStockSub').textContent = upcoming.length
    ? `${upcoming[0].featured_at} 까지 잡혀 있습니다.`
    : '앞으로 걸릴 사진이 없습니다.';

  const gap = $('gapNote');
  if (!upcoming.length) {
    gap.innerHTML = '예약이 <strong>비어 있습니다.</strong> 카탈로그나 투고 검토에서 사진을 골라 며칠치 잡아 두면 매주 들어오지 않아도 홈이 알아서 넘어갑니다.';
  } else if (upcoming.length < 3) {
    gap.innerHTML = `예약이 <strong>${upcoming.length}주</strong>치 남았습니다. 몇 장 더 잡아 두면 바쁜 주를 넘길 수 있습니다.`;
  } else {
    gap.textContent = '';
  }
}

function renderTable() {
  const tbody = $('tbody');
  const { rows, today } = STATE;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">아직 선정된 사진이 없습니다. 카탈로그나 투고 검토에서 사진을 골라 주세요.</td></tr>';
    return;
  }
  const live = liveRow(rows, today);
  tbody.innerHTML = rows.map((r) => {
    const url = `/i/reader/${r.storage_path}`;
    const ig = (r.instagram || '').replace(/^@/, '');
    return `
    <tr data-id="${escapeHtml(r.id)}" data-date="${escapeHtml(r.featured_at)}" data-note="${escapeHtml(r.featured_note || '')}">
      <td class="col-thumb">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
          <img class="thumb" loading="lazy" decoding="async" src="${escapeHtml(url)}" alt="" />
        </a>
      </td>
      <td class="col-when">
        <div class="when-date">${escapeHtml(r.featured_at)}</div>
        <div class="when-rel">${escapeHtml(relDays(r.featured_at, today))}</div>
      </td>
      <td>${badge(r, today, live)}</td>
      <td>
        <div class="who">${escapeHtml(r.submitter_name || '이름 없음')}
          ${ig ? ` <a href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">@${escapeHtml(ig)}</a>` : ''}
        </div>
        ${r.film ? `<div class="meta">${escapeHtml(r.film)}</div>` : ''}
      </td>
      <td class="note${r.featured_note ? '' : ' none'}">${r.featured_note ? escapeHtml(r.featured_note) : '없음'}</td>
      <td class="col-actions">
        <button type="button" class="row-btn" data-act="edit">날짜 변경</button>
        <button type="button" class="row-btn danger" data-act="clear">선정 해제</button>
      </td>
    </tr>`;
  }).join('');
}

// 접근 권한 — 공통 게이트(js/admin-guard.js) 위임.
async function checkAccess() { return window.AdminGuard.requireEditor(STATE); }

async function reload() {
  STATE.today = todayStr();
  STATE.rows = await db().review.listFeatured();
  renderSummary();
  renderTable();
}

$('tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = tr?.dataset.id;
  if (!id) return;

  if (btn.dataset.act === 'edit') {
    // 선정 흐름은 js/potw-picker.js 하나에 모여 있다. 날짜 검증과 중복 확인을
    // 여기서 다시 쓰면 두 곳이 갈라진다.
    const done = await window.PotwPicker.pick(id, {
      current: tr.dataset.date,
      note: tr.dataset.note,
    });
    if (done) await reload();
    return;
  }

  if (btn.dataset.act === 'clear') {
    const when = tr.dataset.date;
    if (!confirm(`${when} 선정을 해제합니다.\n\n사진과 투고는 그대로 남고 홈에서만 내려갑니다. 제출자에게는 알리지 않습니다.`)) return;
    btn.disabled = true;
    const { error } = await db().review.clearFeatured(id);
    btn.disabled = false;
    if (error) { window.notify?.('해제에 실패했어요. (' + (error.message || '권한을 확인해 주세요') + ')', 'danger'); return; }
    window.notify?.('선정을 해제했어요.', 'info');
    await reload();
  }
});

(async function start() {
  if (!(await checkAccess())) return;
  $('app').hidden = false;
  await reload();
})();
