'use strict';

const STATE = {
  user: null,
  isEditor: false,
  films: [],
  readerCounts: new Map(),
  filter: '',
  editingSlug: null,
  proposals: [],
  pendingProposalForForm: null,
};

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }

// 세션 만료 시 인증 쓰기 요청이 응답 없이 멈추는 것을 막는다.
// 일정 시간 안에 안 끝나면 끊고, 새로고침 안내를 error 로 돌려준다.
function withWriteTimeout(promise, ms = 10000) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ error: { message: '세션이 만료된 것 같아요. 페이지를 새로고침한 뒤 다시 시도해주세요.' } });
    }, ms);
    Promise.resolve(promise).then(
      (res) => { if (!settled) { settled = true; clearTimeout(t); resolve(res); } },
      (err) => { if (!settled) { settled = true; clearTimeout(t); resolve({ error: { message: err?.message || String(err) } }); } }
    );
  });
}

function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }
function escapeAttr(s) { return window.MagUtil.escapeAttr(s); }

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
  const [films, submissions, proposals] = await Promise.all([
    db().films.listAll().catch(() => []),
    db().submissions.listApproved(null).catch(() => []),
    // filmProposals 가 정의 안 된 빌드(또는 테스트 mock) 에선 빈 배열로 폴백
    (db().filmProposals?.listForReview?.({ status: 'pending' })?.catch?.(() => []) || Promise.resolve([])),
  ]);
  STATE.films = Array.isArray(films) ? films : [];
  STATE.readerCounts = buildReaderCountsByFilm(STATE.films, submissions || []);
  STATE.proposals = Array.isArray(proposals) ? proposals : [];
  render();
  renderProposals();
}

function renderProposals() {
  const box = document.getElementById('proposalsBox');
  const list = document.getElementById('proposalsList');
  const count = document.getElementById('proposalsCount');
  if (!box || !list) return;
  const rows = STATE.proposals || [];
  if (rows.length === 0) { box.hidden = true; return; }
  box.hidden = false;
  count.textContent = String(rows.length);
  list.innerHTML = rows.map(p => {
    const display = p.display_name || `${p.brand || ''} ${p.name || ''}`.trim();
    const meta = [p.iso, p.type, p.format].filter(Boolean).join(' · ');
    const desc = p.description ? `<div class="proposal-desc">${escapeHtml(p.description)}</div>` : '';
    return `
      <div class="proposal-row" data-id="${escapeAttr(p.id)}">
        <div>
          <div class="proposal-title">${escapeHtml(display)}</div>
          <div class="proposal-meta">${escapeHtml(meta || '메타 없음')} · ${escapeHtml(new Date(p.created_at).toLocaleDateString('ko-KR'))}</div>
          ${desc}
        </div>
        <div class="proposal-actions">
          <button type="button" class="approve" data-action="approve-proposal">이 내용으로 새 필름</button>
          <button type="button" data-action="reject-proposal">반려</button>
        </div>
      </div>`;
  }).join('');
}

// 이벤트 위임: 검토 액션
document.addEventListener('click', async (e) => {
  const row = e.target.closest('.proposal-row');
  if (!row) return;
  const id = row.dataset.id;
  const p = (STATE.proposals || []).find(x => x.id === id);
  if (!p) return;
  if (e.target.dataset.action === 'approve-proposal') {
    // 새 필름 폼 열고 미리 채움. 저장 시 처리: 신청을 approved 로 + 알림.
    STATE.pendingProposalForForm = p;
    openForm(null);
    // 폼 미리 채움
    document.getElementById('f-brand').value = p.brand || '';
    document.getElementById('f-name').value = p.name || '';
    document.getElementById('f-displayName').value = p.display_name || '';
    document.getElementById('f-iso').value = p.iso || '';
    document.getElementById('f-type').value = p.type || '';
    document.getElementById('f-format').value = p.format || '';
    document.getElementById('f-desc').value = p.description || '';
    document.getElementById('f-aliases').value = aliasesToText(p.aliases || []);
    // slug 추천(브랜드+이름의 lowercase, 비영문 제거)
    const slugGuess = String(`${p.brand || ''}${p.name || ''}`).toLowerCase().replace(/[^a-z0-9]+/g, '');
    document.getElementById('f-slug').value = slugGuess;
  } else if (e.target.dataset.action === 'reject-proposal') {
    const note = prompt('반려 사유(신청자에게 안내됨, 선택):') || '';
    if (note === null) return;
    const { error } = await db().filmProposals.reject(id, note);
    if (error) { window.notify?.('반려 실패: ' + error.message, 'danger'); return; }
    await db().filmProposals.notifyDecision({ ...p, reviewer_notes: note }, 'rejected');
    window.notify?.('반려 처리했어요.', 'info');
    await reload();
  }
});

