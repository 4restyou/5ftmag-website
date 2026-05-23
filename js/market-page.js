'use strict';

const CATEGORIES = [
  { key: 'all',       label: '전체' },
  { key: 'film',      label: '필름' },
  { key: 'camera',    label: '카메라' },
  { key: 'lens',      label: '렌즈' },
  { key: 'accessory', label: '액세서리' },
  { key: 'etc',       label: '기타' },
];

const STATE = {
  user: null,
  rows: [],
  filter: 'all',
  search: '',
  detailId: null,
  galleryIndex: 0,
  editId: null,        // 수정 모드일 때 listing id
  formPhotos: [],      // [{ blob, previewUrl, existingPath? }]
};

const MAX_LONG_SIDE = 2000;
const JPEG_QUALITY = 0.85;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MARKET_TIMEOUTS = Object.assign({
  imageProcess: 52000,
  auth: 12000,
  upload: 60000,
  write: 25000,
  cleanup: 12000,
}, window.__MARKET_TIMEOUTS || {});

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function nl2br(s) { return escapeHtml(s).replace(/\n/g, '<br>'); }
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
// "30000000" → "30,000,000원". 숫자가 아니면 (예: "가격 협의") 원문 그대로.
function fmtPrice(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return escapeHtml(raw);
  return escapeHtml(n.toLocaleString('ko-KR')) + '원';
}
function categoryLabel(k) {
  return (CATEGORIES.find(c => c.key === k) || {}).label || k;
}
function statusLabel(s) {
  return s === 'available' ? '판매중' : s === 'reserved' ? '예약중' : s === 'sold' ? '판매완료' : s;
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 응답이 늦어지고 있습니다.`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}
function reportMarketUploadFailure(stage, err, meta = {}) {
  const safeStage = String(stage || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const message = err?.message || String(err || '알 수 없는 마켓 업로드 오류');
  const details = [
    err?.stack || '',
    `stage=${safeStage}`,
    `online=${navigator.onLine ? '1' : '0'}`,
    `input_bytes=${Number(meta.inputBytes || 0)}`,
    `upload_bytes=${Number(meta.uploadBytes || 0)}`,
    `photo_count=${Number(meta.photoCount || 0)}`,
  ].filter(Boolean).join('\n');
  if (typeof window.reportClientError === 'function') {
    window.reportClientError({
      message: `[market-upload:${safeStage}] ${message}`,
      source: `market-page:${safeStage}`,
      stack: details,
    });
    return;
  }
  console.warn('[market-page] upload failure', safeStage, message);
}
function renderMarketLoadError(message) {
  $('marketGrid').innerHTML = `
    <div class="market-empty">
      ${escapeHtml(message || '마켓 데이터를 불러오지 못했습니다.')}
      <br />
      <button type="button" class="market-retry-btn" data-action="retry-market">다시 불러오기</button>
    </div>`;
}

// ═════════════════════════════════════════
// 데이터 로드 + 렌더
// ═════════════════════════════════════════
async function loadList() {
  $('marketGrid').innerHTML = '<div class="market-empty">불러오는 중…</div>';
  try {
    const rows = await withTimeout(db().market.list({ limit: 500 }), 9000, '마켓 목록');
    STATE.rows = Array.isArray(rows) ? rows : [];
    renderFilterChips();
    renderGrid();
  } catch (e) {
    STATE.rows = [];
    renderFilterChips();
    renderMarketLoadError(`${e.message || '마켓 데이터를 불러오지 못했습니다.'} 네트워크 상태를 확인한 뒤 다시 시도해 주세요.`);
  }
}

function renderFilterChips() {
  const bar = $('marketFilter');
  if (!bar) return;
  const counts = { all: STATE.rows.length };
  for (const r of STATE.rows) counts[r.category] = (counts[r.category] || 0) + 1;
  bar.innerHTML = CATEGORIES
    .filter(c => c.key === 'all' || counts[c.key])
    .map(c => `
      <button type="button" class="market-category-chip${c.key === STATE.filter ? ' is-active' : ''}"
              data-cat="${escapeAttr(c.key)}" role="tab" aria-selected="${c.key === STATE.filter}">
        ${escapeHtml(c.label)}<span class="market-category-count">${counts[c.key] || 0}</span>
      </button>
    `).join('');
  bar.querySelectorAll('.market-category-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      STATE.filter = chip.dataset.cat;
      renderFilterChips();
      renderGrid();
    });
  });
}

function applyFilters() {
  const q = STATE.search.trim().toLowerCase();
  return STATE.rows.filter(r => {
    if (STATE.filter !== 'all' && r.category !== STATE.filter) return false;
    if (q) {
      const hay = (r.title + ' ' + (r.description || '') + ' ' + (r.location || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid() {
  const rows = applyFilters();
  const grid = $('marketGrid');
  if (!rows.length) {
    grid.innerHTML = '<div class="market-empty">' +
      (STATE.search ? `"${escapeHtml(STATE.search)}"에 맞는 매물이 없습니다. 검색어를 줄이거나 카테고리를 바꿔보세요.` : '아직 올라온 매물이 없습니다. 카메라, 필름, 액세서리를 첫 매물로 올려보세요.') +
      '</div>';
    return;
  }
  grid.innerHTML = rows.map(renderCard).join('');
  grid.querySelectorAll('.market-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const share = e.target.closest('[data-action="share"]');
      if (share) {
        e.preventDefault();
        e.stopPropagation();
        shareListing(share.dataset.id);
        return;
      }
      openDetail(card.dataset.id);
    });
  });
}

function renderCard(r) {
  const firstPath = r.storage_paths?.[0];
  const url = firstPath ? db().market.publicUrl(firstPath) : '';
  const soldClass = r.status === 'sold' ? ' is-sold' : '';
  return `
    <button type="button" class="market-card" data-id="${escapeAttr(r.id)}">
      <div class="market-card-img${soldClass}">
        <span class="market-card-status ${escapeAttr(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
        <span class="market-card-share" role="button" tabindex="0"
              data-action="share" data-id="${escapeAttr(r.id)}"
              aria-label="이 매물 링크 공유" title="링크 공유">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="12" r="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="17" cy="6"  r="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="17" cy="18" r="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="8.3" y1="10.7" x2="14.7" y2="7.2" stroke-linecap="round"/>
            <line x1="8.3" y1="13.3" x2="14.7" y2="16.8" stroke-linecap="round"/>
          </svg>
        </span>
        ${url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(r.title)}" loading="lazy" />` : ''}
      </div>
      <div class="market-card-body">
        <h3 class="market-card-title">${escapeHtml(r.title)}</h3>
        <span class="market-card-price">${fmtPrice(r.price)}</span>
        <span class="market-card-meta">
          <span>${escapeHtml(categoryLabel(r.category))}</span>
          ${r.location ? `<span>· ${escapeHtml(r.location)}</span>` : ''}
          <span>· ${fmtDate(r.created_at)}</span>
        </span>
      </div>
    </button>`;
}

// ═════════════════════════════════════════
// 매물 deep-link + 공유
//   - 매물 상세 URL: /market.html?id=<uuid>
//   - openDetail / closeDetail 에서 history.replaceState 로 URL 동기화
//   - shareListing 은 navigator.share 우선, fallback 으로 클립보드 복사
// ═════════════════════════════════════════
function listingUrl(id) {
  return `${location.origin}/market/${encodeURIComponent(id)}`;
}
async function shareListing(id) {
  const row = STATE.rows.find(r => r.id === id) || await db().market.getOne(id).catch(() => null);
  const title = row?.title ? `${row.title} · 5ft.mag Market` : '5ft.mag Market 매물';
  const text  = row ? `${row.title} — ${row.price}` : '5ft.mag 중고 장터에서 본 매물';
  const url   = listingUrl(id);
  // 1) navigator.share (모바일 네이티브 시트)
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (_) { /* 사용자가 취소 → 무음 */ }
    return;
  }
  // 2) 클립보드 fallback
  const ok = await window.copyTextToClipboard?.(url);
  showShareToast(ok ? '링크 복사 완료' : '복사 실패 — 주소창에서 직접 복사해주세요', ok ? 'info' : 'danger');
}
function showShareToast(msg, type = 'info') {
  // 글로벌 토스트로 위임 — site-common.js 가 toast host 관리
  if (typeof window.notify === 'function') {
    window.notify(msg, type);
    return;
  }
  // site-common.js 미로드 환경(테스트 등) 폴백
  const t = document.createElement('div');
  t.className = 'mkt-share-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('is-out'), 1400);
  setTimeout(() => t.remove(), 1900);
}

// ═════════════════════════════════════════
// 상세 모달
// ═════════════════════════════════════════
async function openDetail(id) {
  STATE.detailId = id;
  STATE.galleryIndex = 0;
  // 로그인 사용자는 항상 getOne 으로 — 카드 캐시에는 PII 없어서 보강 필요
  const row = STATE.user
    ? (await db().market.getOne(id))
    : (STATE.rows.find(r => r.id === id) || await db().market.getOne(id));
  if (!row) return;
  renderDetail(row);
  $('mktDetailModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  // URL 동기화 — 공유/북마크 가능하게
  try {
    history.replaceState(null, '', `/market/${encodeURIComponent(id)}`);
  } catch (_) {}
}

function closeDetail() {
  $('mktDetailModal').classList.remove('open');
  document.body.style.overflow = '';
  STATE.detailId = null;
  // URL 에서 id 제거
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('id')) {
      u.searchParams.delete('id');
      history.replaceState(null, '', '/market');
    } else if (/^\/market\/[^/]+/.test(u.pathname)) {
      history.replaceState(null, '', '/market');
    }
  } catch (_) {}
}

function renderDetail(r) {
  const paths = r.storage_paths || [];
  const idx = STATE.galleryIndex;
  const mainUrl = paths[idx] ? db().market.publicUrl(paths[idx]) : '';
  const nav = paths.length > 1 ? `
    <button type="button" class="mkt-gallery-nav prev" data-action="prev" aria-label="이전 사진">‹</button>
    <button type="button" class="mkt-gallery-nav next" data-action="next" aria-label="다음 사진">›</button>
  ` : '';
  const thumbs = paths.length > 1 ? `
    <div class="mkt-gallery-thumbs">
      ${paths.map((p, i) => `
        <button type="button" class="mkt-gallery-thumb${i === idx ? ' is-active' : ''}" data-action="thumb" data-i="${i}">
          <img src="${escapeAttr(db().market.publicUrl(p))}" alt="" />
        </button>`).join('')}
    </div>` : '';

  const author = r.display_name || '회원';
  const isMine = STATE.user && STATE.user.id === r.user_id;
  const isAuthed = !!STATE.user;
  const deliveryLabel = ({ courier: '택배', direct: '직거래', both: '택배·직거래' })[r.delivery_method] || r.delivery_method || '';

  $('mktDetailCard').innerHTML = `
    <button type="button" class="mkt-modal-close" data-action="close" aria-label="닫기">✕</button>
    <div class="mkt-gallery">
      <div class="mkt-gallery-main">
        ${mainUrl ? `<img src="${escapeAttr(mainUrl)}" alt="${escapeAttr(r.title)}" />` : ''}
        ${nav}
      </div>
      ${thumbs}
    </div>
    <div class="mkt-detail">
      <span class="mkt-detail-status ${escapeAttr(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
      <h2 class="mkt-detail-title">${escapeHtml(r.title)}</h2>
      <div class="mkt-detail-price">${fmtPrice(r.price)}</div>
      <div class="mkt-detail-meta">
        <span>${escapeHtml(categoryLabel(r.category))}</span>
        ${r.location ? `<span>· ${escapeHtml(r.location)}</span>` : ''}
        ${deliveryLabel ? `<span>· ${escapeHtml(deliveryLabel)}</span>` : ''}
        <span>· ${fmtDate(r.created_at)}</span>
      </div>
      ${r.description ? `<div class="mkt-detail-desc">${nl2br(r.description)}</div>` : ''}
      <div class="mkt-detail-contact">
        <strong>판매자 연락처</strong>
        ${isAuthed ? `
          ${r.seller_name ? `<div>이름 · ${escapeHtml(r.seller_name)}</div>` : ''}
          ${r.phone ? `<div>핸드폰 · ${escapeHtml(r.phone)}</div>` : ''}
          ${r.contact ? `<div>기타 · ${nl2br(r.contact)}</div>` : ''}
        ` : `
          <div class="mkt-detail-contact-locked">로그인하면 판매자의 이름·핸드폰·연락처를 확인할 수 있어요.</div>
        `}
      </div>
      <div class="mkt-detail-author">올린 사람 · ${escapeHtml(author)}</div>
      <div class="mkt-detail-actions">
        ${isMine ? `
          <button type="button" class="mkt-action-btn is-primary" data-action="edit">수정</button>
          <div class="mkt-status-control">
            <button type="button" class="mkt-action-btn mkt-status-trigger" data-action="status-toggle"
                    aria-haspopup="menu" aria-expanded="false">
              상태 · <strong>${escapeHtml(statusLabel(r.status))}</strong>
              <svg viewBox="0 0 12 8" width="9" height="6" aria-hidden="true" style="margin-left:4px;vertical-align:middle;">
                <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="mkt-status-menu" role="menu" hidden>
              ${['available','reserved','sold'].map(s => `
                <button type="button" role="menuitem"
                        class="mkt-status-menu-item${s === r.status ? ' is-current' : ''}"
                        data-action="set-status" data-status="${s}"
                        ${s === r.status ? 'aria-current="true"' : ''}>
                  ${escapeHtml(statusLabel(s))}${s === r.status ? ' ✓' : ''}
                </button>
              `).join('')}
            </div>
          </div>
          <button type="button" class="mkt-action-btn" data-action="share">링크 공유</button>
          <button type="button" class="mkt-action-btn is-danger" data-action="delete">삭제</button>
        ` : `
          <button type="button" class="mkt-action-btn is-primary" data-action="share">링크 공유</button>
          <button type="button" class="mkt-action-btn" data-action="report">신고하기</button>
        `}
      </div>
    </div>`;

  bindDetailHandlers(r);
}

function bindDetailHandlers(r) {
  $('mktDetailCard').querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const a = el.dataset.action;
      if (a === 'close') return closeDetail();
      if (a === 'share') return shareListing(r.id);
      if (a === 'prev') {
        STATE.galleryIndex = (STATE.galleryIndex - 1 + r.storage_paths.length) % r.storage_paths.length;
        return renderDetail(r);
      }
      if (a === 'next') {
        STATE.galleryIndex = (STATE.galleryIndex + 1) % r.storage_paths.length;
        return renderDetail(r);
      }
      if (a === 'thumb') {
        STATE.galleryIndex = Number(el.dataset.i) || 0;
        return renderDetail(r);
      }
      if (a === 'edit') {
        closeDetail();
        return openForm(r);
      }
      if (a === 'status-toggle') {
        const ctrl = el.closest('.mkt-status-control');
        const menu = ctrl?.querySelector('.mkt-status-menu');
        if (!menu) return;
        const isOpen = !menu.hidden;
        menu.hidden = isOpen;
        el.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        return;
      }
      if (a === 'set-status') {
        const next = el.dataset.status;
        if (!next || next === r.status) {
          // 현재 상태 다시 누름 → 메뉴만 닫음
          const trigger = el.closest('.mkt-status-control')?.querySelector('.mkt-status-trigger');
          el.closest('.mkt-status-menu').hidden = true;
          trigger?.setAttribute('aria-expanded', 'false');
          return;
        }
        el.disabled = true;
        const result = await db().market.updateMine(r.id, { status: next });
        if (result?.error) {
          el.disabled = false;
          return window.notify?.('상태를 바꾸지 못했어요. 새로고침 후 다시 시도해 주세요. (' + result.error.message + ')', 'danger');
        }
        r.status = next;
        await loadList();
        renderDetail(r);
        $('mktDetailModal').classList.add('open');
        return;
      }
      if (a === 'delete') {
        if (!confirm('이 매물을 삭제할까요? 등록한 사진 파일도 함께 삭제됩니다.')) return;
        el.disabled = true;
        const { error } = await db().market.deleteMine(r.id);
        if (error) { el.disabled = false; return window.notify?.('매물을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (' + error.message + ')', 'danger'); }
        if (r.storage_paths?.length) await db().market.removePhotos(r.storage_paths);
        closeDetail();
        return loadList();
      }
      if (a === 'report') {
        if (!STATE.user) return window.notify?.('신고는 로그인 후에 가능해요. 로그인하면 보던 매물로 다시 돌아옵니다.', 'info');
        const reason = prompt('신고 사유를 적어주세요 (300자 이내):', '');
        if (!reason) return;
        const { error } = await db().market.report(r.id, reason);
        if (error) return window.notify?.('신고를 접수하지 못했어요. 잠시 뒤 다시 시도해 주세요. (' + error.message + ')', 'danger');
        window.notify?.('신고가 접수되었습니다. 편집부에서 검토할게요.', 'info');
      }
    });
  });
}

// ═════════════════════════════════════════
// 폼 모달 (신규/수정)
// ═════════════════════════════════════════
async function openForm(existing) {
  if (!STATE.user) {
    renderGate();
    $('mktFormModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }
  STATE.editId = existing?.id || null;
  STATE.formPhotos = (existing?.storage_paths || []).map(p => ({
    existingPath: p, previewUrl: db().market.publicUrl(p),
  }));
  renderForm(existing);
  $('mktFormModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeForm() {
  clearMarketUploadStatus();
  // 신규 추가 시 생성한 blob URL 정리
  for (const p of STATE.formPhotos) {
    if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
  }
  STATE.formPhotos = [];
  STATE.editId = null;
  $('mktFormModal').classList.remove('open');
  document.body.style.overflow = '';
}

function renderGate() {
  $('mktFormCard').innerHTML = `
    <div class="mkt-gate">
      <h2>로그인이 필요해요</h2>
      <p>로그인하면 지금 화면으로 돌아와 매물 올리기를 이어갈 수 있어요.</p>
      <button type="button" class="mkt-btn mkt-btn-primary" data-action="login">Google로 계속하기</button>
      <button type="button" class="mkt-btn-link" data-action="close" style="margin-left:8px;">취소</button>
    </div>`;
  $('mktFormCard').querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', async () => {
      const a = el.dataset.action;
      if (a === 'login') await db().auth.signInWithGoogle(window.location.href.split('#')[0]);
      if (a === 'close') closeForm();
    });
  });
}

function renderForm(existing) {
  const e = existing || {};
  $('mktFormCard').innerHTML = `
    <button type="button" class="mkt-modal-close" data-action="close" aria-label="닫기">✕</button>
    <form class="mkt-form" id="mktForm">
      <h2 class="mkt-form-title">${existing ? '매물 수정' : '매물 올리기'}</h2>

      <div class="mkt-field">
        <span class="mkt-field-label">사진 <em>*</em> <small style="font-weight:normal; color: var(--text-muted); letter-spacing: 0;">(최대 3장, 5MB 이하)</small></span>
        <div class="mkt-photo-row" id="mktPhotoRow"></div>
      </div>

      <label class="mkt-field">
        <span class="mkt-field-label">제목 <em>*</em></span>
        <input type="text" name="title" maxlength="60" required value="${escapeAttr(e.title || '')}" placeholder="예: Pentax 17 미사용 박풀세트" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">가격 <em>*</em></span>
        <input type="text" name="price" maxlength="40" required value="${escapeAttr(e.price || '')}" placeholder="예: 25만원 / 5만원 (택포)" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">카테고리 <em>*</em></span>
        <select name="category" required>
          ${CATEGORIES.filter(c => c.key !== 'all').map(c => `
            <option value="${escapeAttr(c.key)}" ${e.category === c.key ? 'selected' : ''}>${escapeHtml(c.label)}</option>
          `).join('')}
        </select>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">설명 <small style="font-weight:normal; color: var(--text-muted); letter-spacing: 0;">(1000자 이내)</small></span>
        <textarea name="description" maxlength="1000" placeholder="상태, 사용 기간, 거래 방식 등 자유롭게 적어주세요.">${escapeHtml(e.description || '')}</textarea>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">지역 <em>*</em></span>
        <input type="text" name="location" maxlength="60" required value="${escapeAttr(e.location || '')}" placeholder="예: 서울 마포 / 경기 성남 / 전국 (택배)" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">거래 방식 <em>*</em></span>
        <select name="delivery_method" required>
          <option value="" ${!e.delivery_method ? 'selected' : ''} disabled>선택해주세요</option>
          <option value="courier" ${e.delivery_method === 'courier' ? 'selected' : ''}>택배</option>
          <option value="direct"  ${e.delivery_method === 'direct'  ? 'selected' : ''}>직거래</option>
          <option value="both"    ${e.delivery_method === 'both'    ? 'selected' : ''}>택배·직거래 둘 다</option>
        </select>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">이름 <em>*</em></span>
        <input type="text" name="seller_name" maxlength="60" required value="${escapeAttr(e.seller_name || '')}" placeholder="실명 또는 통상 사용하는 이름" />
        <span class="mkt-field-hint">구매자가 받을 사람을 확인할 수 있도록 적어주세요. (로그인한 사용자에게만 공개)</span>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">핸드폰 번호 <em>*</em></span>
        <input type="tel" name="phone" maxlength="20" required value="${escapeAttr(e.phone || '')}" placeholder="예: 010-1234-5678" pattern="[0-9\-\s]{9,20}" />
        <span class="mkt-field-hint">로그인한 사용자에게만 공개됩니다.</span>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">기타 연락처 <em>*</em></span>
        <textarea name="contact" maxlength="100" required placeholder="카톡 ID, 인스타 DM 등 — 핸드폰 외 추가로 받을 수 있는 방법">${escapeHtml(e.contact || '')}</textarea>
        <span class="mkt-field-hint">로그인한 사용자에게만 공개됩니다.</span>
      </label>

      <label class="mkt-safety-check">
        <input type="checkbox" name="safety_agree" ${existing ? 'checked' : ''} />
        <span>거래는 개인 간 직접 진행되며, 도난품·가품·불법 물품을 올리지 않는다는 점을 확인했습니다.</span>
      </label>

      <div class="mkt-form-actions">
        <button type="button" class="mkt-btn mkt-btn-secondary" data-action="close">취소</button>
        <button type="submit" class="mkt-btn mkt-btn-primary" id="mktFormSubmit">${existing ? '저장' : '올리기'}</button>
      </div>
      <div class="mkt-upload-status" id="mktUploadStatus" aria-live="polite" hidden>
        <span class="mkt-upload-dot" aria-hidden="true"></span>
        <span>
          <strong id="mktUploadTitle">업로드 준비 중</strong>
          <small id="mktUploadDetail">창을 닫지 말고 잠시만 기다려 주세요.</small>
        </span>
      </div>
      <p class="mkt-form-error" id="mktFormError" aria-live="polite"></p>
    </form>`;

  renderPhotoSlots();
  $('mktFormCard').querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', closeForm));
  $('mktForm').addEventListener('submit', onSubmit);
}

function setMarketUploadStatus(state, title, detail = '') {
  const box = $('mktUploadStatus');
  if (!box) return;
  box.hidden = false;
  box.dataset.state = state || 'progress';
  const titleEl = $('mktUploadTitle');
  const detailEl = $('mktUploadDetail');
  if (titleEl) titleEl.textContent = title || '';
  if (detailEl) detailEl.textContent = detail || '';
}

function clearMarketUploadStatus() {
  const box = $('mktUploadStatus');
  if (!box) return;
  box.hidden = true;
  box.dataset.state = '';
  const titleEl = $('mktUploadTitle');
  const detailEl = $('mktUploadDetail');
  if (titleEl) titleEl.textContent = '';
  if (detailEl) detailEl.textContent = '';
}

function renderPhotoSlots() {
  const row = $('mktPhotoRow');
  if (!row) return;
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const p = STATE.formPhotos[i];
    if (p) {
      slots.push(`
        <div class="mkt-photo-slot" data-i="${i}">
          <img src="${escapeAttr(p.previewUrl)}" alt="" />
          <button type="button" class="mkt-photo-remove" data-action="remove" data-i="${i}" aria-label="삭제">✕</button>
        </div>`);
    } else {
      slots.push(`
        <label class="mkt-photo-slot" data-i="${i}">
          + 추가
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" data-i="${i}" />
        </label>`);
    }
  }
  row.innerHTML = slots.join('');
  row.querySelectorAll('input[type=file]').forEach(el => {
    el.addEventListener('change', async () => {
      const file = el.files?.[0];
      if (!file) return;
      const slot = el.closest('.mkt-photo-slot');
      const origLabel = slot?.firstChild?.nodeValue;
      try {
        if (slot) slot.firstChild.nodeValue = `변환 중… (${fmtBytes(file.size)}) `;
        setMarketUploadStatus('progress', '사진을 준비하는 중', `${fmtBytes(file.size)} 파일을 웹용 이미지로 줄이고 있어요.`);
        const { blob } = await withNetworkTimeout(
          resizeToJpeg(file, ({ stage, width: w, height: h }) => {
            if (!slot) return;
            if (stage === 'decode') {
              slot.firstChild.nodeValue = `사진 읽는 중… (${fmtBytes(file.size)}) `;
              setMarketUploadStatus('progress', '사진을 읽는 중', '큰 사진은 이 단계에서 몇 초 걸릴 수 있어요.');
            } else if (stage === 'resize') {
              slot.firstChild.nodeValue = `크기 줄이는 중… (${w}×${h}) `;
              setMarketUploadStatus('progress', '사진 크기 줄이는 중', `${w}×${h} 크기로 변환하고 있어요.`);
            } else if (stage === 'encode') {
              slot.firstChild.nodeValue = `인코딩 중… (${w}×${h}) `;
              setMarketUploadStatus('progress', '사진을 압축하는 중', '업로드 전에 용량을 줄이고 있어요.');
            }
          }),
          MARKET_TIMEOUTS.imageProcess,
          '사진 변환'
        );
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('파일이 너무 큽니다 (5MB 이하).');
        const blobUrl = URL.createObjectURL(blob);
        STATE.formPhotos[Number(el.dataset.i)] = { blob, blobUrl, previewUrl: blobUrl, originalBytes: file.size };
        setMarketUploadStatus('done', '사진 준비 완료', '계속해서 매물 정보를 입력해 주세요.');
        renderPhotoSlots();
      } catch (err) {
        reportMarketUploadFailure('image-process', err, {
          inputBytes: file.size,
          photoCount: STATE.formPhotos.length,
        });
        if (slot && origLabel) slot.firstChild.nodeValue = origLabel;
        setMarketUploadStatus('error', '사진 준비 실패', '다른 사진을 선택하거나 네트워크 상태를 확인해 주세요.');
        window.notify?.(err.message || '사진을 준비하지 못했어요. 다른 사진으로 다시 시도해 주세요.', 'danger');
      }
    });
  });
  row.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.i);
      const p = STATE.formPhotos[i];
      if (p?.blobUrl) URL.revokeObjectURL(p.blobUrl);
      STATE.formPhotos.splice(i, 1);
      renderPhotoSlots();
    });
  });
}

// 이미지 변환 — js/image-processor.js (Worker + HEIC 가드 + timeout) 위임
function resizeToJpeg(file, onProgress) {
  if (typeof window.processImageForUpload !== 'function') {
    return Promise.reject(new Error('이미지 변환 모듈이 로드되지 않았어요. 새로고침 후 다시 시도해 주세요.'));
  }
  return window.processImageForUpload(file, {
    maxLongSide: MAX_LONG_SIDE,
    quality: JPEG_QUALITY,
    onProgress: onProgress || (() => {}),
  });
}
function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function withNetworkTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 시간 초과 (${Math.round(ms/1000)}초). 네트워크 상태 확인 후 다시 시도해 주세요.`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Supabase JS v2 가 localStorage 의 'sb-<ref>-auth-token' 에 세션 JSON 을 둠.
// access_token JWT 의 sub(user.id) 와 exp 를 sync 로 추출해서 Supabase 호출 자체를
// 우회. auth 엔드포인트 hang(12초 timeout) 누적의 진짜 원인을 호출 회피로 푼다.
// reader-submissions 의 readLocalJwtUser() 와 동일 패턴.
function readLocalJwtUser() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw || raw === 'null') continue;
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token;
      if (!token || typeof token !== 'string') continue;
      const parts = token.split('.');
      if (parts.length < 2) continue;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = '='.repeat((4 - b64.length % 4) % 4);
      const payload = JSON.parse(atob(b64 + pad));
      const exp = Number(payload.exp || 0);
      if (!exp || Date.now() / 1000 > exp - 30) continue;
      const id = payload.sub || parsed?.user?.id;
      if (id) return { id };
    }
  } catch (_) { /* parse 실패는 fallback */ }
  return null;
}

