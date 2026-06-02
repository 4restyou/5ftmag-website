'use strict';

const STATE = {
  user: null,
  isEditor: false,
  days: 30,
  filmsMode: 'range',
  camerasMode: 'range',
  cameraAliasMap: new Map(),
  cameraDisplayOverrides: new Map(),
  ops: { previous: null, timer: null, loading: false },
};

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function fmtNum(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}
function fmtDuration(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n < 1000) return n + 'ms';
  const sec = Math.round(n / 1000);
  if (sec < 60) return sec + '초';
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 60) return s ? `${min}분 ${s}초` : `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function fmtBytesShort(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : (size < 10 ? 1 : 0);
  return `${size.toFixed(digits)}${units[unit]}`;
}

function fmtDay(d) {
  // d 가 'YYYY-MM-DD' 또는 Date
  const date = (d instanceof Date) ? d : new Date(d + 'T00:00:00');
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function fmtClock(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadCameraOverrides() {
  STATE.cameraAliasMap = new Map();
  STATE.cameraDisplayOverrides = new Map();
  if (!db()?.cameraOverrides) return;
  try {
    const overrides = await db().cameraOverrides.list();
    for (const [key, row] of overrides || []) {
      if (row.alias_of) STATE.cameraAliasMap.set(key, row.alias_of);
      if (row.display) STATE.cameraDisplayOverrides.set(key, row.display);
    }
  } catch (_) {}
}

function normalizeCameraForStats(label) {
  if (typeof window.normalizeCamera === 'function') {
    const n = window.normalizeCamera(label);
    return {
      key: n.key || String(label || '').toLowerCase().replace(/[\s\-_]/g, ''),
      brand: n.brand || '',
      original: n.original || label || '',
    };
  }
  return {
    key: String(label || '').toLowerCase().replace(/[\s\-_]/g, ''),
    brand: '',
    original: label || '',
  };
}

function canonicalCameraKey(label) {
  const key = normalizeCameraForStats(label).key;
  return STATE.cameraAliasMap.get(key) || key;
}

function pickCameraDisplayForStats(originals, canonicalKey) {
  const override = STATE.cameraDisplayOverrides.get(canonicalKey);
  if (override) return override;
  const normalized = originals.map(label => normalizeCameraForStats(label)).filter(n => n.key);
  const brand = normalized.find(n => n.brand)?.brand;
  if (brand && /^[a-z0-9]+$/i.test(canonicalKey) && /^\d+[a-z]?$/i.test(canonicalKey)) {
    return `${formatCameraBrand(brand)} ${canonicalKey.toUpperCase()}`;
  }
  const pickDisplay = window.pickCameraDisplay || ((arr) => arr[0] || '');
  return pickDisplay(originals) || originals[0] || '-';
}

function formatCameraBrand(brand) {
  return String(brand || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function mergeTopCameraRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const label = String(row.camera || '').trim();
    const key = canonicalCameraKey(label);
    if (!key) continue;
    const current = grouped.get(key) || { camera: '', uploads: 0, approved: 0, originals: [] };
    current.uploads += Number(row.uploads) || 0;
    current.approved += Number(row.approved) || 0;
    if (label) current.originals.push(label);
    grouped.set(key, current);
  }
  return [...grouped.entries()].map(([key, row]) => ({
    camera: pickCameraDisplayForStats(row.originals, key),
    uploads: row.uploads,
    approved: row.approved,
  })).sort((a, b) => (
    (Number(b.uploads) || 0) - (Number(a.uploads) || 0)
    || (Number(b.approved) || 0) - (Number(a.approved) || 0)
    || String(a.camera).localeCompare(String(b.camera), 'ko')
  )).slice(0, 10);
}

async function checkAccess() {
  if (!db() || !db().isReady()) {
    document.body.innerHTML = '<div class="gate"><h2>인증 모듈 로드 실패</h2><p>새로고침해주세요.</p></div>';
    return false;
  }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;

  const profile = await db().profiles.getMine();
  if (!profile?.is_editor) { showGate('접근 권한이 없어요.'); return false; }
  STATE.isEditor = true;
  $('adminUser').innerHTML = `${escapeHtml(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
  return true;
}

function showGate(msg) {
  $('gate').hidden = false;
  $('app').hidden = true;
  if (msg) {
    $('gate').querySelector('p').textContent = msg;
    $('gateLogin').style.display = 'none';
  }
  $('gateLogin').addEventListener('click', async () => {
    await db().auth.signInWithGoogle(window.location.href.split('#')[0]);
  });
}

function renderSummary(s) {
  if (!s) {
    ['cv-today','cv-7d','cv-30d','cv-total'].forEach(id => $(id).textContent = '0');
    return;
  }
  $('cv-today').textContent = fmtNum(s.views_today);
  $('cs-today').textContent = `어제 ${fmtNum(s.views_yesterday)} · ${diffLabel(s.views_today, s.views_yesterday)}`;
  $('cv-7d').textContent    = fmtNum(s.views_last_7d);
  $('cs-7d').textContent    = `하루 평균 ${fmtNum(Math.round((Number(s.views_last_7d) || 0) / 7))}`;
  $('cv-30d').textContent   = fmtNum(s.views_last_30d);
  $('cs-30d').textContent   = `방문 세션 ${fmtNum(s.sessions_last_30d)}`;
  $('cv-total').textContent = fmtNum(s.total_views);
  $('cs-total').textContent = `전체 세션 ${fmtNum(s.total_sessions)}`;
}

function diffLabel(today, yesterday) {
  const t = Number(today) || 0, y = Number(yesterday) || 0;
  if (y === 0) return t > 0 ? '신규 트래픽' : '기준 데이터 없음';
  const pct = Math.round(((t - y) / y) * 100);
  const sign = pct > 0 ? '▲' : (pct < 0 ? '▼' : '·');
  return `${sign} ${Math.abs(pct)}%`;
}

function drawBarChart(svgId, tipId, rows, valueKey, tipFormatter) {
  const svg = $(svgId);
  const tip = $(tipId);
  svg.innerHTML = '';
  if (!rows.length) {
    svg.innerHTML = '<text x="400" y="110" text-anchor="middle" class="axis-label">데이터 없음</text>';
    return;
  }
  const W = 800, H = 220;
  const PAD_L = 36, PAD_R = 8, PAD_T = 10, PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const n = rows.length;
  const maxV = Math.max(1, ...rows.map(r => Number(r[valueKey]) || 0));
  const niceMax = niceCeil(maxV);
  const barW = Math.max(1, innerW / n - 2);

  const yLines = [0.25, 0.5, 0.75, 1.0];
  let g = '';
  yLines.forEach(p => {
    const y = PAD_T + innerH * (1 - p);
    const val = Math.round(niceMax * p);
    g += `<line class="grid" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" />`;
    g += `<text class="y-label" x="${PAD_L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtNum(val)}</text>`;
  });

  rows.forEach((r, i) => {
    const v = Number(r[valueKey]) || 0;
    const h = innerH * (v / niceMax);
    const x = PAD_L + (innerW / n) * i + 1;
    const y = PAD_T + innerH - h;
    g += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" data-i="${i}" />`;
  });

  const labelStride = Math.max(1, Math.ceil(n / 8));
  const lastI = n - 1;
  rows.forEach((r, i) => {
    const isStride = i % labelStride === 0;
    const isLast = i === lastI;
    if (!isStride && !isLast) return;
    // stride 라벨이 마지막 라벨과 너무 가까우면 (한 stride 미만) skip — 겹침 방지
    if (isStride && !isLast && lastI - i < labelStride) return;
    const x = PAD_L + (innerW / n) * i + (innerW / n) / 2;
    g += `<text class="axis-label" x="${x.toFixed(1)}" y="${(H - 6).toFixed(1)}" text-anchor="middle">${fmtDay(r.day)}</text>`;
  });

  svg.innerHTML = g;

  const wrap = svg.parentElement;
  const rect = () => svg.getBoundingClientRect();
  svg.querySelectorAll('rect.bar').forEach(bar => {
    bar.addEventListener('mouseenter', () => {
      const i = Number(bar.dataset.i);
      const r = rows[i];
      const bbox = rect();
      const x = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
      const y = Number(bar.getAttribute('y'));
      tip.textContent = tipFormatter(r);
      tip.style.left = (bbox.left - wrap.getBoundingClientRect().left + (x / 800) * bbox.width) + 'px';
      tip.style.top  = (bbox.top  - wrap.getBoundingClientRect().top  + (y / 220) * bbox.height) + 'px';
      tip.classList.add('show');
    });
    bar.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

function renderChart(rows) {
  drawBarChart('chart', 'chartTip', rows, 'views',
    r => `${fmtDay(r.day)} · ${fmtNum(r.views)} 뷰 · ${fmtNum(r.sessions)} 세션`);
}

function renderUploadChart(rows) {
  drawBarChart('uploadChart', 'uploadChartTip', rows, 'uploads',
    r => `${fmtDay(r.day)} · ${fmtNum(r.uploads)} 업로드 · 승인 ${fmtNum(r.approved)}`);
}

function niceCeil(n) {
  if (n <= 1) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / exp;
  let nice;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 2.5) nice = 2.5;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return Math.ceil(nice * exp);
}

// 페이지명 매핑 — 알려진 경로는 한글로 표시
const PATH_TITLES = {
  '/':                       '메인',
  '/index.html':             '메인',
  '/films.html':             '필름 데이터베이스',
  '/films':                  '필름 데이터베이스',
  '/stories.html':           '글 목록',
  '/market.html':            '장터',
  '/about.html':             '소개',
  '/authors.html':           '글쓴이 모음',
  '/me.html':                '내 페이지',
  '/legal/privacy.html':     '개인정보처리방침',
  '/legal/terms.html':       '이용약관',
  '/legal/copyright.html':   '저작권',
};

const ANALYTICS_TRACKING_KEYS = new Set([
  'fbclid','gclid','gbraid','wbraid','msclkid','yclid','dclid','twclid',
  'mc_eid','mc_cid','_hsenc','_hsmi','igshid','ref','ref_src','ref_url',
  'ck_subscriber_id',
]);

// utm_*, fbclid 등 트래킹 파라미터 잘라내고 메인 path 만 남김 (기존 데이터 정리용)
function stripTracking(rawPath) {
  let p = String(rawPath || '');
  if (!p.startsWith('/')) p = '/' + p;
  const q = p.indexOf('?');
  if (q < 0) return p;
  const base = p.slice(0, q);
  try {
    const params = new URLSearchParams(p.slice(q + 1));
    const kept = [];
    for (const [k, v] of params) {
      if (k.startsWith('utm_')) continue;
      if (ANALYTICS_TRACKING_KEYS.has(k.toLowerCase())) continue;
      kept.push([k, v]);
    }
    if (!kept.length) return base;
    return base + '?' + kept.map(([k, v]) => v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  } catch (_) {
    return base;
  }
}

function prettyPathLabel(rawPath) {
  const clean = stripTracking(rawPath);
  // 정확히 일치하면 매핑 사용
  if (PATH_TITLES[clean]) return PATH_TITLES[clean];
  // ?page= 같은 쿼리만 있는 경우
  const q = clean.indexOf('?');
  const base = q >= 0 ? clean.slice(0, q) : clean;
  const query = q >= 0 ? clean.slice(q) : '';
  if (PATH_TITLES[base]) return PATH_TITLES[base] + (query ? ` ${query}` : '');

  // /stories/{slug}.html
  let m = base.match(/^\/stories\/([^/]+?)\.html$/);
  if (m) return `글: ${m[1]}`;
  // /authors/{slug}.html
  m = base.match(/^\/authors\/([^/]+?)\.html$/);
  if (m) return `글쓴이: ${m[1]}`;
  return clean;
}

function renderTopPaths(rows) {
  const tbody = $('topPaths');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>';
    return;
  }
  // 트래킹 파라미터를 제거한 정규 경로 기준으로 다시 그룹핑 (기존 데이터에 utm 이 흩어져 들어가 있어서)
  const grouped = new Map();
  for (const r of rows) {
    const clean = stripTracking(r.path);
    const cur = grouped.get(clean);
    const views    = Number(r.views) || 0;
    const sessions = Number(r.sessions) || 0;
    if (cur) {
      cur.views += views;
      cur.sessions += sessions;
    } else {
      grouped.set(clean, { path: clean, views, sessions, raw: r.path });
    }
  }
  const merged = [...grouped.values()].sort((a, b) => b.views - a.views).slice(0, 10);
  const max = Math.max(1, ...merged.map(r => r.views));
  tbody.innerHTML = merged.map(r => {
    const pct = Math.max(2, Math.round((r.views / max) * 100));
    const safePath = r.path.startsWith('/') ? r.path : '/' + r.path;
    const linkable = !safePath.includes('/admin/');
    const label = prettyPathLabel(safePath);
    const labelHtml = linkable
      ? `<a href="..${escapeAttr(safePath)}" target="_blank" rel="noopener" title="${escapeAttr(safePath)}">${escapeHtml(label)}</a>`
      : `<span title="${escapeAttr(safePath)}">${escapeHtml(label)}</span>`;
    return `<tr>
      <td class="path-cell">${labelHtml}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.views)}</td>
      <td class="num">${fmtNum(r.sessions)}</td>
    </tr>`;
  }).join('');
}

// timezone 값을 사람이 보기 좋게 — "Asia/Seoul" → "Seoul (Asia)"
function fmtTz(tz) {
  if (!tz || tz === '(unknown)') return '(미상)';
  const slash = tz.indexOf('/');
  if (slash < 0) return tz;
  const region = tz.slice(0, slash);
  const city = tz.slice(slash + 1).replace(/_/g, ' ');
  return `${city} (${region})`;
}

function renderRegions(rows) {
  const tbody = $('regions');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.views) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.views) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    return `<tr>
      <td>${escapeHtml(fmtTz(r.tz))}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.views)}</td>
      <td class="num">${fmtNum(r.sessions)}</td>
    </tr>`;
  }).join('');
}