function normalizeFilmLabel(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
}

function filmAliases(film) {
  return [
    ...(Array.isArray(film.aliases) ? film.aliases : []),
    film.display_name,
    film.displayName,
    film.name,
    `${film.brand || ''} ${film.name || ''}`.trim(),
  ].filter(Boolean);
}

function buildReaderCountsByFilm(films, submissions) {
  const aliasToSlug = new Map();
  for (const film of films || []) {
    if (!film?.slug) continue;
    for (const alias of filmAliases(film)) {
      const key = normalizeFilmLabel(alias);
      if (key && !aliasToSlug.has(key)) aliasToSlug.set(key, film.slug);
    }
  }

  const counts = new Map();
  for (const row of submissions || []) {
    const slug = aliasToSlug.get(normalizeFilmLabel(row.film));
    if (!slug) continue;
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return counts;
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
    const readerCount = STATE.readerCounts.get(f.slug) || 0;
    const hidden = !!f.is_hidden;
    const hideLabel = hidden ? '복원' : '숨김';
    return `
      <tr${hidden ? ' style="opacity:.55"' : ''}>
        <td data-label="필름">
          <div class="col-display">${escapeHtml(display)}${hidden ? ' <span class="badge" style="background:#fde68a;color:#78350f">숨김</span>' : ''}</div>
          <div class="col-slug">${escapeHtml(f.slug)}</div>
        </td>
        <td class="col-meta" data-label="스펙">${escapeHtml(spec)}</td>
        <td data-label="등급"><span class="badge ${f.tier === 'featured' ? 'featured' : ''}">${escapeHtml(f.tier || 'library')}</span></td>
        <td class="col-meta" data-label="컷">${readerCount}</td>
        <td class="col-actions" data-label="actions">
          <button type="button" class="row-btn" data-edit="${escapeAttr(f.slug)}">수정</button>
          <button type="button" class="row-btn" data-toggle-hidden="${escapeAttr(f.slug)}" data-current-hidden="${hidden}">${hideLabel}</button>
          <button type="button" class="row-btn danger" data-delete="${escapeAttr(f.slug)}">삭제</button>
        </td>
      </tr>
    `;
  }).join('');

  $('tbody').querySelectorAll('[data-toggle-hidden]').forEach(btn => {
    btn.addEventListener('click', () => toggleHidden(btn.dataset.toggleHidden, btn.dataset.currentHidden === 'true'));
  });

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
    setCanThumbPreview(f.can_thumbnail || '');
  } else {
    $('modalTitle').textContent = '새 필름';
    $('originalSlug').value = '';
    $('filmForm').reset();
    $('f-slug').readOnly = false;
    $('f-tier').value = 'library';
    setCanThumbPreview('');
  }
  // 삭제 버튼은 기존 항목 수정 시에만 노출
  const deleteBtn = $('deleteBtn');
  if (deleteBtn) deleteBtn.hidden = !slug;
  // slug 입력 변화에 즉시 중복 검사 안내
  validateSlugLive();
}

function validateSlugLive() {
  const warn = $('slugWarn');
  if (!warn) return;
  const slugEl = $('f-slug');
  const value = (slugEl?.value || '').trim().toLowerCase();
  if (!value) { warn.textContent = ''; warn.classList.remove('is-error'); return; }
  if (!/^[a-z0-9-]+$/.test(value)) {
    warn.textContent = '소문자·숫자·하이픈(-) 만 사용 가능해요.';
    warn.classList.add('is-error');
    return;
  }
  const duplicate = STATE.films.some(f => f.slug === value && f.slug !== STATE.editingSlug);
  if (duplicate) {
    warn.textContent = '이미 사용 중인 slug 예요. 다른 이름을 골라주세요.';
    warn.classList.add('is-error');
  } else {
    warn.textContent = '';
    warn.classList.remove('is-error');
  }
}

