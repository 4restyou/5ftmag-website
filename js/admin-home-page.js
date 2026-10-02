'use strict';

// 5ft.mag 편집부 홈 — 오늘 처리할 일 (검토·신고·메시지·필름 제안·오류·트래픽) 요약과 섹션 바로가기.
const STATE = { user: null };
const REQUEST_TIMEOUT_MS = 15000;
const STRICT = { strict: true };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function fmtNum(n) { return n.toLocaleString('ko-KR'); }
function count(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new Error('올바른 집계 응답이 없습니다.');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('올바른 집계 응답이 없습니다.');
  return n;
}
function listCount(value) {
  if (!Array.isArray(value)) throw new Error('목록 응답이 없습니다.');
  return value.length;
}

function diffLabel(today, yesterday) {
  const t = today, y = yesterday;
  if (y === 0) return t > 0 ? '신규 트래픽' : '기준 데이터 없음';
  const pct = Math.round(((t - y) / y) * 100);
  const sign = pct > 0 ? '▲' : (pct < 0 ? '▼' : '·');
  return `어제 ${fmtNum(y)} · ${sign} ${Math.abs(pct)}%`;
}

// Each widget keeps its last successful value; failed reads never become zero.
const WIDGETS = [
  { key: 'Pending', read: () => db().analytics.uploadsSummary(STRICT), decode: (v) => count(v?.total_pending) },
  { key: 'Reports', read: () => db().market.adminReportCount('pending', STRICT), decode: count },
  { key: 'Messages', read: () => db().messages.unreadCountForAdmin(STRICT), decode: count },
  { key: 'Proposals', read: () => db().filmProposals.listForReview({ status: 'pending', strict: true }), decode: listCount, cap: 100 },
  { key: 'Errors', read: () => db().analytics.clientErrorsRecent(24, 50, STRICT), decode: listCount, cap: 50 },
  {
    key: 'Views', read: () => db().analytics.summary(STRICT),
    decode: (v) => ({ today: count(v?.views_today), yesterday: count(v?.views_yesterday) }),
  },
].map((widget) => ({ ...widget, lastValue: null, lastSuccess: null, pending: null }));

function lastSuccessLabel(widget) {
  return widget.lastSuccess ? `마지막 성공 ${widget.lastSuccess.toLocaleString('ko-KR')}` : '';
}

function renderWidget(widget, state) {
  const card = $('card' + widget.key);
  const status = $('status' + widget.key);
  const hasValue = widget.lastSuccess !== null;
  const value = widget.key === 'Views' ? widget.lastValue?.today : widget.lastValue;
  $('v' + widget.key).textContent = hasValue
    ? (widget.cap && value >= widget.cap ? `${widget.cap}+` : fmtNum(value))
    : (state === 'loading' ? '확인 중' : '확인 불가');
  card.classList.toggle('is-alert', hasValue && widget.key !== 'Views' && value > 0);
  card.classList.toggle('is-unavailable', state === 'unavailable');
  card.classList.toggle('is-loading', state === 'loading');
  card.classList.toggle('has-value', hasValue);
  card.setAttribute('aria-busy', String(state === 'loading'));
  status.textContent = state === 'success' ? lastSuccessLabel(widget)
    : [state === 'loading' ? '확인 중' : '확인 불가', hasValue ? '이전 값' : '', lastSuccessLabel(widget)].filter(Boolean).join(' · ');
  if (hasValue) status.dataset.lastSuccess = widget.lastSuccess.toISOString();
  $('retry' + widget.key).hidden = state !== 'unavailable';
  $('retry' + widget.key).disabled = state === 'loading';
  if (widget.key === 'Views') {
    $('vViewsSub').textContent = hasValue
      ? diffLabel(widget.lastValue.today, widget.lastValue.yesterday)
      : (state === 'loading' ? '비교 확인 중' : '비교 확인 불가');
  }
}

async function readWithTimeout(read) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('조회 시간이 초과되었습니다.')), REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function refreshWidget(widget) {
  if (widget.pending) return widget.pending;
  renderWidget(widget, 'loading');
  $('homeRefresh').disabled = true;
  widget.pending = (async () => {
    try {
      const value = widget.decode(await readWithTimeout(widget.read));
      widget.lastValue = value;
      widget.lastSuccess = new Date();
      renderWidget(widget, 'success');
    } catch (err) {
      console.warn('[home.' + widget.key + ']', err?.message || err);
      renderWidget(widget, 'unavailable');
    } finally {
      widget.pending = null;
      $('homeRefresh').disabled = WIDGETS.some((item) => item.pending !== null);
    }
  })();
  return widget.pending;
}

function reload() { return Promise.all(WIDGETS.map(refreshWidget)); }

$('homeRefresh').addEventListener('click', reload);
for (const widget of WIDGETS) {
  $('retry' + widget.key).addEventListener('click', () => refreshWidget(widget));
}

(async function start() {
  if (!(await window.AdminGuard.requireEditor(STATE))) return;
  $('app').hidden = false;
  await reload();
})();
