'use strict';

const i18n = window.i18n;

const CATEGORIES = [
  { key: 'all',       label: i18n.t('전체', 'All', 'すべて') },
  { key: 'film',      label: i18n.t('필름', 'Film', 'フィルム') },
  { key: 'camera',    label: i18n.t('카메라', 'Cameras', 'カメラ') },
  { key: 'lens',      label: i18n.t('렌즈', 'Lenses', 'レンズ') },
  { key: 'accessory', label: i18n.t('액세서리', 'Accessories', 'アクセサリー') },
  { key: 'etc',       label: i18n.t('기타', 'Other', 'その他') },
];

const STATE = {
  user: null,
  rows: [],
  filter: 'all',
  search: '',
  hideSold: true,      // true: 판매중·예약중만 / false: 전체 (판매완료 포함)
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
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }
function escapeAttr(s) { return window.MagUtil.escapeAttr(s); }
function nl2br(s) { return escapeHtml(s).replace(/\n/g, '<br>'); }
// 판매자 연락처는 핸드폰·기타 중 하나만 있어도 된다. 비운 칸은 NULL 로 저장한다.
// 옛 행에는 비운 칸이 '미입력'으로 남아 있을 수 있어 화면에선 빈 값으로 본다.
function contactValue(v) { return v && v !== '미입력' ? v : ''; }
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
// "30000000" → "30,000,000원". 숫자가 아니면 (예: "가격 협의") 원문 그대로.
function fmtPrice(v) { return window.MagUtil.formatPrice(v, { keepText: true }); }
function categoryLabel(k) {
  return (CATEGORIES.find(c => c.key === k) || {}).label || k;
}
function statusLabel(s) {
  return s === 'available' ? i18n.t('판매중', 'For sale', '販売中') : s === 'reserved' ? i18n.t('예약중', 'Reserved', '予約中') : s === 'sold' ? i18n.t('판매완료', 'Sold', '売約済み') : s;
}
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(i18n.t(`${label} 응답이 늦어지고 있습니다.`, `${label} is taking too long to respond.`, `${label}の応答に時間がかかっています。`))), ms);
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
  $('marketGrid').innerHTML = window.MagState
    ? window.MagState.error({ title: message || i18n.t('마켓 데이터를 불러오지 못했어요.', 'Could not load the market.', 'マーケットのデータを読み込めませんでした。'), action: 'retry-market', actionLabel: i18n.t('다시 불러오기', 'Try again', '再読み込み') })
    : `<div class="market-empty">${escapeHtml(message || i18n.t('마켓 데이터를 불러오지 못했습니다.', 'Could not load the market.', 'マーケットのデータを読み込めませんでした。'))}<br /><button type="button" class="market-retry-btn" data-action="retry-market">${i18n.t('다시 불러오기', 'Try again', '再読み込み')}</button></div>`;
}