function renderLanguages(rows) {
  const tbody = $('languages');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.views) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.views) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    const lang = r.lang === '(unknown)' ? '(미상)' : (r.lang || '(미상)');
    return `<tr>
      <td>${escapeHtml(lang)}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.views)}</td>
      <td class="num">${fmtNum(r.sessions)}</td>
    </tr>`;
  }).join('');
}

function renderUploadsSummary(s) {
  if (!s) {
    ['up-today','up-7d','up-30d','up-total'].forEach(id => $(id).textContent = '0');
    ['up-status','up-7d-sub','up-30d-sub','up-total-sub'].forEach(id => $(id).textContent = '');
    return;
  }
  $('up-today').textContent = fmtNum(s.uploads_today);
  $('up-status').textContent =
    `대기 ${fmtNum(s.total_pending)} · 승인 ${fmtNum(s.total_approved)} · 반려 ${fmtNum(s.total_rejected)}`;
  $('up-7d').textContent = fmtNum(s.uploads_last_7d);
  $('up-7d-sub').textContent = `하루 평균 ${fmtNum(Math.round((Number(s.uploads_last_7d) || 0) / 7))}`;
  $('up-30d').textContent = fmtNum(s.uploads_last_30d);
  $('up-30d-sub').textContent = `활동 작가 ${fmtNum(s.active_contributors_30d)}명`;
  $('up-total').textContent = fmtNum(s.total_uploads);
  $('up-total-sub').textContent = `누적 작가 ${fmtNum(s.unique_contributors)}명`;
}

