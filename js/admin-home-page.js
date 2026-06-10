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

function showGate(msg) { $('gate').hidden = false; if (msg) $('gate').querySelector('p').textContent = msg; }

async function checkAccess() {
  for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
  if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;
  const profile = await db().profiles.getMine();
  if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
  $('adminUser').innerHTML = `${escapeHtml(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
  return true;
}

$('gateLogin').addEventListener('click', async () => { await db().auth.signInWithGoogle(window.location.href); });

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