// ═════════════════════════════════════════
// 데이터 로드 + 렌더
// ═════════════════════════════════════════
async function loadList() {
  $('marketGrid').innerHTML = window.MagState ? window.MagState.loading({ count: 8, variant: 'square' }) : `<div class="market-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  try {
    const rows = await withTimeout(db().market.list({ limit: 500 }), 9000, i18n.t('마켓 목록', 'Market listings', 'マーケット一覧'));
    STATE.rows = Array.isArray(rows) ? rows : [];
    renderFilterChips();
    renderGrid();
  } catch (e) {
    STATE.rows = [];
    renderFilterChips();
    renderMarketLoadError(`${e.message || i18n.t('마켓 데이터를 불러오지 못했습니다.', 'Could not load the market.', 'マーケットのデータを読み込めませんでした。')} ${i18n.t('네트워크 상태를 확인한 뒤 다시 시도해 주세요.', 'Check your connection and try again.', '通信状況を確認してから、もう一度お試しください。')}`);
  }
}

function renderFilterChips() {
  const bar = $('marketFilter');
  if (!bar) return;
  // hideSold 활성 시 sold 매물은 카운트에서도 제외 — 칩 숫자와 그리드 결과 일치
  const visibleRows = STATE.hideSold
    ? STATE.rows.filter(r => r.status !== 'sold')
    : STATE.rows;
  const counts = { all: visibleRows.length };
  for (const r of visibleRows) counts[r.category] = (counts[r.category] || 0) + 1;
  bar.innerHTML = CATEGORIES
    .filter(c => c.key === 'all' || counts[c.key])
    .map(c => `
      <button type="button" class="ft-chip market-category-chip${c.key === STATE.filter ? ' is-active' : ''}"
              data-cat="${escapeAttr(c.key)}" role="tab" aria-selected="${c.key === STATE.filter}">
        ${escapeHtml(c.label)}<span class="ft-chip-count market-category-count">${counts[c.key] || 0}</span>
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

function renderStatusToggle() {
  const btn = $('marketStatusToggle');
  if (!btn) return;
  const labelEl = btn.querySelector('.market-status-toggle-label');
  btn.setAttribute('aria-pressed', STATE.hideSold ? 'true' : 'false');
  if (labelEl) labelEl.textContent = STATE.hideSold ? i18n.t('판매중만', 'For sale only', '販売中のみ') : i18n.t('전체 보기', 'Show all', 'すべて表示');
}

function applyFilters() {
  const q = STATE.search.trim().toLowerCase();
  return STATE.rows.filter(r => {
    if (STATE.hideSold && r.status === 'sold') return false;
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
    const hasFilter = !!STATE.search || STATE.filter !== 'all' || STATE.hideSold;
    if (window.MagState) {
      grid.innerHTML = STATE.search || STATE.filter !== 'all' || STATE.hideSold
        ? window.MagState.empty({
            title: i18n.t('조건에 맞는 매물이 없어요.', 'No items match your filters.', '条件に合う出品はありません。'),
            desc: i18n.t('검색어를 줄이거나 카테고리를 바꿔보세요.', 'Try a shorter search or a different category.', '検索語を短くするか、カテゴリーを変えてみてください。'),
            actionLabel: hasFilter ? i18n.t('전체 보기', 'Show all', 'すべて表示') : '',
            action: 'reset-market',
          })
        : window.MagState.empty({
            title: i18n.t('아직 올라온 매물이 없어요.', 'No items listed yet.', 'まだ出品はありません。'),
            desc: i18n.t('카메라, 필름, 액세서리를 첫 매물로 올려보세요.', 'Be the first to list a camera, film or accessory.', 'カメラやフィルム、アクセサリーを最初に出品してみませんか。'),
          });
      if (hasFilter) {
        window.MagState.bindAction(grid, 'reset-market', () => {
          STATE.search = ''; STATE.filter = 'all'; STATE.hideSold = false;
          const si = $('marketSearch'); if (si) si.value = '';
          renderStatusToggle(); renderFilterChips(); renderGrid();
        });
      }
    } else {
      grid.innerHTML = '<div class="market-empty">' +
        (STATE.search ? i18n.t(`"${escapeHtml(STATE.search)}"에 맞는 매물이 없습니다.`, `No items match "${escapeHtml(STATE.search)}".`, `「${escapeHtml(STATE.search)}」に合う出品はありません。`) : i18n.t('아직 올라온 매물이 없습니다.', 'No items listed yet.', 'まだ出品はありません。')) + '</div>';
    }
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
    // 공유 아이콘(span role=button)의 키보드 작동 — Enter/Space
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const share = e.target.closest('[data-action="share"]');
      if (!share) return;
      e.preventDefault();
      e.stopPropagation();
      shareListing(share.dataset.id);
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
              aria-label="${i18n.t('이 매물 링크 공유', 'Share a link to this item', 'この出品のリンクを共有')}" title="${i18n.t('링크 공유', 'Share link', 'リンクを共有')}">
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
// 외국어판은 /market/<id> 짧은 주소가 한국어판으로 가므로 /en/(/ja/)market.html?id=<id> 를 쓴다
function detailPath(id) {
  return i18n.isEn ? `/${i18n.lang}/market.html?id=${encodeURIComponent(id)}` : `/market/${encodeURIComponent(id)}`;
}
const LIST_PATH = i18n.isEn ? `/${i18n.lang}/market.html` : '/market';
function listingUrl(id) {
  const path = detailPath(id);
  return window.prettyShareUrl ? window.prettyShareUrl(path) : `https://5ftmag.com${path}`;
}
async function shareListing(id) {
  const row = STATE.rows.find(r => r.id === id) || await db().market.getOne(id).catch(() => null);
  const title = row?.title ? `${row.title} · 5ft.mag Market` : i18n.t('5ft.mag Market 매물', '5ft.mag Market listing', '5ft.mag Market の出品');
  const text  = row ? i18n.t(`${row.title} — ${row.price}`, `${row.title} · ${row.price}`, `${row.title} · ${row.price}`) : i18n.t('5ft.mag 중고 장터에서 본 매물', 'Spotted on the 5ft.mag used market', '5ft.mag 中古マーケットで見つけた出品');
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
  showShareToast(ok ? i18n.t('링크 복사 완료', 'Link copied', 'リンクをコピーしました') : i18n.t('복사 실패 — 주소창에서 직접 복사해주세요', 'Could not copy. Copy the link from the address bar.', 'コピーできませんでした。アドレスバーから直接コピーしてください。'), ok ? 'info' : 'danger');
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
    history.replaceState(null, '', detailPath(id));
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
      history.replaceState(null, '', LIST_PATH);
    } else if (/^\/market\/[^/]+/.test(u.pathname)) {
      history.replaceState(null, '', LIST_PATH);
    }
  } catch (_) {}
}

function renderDetail(r) {
  const paths = r.storage_paths || [];
  const idx = STATE.galleryIndex;
  const mainUrl = paths[idx] ? db().market.publicUrl(paths[idx]) : '';
  const nav = paths.length > 1 ? `
    <button type="button" class="mkt-gallery-nav prev" data-action="prev" aria-label="${i18n.t('이전 사진', 'Previous photo', '前の写真')}">‹</button>
    <button type="button" class="mkt-gallery-nav next" data-action="next" aria-label="${i18n.t('다음 사진', 'Next photo', '次の写真')}">›</button>
  ` : '';
  const thumbs = paths.length > 1 ? `
    <div class="mkt-gallery-thumbs">
      ${paths.map((p, i) => `
        <button type="button" class="mkt-gallery-thumb${i === idx ? ' is-active' : ''}" data-action="thumb" data-i="${i}" aria-label="${i18n.t(`${i + 1}번째 사진 보기`, `View photo ${i + 1}`, `${i + 1}枚目の写真を見る`)}">
          <img src="${escapeAttr(db().market.publicUrl(p))}" alt="" />
        </button>`).join('')}
    </div>` : '';

  const author = r.display_name || i18n.t('회원', 'Member', '会員');
  const isMine = STATE.user && STATE.user.id === r.user_id;
  const isAuthed = !!STATE.user;
  const deliveryLabel = ({ courier: i18n.t('택배', 'Shipping', '配送'), direct: i18n.t('직거래', 'In person', '手渡し'), both: i18n.t('택배·직거래', 'Shipping or in person', '配送・手渡し') })[r.delivery_method] || r.delivery_method || '';

  $('mktDetailCard').innerHTML = `
    <button type="button" class="mkt-modal-close" data-action="close" aria-label="${i18n.t('닫기', 'Close', '閉じる')}">✕</button>
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
        <strong>${i18n.t('판매자 연락처', 'Seller contact', '出品者の連絡先')}</strong>
        ${isAuthed ? `
          ${r.seller_name ? `<div>${i18n.t('이름', 'Name', '名前')} · ${escapeHtml(r.seller_name)}</div>` : ''}
          ${contactValue(r.phone) ? `<div>${i18n.t('핸드폰', 'Phone', '携帯電話')} · ${escapeHtml(r.phone)}</div>` : ''}
          ${contactValue(r.contact) ? `<div>${i18n.t('기타', 'Other', 'その他')} · ${nl2br(r.contact)}</div>` : ''}
        ` : `
          <div class="mkt-detail-contact-locked">${i18n.t('로그인하면 판매자의 이름·핸드폰·연락처를 확인할 수 있어요.', 'Log in to see the seller\'s name, phone and contact details.', 'ログインすると、出品者の名前・携帯電話・連絡先を確認できます。')}</div>
        `}
      </div>
      <div class="mkt-detail-author">${i18n.t('올린 사람', 'Listed by', '出品者')} · ${escapeHtml(author)}</div>
      <div class="mkt-detail-actions">
        ${isMine ? `
          <button type="button" class="mkt-action-btn is-primary" data-action="edit">${i18n.t('수정', 'Edit', '編集')}</button>
          <div class="mkt-status-control">
            <button type="button" class="mkt-action-btn mkt-status-trigger" data-action="status-toggle"
                    aria-haspopup="menu" aria-expanded="false">
              ${i18n.t('상태', 'Status', 'ステータス')} · <strong>${escapeHtml(statusLabel(r.status))}</strong>
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
          <button type="button" class="mkt-action-btn" data-action="share">${i18n.t('링크 공유', 'Share link', 'リンクを共有')}</button>
          <button type="button" class="mkt-action-btn is-danger" data-action="delete">${i18n.t('삭제', 'Delete', '削除')}</button>
        ` : `
          <button type="button" class="mkt-action-btn is-primary" data-action="share">${i18n.t('링크 공유', 'Share link', 'リンクを共有')}</button>
          <button type="button" class="mkt-action-btn" data-action="report">${i18n.t('신고하기', 'Report', '通報する')}</button>
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
          return window.notify?.(i18n.t('상태를 바꾸지 못했어요. 새로고침 후 다시 시도해 주세요. (', 'Could not change the status. Refresh and try again. (', 'ステータスを変更できませんでした。再読み込みしてから、もう一度お試しください。(') + result.error.message + ')', 'danger');
        }
        r.status = next;
        await loadList();
        renderDetail(r);
        $('mktDetailModal').classList.add('open');
        window.notify?.(i18n.t(`상태를 '${statusLabel(next)}' 로 바꿨어요.`, `Status changed to "${statusLabel(next)}".`, `ステータスを「${statusLabel(next)}」に変更しました。`), 'info');
        return;
      }
      if (a === 'delete') {
        if (!confirm(i18n.t('이 매물을 삭제할까요? 등록한 사진 파일도 함께 삭제됩니다.', 'Delete this listing? Its photos will be deleted too.', 'この出品を削除しますか？登録した写真ファイルも一緒に削除されます。'))) return;
        el.disabled = true;
        const { error } = await db().market.deleteMine(r.id);
        if (error) { el.disabled = false; return window.notify?.(i18n.t('매물을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (', 'Could not delete the listing. Check your permissions or connection. (', '出品を削除できませんでした。権限または通信状況を確認してください。(') + error.message + ')', 'danger'); }
        if (r.storage_paths?.length) await db().market.removePhotos(r.storage_paths);
        closeDetail();
        window.notify?.(i18n.t('매물을 삭제했어요.', 'Listing deleted.', '出品を削除しました。'), 'info');
        return loadList();
      }
      if (a === 'report') {
        if (!STATE.user) return window.notify?.(i18n.t('신고는 로그인 후에 가능해요. 로그인하면 보던 매물로 다시 돌아옵니다.', 'Log in to report a listing. You will come back to this item after logging in.', '通報はログイン後にできます。ログインすると、見ていた出品に戻ります。'), 'info');
        const reason = await askReportReason();
        if (!reason) return;
        const { error } = await db().market.report(r.id, reason);
        if (error) return window.notify?.(i18n.t('신고를 접수하지 못했어요. 잠시 뒤 다시 시도해 주세요. (', 'Could not send your report. Try again in a moment. (', '通報を受け付けられませんでした。しばらくしてから、もう一度お試しください。(') + error.message + ')', 'danger');
        window.notify?.(i18n.t('신고가 접수되었습니다. 편집부에서 검토할게요.', 'Report received. Our editors will review it.', '通報を受け付けました。編集部で確認します。'), 'info');
      }
    });
  });
}