async function getPendingReportCount() {
  try {
    if (!db()?.market?.adminReportCount) return 0;
    return await db().market.adminReportCount('pending');
  } catch (err) {
    console.warn('[ops.pendingReports]', err?.message || err);
    return 0;
  }
}

function renderOpsStatus(snapshot, opts = {}) {
  const { announce = true } = opts;
  const prev = STATE.ops.previous;
  const uploads = snapshot.uploads || {};
  const totalUploads = Number(uploads.total_uploads) || 0;
  const todayUploads = Number(uploads.uploads_today) || 0;
  const pendingUploads = Number(uploads.total_pending) || 0;
  const pendingReports = Number(snapshot.pendingReports) || 0;
  const hasPending = pendingUploads > 0 || pendingReports > 0;

  $('opsTotalUploads').textContent = fmtNum(totalUploads);
  $('opsTotalUploadsSub').textContent = `오늘 ${fmtNum(todayUploads)}건`;
  $('opsPendingUploads').textContent = fmtNum(pendingUploads);
  $('opsPendingReports').textContent = fmtNum(pendingReports);
  $('opsHealth').textContent = hasPending ? '확인 필요' : '정상';
  $('opsLastChecked').textContent = `${fmtClock()} 확인`;
  $('opsWatchLabel').textContent = '페이지가 열려 있으면 1분마다 새 업로드와 신고 대기를 확인합니다.';
  $('opsPendingItem').classList.toggle('is-alert', pendingUploads > 0);
  $('opsReportItem').classList.toggle('is-alert', pendingReports > 0);
  $('opsHealthItem').classList.toggle('is-alert', hasPending);

  if (announce && prev) {
    const uploadDiff = totalUploads - (Number(prev.uploads?.total_uploads) || 0);
    const pendingReportDiff = pendingReports - (Number(prev.pendingReports) || 0);
    if (uploadDiff > 0) {
      window.notify?.(`새 사진 업로드 ${fmtNum(uploadDiff)}건이 들어왔어요.`, 'info');
    } else if (pendingReportDiff > 0) {
      window.notify?.(`새 매물 신고 ${fmtNum(pendingReportDiff)}건이 들어왔어요.`, 'info');
    }
  }

  STATE.ops.previous = snapshot;
}