async function onSubmit(e) {
  e.preventDefault();
  const err = $('mktFormError');
  err.textContent = '';
  const form = e.target;
  const submit = $('mktFormSubmit');
  submit.disabled = true; submit.textContent = '내용 확인 중…';
  setMarketUploadStatus('progress', '내용 확인 중', '필수 입력값과 사진을 확인하고 있어요.');
  let uploadStage = 'validate';
  const uploadMeta = {
    inputBytes: STATE.formPhotos.reduce((sum, p) => sum + (Number(p?.originalBytes) || Number(p?.blob?.size) || 0), 0),
    uploadBytes: 0,
    photoCount: STATE.formPhotos.length,
  };
  try {
    if (!STATE.formPhotos.length) throw new Error('상품 상태를 볼 수 있는 사진을 1장 이상 올려주세요.');
    const fd = new FormData(form);
    const title           = String(fd.get('title') || '').trim();
    const price           = String(fd.get('price') || '').trim();
    const category        = String(fd.get('category') || '').trim();
    const description     = String(fd.get('description') || '').trim() || null;
    const location        = String(fd.get('location') || '').trim();
    const delivery_method = String(fd.get('delivery_method') || '').trim();
    const seller_name     = String(fd.get('seller_name') || '').trim();
    const phone           = String(fd.get('phone') || '').trim();
    const contact         = String(fd.get('contact') || '').trim();
    if (!title || !price || !category || !location || !delivery_method || !seller_name || !phone || !contact) {
      throw new Error('필수 항목(제목·가격·카테고리·지역·거래 방식·이름·핸드폰·기타 연락처)을 모두 입력해 주세요.');
    }
    if (!['courier','direct','both'].includes(delivery_method)) throw new Error('거래 방식을 다시 선택해 주세요.');
    if (!/[0-9]{8,}/.test(phone.replace(/[^0-9]/g, ''))) throw new Error('핸드폰 번호 형식을 확인해 주세요. (숫자 8자리 이상)');
    if (fd.get('safety_agree') !== 'on') throw new Error('개인 간 거래 확인사항에 동의해야 매물을 올릴 수 있어요.');

    // 사진 업로드 — 신규 추가된 것만
    uploadStage = 'auth';
    setMarketUploadStatus('progress', '로그인 상태 확인 중', '매물 등록 권한을 확인하고 있어요.');
    // 1) localStorage JWT 를 sync 로 파싱해서 Supabase 호출 없이 user.id 확보.
    // 2) 토큰이 없거나 만료됐을 때만 db.auth.getSession() 으로 fallback.
    //    실제 권한은 RLS 가 백엔드에서 확인하므로 사전 검증 우회는 안전.
    let user = readLocalJwtUser();
    if (!user) {
      const session = await withNetworkTimeout(db().auth.getSession(), MARKET_TIMEOUTS.auth, '로그인 확인');
      user = session?.user || null;
    }
    if (!user) throw new Error('로그인이 만료되었어요. 다시 로그인한 뒤 저장해 주세요.');
    const finalPaths = [];
    const uploadedNew = [];
    for (const p of STATE.formPhotos) {
      if (p.existingPath) { finalPaths.push(p.existingPath); continue; }
      const totalNew = STATE.formPhotos.filter(x => !x.existingPath).length;
      submit.textContent = `사진 업로드 중… (${uploadedNew.length + 1}/${totalNew} · ${fmtBytes(p.blob?.size)})`;
      setMarketUploadStatus('progress', '사진 업로드 중', `${uploadedNew.length + 1}/${totalNew}번째 사진 ${fmtBytes(p.blob?.size)} 파일을 서버에 보내고 있어요.`);
      uploadStage = 'storage';
      uploadMeta.uploadBytes = p.blob?.size || 0;
      const path = `${user.id}/${Date.now()}-${uuid()}.jpg`;
      const { error: upErr } = await withNetworkTimeout(
        db().market.uploadPhoto(path, p.blob),
        MARKET_TIMEOUTS.upload,
        '사진 업로드'
      ).catch(err => ({ error: { message: err.message } }));
      if (upErr) {
        // 실패 시 이번 세션에서 올린 것들 정리
        if (uploadedNew.length) {
          await withNetworkTimeout(db().market.removePhotos(uploadedNew), MARKET_TIMEOUTS.cleanup, '업로드 파일 정리').catch(() => null);
        }
        throw new Error('사진 업로드가 완료되지 않았어요. 네트워크를 확인한 뒤 다시 시도해 주세요. (' + upErr.message + ')');
      }
      finalPaths.push(path);
      uploadedNew.push(path);
    }

    const record = { title, price, category, description, location, delivery_method, seller_name, phone, contact, storage_paths: finalPaths };

    if (STATE.editId) {
      submit.textContent = '수정 저장 중…';
      setMarketUploadStatus('progress', '수정 내용 저장 중', '사진 경로와 매물 정보를 함께 저장하고 있어요.');
      uploadStage = 'write';
      // 수정: 제거된 사진 (formPhotos 에서 빠진 existingPath) 들 storage 정리
      const existing = STATE.rows.find(r => r.id === STATE.editId);
      const droppedPaths = (existing?.storage_paths || []).filter(p => !finalPaths.includes(p));
      const { error } = await withNetworkTimeout(db().market.updateMine(STATE.editId, record), MARKET_TIMEOUTS.write, '수정 저장');
      if (error) throw new Error('수정 내용을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요. (' + error.message + ')');
      if (droppedPaths.length) await withNetworkTimeout(db().market.removePhotos(droppedPaths), MARKET_TIMEOUTS.cleanup, '삭제 사진 정리').catch(() => null);
    } else {
      submit.textContent = '매물 등록 중…';
      setMarketUploadStatus('progress', '매물 등록 중', '사진 경로와 매물 정보를 함께 저장하고 있어요.');
      uploadStage = 'write';
      const { error } = await withNetworkTimeout(db().market.create(record), MARKET_TIMEOUTS.write, '매물 등록');
      if (error) {
        if (uploadedNew.length) {
          await withNetworkTimeout(db().market.removePhotos(uploadedNew), MARKET_TIMEOUTS.cleanup, '업로드 파일 정리').catch(() => null);
        }
        throw new Error('매물을 등록하지 못했어요. 입력 내용과 네트워크를 확인해 주세요. (' + error.message + ')');
      }
    }

    closeForm();
    await loadList();
  } catch (e) {
    if (uploadStage !== 'validate') reportMarketUploadFailure(uploadStage, e, uploadMeta);
    setMarketUploadStatus('error', '저장이 중단됐어요', '입력한 내용은 유지됩니다. 메시지를 확인한 뒤 다시 시도해 주세요.');
    err.textContent = e.message || '저장을 마치지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.';
    submit.disabled = false;
    submit.textContent = STATE.editId ? '저장' : '올리기';
  }
}

