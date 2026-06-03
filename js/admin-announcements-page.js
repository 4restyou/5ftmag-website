'use strict';

// 5ft.mag 공지 관리 — 편집부가 사이트 상단 마퀴 배너 공지를 등록·관리.
const STATE = { user: null, items: [] };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

// datetime-local 입력값 (`YYYY-MM-DDTHH:mm`, 로컬) → ISO (UTC)
function localToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function statusBadge(item, now) {
  if (!item.is_active) return '<span class="badge inactive">비활성</span>';
  const starts = new Date(item.starts_at).getTime();
  const ends = item.ends_at ? new Date(item.ends_at).getTime() : null;
  if (starts > now) return '<span class="badge scheduled">예약</span>';
  if (ends !== null && ends < now) return '<span class="badge expired">지남</span>';
  return '<span class="badge live">진행중</span>';
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

async function reload() {
  const { data, error } = await db().announcements.listAll();
  if (error) { console.error(error); STATE.items = []; }
  else STATE.items = data;
  render();
}

function render() {
  const tbody = $('tbody');
  if (!STATE.items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">등록된 공지가 없습니다.</td></tr>';
    return;
  }
  const now = Date.now();
  tbody.innerHTML = STATE.items.map(it => `
    <tr data-id="${escapeHtml(it.id)}">
      <td>${statusBadge(it, now)}</td>
      <td class="col-body">${escapeHtml(it.body)}</td>
      <td class="col-time">${fmtTime(it.starts_at)}</td>
      <td class="col-time">${it.ends_at ? fmtTime(it.ends_at) : '—'}</td>
      <td class="col-actions">
        <button type="button" class="row-btn" data-act="toggle">${it.is_active ? '비활성화' : '활성화'}</button>
        <button type="button" class="row-btn danger" data-act="del">삭제</button>
      </td>
    </tr>`).join('');
}

$('tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.row-btn'); if (!btn) return;
  const id = btn.closest('tr')?.dataset.id;
  const item = STATE.items.find(x => x.id === id);
  if (!item) return;
  if (btn.dataset.act === 'toggle') {
    btn.disabled = true;
    const { error } = await db().announcements.update(id, { is_active: !item.is_active });
    if (error) alert('변경 실패: ' + error.message);
    await reload();
  } else if (btn.dataset.act === 'del') {
    if (!confirm('이 공지를 삭제할까요? (되돌릴 수 없습니다)')) return;
    btn.disabled = true;
    const { error } = await db().announcements.remove(id);
    if (error) alert('삭제 실패: ' + error.message);
    await reload();
  }
});

$('newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = $('f-body').value.trim();
  const starts_at = localToIso($('f-starts').value);
  const ends_at = localToIso($('f-ends').value);
  const msg = $('formMsg');
  msg.className = 'form-msg';
  msg.textContent = '';
  if (!body) { msg.classList.add('error'); msg.textContent = '본문은 필수예요.'; return; }
  if (body.length > 500) { msg.classList.add('error'); msg.textContent = '본문은 500자 이내.'; return; }
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
    msg.classList.add('error'); msg.textContent = '종료는 시작보다 뒤여야 해요.'; return;
  }
  const saveBtn = $('saveBtn');
  saveBtn.disabled = true;
  const { error } = await db().announcements.create({ body, starts_at, ends_at });
  saveBtn.disabled = false;
  if (error) { msg.classList.add('error'); msg.textContent = '등록 실패: ' + error.message; return; }
  msg.classList.add('ok'); msg.textContent = '등록 완료.';
  $('newForm').reset();
  await reload();
});

(async function start() {
  if (!(await checkAccess())) return;
  $('app').hidden = false;
  await reload();
})();