function fmtAgoShort(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return '방금 전';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

function clientErrorMeta(row) {
  const message = String(row?.message || '');
  const uploadMatch = message.match(/^\[(reader|market)-upload:([a-z0-9_-]+)\]/i);
  if (!uploadMatch) return { kind: 'js', stage: '', label: 'JS 오류', displayMessage: message };
  const area = uploadMatch[1] || 'reader';
  const stage = uploadMatch[2] || 'unknown';
  const areaLabel = area === 'market' ? 'Market 업로드' : 'Reader 업로드';
  const stageLabel = ({
    auth: '로그인 확인',
    storage: '사진 업로드',
    database: '제출 저장',
    write: '기록 저장',
    cleanup: '업로드 정리',
    decode: '사진 읽기',
    resize: '크기 조정',
    encode: '압축',
    'image-process': '사진 변환',
    unknown: '알 수 없음',
  })[stage] || stage;
  return {
    kind: 'upload',
    area,
    stage,
    stageLabel,
    summaryLabel: `${areaLabel} · ${stageLabel}`,
    label: `${areaLabel} · ${stageLabel}`,
    displayMessage: message.replace(/^\[(reader|market)-upload:[^\]]+\]\s*/i, ''),
  };
}

function parseClientErrorStack(row) {
  const stack = String(row?.stack || row?.details || '');
  if (!stack.trim()) return {};
  return stack.split(/\r?\n/).reduce((acc, line) => {
    const index = line.indexOf('=');
    if (index <= 0) return acc;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) acc[key] = value;
    return acc;
  }, {});
}

