'use strict';

// 5ft.mag 웹진 관리 (비공개) — 편집부가 PDF/표지를 올리고 발행 토글.
const STATE = { user: null, issues: [], editingId: null };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }

function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }

function withWriteTimeout(promise, ms = 60000) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve({ error: { message: '시간이 초과됐어요. 네트워크를 확인하고 다시 시도해 주세요.' } }); } }, ms);
    Promise.resolve(promise).then(
      (res) => { if (!settled) { settled = true; clearTimeout(t); resolve(res); } },
      (err) => { if (!settled) { settled = true; clearTimeout(t); resolve({ error: { message: err?.message || String(err) } }); } }
    );
  });
}

function slugify(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function extOf(name, fallback) { const m = String(name || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : fallback; }

// ── 접근 권한 ──
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

// ── 목록 ──
async function reload() {
  STATE.issues = await db().webzine.listAll();
  render();
}

function render() {
  const tbody = $('tbody');
  $('count').textContent = `${STATE.issues.length}개`;
  if (!STATE.issues.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">아직 등록된 웹진이 없습니다.</td></tr>'; return; }
  tbody.innerHTML = STATE.issues.map(it => `
    <tr data-id="${escapeHtml(it.id)}">
      <td class="col-title">${escapeHtml(it.title)}</td>
      <td>${escapeHtml(it.issue_label || '')}</td>
      <td>${escapeHtml(it.category || '')}</td>
      <td>${it.published ? '<span class="badge live">공개</span>' : '<span class="badge">비공개</span>'}</td>
      <td>${Number(it.sort_order) || 0}</td>
      <td class="col-actions">
        <button type="button" class="row-btn" data-act="edit">수정</button>
        <button type="button" class="row-btn" data-act="toggle">${it.published ? '비공개로' : '공개'}</button>
        <button type="button" class="row-btn danger" data-act="del">삭제</button>
      </td>
    </tr>`).join('');
}

$('tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('.row-btn'); if (!btn) return;
  const id = btn.closest('tr')?.dataset.id;
  const issue = STATE.issues.find(x => String(x.id) === String(id));
  if (!issue) return;
  if (btn.dataset.act === 'edit') { openModal(issue); }
  else if (btn.dataset.act === 'toggle') {
    btn.disabled = true;
    const { error } = await withWriteTimeout(db().webzine.upsert({ id: issue.id, slug: issue.slug, title: issue.title, published: !issue.published }));
    if (error) alert('변경 실패: ' + error.message);
    await reload();
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`"${issue.title}" 을(를) 삭제할까요? (목록에서만 제거되며 업로드 파일은 남습니다)`)) return;
    const { error } = await withWriteTimeout(db().webzine.remove(issue.id));
    if (error) alert('삭제 실패: ' + error.message);
    await reload();
  }
});

// ── 모달 ──
function openModal(issue) {
  STATE.editingId = issue ? issue.id : null;
  $('modalTitle').textContent = issue ? '웹진 수정' : '새 웹진';
  $('f-id').value = issue?.id || '';
  $('f-title').value = issue?.title || '';
  $('f-issue').value = issue?.issue_label || '';
  $('f-category').value = issue?.category || '';
  $('f-desc').value = issue?.description || '';
  $('f-slug').value = issue?.slug || '';
  $('f-sort').value = issue?.sort_order ?? 0;
  $('f-cover').value = '';
  $('f-pdf').value = '';
  $('f-pub').checked = !!issue?.published;
  $('cover-hint').textContent = issue?.cover_path ? '현재 표지 있음 (새 파일 선택 시 교체)' : '';
  $('pdf-hint').textContent = issue?.pdf_path ? '현재 PDF 있음 (새 파일 선택 시 교체)' : '웹용으로 최적화한 PDF 권장(최대 60MB).';
  $('formMsg').textContent = ''; $('formMsg').classList.remove('error');
  $('modal').classList.add('open');
}
function closeModal() { $('modal').classList.remove('open'); }
$('newBtn').addEventListener('click', () => openModal(null));
$('cancelBtn').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

function setMsg(text, isError) { const m = $('formMsg'); m.textContent = text || ''; m.classList.toggle('error', !!isError); }

$('wzForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = $('saveBtn');
  const id = $('f-id').value || null;
  const title = $('f-title').value.trim();
  const slug = (slugify($('f-slug').value) || slugify(title));
  if (!title || !slug) { setMsg('제목과 slug 는 필수입니다.', true); return; }
  const existing = STATE.issues.find(x => String(x.id) === String(id));
  const coverFile = $('f-cover').files[0];
  const pdfFile = $('f-pdf').files[0];

  saveBtn.disabled = true;
  try {
    let cover_path = existing?.cover_path || null;
    let pdf_path = existing?.pdf_path || null;

    if (coverFile) {
      setMsg('표지 업로드 중…');
      const path = `${slug}/cover.${extOf(coverFile.name, 'jpg')}`;
      const { error } = await withWriteTimeout(db().webzine.uploadFile(path, coverFile));
      if (error) { setMsg('표지 업로드 실패: ' + error.message, true); return; }
      cover_path = path;
    }
    if (pdfFile) {
      setMsg('PDF 업로드 중… (용량이 크면 시간이 걸려요)');
      const path = `${slug}/source.pdf`;
      const { error } = await withWriteTimeout(db().webzine.uploadFile(path, pdfFile), 120000);
      if (error) { setMsg('PDF 업로드 실패: ' + error.message, true); return; }
      pdf_path = path;
    }

    const record = {
      slug, title,
      issue_label: $('f-issue').value.trim() || null,
      category: $('f-category').value.trim() || null,
      description: $('f-desc').value.trim() || null,
      cover_path, pdf_path,
      published: $('f-pub').checked,
      sort_order: Number($('f-sort').value) || 0,
      updated_at: new Date().toISOString(),
    };
    if (id) record.id = id;

    setMsg('저장 중…');
    const { error } = await withWriteTimeout(db().webzine.upsert(record));
    if (error) { setMsg('저장 실패: ' + error.message, true); return; }
    closeModal();
    await reload();
  } finally {
    saveBtn.disabled = false;
  }
});

(async function init() {
  if (await checkAccess()) { $('app').hidden = false; await reload(); }
})();
