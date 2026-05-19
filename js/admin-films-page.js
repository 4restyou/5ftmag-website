'use strict';

const STATE = {
  user: null,
  isEditor: false,
  films: [],
  filter: '',
  editingSlug: null,
};

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ═════════════════════════════════════════
// 접근 권한
// ═════════════════════════════════════════
function showGate(msg) {
  $('gate').hidden = false;
  if (msg) $('gate').querySelector('p').textContent = msg;
}

async function checkAccess() {
  for (let i = 0; i < 50; i++) {
    if (db() && db().isReady()) break;
    await new Promise(r => setTimeout(r, 50));
  }
  if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;
  const profile = await db().profiles.getMine();
  if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
  STATE.isEditor = true;
  $('adminUser').innerHTML = `${escapeHtml(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
  return true;
}

$('gateLogin').addEventListener('click', async () => {
  await db().auth.signInWithGoogle(window.location.href);
});

// ═════════════════════════════════════════
// 목록 로드 + 렌더
// ═════════════════════════════════════════
async function reload() {
  STATE.films = await db().films.list();
  render();
}

function applyFilter(films, q) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return films;
  return films.filter(f => (
    String(f.slug || '').toLowerCase().includes(k) ||
    String(f.brand || '').toLowerCase().includes(k) ||
    String(f.name || '').toLowerCase().includes(k) ||
    String(f.display_name || '').toLowerCase().includes(k)
  ));
}

function render() {
  const filtered = applyFilter(STATE.films, STATE.filter);
  $('count').textContent = `${filtered.length} / ${STATE.films.length}`;
  if (filtered.length === 0) {
    $('tbody').innerHTML = '<tr><td colspan="5" class="empty">필름이 없어요.</td></tr>';
    return;
  }
  $('tbody').innerHTML = filtered.map(f => {
    const display = f.display_name || `${f.brand} ${f.name}`;
    const spec = [f.iso ? `ISO ${f.iso}` : '', f.type, f.format].filter(Boolean).join(' · ');
    const photoCount = Array.isArray(f.photos) ? f.photos.length : 0;
    return `
      <tr>
        <td>
          <div class="col-display">${escapeHtml(display)}</div>
          <div class="col-slug">${escapeHtml(f.slug)}</div>
        </td>
        <td class="col-meta">${escapeHtml(spec)}</td>
        <td><span class="badge ${f.tier === 'featured' ? 'featured' : ''}">${escapeHtml(f.tier || 'library')}</span></td>
        <td class="col-meta">${photoCount}</td>
        <td class="col-actions">
          <button type="button" class="row-btn" data-edit="${escapeAttr(f.slug)}">수정</button>
          <button type="button" class="row-btn danger" data-delete="${escapeAttr(f.slug)}">삭제</button>
        </td>
      </tr>
    `;
  }).join('');

  $('tbody').querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openForm(btn.dataset.edit));
  });
  $('tbody').querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteFilm(btn.dataset.delete));
  });
}

$('filter').addEventListener('input', (e) => {
  STATE.filter = e.target.value;
  render();
});

// ═════════════════════════════════════════
// 폼
// ═════════════════════════════════════════
function aliasesToText(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.join(', ');
}
function textToAliases(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function openForm(slug) {
  STATE.editingSlug = slug || null;
  $('modal').classList.add('open');
  if (slug) {
    const f = STATE.films.find(x => x.slug === slug);
    if (!f) { closeForm(); return; }
    $('modalTitle').textContent = `필름 수정 — ${f.display_name || (f.brand + ' ' + f.name)}`;
    $('originalSlug').value = f.slug;
    $('f-slug').value = f.slug;
    $('f-slug').readOnly = true;
    $('f-brand').value = f.brand || '';
    $('f-name').value = f.name || '';
    $('f-displayName').value = f.display_name || '';
    $('f-iso').value = f.iso || '';
    $('f-type').value = f.type || '';
    $('f-format').value = f.format || '';
    $('f-tier').value = f.tier || 'library';
    $('f-issue').value = f.issue || '';
    $('f-aliases').value = aliasesToText(f.aliases);
    $('f-desc').value = f.description || '';
    $('f-canThumbnail').value = f.can_thumbnail || '';
  } else {
    $('modalTitle').textContent = '새 필름';
    $('originalSlug').value = '';
    $('filmForm').reset();
    $('f-slug').readOnly = false;
    $('f-tier').value = 'library';
  }
}

function closeForm() {
  $('modal').classList.remove('open');
  STATE.editingSlug = null;
  $('filmForm').reset();
  $('f-slug').readOnly = false;
}

$('newBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', closeForm);
$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeForm();
});

$('filmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = $('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중…';
  try {
    const form = e.target;
    const slug = String(form.slug.value || '').trim();
    if (!slug) { window.notify?.('slug 가 필요해요.', 'danger'); return; }
    const record = {
      slug,
      tier: form.tier.value || 'library',
      brand: form.brand.value.trim(),
      name: form.name.value.trim(),
      displayName: form.displayName.value.trim() || `${form.brand.value.trim()} ${form.name.value.trim()}`.trim(),
      aliases: textToAliases(form.aliases.value),
      description: form.description.value.trim(),
      iso: form.iso.value.trim() || null,
      type: form.type.value.trim() || null,
      format: form.format.value.trim() || null,
      issue: form.issue.value.trim() || null,
      canThumbnail: form.canThumbnail.value.trim() || null,
      canThumbnailStatus: form.canThumbnail.value.trim() ? 'set' : 'pending',
    };
    const { error } = await db().films.upsert(record);
    if (error) {
      window.notify?.('저장 실패: ' + (error.message || ''), 'danger');
      return;
    }
    window.notify?.(STATE.editingSlug ? '필름을 수정했어요.' : '새 필름을 추가했어요.', 'info');
    closeForm();
    await reload();
  } catch (err) {
    window.notify?.('저장 실패: ' + (err?.message || err), 'danger');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
});

async function deleteFilm(slug) {
  if (!slug) return;
  const f = STATE.films.find(x => x.slug === slug);
  const label = f ? (f.display_name || `${f.brand} ${f.name}`) : slug;
  if (!confirm(`"${label}" 필름을 삭제할까요?\n사진이 등록되어 있어도 함께 사라집니다.`)) return;
  const { error } = await db().films.remove(slug);
  if (error) {
    window.notify?.('삭제 실패: ' + (error.message || ''), 'danger');
    return;
  }
  window.notify?.(`"${label}" 을 삭제했어요.`, 'info');
  STATE.films = STATE.films.filter(x => x.slug !== slug);
  render();
}

// ═════════════════════════════════════════
(async function main() {
  const ok = await checkAccess();
  if (!ok) return;
  $('gate').hidden = true;
  $('app').hidden = false;
  await reload();
})();