function setCanThumbPreview(url) {
  const img = $('f-canThumbPreview');
  const clearBtn = $('f-canThumbClear');
  if (url) {
    img.src = url;
    img.hidden = false;
    clearBtn.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    clearBtn.hidden = true;
  }
}

// 파일 선택 → 미리보기(데이터 URL). 실제 업로드는 폼 submit 시 (slug 확정 후).
$('f-canThumbFile').addEventListener('change', () => {
  const file = $('f-canThumbFile').files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setCanThumbPreview(reader.result);
  reader.readAsDataURL(file);
});

// 등록된 썸네일 제거 — 파일 선택 초기화 + 저장된 URL 도 지움
$('f-canThumbClear').addEventListener('click', () => {
  $('f-canThumbFile').value = '';
  $('f-canThumbnail').value = '';
  setCanThumbPreview('');
});

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
// slug 입력 즉시 검증 — 중복·문자 제한
$('f-slug').addEventListener('input', validateSlugLive);
// 모달의 [삭제] 버튼 — 기존 행 삭제 로직 재사용
$('deleteBtn')?.addEventListener('click', () => {
  if (!STATE.editingSlug) return;
  deleteFilm(STATE.editingSlug);
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

    // 캔 썸네일 파일이 선택되어 있으면 먼저 Storage 에 업로드 → URL 을 record 에 채움.
    // 파일 미선택이면 기존 hidden 값(편집 진입 시 채워졌거나 빈 값) 그대로 사용.
    let canThumbUrl = form.canThumbnail.value.trim() || null;
    const canThumbFile = $('f-canThumbFile').files?.[0];
    if (canThumbFile) {
      saveBtn.textContent = '썸네일 업로드 중…';
      const up = await db().films.uploadCanThumbnail(slug, canThumbFile);
      if (up.error) {
        window.notify?.('썸네일 업로드 실패: ' + (up.error.message || ''), 'danger');
        return;
      }
      canThumbUrl = up.url;
    }
    saveBtn.textContent = '저장 중…';

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
      canThumbnail: canThumbUrl,
      canThumbnailStatus: canThumbUrl ? 'set' : 'pending',
    };
    const { error } = await withWriteTimeout(db().films.upsert(record));
    if (error) {
      window.notify?.('저장 실패: ' + (error.message || ''), 'danger');
      return;
    }
    window.notify?.(STATE.editingSlug ? '필름을 수정했어요.' : '새 필름을 추가했어요.', 'info');
    // 검토 대기 신청에서 들어온 경우 신청을 승인 처리 + 신청자 알림
    if (STATE.pendingProposalForForm && !STATE.editingSlug) {
      const p = STATE.pendingProposalForForm;
      try {
        await db().filmProposals.approve(p.id, slug, null);
        await db().filmProposals.notifyDecision(p, 'approved', `/films.html#film-${slug}`);
      } catch (_) { /* silently — 새 필름 저장은 이미 성공 */ }
      STATE.pendingProposalForForm = null;
    }
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
  // 모달에서 호출됐으면 모달도 닫아준다
  if (STATE.editingSlug === slug) closeForm();
  render();
}

async function toggleHidden(slug, currentlyHidden) {
  if (!slug) return;
  const f = STATE.films.find(x => x.slug === slug);
  const label = f ? (f.display_name || `${f.brand} ${f.name}`) : slug;
  const next = !currentlyHidden;
  const { error } = await db().films.setHidden(slug, next);
  if (error) {
    window.notify?.((next ? '숨김' : '복원') + ' 실패: ' + (error.message || ''), 'danger');
    return;
  }
  if (f) f.is_hidden = next;
  window.notify?.(`"${label}" 을 ${next ? '숨김' : '복원'} 처리했어요. 라이브에 바로 반영돼요.`, 'info');
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
