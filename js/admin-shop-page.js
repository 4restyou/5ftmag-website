'use strict';

// admin/shop 페이지 — shop_products CRUD.

const STATE = {
  user: null,
  isEditor: false,
  rows: [],
  filter: '',
  cat: 'all',
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
  STATE.rows = await db().shop.listAll();
  render();
}

function categoryLabel(cat) {
  switch (cat) {
    case 'film':   return '필름';
    case 'camera': return '카메라';
    case 'goods':  return '굿즈';
    case 'book':   return '책';
    default:       return cat || '—';
  }
}

function fmtPrice(n) {
  if (!n || n <= 0) return '—';
  return n.toLocaleString('ko-KR') + '원';
}

function render() {
  const q = STATE.filter.toLowerCase();
  const cat = STATE.cat;
  const filtered = STATE.rows.filter(r => {
    if (cat !== 'all' && r.category !== cat) return false;
    if (!q) return true;
    return (r.title || '').toLowerCase().includes(q) || (r.slug || '').toLowerCase().includes(q);
  });

  $('count').textContent = `${filtered.length} / ${STATE.rows.length} 상품`;
  const tbody = $('rows');
  const empty = $('empty');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = STATE.rows.length === 0
      ? '등록된 상품이 없어요. "+ 새 상품" 으로 첫 항목을 추가하세요.'
      : '필터에 일치하는 상품이 없어요.';
    return;
  }
  empty.hidden = true;

  // 순서 변경은 전체 보기 + 검색어 없을 때만 가능 (필터 중엔 의미 모호)
  const canDrag = STATE.filter.trim() === '' && STATE.cat === 'all';
  // 기존 hint 제거 (매번 render 마다 깨끗이)
  document.querySelectorAll('.drag-hint').forEach(el => el.remove());
  tbody.innerHTML = filtered.map(r => {
    const thumb = (Array.isArray(r.images) && r.images[0])
      ? `<img src="${escapeAttr(r.images[0])}" alt="" loading="lazy" />`
      : '';
    const statusBadges = [
      r.published
        ? '<span class="badge pub">발행</span>'
        : '<span class="badge unpub">초안</span>',
      r.available === false ? '<span class="badge soldout">품절</span>' : '',
    ].filter(Boolean).join(' ');
    const dragAttr = canDrag ? 'draggable="true"' : '';
    const dragBtn = canDrag
      ? `<button type="button" class="drag-handle" title="드래그해서 순서 변경" aria-label="순서 변경 핸들">⋮⋮</button>`
      : `<button type="button" class="drag-handle" disabled title="전체 보기에서만 순서 변경 가능">⋮⋮</button>`;
    return `
      <tr data-slug="${escapeAttr(r.slug)}" ${dragAttr}>
        <td class="col-thumb">${thumb}</td>
        <td>
          <div class="col-title">${escapeHtml(r.title)}</div>
          <div class="col-slug">${escapeHtml(r.slug)}</div>
        </td>
        <td>${escapeHtml(categoryLabel(r.category))}</td>
        <td class="col-price">${escapeHtml(fmtPrice(r.price))}</td>
        <td>${statusBadges}</td>
        <td class="col-actions">
          ${dragBtn}
          <button type="button" class="row-btn" data-action="edit" data-slug="${escapeAttr(r.slug)}">편집</button>
        </td>
      </tr>
    `;
  }).join('');
  if (!canDrag) {
    const hint = document.createElement('p');
    hint.className = 'drag-hint';
    hint.textContent = '※ 순서 변경은 필터·검색 해제 후 가능합니다.';
    tbody.parentElement.parentElement.appendChild(hint);
  }
}

// ────────── 폼 ──────────
function openForm(row) {
  STATE.editing = row ? row.slug : null;
  const form = $('form');
  $('modalTitle').textContent = row ? `편집 — ${row.title || row.slug}` : '새 상품';
  $('delBtn').hidden = !row;
  $('formMsg').textContent = '';

  form.slug.value = row?.slug || '';
  form.slug.readOnly = !!row;
  form.title.value = row?.title || '';
  form.category.value = row?.category || 'goods';
  form.price.value = row?.price ?? '';
  form.original_price.value = row?.original_price ?? '';
  form.excerpt.value = row?.excerpt || '';
  form.description.value = row?.description || '';
  form.images.value = Array.isArray(row?.images) ? row.images.join('\n') : '';
  form.smart_store_url.value = row?.smart_store_url || '';
  form.ebook_slug.value = row?.ebook_slug || '';
  form.sort_order.value = row?.sort_order ?? 0;
  form.published.checked = !!row?.published;
  form.available.checked = row ? row.available !== false : true;

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
  // 정규화: NFKC (전각 → 반각), 유니코드 dash 통일, invisible char 제거, 소문자
  let slug = f.slug.value.normalize('NFKC').toLowerCase()
    .replace(/[‐-―−]/g, '-')         // hyphen·en·em·minus → '-'
    .replace(/[​-‍﻿ \s]/g, ''); // zero-width / nbsp / 일반 공백 제거
  if (slug !== f.slug.value) f.slug.value = slug;   // 사용자에게도 보여줌
  if (!/^[a-z0-9-]+$/.test(slug)) {
    $('formMsg').textContent = `slug "${slug || '(빈 값)'}" 에 못 쓰는 문자가 있어요. 영문 소문자·숫자·하이픈만 사용.`;
    return;
  }
  const images = f.images.value.split('\n').map(s => s.trim()).filter(Boolean);

  const row = {
    slug,
    title: f.title.value.trim(),
    category: f.category.value,
    price: Number(f.price.value) || 0,
    original_price: f.original_price.value ? Number(f.original_price.value) : null,
    excerpt: f.excerpt.value.trim(),
    description: f.description.value,
    images,
    smart_store_url: f.smart_store_url.value.trim(),
    ebook_slug: f.ebook_slug.value.trim() || null,
    sort_order: Number(f.sort_order.value) || 0,
    available: !!f.available.checked,
    published: !!f.published.checked,
  };

  if (!row.title) {
    $('formMsg').textContent = '제목은 필수입니다.';
    return;
  }
  if (row.published && row.available && !row.smart_store_url) {
    $('formMsg').textContent = '판매 중으로 발행하려면 Smart Store URL 이 필요합니다 (구매 버튼 동작). 품절이면 비워도 됩니다.';
    return;
  }

  // 기존 row 가 있으면 id 도 함께 보내야 conflict 회피
  if (STATE.editing) {
    const existing = STATE.rows.find(r => r.slug === STATE.editing);
    if (existing?.id) row.id = existing.id;
  }

  const { error } = await db().shop.upsert(row);
  if (error) {
    $('formMsg').textContent = '저장 실패: ' + (error.message || '알 수 없는 오류');
    return;
  }
  closeForm();
  await reload();
}