function uploadPathLabel(kind) {
  return ({
    primary: '기본 경로',
    fallback: '경량 경로',
    tertiary: '최소 경로',
  })[String(kind || '').toLowerCase()] || kind || '';
}

function clipClientErrorText(text, max = 96) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function clientUploadDetail(row) {
  const data = parseClientErrorStack(row);
  if (!Object.keys(data).length) return '';
  const parts = [];
  if (data.file_name) parts.push(`파일 ${data.file_name}`);
  const inputBytes = fmtBytesShort(data.input_bytes);
  const uploadBytes = fmtBytesShort(data.upload_bytes);
  if (inputBytes && uploadBytes && inputBytes !== uploadBytes) {
    parts.push(`용량 ${inputBytes} → ${uploadBytes}`);
  } else if (inputBytes || uploadBytes) {
    parts.push(`용량 ${inputBytes || uploadBytes}`);
  }
  const attemptCount = Number(data.attempt_count) || 0;
  if (attemptCount > 0) parts.push(`시도 ${fmtNum(attemptCount)}회`);
  const lastKind = uploadPathLabel(data.last_successful_kind || data[`attempt_${attemptCount}_kind`]);
  const lastError = clipClientErrorText(data.final_error || data.last_error || data[`attempt_${attemptCount}_resumable`] || data[`attempt_${attemptCount}_simple`]);
  if (lastKind && data.last_successful_path) {
    parts.push(`마지막 ${lastKind} 성공`);
  } else if (lastKind && lastError) {
    parts.push(`마지막 ${lastKind} · ${lastError}`);
  } else if (lastError) {
    parts.push(`마지막 오류 ${lastError}`);
  }
  const triedCount = String(data.tried_paths || '').split(',').map(s => s.trim()).filter(Boolean).length;
  if (triedCount > 1) parts.push(`경로 ${fmtNum(triedCount)}개`);
  return parts.join(' · ');
}

