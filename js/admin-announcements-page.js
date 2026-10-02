'use strict';

// 5ft.mag 공지 관리 — 편집부가 사이트 상단 마퀴 배너 공지를 등록·관리.
const STATE = { user: null, items: [], editingId: null };

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

// ISO → datetime-local 입력값 (`YYYY-MM-DDTHH:mm`, 로컬). 수정할 때 폼에 되돌려 넣는다.
function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusBadge(item, now) {
  if (!item.is_active) return '<span class="badge inactive">비활성</span>';
  const starts = new Date(item.starts_at).getTime();
  const ends = item.ends_at ? new Date(item.ends_at).getTime() : null;
  if (starts > now) return '<span class="badge scheduled">예약</span>';
  if (ends !== null && ends < now) return '<span class="badge expired">지남</span>';
  return '<span class="badge live">진행중</span>';
}

// 영·일 칸이 빈 언어 배지 (필름·현상소 목록과 같은 모양).
function missBadges(it) {
  return ['en', 'ja'].filter((l) => !String(it[`body_${l}`] || '').trim())
    .map((l) => `<span class="tr-miss">${l.toUpperCase()} 없음</span>`).join('');
}

// 접근 권한 — 공통 게이트(js/admin-guard.js) 위임.
const showGate = (msg) => window.AdminGuard.showGate(msg);
async function checkAccess() { return window.AdminGuard.requireEditor(STATE); }

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
      <td data-label="상태">${statusBadge(it, now)}</td>
      <td class="col-body" data-label="본문">${escapeHtml(it.body)}${missBadges(it)}</td>
      <td class="col-time" data-label="시작">${fmtTime(it.starts_at)}</td>
      <td class="col-time" data-label="종료">${it.ends_at ? fmtTime(it.ends_at) : '—'}</td>
      <td class="col-actions">
        <button type="button" class="row-btn" data-act="edit">수정</button>
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
  if (btn.dataset.act === 'edit') {
    startEdit(item);
  } else if (btn.dataset.act === 'toggle') {
    btn.disabled = true;
    const { error } = await db().announcements.update(id, { is_active: !item.is_active });
    if (error) window.notify('변경 실패: ' + error.message, 'danger');
    await reload();
  } else if (btn.dataset.act === 'del') {
    if (!confirm('이 공지를 삭제할까요? (되돌릴 수 없습니다)')) return;
    btn.disabled = true;
    const { error } = await db().announcements.remove(id);
    if (error) window.notify('삭제 실패: ' + error.message, 'danger');
    await reload();
  }
});

// 수정 — 등록 폼을 그대로 쓴다. 영·일 칸을 나중에 채울 때 주로 쓴다.
function startEdit(item) {
  STATE.editingId = item.id;
  $('f-body').value = item.body || '';
  $('f-bodyEn').value = item.body_en || '';
  $('f-bodyJa').value = item.body_ja || '';
  $('f-starts').value = isoToLocal(item.starts_at);
  $('f-ends').value = isoToLocal(item.ends_at);
  $('formTitle').textContent = '공지 수정';
  $('saveBtn').textContent = '수정 저장';
  $('cancelEditBtn').hidden = false;
  $('formMsg').textContent = '';
  $('newForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function endEdit() {
  STATE.editingId = null;
  $('newForm').reset();
  $('formTitle').textContent = '새 공지 등록';
  $('saveBtn').textContent = '등록';
  $('cancelEditBtn').hidden = true;
}
$('cancelEditBtn').addEventListener('click', () => { endEdit(); $('formMsg').textContent = ''; });

$('newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = $('f-body').value.trim();
  const body_en = $('f-bodyEn').value.trim();
  const body_ja = $('f-bodyJa').value.trim();
  const starts_at = localToIso($('f-starts').value);
  const ends_at = localToIso($('f-ends').value);
  const msg = $('formMsg');
  msg.className = 'form-msg';
  msg.textContent = '';
  if (!body) { msg.classList.add('error'); msg.textContent = '본문은 필수예요.'; return; }
  if (body.length > 500 || body_en.length > 500 || body_ja.length > 500) { msg.classList.add('error'); msg.textContent = '본문은 언어마다 500자 이내.'; return; }
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
    msg.classList.add('error'); msg.textContent = '종료는 시작보다 뒤여야 해요.'; return;
  }
  const saveBtn = $('saveBtn');
  saveBtn.disabled = true;
  const editing = STATE.editingId;
  const { error } = editing
    // starts_at 은 NOT NULL 이라, 수정 때 비우면 원래 시작 시각을 그대로 둔다.
    ? await db().announcements.update(editing, { body, body_en, body_ja, ends_at, ...(starts_at ? { starts_at } : {}) })
    : await db().announcements.create({ body, body_en, body_ja, starts_at, ends_at });
  saveBtn.disabled = false;
  const verb = editing ? '수정' : '등록';
  if (error) { msg.classList.add('error'); msg.textContent = verb + ' 실패: ' + error.message; return; }
  msg.classList.add('ok'); msg.textContent = verb + ' 완료.';
  endEdit();
  await reload();
});

(async function start() {
  if (!(await checkAccess())) return;
  $('app').hidden = false;
  await reload();
})();
