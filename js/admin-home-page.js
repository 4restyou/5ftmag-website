'use strict';

// 5ft.mag 편집부 홈 — 오늘 처리할 일 (검토·신고·오류·트래픽) 요약과 섹션 바로가기.
const STATE = { user: null, loading: false };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }
function fmtNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }

function diffLabel(today, yesterday) {
  const t = Number(today) || 0, y = Number(yesterday) || 0;
  if (y === 0) return t > 0 ? '신규 트래픽' : '기준 데이터 없음';
  const pct = Math.round(((t - y) / y) * 100);
  const sign = pct > 0 ? '▲' : (pct < 0 ? '▼' : '·');
  return `어제 ${fmtNum(y)} · ${sign} ${Math.abs(pct)}%`;
}

// 접근 권한 — 공통 게이트(js/admin-guard.js) 위임.
const showGate = (msg) => window.AdminGuard.showGate(msg);
async function checkAccess() { return window.AdminGuard.requireEditor(STATE); }

async function getPendingReportCount() {
  try {
    if (!db()?.market?.adminReportCount) return 0;
    return await db().market.adminReportCount('pending');
  } catch (err) {
    console.warn('[home.pendingReports]', err?.message || err);
    return 0;
  }
}

async function reload() {
  if (STATE.loading) return;
  STATE.loading = true;
  const btn = $('homeRefresh');
  btn.disabled = true;
  try {
    const [uploads, pendingReports, errors, summary] = await Promise.all([
      db().analytics.uploadsSummary(),
      getPendingReportCount(),
      db().analytics.clientErrorsRecent(24, 50),
      db().analytics.summary(),
    ]);

    const pendingUploads = Number(uploads?.total_pending) || 0;
    const reportCount = Number(pendingReports) || 0;
    const errorCount = Array.isArray(errors) ? errors.length : 0;

    $('vPending').textContent = fmtNum(pendingUploads);
    $('vReports').textContent = fmtNum(reportCount);
    $('vErrors').textContent = errorCount >= 50 ? '50+' : fmtNum(errorCount);
    $('vViews').textContent = fmtNum(summary?.views_today);
    $('vViewsSub').textContent = summary ? diffLabel(summary.views_today, summary.views_yesterday) : '데이터 없음';

    $('cardPending').classList.toggle('is-alert', pendingUploads > 0);
    $('cardReports').classList.toggle('is-alert', reportCount > 0);
    $('cardErrors').classList.toggle('is-alert', errorCount > 0);
  } finally {
    STATE.loading = false;
    btn.disabled = false;
  }
}

$('homeRefresh').addEventListener('click', reload);

(async function start() {
  if (!(await checkAccess())) return;
  $('app').hidden = false;
  await reload();
})();