function clientUploadSummaries(rows) {
  const map = new Map();
  rows.forEach(row => {
    const meta = clientErrorMeta(row);
    if (meta.kind !== 'upload') return;
    const key = `${meta.area}:${meta.stage}`;
    const current = map.get(key) || { label: meta.summaryLabel, count: 0 };
    current.count += Number(row.occurrences) || 0;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
}

async function loadClientErrors() {
  const countEl = $('clientErrorCount');
  const listEl = $('clientErrorList');
  const summaryEl = $('clientErrorStageSummary');
  const opsEl = $('opsClientErrors');
  const opsSubEl = $('opsClientErrorsSub');
  const cardEl = $('opsErrorItem');
  if (!countEl || !listEl || !opsEl) return [];
  try {
    const rows = await db().analytics.clientErrorsRecent(24, 10);
    const total = rows.reduce((sum, row) => sum + (Number(row.occurrences) || 0), 0);
    const uploadSummaries = clientUploadSummaries(rows);
    const uploadTotal = uploadSummaries.reduce((sum, row) => sum + row.count, 0);
    opsEl.textContent = fmtNum(total);
    if (opsSubEl) {
      const top = uploadSummaries[0];
      opsSubEl.textContent = top
        ? `${top.label} ${fmtNum(top.count)}건${uploadSummaries.length > 1 ? ' 외' : ''}`
        : '최근 24시간';
    }
    cardEl?.classList.toggle('is-alert', total > 0);
    countEl.textContent = total
      ? `${fmtNum(total)}건 · 최근 24시간${uploadTotal ? ` · 업로드 실패 ${fmtNum(uploadTotal)}건` : ''}`
      : '최근 24시간 오류 없음';
    if (summaryEl) {
      summaryEl.hidden = !uploadSummaries.length;
      summaryEl.innerHTML = uploadSummaries.map(item => `
        <span class="ops-stage-chip">${escapeHtml(item.label)} <span class="count">${fmtNum(item.count)}건</span></span>
      `).join('');
    }
    if (!rows.length) {
      listEl.innerHTML = '<div class="ops-empty">최근 24시간 기록된 JS 오류가 없습니다.</div>';
      return rows;
    }
    listEl.innerHTML = rows.map(row => {
      const meta = clientErrorMeta(row);
      const loc = [row.source, row.lineno ? `${row.lineno}:${row.colno || 0}` : ''].filter(Boolean).join(' ');
      const uploadDetail = meta.kind === 'upload' ? clientUploadDetail(row) : '';
      return `
        <div class="ops-row">
          <div class="ops-row-main">
            <div class="ops-row-name">
              <span class="ops-badge ${meta.kind === 'upload' ? 'is-danger' : ''}">${escapeHtml(meta.label)}</span>${escapeHtml(meta.displayMessage || 'Unknown error')}
            </div>
            <div class="ops-row-sub">${escapeHtml(row.path || '-')} ${loc ? `· ${escapeHtml(loc)}` : ''}</div>
            ${uploadDetail ? `<div class="ops-row-sub">${escapeHtml(uploadDetail)}</div>` : ''}
          </div>
          <div class="ops-row-meta">${escapeHtml(fmtAgoShort(row.ts))}<br>${fmtNum(row.occurrences)}건</div>
        </div>
      `;
    }).join('');
    return rows;
  } catch (err) {
    console.warn('[clientErrors]', err?.message || err);
    opsEl.textContent = '!';
    if (opsSubEl) opsSubEl.textContent = '확인 실패';
    if (summaryEl) {
      summaryEl.hidden = true;
      summaryEl.innerHTML = '';
    }
    cardEl?.classList.add('is-alert');
    countEl.textContent = '확인 실패';
    listEl.innerHTML = '<div class="ops-empty">최근 JS 오류를 불러오지 못했어요.</div>';
    return [];
  }
}

async function loadThumbnailDebt() {
  const countEl = $('thumbPendingCount');
  const listEl = $('thumbPendingList');
  if (!countEl || !listEl) return;
  try {
    let films = null;
    if (window.MagDB && window.MagDB.isReady()) {
      films = await window.MagDB.films.listAsObject();
    }
    if (!films || Object.keys(films).length === 0) {
      const res = await fetch('../data/films.json');
      if (!res.ok) throw new Error('films load failed');
      films = await res.json();
    }
    const pending = Object.values(films || {}).flatMap(film => {
      const rows = [];
      // 캔 썸네일은 모든 필름 카드(라이브러리 + featured) 에 노출.
      if (film.canThumbnailStatus === 'pending') {
        rows.push({ film, type: '캔 썸네일' });
      }
      // 박스 썸네일은 5ft Issue (featured) 모달에서만 사용 — featured 만 카운트.
      if (film.tier === 'featured' && film.boxThumbnailStatus === 'pending') {
        rows.push({ film, type: '박스 썸네일' });
      }
      return rows;
    }).sort((a, b) => {
      const brand = String(a.film.brand || '').localeCompare(String(b.film.brand || ''), 'ko');
      if (brand) return brand;
      return String(a.film.displayName || a.film.name || '').localeCompare(String(b.film.displayName || b.film.name || ''), 'ko');
    });
    countEl.textContent = pending.length ? `${fmtNum(pending.length)}개 대기` : '대기 없음';
    if (!pending.length) {
      listEl.innerHTML = '<div class="ops-empty">대기 중인 썸네일이 없습니다.</div>';
      return;
    }
    listEl.innerHTML = pending.map(({ film, type }) => `
      <div class="ops-row">
        <span class="ops-row-name">${escapeHtml(film.displayName || film.name || film.slug)}</span>
        <span class="ops-row-meta">${escapeHtml(film.brand || '-')} · ${escapeHtml(type)}</span>
      </div>
    `).join('');
  } catch (err) {
    console.warn('[thumbnailDebt]', err?.message || err);
    countEl.textContent = '확인 실패';
    listEl.innerHTML = '<div class="ops-empty">필름 썸네일 상태를 불러오지 못했어요.</div>';
  }
}

async function refreshOpsStatus(opts = {}) {
  const { announce = true } = opts;
  if (STATE.ops.loading) return;
  STATE.ops.loading = true;
  $('opsRefresh').disabled = true;
  try {
    const [uploads, pendingReports] = await Promise.all([
      db().analytics.uploadsSummary(),
      getPendingReportCount(),
    ]);
    const snapshot = { uploads, pendingReports };
    renderOpsStatus(snapshot, { announce });
    renderUploadsSummary(uploads);
    loadClientErrors();
  } catch (err) {
    console.warn('[ops.refresh]', err?.message || err);
    $('opsWatchLabel').textContent = '운영 알림을 새로 불러오지 못했어요. 잠시 뒤 다시 확인해주세요.';
  } finally {
    STATE.ops.loading = false;
    $('opsRefresh').disabled = false;
  }
}

function startOpsWatch() {
  if (STATE.ops.timer) clearInterval(STATE.ops.timer);
  STATE.ops.timer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshOpsStatus({ announce: true });
  }, 60000);
}