// ═════════════════════════════════════════
// 이벤트 바인딩
// ═════════════════════════════════════════
$('marketNewBtn').addEventListener('click', () => openForm());
$('marketSearch').addEventListener('input', (e) => {
  STATE.search = e.target.value;
  renderGrid();
});
$('marketGrid').addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="retry-market"]')) return;
  loadList();
});
$('mktDetailModal').addEventListener('click', (e) => {
  if (e.target === $('mktDetailModal')) closeDetail();
});
$('mktFormModal').addEventListener('click', (e) => {
  if (e.target === $('mktFormModal')) closeForm();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 상태 드롭다운이 열려 있으면 그것만 닫기 (모달은 유지)
  const openMenu = document.querySelector('#mktDetailCard .mkt-status-menu:not([hidden])');
  if (openMenu) {
    openMenu.hidden = true;
    document.querySelector('#mktDetailCard .mkt-status-trigger')?.setAttribute('aria-expanded', 'false');
    return;
  }
  if ($('mktDetailModal').classList.contains('open')) closeDetail();
  else if ($('mktFormModal').classList.contains('open')) closeForm();
});
// 상태 드롭다운 외부 클릭 시 닫기 (capture phase 로 다른 click 핸들러보다 먼저)
document.addEventListener('click', (e) => {
  const openMenu = document.querySelector('#mktDetailCard .mkt-status-menu:not([hidden])');
  if (!openMenu) return;
  if (e.target.closest('.mkt-status-control')) return;
  openMenu.hidden = true;
  document.querySelector('#mktDetailCard .mkt-status-trigger')?.setAttribute('aria-expanded', 'false');
}, true);

