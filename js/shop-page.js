'use strict';

// Shop 공개 페이지 — data/shop.json 을 fetch 해서 그리드 렌더링.
// 구매 CTA 는 Smart Store 의 상품 페이지로 새 탭 점프.

(function () {
  const grid = document.getElementById('shopGrid');
  const empty = document.getElementById('shopEmpty');
  const chipsBar = document.getElementById('shopChips');
  const modal = document.getElementById('shopModal');
  const modalPanel = document.getElementById('shopModalPanel');
  const modalClose = document.getElementById('shopModalClose');

  if (!grid) return;

  const escapeHtml = window.MagUtil ? window.MagUtil.escapeHtml : (s) => String(s ?? '');
  const escapeAttr = window.MagUtil ? window.MagUtil.escapeAttr : (s) => String(s ?? '');

  const STATE = {
    products: [],
    filter: 'all',
  };

  function fmtPrice(n) {
    if (!n || n <= 0) return '';
    return n.toLocaleString('ko-KR') + '원';
  }

  function categoryLabel(cat) {
    switch (cat) {
      case 'film':   return '필름';
      case 'camera': return '카메라';
      case 'goods':  return '굿즈';
      case 'book':   return '책';
      default:       return cat || '';
    }
  }

  function productCard(p) {
    const img = (p.images && p.images[0]) || '';
    const thumb = img
      ? `<img decoding="async" src="${escapeAttr(img)}" alt="${escapeAttr(p.title)}" loading="lazy" />`
      : '';
    const priceLine = (p.originalPrice && p.originalPrice > p.price)
      ? `<span class="shop-card-price-original">${escapeHtml(fmtPrice(p.originalPrice))}</span> <span class="shop-card-price">${escapeHtml(fmtPrice(p.price))}</span>`
      : `<span class="shop-card-price">${escapeHtml(fmtPrice(p.price))}</span>`;
    const soldOut = p.available === false
      ? '<span class="shop-card-soldout">품절</span>'
      : '';
    return `
      <button type="button" class="shop-card" data-slug="${escapeAttr(p.slug)}">
        <div class="shop-card-thumb">
          ${thumb}
          <span class="shop-card-cat">${escapeHtml(categoryLabel(p.category))}</span>
          ${soldOut}
        </div>
        <div class="shop-card-body">
          <h3 class="shop-card-title">${escapeHtml(p.title)}</h3>
          <div class="shop-card-price-row">${priceLine}</div>
        </div>
      </button>
    `;
  }

  function applyFilter() {
    const cat = STATE.filter;
    const list = cat === 'all'
      ? STATE.products
      : STATE.products.filter(p => p.category === cat);

    if (list.length === 0) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.textContent = cat === 'all'
        ? '아직 등록된 상품이 없어요. 편집부가 곧 채워 넣습니다.'
        : '이 카테고리엔 아직 상품이 없어요.';
      return;
    }
    empty.hidden = true;
    grid.innerHTML = list.map(productCard).join('');
  }

  function updateChipCounts() {
    const all = STATE.products.length;
    const by = STATE.products.reduce((acc, p) => {
      acc[p.category] = (acc[p.category] || 0) + 1;
      return acc;
    }, {});
    chipsBar.querySelectorAll('.ft-chip-count').forEach(el => {
      const k = el.dataset.count;
      el.textContent = k === 'all' ? all : (by[k] || 0);
    });
  }

  function openModal(p) {
    const imgs = (p.images || []).map(src => `
      <div class="shop-modal-img"><img decoding="async" src="${escapeAttr(src)}" alt="${escapeAttr(p.title)}" loading="lazy" /></div>
    `).join('');
    const priceLine = (p.originalPrice && p.originalPrice > p.price)
      ? `<span class="shop-card-price-original">${escapeHtml(fmtPrice(p.originalPrice))}</span> <strong class="shop-modal-price">${escapeHtml(fmtPrice(p.price))}</strong>`
      : `<strong class="shop-modal-price">${escapeHtml(fmtPrice(p.price))}</strong>`;
    const buyDisabled = !p.smartStoreUrl || p.available === false;
    const buyButton = buyDisabled
      ? `<button type="button" class="shop-buy-btn is-disabled" disabled>${p.available === false ? '품절' : '준비 중'}</button>`
      : `<a href="${escapeAttr(p.smartStoreUrl)}" target="_blank" rel="noopener" class="shop-buy-btn">Smart Store 에서 구매하기 <span class="shop-buy-arrow">↗</span></a>`;
    const description = p.description
      ? `<div class="shop-modal-desc">${escapeHtml(p.description).replace(/\n/g, '<br>')}</div>`
      : '';

    modalPanel.innerHTML = `
      <div class="shop-modal-images">${imgs || '<div class="shop-modal-img shop-modal-img-empty"></div>'}</div>
      <div class="shop-modal-info">
        <span class="shop-modal-cat">${escapeHtml(categoryLabel(p.category))}</span>
        <h2 class="shop-modal-title" id="shopModalTitle">${escapeHtml(p.title)}</h2>
        <div class="shop-modal-price-row">${priceLine}</div>
        ${p.excerpt ? `<p class="shop-modal-excerpt">${escapeHtml(p.excerpt)}</p>` : ''}
        ${description}
        ${buyButton}
        <p class="shop-modal-note">결제·배송·환불은 Naver Smart Store 에서 진행됩니다.</p>
      </div>
    `;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  chipsBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.ft-chip');
    if (!btn) return;
    STATE.filter = btn.dataset.cat;
    chipsBar.querySelectorAll('.ft-chip').forEach(c => {
      const on = c.dataset.cat === STATE.filter;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    applyFilter();
  });

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.shop-card');
    if (!card) return;
    const slug = card.dataset.slug;
    const p = STATE.products.find(x => x.slug === slug);
    if (p) openModal(p);
  });

  fetch('data/shop.json', { cache: 'no-cache' })
    .then(res => res.json())
    .then(data => {
      STATE.products = Array.isArray(data) ? data : [];
      updateChipCounts();
      applyFilter();
    })
    .catch(err => {
      console.error('[shop] fetch 실패:', err);
      empty.hidden = false;
      empty.textContent = '상품을 불러오지 못했어요. 잠시 후 새로고침 해주세요.';
    });
})();