function renderThemeRatio(t) {
  if (!t) {
    ['tr-theme','tr-general','tr-ratio'].forEach(id => $(id).textContent = '0');
    return;
  }
  $('tr-theme').textContent   = fmtNum(t.theme_count);
  $('tr-general').textContent = fmtNum(t.general_count);
  const ratio = Number(t.theme_ratio || 0);
  $('tr-ratio').textContent = (ratio * 100).toFixed(1) + '%';
}

function renderTopContributors(rows) {
  const tbody = $('topContributors');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.uploads) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.uploads) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    const name = String(r.contributor || '').trim();
    const looksLikeHandle = name && !/\s/.test(name) && !/^익명$/.test(name);
    const labelHtml = looksLikeHandle
      ? `<a href="https://instagram.com/${escapeAttr(name)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(name)}</a>`
      : escapeHtml(name || '익명');
    return `<tr>
      <td class="path-cell">${labelHtml}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.uploads)}</td>
      <td class="num">${fmtNum(r.approved)}</td>
    </tr>`;
  }).join('');
}

function renderTopByKey(tbodyId, rows, keyField) {
  const tbody = $(tbodyId);
  if (keyField === 'camera') rows = mergeTopCameraRows(rows);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.uploads) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.uploads) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    return `<tr>
      <td>${escapeHtml(r[keyField] || '-')}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.uploads)}</td>
      <td class="num">${fmtNum(r.approved)}</td>
    </tr>`;
  }).join('');
}

function renderSessionStats(s, dwell) {
  if (!s) {
    ['ss-sessions','ss-pages','ss-duration','ss-bounce'].forEach(id => $(id).textContent = '0');
    return;
  }
  $('ss-sessions').textContent = fmtNum(s.sessions);
  $('ss-pages').textContent    = Number(s.avg_pages || 0).toFixed(2);
  $('ss-duration').textContent = fmtDuration(s.avg_duration_ms);
  if (dwell && Number(dwell.samples) > 0) {
    $('ss-duration-sub').textContent =
      `페이지 평균 ${fmtDuration(dwell.avg_ms)} · 표본 ${fmtNum(dwell.samples)}`;
  } else {
    $('ss-duration-sub').textContent = '페이지 단위 데이터 수집 중';
  }
  const br = Number(s.bounce_rate || 0);
  $('ss-bounce').textContent = (br * 100).toFixed(1) + '%';
}

function renderDwellByPath(rows) {
  const tbody = $('dwellByPath');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">데이터 수집 중 (표본 3건 이상 모이면 표시)</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.avg_ms) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.avg_ms) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    const safePath = String(r.path || '').startsWith('/') ? r.path : '/' + r.path;
    const label = prettyPathLabel(safePath);
    const labelHtml = !safePath.includes('/admin/')
      ? `<a href="..${escapeAttr(safePath)}" target="_blank" rel="noopener" title="${escapeAttr(safePath)}">${escapeHtml(label)}</a>`
      : `<span title="${escapeAttr(safePath)}">${escapeHtml(label)}</span>`;
    return `<tr>
      <td class="path-cell">${labelHtml}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${escapeHtml(fmtDuration(r.avg_ms))}</td>
      <td class="num">${fmtNum(r.samples)}</td>
    </tr>`;
  }).join('');
}

function renderReferrers(rows) {
  const tbody = $('referrers');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">유입 데이터 없음</td></tr>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => Number(r.views) || 0));
  tbody.innerHTML = rows.map(r => {
    const v = Number(r.views) || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    const dom = String(r.referrer_domain || '(direct)');
    const isExternal = dom !== '(direct)' && dom.includes('.');
    const domHtml = isExternal
      ? `<a href="https://${escapeAttr(dom)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dom)}</a>`
      : escapeHtml(dom);
    return `<tr>
      <td class="path-cell">${domHtml}</td>
      <td class="bar-cell"><div class="stat-bar"><span style="width:${pct}%"></span></div></td>
      <td class="num">${fmtNum(r.views)}</td>
    </tr>`;
  }).join('');
}

