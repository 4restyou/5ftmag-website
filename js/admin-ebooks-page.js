'use strict';

// admin/ebooks 페이지 — ebook_products CRUD + 페이지 이미지 업로드 + 열람권 부여.

const STATE = {
  user: null,
  isEditor: false,
  rows: [],
  filter: '',
  kind: 'all',
  editing: null, // slug or null (=새 항목)
};

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }
function escapeAttr(s) { return window.MagUtil.escapeAttr(s); }

// ────────── 권한 ──────────
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

// ────────── 목록 ──────────
async function reload() {
  STATE.rows = await db().ebooks.listAll();
  render();
}

function kindLabel(kind) {
  switch (kind) {
    case 'spc':       return 'SPC 사진첩';
    case 'backissue': return '5ft 이월호';
    default:          return kind || '—';
  }
}

function fmtPrice(n) {
  if (!n || n <= 0) return '—';
  return n.toLocaleString('ko-KR') + '원';
}

function render() {
  const q = STATE.filter.toLowerCase();
  const kind = STATE.kind;
  const filtered = STATE.rows.filter(r => {
    if (kind !== 'all' && r.kind !== kind) return false;
    if (!q) return true;
    return (r.title || '').toLowerCase().includes(q) || (r.slug || '').toLowerCase().includes(q);
  });

  $('count').textContent = `${filtered.length} / ${STATE.rows.length} 이북`;
  const tbody = $('rows');
  const empty = $('empty');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = STATE.rows.length === 0
      ? '등록된 이북이 없어요. "+ 새 이북" 으로 첫 항목을 추가하세요.'
      : '필터에 일치하는 이북이 없어요.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = filtered.map(r => {
    const thumb = r.cover_image
      ? `<img src="${escapeAttr(r.cover_image)}" alt="" loading="lazy" />`
      : '';
    const statusBadges = [
      r.published ? '<span class="badge pub">발행</span>' : '<span class="badge unpub">초안</span>',
      r.ebook_on_sale ? '<span class="badge onsale">이북 판매중</span>' : '',
    ].filter(Boolean).join(' ');
    const pageInfo = r.page_count ? `${r.page_count}p` : '0p';
    return `
      <tr data-slug="${escapeAttr(r.slug)}">
        <td class="col-thumb">${thumb}</td>
        <td>
          <div class="col-title">${escapeHtml(r.title)}</div>
          <div class="col-slug">${escapeHtml(r.slug)} · ${pageInfo}</div>
        </td>
        <td>${escapeHtml(kindLabel(r.kind))}</td>
        <td class="col-price">${escapeHtml(fmtPrice(r.price))}</td>
        <td>${statusBadges}</td>
        <td class="col-actions">
          <button type="button" class="mini-btn" data-action="edit" data-slug="${escapeAttr(r.slug)}">편집</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ────────── 폼 ──────────
function currentRow() {
  return STATE.editing ? STATE.rows.find(r => r.slug === STATE.editing) : null;
}

function openForm(row) {
  STATE.editing = row ? row.slug : null;
  const form = $('form');
  $('modalTitle').textContent = row ? `편집 — ${row.title || row.slug}` : '새 이북';
  $('delBtn').hidden = !row;
  $('formMsg').textContent = '';

  form.slug.value = row?.slug || '';
  form.slug.readOnly = !!row;
  form.title.value = row?.title || '';
  form.kind.value = row?.kind || 'spc';
  form.price.value = window.MoneyInput ? window.MoneyInput.format(row?.price) : (row?.price ?? '');
  form.original_price.value = window.MoneyInput ? window.MoneyInput.format(row?.original_price) : (row?.original_price ?? '');
  form.excerpt.value = row?.excerpt || '';
  form.description.value = row?.description || '';
  STATE.coverImage = row?.cover_image || '';   // 재업로드 안 하면 유지
  $('coverFile').value = '';
  const cp = $('coverPreview');
  if (STATE.coverImage) { cp.src = STATE.coverImage; cp.style.display = 'block'; }
  else { cp.removeAttribute('src'); cp.style.display = 'none'; }
  form.sort_order.value = row?.sort_order ?? 0;
  form.published.checked = !!row?.published;
  form.ebook_on_sale.checked = !!row?.ebook_on_sale;

  // 편집 전용 패널 (페이지 업로드 / 열람권) — 새 항목엔 숨김 (저장 후 편집에서)
  $('pagesPanel').hidden = !row;
  $('entPanel').hidden = !row;
  $('pagesMsg').textContent = '';
  $('entMsg').textContent = '';
  $('entResults').innerHTML = '';
  $('entHolders').innerHTML = '';
  $('entSearch').value = '';
  if (row) { refreshPagesStatus(row); refreshHolders(row); }

  $('modal').classList.add('open');
  setTimeout(() => form.title.focus(), 50);
}

function closeForm() {
  $('modal').classList.remove('open');
  STATE.editing = null;
}

async function saveForm(e) {
  e.preventDefault();
  const f = e.target;
  let slug = f.slug.value.normalize('NFKC').toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[​-‍﻿ \s]/g, '');
  if (slug !== f.slug.value) f.slug.value = slug;
  if (!/^[a-z0-9-]+$/.test(slug)) {
    $('formMsg').textContent = `slug "${slug || '(빈 값)'}" 에 못 쓰는 문자가 있어요. 영문 소문자·숫자·하이픈만.`;
    return;
  }

  const existing = STATE.editing ? STATE.rows.find(r => r.slug === STATE.editing) : null;

  // 표지 — 파일 선택했으면 업로드(웹진과 같은 공개 버킷), 아니면 기존 유지
  let coverImage = STATE.coverImage || '';
  const coverFile = ($('coverFile').files || [])[0];
  if (coverFile) {
    $('formMsg').textContent = '표지 업로드 중…';
    const up = await db().ebooks.uploadCover(slug, coverFile);
    if (up.error) { $('formMsg').textContent = '표지 업로드 실패: ' + (up.error.message || '오류'); return; }
    coverImage = up.url;
  }

  const row = {
    slug,
    title: f.title.value.trim(),
    kind: f.kind.value,
    price: (window.MoneyInput ? window.MoneyInput.parse(f.price.value) : Number(f.price.value)) || 0,
    original_price: window.MoneyInput ? window.MoneyInput.parse(f.original_price.value) : (f.original_price.value ? Number(f.original_price.value) : null),
    excerpt: f.excerpt.value.trim(),
    description: f.description.value,
    cover_image: coverImage,
    pages_path: slug,
    page_count: existing?.page_count || 0,
    sort_order: Number(f.sort_order.value) || 0,
    published: !!f.published.checked,
    ebook_on_sale: !!f.ebook_on_sale.checked,
  };

  if (!row.title) { $('formMsg').textContent = '제목은 필수입니다.'; return; }
  if (row.ebook_on_sale && !row.page_count) {
    $('formMsg').textContent = '이북 판매중으로 두려면 PDF 를 먼저 올려주세요. (저장 후 아래 "PDF 업로드")';
    f.ebook_on_sale.checked = false;
    row.ebook_on_sale = false;
  }
  if (existing?.id) row.id = existing.id;

  const { error } = await db().ebooks.upsert(row);
  if (error) { $('formMsg').textContent = '저장 실패: ' + (error.message || '알 수 없는 오류'); return; }

  // 새 항목이면 편집 모드로 전환해 업로드/열람권 패널을 바로 쓸 수 있게
  await reload();
  const saved = STATE.rows.find(r => r.slug === slug);
  if (saved) openForm(saved);
  else closeForm();
}

async function deleteRow() {
  const r = currentRow();
  if (!r) return;
  if (!confirm(`정말 삭제할까요?\n\n${r.title}\n(${r.slug})\n\n페이지 이미지·열람권도 함께 사라집니다. 복구 불가.`)) return;
  await db().ebooks.clearPdfs(r.pages_path || r.slug);
  const { error } = await db().ebooks.remove(r.slug);
  if (error) { $('formMsg').textContent = '삭제 실패: ' + (error.message || '알 수 없는 오류'); return; }
  closeForm();
  await reload();
}

// ────────── 페이지 업로드 ──────────
async function refreshPagesStatus(row) {
  const path = row.pages_path || row.slug;
  $('pagesStatus').textContent = 'PDF 확인 중…';
  const has = await db().ebooks.hasPdf(path);
  $('pagesStatus').textContent = has
    ? `PDF 업로드됨 (총 ${row.page_count || '?'}쪽, 무료 미리보기 ${Math.max(1, Math.ceil((row.page_count || 0) / 3))}쪽)`
    : '아직 PDF 가 업로드되지 않았어요.';
}

async function uploadPages() {
  const row = currentRow();
  if (!row) return;
  if (!window.PDFLib) { $('pagesMsg').textContent = 'PDF 라이브러리 로드 실패. 새로고침 후 다시 시도하세요.'; return; }
  const input = $('pagesInput');
  const file = (input.files || [])[0];
  if (!file) { $('pagesMsg').textContent = '업로드할 PDF 를 먼저 선택하세요.'; return; }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { $('pagesMsg').textContent = 'PDF 파일만 업로드할 수 있어요.'; return; }
  const path = row.pages_path || row.slug;
  $('uploadBtn').disabled = true;
  try {
    $('pagesMsg').textContent = 'PDF 읽는 중…';
    const buf = await file.arrayBuffer();
    const full = await window.PDFLib.PDFDocument.load(buf);
    const n = full.getPageCount();
    if (!n) { $('pagesMsg').textContent = '페이지가 없는 PDF 예요.'; $('uploadBtn').disabled = false; return; }
    const freeN = Math.max(1, Math.ceil(n / 3));

    // 앞 1/3 미리보기 PDF 생성
    $('pagesMsg').textContent = `미리보기(${freeN}/${n}쪽) 만드는 중…`;
    const prev = await window.PDFLib.PDFDocument.create();
    const idxs = Array.from({ length: freeN }, (_, i) => i);
    const copied = await prev.copyPages(full, idxs);
    copied.forEach(p => prev.addPage(p));
    // 미리보기 끝 — 깔끔한 브랜드 빈 페이지 1장(메시지·구매 버튼은 뷰어 HTML 오버레이).
    try {
      const { width, height } = full.getPage(0).getSize();
      const endPage = prev.addPage([width, height]);
      endPage.drawRectangle({ x: 0, y: 0, width, height, color: window.PDFLib.rgb(0.94, 0.94, 0.95) });
    } catch (_) {}
    const prevBytes = await prev.save();

    // 업로드: full.pdf + preview.pdf
    $('pagesMsg').textContent = '전체 PDF 업로드 중…';
    let res = await db().ebooks.uploadPdf(path, 'full.pdf', new Blob([buf], { type: 'application/pdf' }));
    if (res.error) { $('pagesMsg').textContent = '전체 PDF 업로드 실패: ' + (res.error.message || '오류'); $('uploadBtn').disabled = false; return; }
    $('pagesMsg').textContent = '미리보기 PDF 업로드 중…';
    res = await db().ebooks.uploadPdf(path, 'preview.pdf', new Blob([prevBytes], { type: 'application/pdf' }));
    if (res.error) { $('pagesMsg').textContent = '미리보기 PDF 업로드 실패: ' + (res.error.message || '오류'); $('uploadBtn').disabled = false; return; }

    if (row.id) await db().ebooks.setPageCount(row.id, n);
    $('pagesMsg').textContent = `완료 — 총 ${n}쪽 (무료 미리보기 ${freeN}쪽).`;
    input.value = '';
  } catch (e) {
    $('pagesMsg').textContent = 'PDF 처리 실패: ' + (e.message || '오류');
  } finally {
    $('uploadBtn').disabled = false;
  }
  await reload();
  const saved = STATE.rows.find(r => r.slug === row.slug);
  if (saved) { STATE.editing = saved.slug; refreshPagesStatus(saved); }
}

async function clearAllPages() {
  const row = currentRow();
  if (!row) return;
  if (!confirm('이 이북의 PDF(전체·미리보기)를 삭제할까요? 복구 불가.')) return;
  const path = row.pages_path || row.slug;
  const { error } = await db().ebooks.clearPdfs(path);
  if (error) { $('pagesMsg').textContent = '삭제 실패: ' + (error.message || '오류'); return; }
  if (row.id) await db().ebooks.setPageCount(row.id, 0);
  $('pagesMsg').textContent = 'PDF 삭제됨.';
  await reload();
  const saved = STATE.rows.find(r => r.slug === row.slug);
  if (saved) { STATE.editing = saved.slug; refreshPagesStatus(saved); }
}

// ────────── 열람권 ──────────
function entRowHtml(p, granted) {
  const name = escapeHtml(p.display_name || '(이름 없음)');
  const meta = escapeHtml((p.hints && p.hints.length ? p.hints.join('·') + ' · ' : '') + (p.user_id || '').slice(0, 8));
  const btn = granted
    ? `<button type="button" class="ent-act revoke" data-revoke="${escapeAttr(p.user_id)}">회수</button>`
    : `<button type="button" class="ent-act" data-grant="${escapeAttr(p.user_id)}" data-name="${escapeAttr(p.display_name || '')}">부여</button>`;
  return `<div class="ent-row"><span class="ent-name">${name}</span><span class="ent-meta">${meta}</span>${btn}</div>`;
}

async function searchUsers() {
  const q = $('entSearch').value.trim();
  if (q.length < 1) { $('entResults').innerHTML = ''; return; }
  $('entResults').innerHTML = '<p class="ent-meta" style="padding:6px 2px;">검색 중…</p>';
  const results = await db().profiles.search(q);
  if (!results.length) { $('entResults').innerHTML = '<p class="ent-meta" style="padding:6px 2px;">일치하는 회원이 없어요.</p>'; return; }
  $('entResults').innerHTML = results.map(p => entRowHtml(p, false)).join('');
}

async function refreshHolders(row) {
  const r = row || currentRow();
  if (!r?.id) return;
  $('entHolders').innerHTML = '<p class="ent-meta" style="padding:6px 2px;">불러오는 중…</p>';
  const ents = await db().ebooks.listEntitlements(r.id);
  if (!ents.length) { $('entHolders').innerHTML = '<p class="ent-meta" style="padding:6px 2px;">아직 열람권 보유자가 없어요.</p>'; return; }
  $('entHolders').innerHTML = ents.map(e => {
    const meta = escapeHtml(`${e.source}${e.order_ref ? ' · ' + e.order_ref : ''} · ${(e.user_id || '').slice(0, 8)}`);
    const date = e.created_at ? new Date(e.created_at).toLocaleDateString('ko-KR') : '';
    return `<div class="ent-row"><span class="ent-name">${escapeHtml(date)}</span><span class="ent-meta">${meta}</span><button type="button" class="ent-act revoke" data-revoke="${escapeAttr(e.user_id)}">회수</button></div>`;
  }).join('');
}

async function grantTo(userId, displayName) {
  const r = currentRow();
  if (!r?.id) return;
  const orderRef = prompt(`"${displayName || userId.slice(0, 8)}" 에게 열람권 부여.\n메모(입금자명/주문번호 등, 선택):`, displayName || '');
  if (orderRef === null) return; // 취소
  const { error } = await db().ebooks.grant(userId, r.id, { source: 'manual', orderRef: orderRef.trim() });
  if (error) { $('entMsg').textContent = '부여 실패: ' + (error.message || '오류'); return; }
  $('entMsg').textContent = '열람권 부여됨.';
  refreshHolders(r);
}

async function revokeFrom(userId) {
  const r = currentRow();
  if (!r?.id) return;
  if (!confirm('이 회원의 열람권을 회수할까요?')) return;
  const { error } = await db().ebooks.revoke(userId, r.id);
  if (error) { $('entMsg').textContent = '회수 실패: ' + (error.message || '오류'); return; }
  $('entMsg').textContent = '회수됨.';
  refreshHolders(r);
}

// ────────── 이벤트 ──────────
function slugFromFileName(name) {
  return String(name || '').replace(/\.[^.]+$/, '')   // 확장자 제거
    .normalize('NFKC').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
$('coverFile').addEventListener('change', (e) => {
  const file = (e.target.files || [])[0];
  const cp = $('coverPreview');
  if (file) { cp.src = URL.createObjectURL(file); cp.style.display = 'block'; }
  // 새 이북일 때만, 비어 있으면 파일명에서 slug/제목 자동 채움
  const form = $('form');
  if (file && !STATE.editing) {
    const base = String(file.name || '').replace(/\.[^.]+$/, '');
    if (!form.slug.value.trim()) form.slug.value = slugFromFileName(file.name);
    if (!form.title.value.trim()) form.title.value = base.replace(/[-_]+/g, ' ').trim();
  }
});
$('newBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', closeForm);
$('delBtn').addEventListener('click', deleteRow);
$('form').addEventListener('submit', saveForm);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeForm(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').classList.contains('open')) closeForm(); });

$('filter').addEventListener('input', (e) => { STATE.filter = e.target.value; render(); });
$('kindFilter').addEventListener('change', (e) => { STATE.kind = e.target.value; render(); });

$('rows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="edit"]');
  if (!btn) return;
  const r = STATE.rows.find(x => x.slug === btn.dataset.slug);
  if (r) openForm(r);
});

$('uploadBtn').addEventListener('click', uploadPages);
$('clearPagesBtn').addEventListener('click', clearAllPages);
$('entSearchBtn').addEventListener('click', searchUsers);
$('entSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchUsers(); } });
$('entResults').addEventListener('click', (e) => {
  const g = e.target.closest('[data-grant]');
  if (g) { grantTo(g.dataset.grant, g.dataset.name); return; }
});
$('entHolders').addEventListener('click', (e) => {
  const r = e.target.closest('[data-revoke]');
  if (r) revokeFrom(r.dataset.revoke);
});

// ────────── 부트 ──────────
(async function init() {
  const ok = await checkAccess();
  if (!ok) return;
  $('app').hidden = false;
  await reload();
})();