// ═════════════════════════════════════════
// 신고 사유 창 (prompt 대신)
// ═════════════════════════════════════════
// 고른 사유 문구와 직접 적은 내용을 합쳐 돌려준다. 취소하면 null.
// DB 는 사유를 300자까지 받는다. 사유 문구가 짧으니 직접 입력은 250자로 막는다.
let closeReportDialog = null;
function askReportReason() {
  const reasons = [
    i18n.t('허위·사기 의심', 'Suspected fake or scam', '虚偽・詐欺の疑い'),
    i18n.t('금지 품목', 'Prohibited item', '禁止されている品物'),
    i18n.t('연락 두절', 'Seller stopped responding', '連絡が取れない'),
    i18n.t('기타', 'Other', 'その他'),
  ];
  const OTHER = reasons.length - 1;
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'mkt-modal mkt-report-modal open';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'mktReportTitle');
    wrap.innerHTML = `
      <form class="mkt-modal-card mkt-report-card" novalidate>
        <h2 class="mkt-form-title" id="mktReportTitle">${i18n.t('매물 신고', 'Report this listing', '出品を通報')}</h2>
        <fieldset class="mkt-report-reasons">
          <legend class="mkt-field-label">${i18n.t('어떤 문제인가요?', 'What is the problem?', 'どんな問題ですか？')}</legend>
          ${reasons.map((label, i) => `
            <label class="mkt-report-reason"><input type="radio" name="reason" value="${i}" /> <span>${escapeHtml(label)}${i === OTHER ? i18n.t(' (직접 입력)', ' (describe below)', '（下に入力）') : ''}</span></label>`).join('')}
        </fieldset>
        <label class="mkt-field">
          <span class="mkt-field-label">${i18n.t('자세한 내용', 'Details', '詳しい内容')}</span>
          <textarea name="detail" maxlength="250" rows="3" placeholder="${i18n.t('기타를 골랐다면 꼭 적어 주세요. 다른 사유도 덧붙일 수 있어요.', 'Required if you chose Other. You can add details for any reason.', 'その他を選んだ場合は必ず入力してください。ほかの理由にも書き添えられます。')}"></textarea>
        </label>
        <p class="mkt-report-error" role="alert"></p>
        <div class="mkt-report-actions">
          <button type="button" class="mkt-btn mkt-btn-secondary" data-action="cancel">${i18n.t('취소', 'Cancel', 'キャンセル')}</button>
          <button type="submit" class="mkt-btn mkt-btn-primary">${i18n.t('신고 보내기', 'Send report', '通報する')}</button>
        </div>
      </form>`;
    const form = wrap.querySelector('form');
    const errEl = wrap.querySelector('.mkt-report-error');
    const finish = (value) => {
      closeReportDialog = null;
      wrap.remove();
      prevFocus?.focus?.();
      resolve(value);
    };
    closeReportDialog = () => finish(null);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-action="cancel"]')) finish(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = form.querySelector('input[name="reason"]:checked');
      const detail = form.detail.value.trim();
      if (!picked) { errEl.textContent = i18n.t('신고 사유를 골라 주세요.', 'Choose a reason.', '通報の理由を選んでください。'); return; }
      const idx = Number(picked.value);
      if (idx === OTHER && !detail) { errEl.textContent = i18n.t('기타 사유를 적어 주세요.', 'Describe the problem.', 'その他の理由を入力してください。'); form.detail.focus(); return; }
      finish(detail ? `${reasons[idx]}: ${detail}` : reasons[idx]);
    });
    document.body.appendChild(wrap);
    wrap.querySelector('input[name="reason"]').focus();
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
      <h2>${i18n.t('로그인이 필요해요', 'Please log in', 'ログインが必要です')}</h2>
      <p>${i18n.t('로그인하면 지금 화면으로 돌아와 매물 올리기를 이어갈 수 있어요.', 'After logging in, you will come back here to finish your listing.', 'ログインすると、この画面に戻って出品を続けられます。')}</p>
      ${window.MagAuthUI.loginButton({ className: 'mkt-btn mkt-btn-primary', attrs: 'data-action="login"' })}
      <button type="button" class="mkt-btn-link" data-action="close" style="margin-top:12px;">${i18n.t('취소', 'Cancel', 'キャンセル')}</button>
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
    <button type="button" class="mkt-modal-close" data-action="close" aria-label="${i18n.t('닫기', 'Close', '閉じる')}">✕</button>
    <form class="mkt-form" id="mktForm">
      <h2 class="mkt-form-title">${existing ? i18n.t('매물 수정', 'Edit listing', '出品を編集') : i18n.t('매물 올리기', 'List an item', '出品する')}</h2>

      <div class="mkt-field">
        <span class="mkt-field-label">${i18n.t('사진', 'Photos', '写真')} <em>*</em> <small style="font-weight:normal; color: var(--text-muted); letter-spacing: 0;">${i18n.t('(최대 3장, 5MB 이하)', '(up to 3, 5MB each)', '（最大3枚、各5MBまで）')}</small></span>
        <div class="mkt-photo-row" id="mktPhotoRow"></div>
      </div>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('제목', 'Title', 'タイトル')} <em>*</em></span>
        <input type="text" name="title" maxlength="60" required value="${escapeAttr(e.title || '')}" placeholder="${i18n.t('예: Pentax 17 미사용 박풀세트', 'e.g. Pentax 17, unused, full box', '例：Pentax 17 未使用 箱・付属品完備')}" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('가격', 'Price', '価格')} <em>*</em></span>
        <input type="text" name="price" maxlength="40" required value="${escapeAttr(e.price || '')}" placeholder="${i18n.t('예: 25만원 / 5만원 (택포)', 'e.g. 250,000 won / 50,000 won (shipping incl.)', '例：25万ウォン / 5万ウォン（送料込み）')}" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('카테고리', 'Category', 'カテゴリー')} <em>*</em></span>
        <select name="category" required>
          ${CATEGORIES.filter(c => c.key !== 'all').map(c => `
            <option value="${escapeAttr(c.key)}" ${e.category === c.key ? 'selected' : ''}>${escapeHtml(c.label)}</option>
          `).join('')}
        </select>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('설명', 'Description', '説明')} <small style="font-weight:normal; color: var(--text-muted); letter-spacing: 0;">${i18n.t('(1000자 이내)', '(1,000 characters max)', '（1,000字以内）')}</small></span>
        <textarea name="description" maxlength="1000" placeholder="${i18n.t('상태, 사용 기간, 거래 방식 등 자유롭게 적어주세요.', 'Condition, how long you used it, how you want to sell, anything else.', '状態や使用期間、取引方法など、自由に書いてください。')}">${escapeHtml(e.description || '')}</textarea>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('지역', 'Location', '地域')} <em>*</em></span>
        <input type="text" name="location" maxlength="60" required value="${escapeAttr(e.location || '')}" placeholder="${i18n.t('예: 서울 마포 / 경기 성남 / 전국 (택배)', 'e.g. Seoul Mapo / Seongnam / Nationwide (shipping)', '例：ソウル 麻浦 / 京畿 城南 / 全国（配送）')}" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('거래 방식', 'Delivery', '取引方法')} <em>*</em></span>
        <select name="delivery_method" required>
          <option value="" ${!e.delivery_method ? 'selected' : ''} disabled>${i18n.t('선택해주세요', 'Choose one', '選択してください')}</option>
          <option value="courier" ${e.delivery_method === 'courier' ? 'selected' : ''}>${i18n.t('택배', 'Shipping', '配送')}</option>
          <option value="direct"  ${e.delivery_method === 'direct'  ? 'selected' : ''}>${i18n.t('직거래', 'In person', '手渡し')}</option>
          <option value="both"    ${e.delivery_method === 'both'    ? 'selected' : ''}>${i18n.t('택배·직거래 둘 다', 'Shipping or in person', '配送・手渡しどちらも可')}</option>
        </select>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('이름', 'Name', '名前')} <em>*</em></span>
        <input type="text" name="seller_name" maxlength="60" required value="${escapeAttr(e.seller_name || '')}" placeholder="${i18n.t('실명 또는 통상 사용하는 이름', 'Your real name or the name you usually go by', '本名、または普段使っている名前')}" />
        <span class="mkt-field-hint">${i18n.t('구매자가 받을 사람을 확인할 수 있도록 적어주세요. (로그인한 사용자에게만 공개)', 'So buyers know who they are dealing with. (Visible to logged-in members only)', '購入者が取引相手を確認できるように入力してください。（ログイン中の会員にのみ公開）')}</span>
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('핸드폰 번호', 'Phone number', '携帯電話番号')}</span>
        <input type="tel" name="phone" maxlength="20" value="${escapeAttr(contactValue(e.phone))}" placeholder="${i18n.t('예: 010-1234-5678', 'e.g. 010-1234-5678', '例：010-1234-5678')}" pattern="[0-9\-\s]{9,20}" />
      </label>

      <label class="mkt-field">
        <span class="mkt-field-label">${i18n.t('기타 연락처', 'Other contact', 'その他の連絡先')}</span>
        <textarea name="contact" maxlength="100" placeholder="${i18n.t('카톡 ID, 인스타 DM 등 — 핸드폰 외에 받을 수 있는 방법', 'KakaoTalk ID, Instagram DM, or another way to reach you besides phone', 'カカオトーク ID、Instagram DM など、携帯電話以外の連絡方法')}">${escapeHtml(contactValue(e.contact))}</textarea>
        <span class="mkt-field-hint">${i18n.t('핸드폰과 기타 연락처 중 하나만 적어도 돼요. 로그인한 독자 누구나 매물의 \'판매자 연락처\'에서 볼 수 있어요.', 'Fill in at least one of phone or other contact. Any signed-in reader can see it under \'Seller contact\' on the listing.', '携帯電話とその他の連絡先のどちらか一つで構いません。ログインした読者なら誰でも、出品ページの「出品者の連絡先」で確認できます。')}</span>
      </label>

      <label class="mkt-safety-check">
        <input type="checkbox" name="safety_agree" ${existing ? 'checked' : ''} />
        <span>${i18n.t('거래는 개인 간 직접 진행되며, 도난품·가품·불법 물품을 올리지 않는다는 점을 확인했습니다.', 'I understand that deals happen directly between members, and I will not list stolen, counterfeit or illegal items.', '取引は会員同士で直接行うものであり、盗品・偽物・違法な品物を出品しないことを確認しました。')}</span>
      </label>

      <div class="mkt-form-actions">
        <button type="button" class="mkt-btn mkt-btn-secondary" data-action="close">${i18n.t('취소', 'Cancel', 'キャンセル')}</button>
        <button type="submit" class="mkt-btn mkt-btn-primary" id="mktFormSubmit">${existing ? i18n.t('저장', 'Save', '保存') : i18n.t('올리기', 'Post', '出品する')}</button>
      </div>
      <div class="mkt-upload-status" id="mktUploadStatus" aria-live="polite" hidden>
        <span class="mkt-upload-dot" aria-hidden="true"></span>
        <span>
          <strong id="mktUploadTitle">${i18n.t('업로드 준비 중', 'Getting ready to upload', 'アップロードの準備中')}</strong>
          <small id="mktUploadDetail">${i18n.t('창을 닫지 말고 잠시만 기다려 주세요.', 'Please keep this window open.', '画面を閉じずに、少しお待ちください。')}</small>
        </span>
      </div>
      <p class="mkt-form-error" id="mktFormError" aria-live="polite"></p>
    </form>`;

  renderPhotoSlots();
  $('mktFormCard').querySelectorAll('[data-action="close"]').forEach(b => b.addEventListener('click', closeForm));
  $('mktForm').addEventListener('submit', onSubmit);
  // 입력 시작하면 누락 표시(aria-invalid) 해제
  $('mktForm').querySelectorAll('[name]').forEach(el => {
    el.addEventListener('input', () => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
  });
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
          <button type="button" class="mkt-photo-remove" data-action="remove" data-i="${i}" aria-label="${i18n.t('삭제', 'Remove', '削除')}">✕</button>
        </div>`);
    } else {
      slots.push(`
        <label class="mkt-photo-slot" data-i="${i}">
          + ${i18n.t('추가', 'Add', '追加')}
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
        if (slot) slot.firstChild.nodeValue = i18n.t(`변환 중… (${fmtBytes(file.size)}) `, `Converting… (${fmtBytes(file.size)}) `, `変換中…（${fmtBytes(file.size)}） `);
        setMarketUploadStatus('progress', i18n.t('사진을 준비하는 중', 'Preparing photo', '写真を準備しています'), i18n.t(`${fmtBytes(file.size)} 파일을 웹용 이미지로 줄이고 있어요.`, `Shrinking a ${fmtBytes(file.size)} file for the web.`, `${fmtBytes(file.size)} のファイルをウェブ用の画像に縮小しています。`));
        const { blob } = await withNetworkTimeout(
          resizeToJpeg(file, ({ stage, width: w, height: h }) => {
            if (!slot) return;
            if (stage === 'decode') {
              slot.firstChild.nodeValue = i18n.t(`사진 읽는 중… (${fmtBytes(file.size)}) `, `Reading photo… (${fmtBytes(file.size)}) `, `写真を読み込み中…（${fmtBytes(file.size)}） `);
              setMarketUploadStatus('progress', i18n.t('사진을 읽는 중', 'Reading photo', '写真を読み込んでいます'), i18n.t('큰 사진은 이 단계에서 몇 초 걸릴 수 있어요.', 'Large photos can take a few seconds here.', '大きな写真はここで数秒かかることがあります。'));
            } else if (stage === 'resize') {
              slot.firstChild.nodeValue = i18n.t(`크기 줄이는 중… (${w}×${h}) `, `Resizing… (${w}×${h}) `, `サイズ変更中…（${w}×${h}） `);
              setMarketUploadStatus('progress', i18n.t('사진 크기 줄이는 중', 'Resizing photo', '写真のサイズを変更しています'), i18n.t(`${w}×${h} 크기로 변환하고 있어요.`, `Resizing to ${w}×${h}.`, `${w}×${h} に変換しています。`));
            } else if (stage === 'encode') {
              slot.firstChild.nodeValue = i18n.t(`인코딩 중… (${w}×${h}) `, `Encoding… (${w}×${h}) `, `エンコード中…（${w}×${h}） `);
              setMarketUploadStatus('progress', i18n.t('사진을 압축하는 중', 'Compressing photo', '写真を圧縮しています'), i18n.t('업로드 전에 용량을 줄이고 있어요.', 'Making the file smaller before upload.', 'アップロードの前にファイルサイズを小さくしています。'));
            }
          }),
          MARKET_TIMEOUTS.imageProcess,
          i18n.t('사진 변환', 'Photo conversion', '写真の変換')
        );
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error(i18n.t('파일이 너무 큽니다 (5MB 이하).', 'File is too large (5MB max).', 'ファイルが大きすぎます（5MBまで）。'));
        const blobUrl = URL.createObjectURL(blob);
        STATE.formPhotos[Number(el.dataset.i)] = { blob, blobUrl, previewUrl: blobUrl, originalBytes: file.size };
        setMarketUploadStatus('done', i18n.t('사진 준비 완료', 'Photo ready', '写真の準備ができました'), i18n.t('계속해서 매물 정보를 입력해 주세요.', 'Go ahead and fill in the details.', '続けて出品情報を入力してください。'));
        renderPhotoSlots();
      } catch (err) {
        reportMarketUploadFailure('image-process', err, {
          inputBytes: file.size,
          photoCount: STATE.formPhotos.length,
        });
        if (slot && origLabel) slot.firstChild.nodeValue = origLabel;
        setMarketUploadStatus('error', i18n.t('사진 준비 실패', 'Photo failed', '写真を準備できませんでした'), i18n.t('다른 사진을 선택하거나 네트워크 상태를 확인해 주세요.', 'Pick another photo or check your connection.', '別の写真を選ぶか、通信状況を確認してください。'));
        window.notify?.(err.message || i18n.t('사진을 준비하지 못했어요. 다른 사진으로 다시 시도해 주세요.', 'Could not prepare the photo. Try a different one.', '写真を準備できませんでした。別の写真でもう一度お試しください。'), 'danger');
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
    return Promise.reject(new Error(i18n.t('이미지 변환 모듈이 로드되지 않았어요. 새로고침 후 다시 시도해 주세요.', 'The image converter did not load. Refresh and try again.', '画像変換モジュールを読み込めませんでした。再読み込みしてから、もう一度お試しください。')));
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
    const t = setTimeout(() => reject(new Error(i18n.t(`${label} 시간 초과 (${Math.round(ms/1000)}초). 네트워크 상태 확인 후 다시 시도해 주세요.`, `${label} timed out (${Math.round(ms/1000)}s). Check your connection and try again.`, `${label}がタイムアウトしました（${Math.round(ms/1000)}秒）。通信状況を確認してから、もう一度お試しください。`))), ms);
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
  submit.disabled = true; submit.textContent = i18n.t('내용 확인 중…', 'Checking…', '内容を確認中…');
  setMarketUploadStatus('progress', i18n.t('내용 확인 중', 'Checking your listing', '内容を確認しています'), i18n.t('필수 입력값과 사진을 확인하고 있어요.', 'Checking required fields and photos.', '必須項目と写真を確認しています。'));
  let uploadStage = 'validate';
  const uploadMeta = {
    inputBytes: STATE.formPhotos.reduce((sum, p) => sum + (Number(p?.originalBytes) || Number(p?.blob?.size) || 0), 0),
    uploadBytes: 0,
    photoCount: STATE.formPhotos.length,
  };
  try {
    if (!STATE.formPhotos.length) throw new Error(i18n.t('상품 상태를 볼 수 있는 사진을 1장 이상 올려주세요.', 'Add at least one photo that shows the item\'s condition.', '商品の状態がわかる写真を1枚以上追加してください。'));
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
    const requiredFields = [
      ['title', title], ['price', price], ['category', category], ['location', location],
      ['delivery_method', delivery_method], ['seller_name', seller_name],
    ];
    const missing = requiredFields.find(([, v]) => !v);
    if (missing) {
      const field = form.querySelector(`[name="${missing[0]}"]`);
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', 'mktFormError');
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        field.focus({ preventScroll: true });
      }
      throw new Error(i18n.t('필수 항목(제목·가격·카테고리·지역·거래 방식·이름)을 모두 입력해 주세요.', 'Please fill in all required fields (title, price, category, location, delivery, name).', '必須項目（タイトル・価格・カテゴリー・地域・取引方法・名前）をすべて入力してください。'));
    }
    if (!phone && !contact) {
      const field = form.querySelector('[name="phone"]');
      field?.setAttribute('aria-invalid', 'true');
      field?.setAttribute('aria-describedby', 'mktFormError');
      field?.focus();
      throw new Error(i18n.t('연락처를 하나 이상 적어 주세요.', 'Please add at least one way to contact you.', '連絡先を一つ以上入力してください。'));
    }
    if (!['courier','direct','both'].includes(delivery_method)) throw new Error(i18n.t('거래 방식을 다시 선택해 주세요.', 'Please choose a delivery option again.', '取引方法をもう一度選択してください。'));
    if (phone && !/[0-9]{8,}/.test(phone.replace(/[^0-9]/g, ''))) throw new Error(i18n.t('핸드폰 번호 형식을 확인해 주세요. (숫자 8자리 이상)', 'Check your phone number. (At least 8 digits)', '携帯電話番号の形式を確認してください。（数字8桁以上）'));
    if (fd.get('safety_agree') !== 'on') throw new Error(i18n.t('개인 간 거래 확인사항에 동의해야 매물을 올릴 수 있어요.', 'You need to agree to the private sale terms to post a listing.', '個人間取引の確認事項に同意すると出品できます。'));

    // 사진 업로드 — 신규 추가된 것만
    uploadStage = 'auth';
    setMarketUploadStatus('progress', i18n.t('로그인 상태 확인 중', 'Checking your login', 'ログイン状態を確認しています'), i18n.t('매물 등록 권한을 확인하고 있어요.', 'Making sure you can post listings.', '出品の権限を確認しています。'));
    // 1) localStorage JWT 를 sync 로 파싱해서 Supabase 호출 없이 user.id 확보.
    // 2) 토큰이 없거나 만료됐을 때만 db.auth.getSession() 으로 fallback.
    //    실제 권한은 RLS 가 백엔드에서 확인하므로 사전 검증 우회는 안전.
    let user = readLocalJwtUser();
    if (!user) {
      const session = await withNetworkTimeout(db().auth.getSession(), MARKET_TIMEOUTS.auth, i18n.t('로그인 확인', 'Login check', 'ログインの確認'));
      user = session?.user || null;
    }
    if (!user) throw new Error(i18n.t('로그인이 만료되었어요. 다시 로그인한 뒤 저장해 주세요.', 'Your login has expired. Log in again and save.', 'ログインの有効期限が切れました。もう一度ログインしてから保存してください。'));
    const finalPaths = [];
    const uploadedNew = [];
    for (const p of STATE.formPhotos) {
      if (p.existingPath) { finalPaths.push(p.existingPath); continue; }
      const totalNew = STATE.formPhotos.filter(x => !x.existingPath).length;
      submit.textContent = i18n.t(`사진 업로드 중… (${uploadedNew.length + 1}/${totalNew} · ${fmtBytes(p.blob?.size)})`, `Uploading photos… (${uploadedNew.length + 1}/${totalNew} · ${fmtBytes(p.blob?.size)})`, `写真をアップロード中…（${uploadedNew.length + 1}/${totalNew} · ${fmtBytes(p.blob?.size)}）`);
      setMarketUploadStatus('progress', i18n.t('사진 업로드 중', 'Uploading photos', '写真をアップロードしています'), i18n.t(`${uploadedNew.length + 1}/${totalNew}번째 사진 ${fmtBytes(p.blob?.size)} 파일을 서버에 보내고 있어요.`, `Sending photo ${uploadedNew.length + 1} of ${totalNew} (${fmtBytes(p.blob?.size)}).`, `${uploadedNew.length + 1}/${totalNew}枚目の写真（${fmtBytes(p.blob?.size)}）をサーバーに送信しています。`));
      uploadStage = 'storage';
      uploadMeta.uploadBytes = p.blob?.size || 0;
      const path = `${user.id}/${Date.now()}-${uuid()}.jpg`;
      const { error: upErr } = await withNetworkTimeout(
        db().market.uploadPhoto(path, p.blob),
        MARKET_TIMEOUTS.upload,
        i18n.t('사진 업로드', 'Photo upload', '写真のアップロード')
      ).catch(err => ({ error: { message: err.message } }));
      if (upErr) {
        // 실패 시 이번 세션에서 올린 것들 정리
        if (uploadedNew.length) {
          await withNetworkTimeout(db().market.removePhotos(uploadedNew), MARKET_TIMEOUTS.cleanup, '업로드 파일 정리').catch(() => null);
        }
        throw new Error(i18n.t('사진 업로드가 완료되지 않았어요. 네트워크를 확인한 뒤 다시 시도해 주세요. (', 'The photo upload did not finish. Check your connection and try again. (', '写真のアップロードが完了しませんでした。通信状況を確認してから、もう一度お試しください。(') + upErr.message + ')');
      }
      finalPaths.push(path);
      uploadedNew.push(path);
    }

    // 비운 칸은 NULL. DB 제약(market_listings_contact_any)이 둘 중 하나는 있게 막는다.
    const record = { title, price, category, description, location, delivery_method, seller_name, phone: phone || null, contact: contact || null, storage_paths: finalPaths };

    if (STATE.editId) {
      submit.textContent = i18n.t('수정 저장 중…', 'Saving changes…', '変更を保存中…');
      setMarketUploadStatus('progress', i18n.t('수정 내용 저장 중', 'Saving changes', '変更内容を保存しています'), i18n.t('사진 경로와 매물 정보를 함께 저장하고 있어요.', 'Saving your photos and listing details.', '写真と出品情報をまとめて保存しています。'));
      uploadStage = 'write';
      // 수정: 제거된 사진 (formPhotos 에서 빠진 existingPath) 들 storage 정리
      const existing = STATE.rows.find(r => r.id === STATE.editId);
      const droppedPaths = (existing?.storage_paths || []).filter(p => !finalPaths.includes(p));
      const { error } = await withNetworkTimeout(db().market.updateMine(STATE.editId, record), MARKET_TIMEOUTS.write, i18n.t('수정 저장', 'Saving changes', '変更の保存'));
      if (error) throw new Error(i18n.t('수정 내용을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요. (', 'Could not save your changes. Try again in a moment. (', '変更内容を保存できませんでした。しばらくしてから、もう一度お試しください。(') + error.message + ')');
      if (droppedPaths.length) await withNetworkTimeout(db().market.removePhotos(droppedPaths), MARKET_TIMEOUTS.cleanup, '삭제 사진 정리').catch(() => null);
    } else {
      submit.textContent = i18n.t('매물 등록 중…', 'Posting…', '出品中…');
      setMarketUploadStatus('progress', i18n.t('매물 등록 중', 'Posting your listing', '出品を登録しています'), i18n.t('사진 경로와 매물 정보를 함께 저장하고 있어요.', 'Saving your photos and listing details.', '写真と出品情報をまとめて保存しています。'));
      uploadStage = 'write';
      const { error } = await withNetworkTimeout(db().market.create(record), MARKET_TIMEOUTS.write, i18n.t('매물 등록', 'Posting', '出品の登録'));
      if (error) {
        if (uploadedNew.length) {
          await withNetworkTimeout(db().market.removePhotos(uploadedNew), MARKET_TIMEOUTS.cleanup, '업로드 파일 정리').catch(() => null);
        }
        throw new Error(i18n.t('매물을 등록하지 못했어요. 입력 내용과 네트워크를 확인해 주세요. (', 'Could not post the listing. Check your details and connection. (', '出品できませんでした。入力内容と通信状況を確認してください。(') + error.message + ')');
      }
    }

    closeForm();
    await loadList();
  } catch (e) {
    if (uploadStage !== 'validate') reportMarketUploadFailure(uploadStage, e, uploadMeta);
    setMarketUploadStatus('error', i18n.t('저장이 중단됐어요', 'Save stopped', '保存が中断されました'), i18n.t('입력한 내용은 유지됩니다. 메시지를 확인한 뒤 다시 시도해 주세요.', 'Your entries are kept. Read the message and try again.', '入力した内容はそのまま残っています。メッセージを確認してから、もう一度お試しください。'));
    err.textContent = e.message || i18n.t('저장을 마치지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.', 'Could not finish saving. Check your entries and try again.', '保存を完了できませんでした。入力内容を確認してから、もう一度お試しください。');
    submit.disabled = false;
    submit.textContent = STATE.editId ? i18n.t('저장', 'Save', '保存') : i18n.t('올리기', 'Post', '出品する');
  }
}

// ═════════════════════════════════════════
// 이벤트 바인딩
// ═════════════════════════════════════════
$('marketNewBtn').addEventListener('click', () => openForm());
const _mktSearchBar = $('marketSearchBar');
const _mktSearchBtn = $('marketSearchBtn');
const _mktSearchInput = $('marketSearch');
const _mktSearchClose = $('marketSearchClose');
_mktSearchBtn?.addEventListener('click', () => {
  const open = _mktSearchBar.hidden;
  _mktSearchBar.hidden = !open;
  _mktSearchBtn.setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => _mktSearchInput.focus(), 10);
});
_mktSearchClose?.addEventListener('click', () => {
  _mktSearchBar.hidden = true;
  _mktSearchBtn?.setAttribute('aria-expanded', 'false');
  _mktSearchInput.value = ''; STATE.search = ''; renderGrid();
});
_mktSearchInput.addEventListener('input', (e) => {
  STATE.search = e.target.value;
  renderGrid();
});
$('marketStatusToggle')?.addEventListener('click', () => {
  STATE.hideSold = !STATE.hideSold;
  renderStatusToggle();
  renderFilterChips();
  renderGrid();
});
renderStatusToggle();
$('marketGrid').addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="retry-market"], [data-state-action="retry-market"]')) return;
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
  // 신고 창이 떠 있으면 그것만 닫는다 (상세 모달은 유지)
  if (closeReportDialog) { closeReportDialog(); return; }
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
    renderMarketLoadError(i18n.t(`마켓 연결을 준비하지 못했습니다. 새로고침 후에도 반복되면 편집부에 알려주세요 (${window.MagContact.text()}).`, `Could not connect to the market. If this keeps happening after a refresh, let our editors know (${window.MagContact.text()}).`, `マーケットへの接続を準備できませんでした。再読み込みしても続く場合は、編集部にお知らせください（${window.MagContact.text()}）。`));
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