async function reload() {
  const d = STATE.days;
  const label = `최근 ${d}일`;
  $('chartRangeLabel').textContent  = label;
  $('topRangeLabel').textContent    = label;
  $('refRangeLabel').textContent    = label;
  $('regRangeLabel').textContent    = label;
  $('langRangeLabel').textContent   = label;
  $('sessRangeLabel').textContent   = label;
  $('dwellRangeLabel').textContent  = label;
  $('uploadChartRangeLabel').textContent = label;
  $('themeRangeLabel').textContent       = label;
  $('topContribRangeLabel').textContent  = label;
  $('topFilmsRangeLabel').textContent    = STATE.filmsMode   === 'all' ? '전체 누적' : label;
  $('topCamerasRangeLabel').textContent  = STATE.camerasMode === 'all' ? '전체 누적' : label;

  const topFilmsFn   = STATE.filmsMode   === 'all' ? db().analytics.uploadsTopFilmsAll(10)   : db().analytics.uploadsTopFilms(d, 10);
  const topCamerasFn = STATE.camerasMode === 'all' ? db().analytics.uploadsTopCamerasAll(200) : db().analytics.uploadsTopCameras(d, 200);

  const [
    summary, daily, paths, refs, regs, langs, sess, dwellSum, dwellPaths,
    upSummary, upDaily, upTopContrib, upTopFilms, upTopCameras, upThemeRatio, pendingReports,
  ] = await Promise.all([
    db().analytics.summary(),
    db().analytics.daily(d),
    db().analytics.topPaths(d, 10),
    db().analytics.referrers(d, 15),
    db().analytics.regions(d, 20),
    db().analytics.languages(d, 15),
    db().analytics.sessionStats(d),
    db().analytics.dwellSummary(d),
    db().analytics.dwellByPath(d, 10),
    db().analytics.uploadsSummary(),
    db().analytics.uploadsDaily(d),
    db().analytics.uploadsTopContributors(d, 10),
    topFilmsFn,
    topCamerasFn,
    db().analytics.uploadsThemeRatio(d),
    getPendingReportCount(),
  ]);

  await loadCameraOverrides();

  renderSummary(summary);
  renderChart(daily);
  renderTopPaths(paths);
  renderSessionStats(sess, dwellSum);
  renderDwellByPath(dwellPaths);
  renderReferrers(refs);
  renderRegions(regs);
  renderLanguages(langs);

  renderUploadsSummary(upSummary);
  renderUploadChart(upDaily);
  renderThemeRatio(upThemeRatio);
  renderTopContributors(upTopContrib);
  renderTopByKey('topFilms', upTopFilms, 'film');
  renderTopByKey('topCameras', upTopCameras, 'camera');
  renderOpsStatus({ uploads: upSummary, pendingReports }, { announce: !!STATE.ops.previous });
}

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-current'));
    btn.classList.add('is-current');
    STATE.days = Number(btn.dataset.days) || 30;
    reload();
  });
});

document.querySelectorAll('.top-mode').forEach(group => {
  const target = group.dataset.target;
  group.querySelectorAll('.top-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.top-mode-btn').forEach(b => b.classList.remove('is-current'));
      btn.classList.add('is-current');
      const mode = btn.dataset.mode === 'all' ? 'all' : 'range';
      if (target === 'films')   STATE.filmsMode   = mode;
      if (target === 'cameras') STATE.camerasMode = mode;
      reload();
    });
  });
});

$('opsRefresh').addEventListener('click', () => refreshOpsStatus({ announce: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && STATE.isEditor) {
    refreshOpsStatus({ announce: true });
  }
});

async function purgeClientErrors() {
  const btn = $('clientErrorsPurgeBtn');
  if (!btn) return;
  if (!window.confirm('30일 이전 JS 오류 로그를 삭제할까요?')) return;
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = '정리 중…';
  try {
    const res = await db().analytics.clientErrorsPurge(30);
    if (res?.error) {
      window.showToast?.('정리 실패: ' + (res.error.message || ''), { type: 'danger' });
    } else {
      const n = res?.deleted ?? 0;
      window.showToast?.(n ? `오래된 로그 ${n}건을 정리했어요.` : '정리할 로그가 없었어요.');
      await loadClientErrors();
    }
  } catch (err) {
    window.showToast?.('정리 실패: ' + (err?.message || err), { type: 'danger' });
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

(async function main() {
  for (let i = 0; i < 50; i++) {
    if (db() && db().isReady()) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const ok = await checkAccess();
  if (!ok) return;
  $('gate').hidden = true;
  $('app').hidden = false;
  $('clientErrorsPurgeBtn')?.addEventListener('click', purgeClientErrors);
  await Promise.all([loadThumbnailDebt(), loadClientErrors()]);
  await reload();
  startOpsWatch();
})();