async function deleteRow() {
  if (!STATE.editing) return;
  const r = STATE.rows.find(x => x.slug === STATE.editing);
  if (!r) return;
  if (!confirm(`정말 삭제할까요?\n\n${r.title}\n(${r.slug})\n\n복구 불가.`)) return;
  const { error } = await db().shop.remove(r.slug);
  if (error) {
    $('formMsg').textContent = '삭제 실패: ' + (error.message || '알 수 없는 오류');
    return;
  }
  closeForm();
  await reload();
}

// ────────── Drag & Drop 순서 변경 ──────────
let dragSrcSlug = null;

function clearDragOver() {
  document.querySelectorAll('.shop-table tr.drag-over-before, .shop-table tr.drag-over-after')
    .forEach(el => el.classList.remove('drag-over-before', 'drag-over-after'));
}

async function applyReorder(srcSlug, targetSlug, before) {
  // STATE.rows 안에서 src 를 target 의 앞 (before=true) 또는 뒤로 이동.
  const src = STATE.rows.find(r => r.slug === srcSlug);
  const target = STATE.rows.find(r => r.slug === targetSlug);
  if (!src || !target || src.slug === target.slug) return;
  const without = STATE.rows.filter(r => r.slug !== srcSlug);
  const targetIdx = without.findIndex(r => r.slug === targetSlug);
  const insertIdx = before ? targetIdx : targetIdx + 1;
  without.splice(insertIdx, 0, src);
  STATE.rows = without;
  // 새 sort_order: 10 간격
  const updates = STATE.rows.map((r, i) => {
    const newOrder = (i + 1) * 10;
    r.sort_order = newOrder;
    return { slug: r.slug, sort_order: newOrder };
  });
  render();  // 낙관적 렌더
  const { error } = await db().shop.updateSortOrder(updates);
  if (error) {
    alert('순서 저장 실패: ' + (error.message || '알 수 없음') + '\n새로고침해서 실제 상태 확인하세요.');
    await reload();
  }
}

function bindDrag() {
  const tbody = $('rows');
  tbody.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[draggable]');
    if (!tr) return;
    dragSrcSlug = tr.dataset.slug;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcSlug);
  });
  tbody.addEventListener('dragend', (e) => {
    const tr = e.target.closest('tr[draggable]');
    if (tr) tr.classList.remove('dragging');
    clearDragOver();
    dragSrcSlug = null;
  });
  tbody.addEventListener('dragover', (e) => {
    const tr = e.target.closest('tr[draggable]');
    if (!tr || !dragSrcSlug || tr.dataset.slug === dragSrcSlug) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDragOver();
    const rect = tr.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    tr.classList.add(before ? 'drag-over-before' : 'drag-over-after');
  });
  tbody.addEventListener('drop', (e) => {
    const tr = e.target.closest('tr[draggable]');
    if (!tr || !dragSrcSlug || tr.dataset.slug === dragSrcSlug) return;
    e.preventDefault();
    const rect = tr.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const srcSlug = dragSrcSlug;
    const targetSlug = tr.dataset.slug;
    dragSrcSlug = null;
    clearDragOver();
    applyReorder(srcSlug, targetSlug, before);
  });
}

// ────────── 이벤트 ──────────
$('newBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', closeForm);
$('delBtn').addEventListener('click', deleteRow);
$('form').addEventListener('submit', saveForm);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeForm(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').classList.contains('open')) closeForm(); });

$('filter').addEventListener('input', (e) => { STATE.filter = e.target.value; render(); });
$('catFilter').addEventListener('change', (e) => { STATE.cat = e.target.value; render(); });

$('rows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="edit"]');
  if (!btn) return;
  const r = STATE.rows.find(x => x.slug === btn.dataset.slug);
  if (r) openForm(r);
});

// ────────── 부트 ──────────
(async function init() {
  const ok = await checkAccess();
  if (!ok) return;
  $('app').hidden = false;
  bindDrag();
  await reload();
})();