(async function main() {
  for (let i = 0; i < 50; i++) {
    if (db() && db().isReady()) break;
    await new Promise(r => setTimeout(r, 50));
  }
  if (!db() || !db().isReady()) {
    renderMarketLoadError('마켓 연결을 준비하지 못했습니다. 새로고침 후에도 반복되면 편집부에 알려주세요.');
    return;
  }
  const session = await db().auth.getSession();
  STATE.user = session?.user || null;
  await loadList();

  // URL 파라미터로 진입
  //   ?id=<uuid>  → 해당 매물 상세 모달 자동 오픈 (공유 링크 deep-link)
  //   ?edit=<id>  → 본인 매물 수정 폼
  //   #new       → 신규 등록 폼
  try {
    const params = new URLSearchParams(location.search);
    const pathParts = location.pathname.split('/').filter(Boolean);
    const routeDetailId = pathParts[0] === 'market' && pathParts[1] ? decodeURIComponent(pathParts[1]) : '';
    const detailId = params.get('id') || routeDetailId;
    const editId = params.get('edit');
    if (detailId) {
      openDetail(detailId);
    } else if (editId) {
      const row = await db().market.getOne(editId);
      if (row && row.user_id === STATE.user?.id) {
        openForm(row);
      }
    } else if (location.hash === '#new') {
      openForm();
    }
  } catch (_) {}
})();
