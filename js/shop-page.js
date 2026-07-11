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
  let shopTrapRelease = null;

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

  // protocol 없는 URL 자동 보정 (예: phinf.pstatic.net/... → https://phinf.pstatic.net/...)
  function normalizeImageUrl(u) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('//')) return 'https:' + s;
    if (s.startsWith('/')) return s;  // 사이트 내부 경로 (예: /img/shop/...)
    // bare host (예: phinf.pstatic.net/...) — https:// 보정
    return 'https://' + s;
  }

  function productCard(p) {
    const rawImg = (p.images && p.images[0]) || '';
    const img = normalizeImageUrl(rawImg);
    const thumb = img
      ? `<img decoding="async" src="${escapeAttr(img)}" alt="${escapeAttr(p.title)}" loading="lazy" />`
      : '';
    const priceLine = (p.originalPrice && p.originalPrice > p.price)
      ? `<span class="shop-card-price-original">${escapeHtml(fmtPrice(p.originalPrice))}</span> <span class="shop-card-price">${escapeHtml(fmtPrice(p.price))}</span>`
      : `<span class="shop-card-price">${escapeHtml(fmtPrice(p.price))}</span>`;
    const isSoldOut = p.available === false;
    const soldOut = isSoldOut
      ? '<span class="shop-card-soldout">품절</span>'
      : '';
    const excerpt = p.excerpt
      ? `<p class="shop-card-excerpt">${escapeHtml(p.excerpt)}</p>`
      : '';
    const cardClass = isSoldOut ? 'shop-card is-soldout' : 'shop-card';
    return `
      <button type="button" class="${cardClass}" data-slug="${escapeAttr(p.slug)}">
        <div class="shop-card-thumb">
          ${thumb}
          <span class="shop-card-cat">${escapeHtml(categoryLabel(p.category))}</span>
          ${soldOut}
        </div>
        <div class="shop-card-body">
          <h3 class="shop-card-title">${escapeHtml(p.title)}</h3>
          ${excerpt}
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

  // 토스트
  function flashToast(msg) {
    let t = document.querySelector('.shop-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'shop-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove('is-show'), 2200);
  }

  function shareUrlFor(slug) {
    const u = new URL(window.location.href);
    u.searchParams.set('p', slug);
    u.hash = '';
    return u.toString();
  }

  async function shareProduct(p) {
    const url = shareUrlFor(p.slug);
    const shareData = { title: `${p.title} | 5ft magazine Shop`, text: p.excerpt || '', url };
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share(shareData);
        return;
      }
    } catch (_) { /* 사용자 취소·실패 → 클립보드 fallback */ }
    try {
      await navigator.clipboard.writeText(url);
      flashToast('링크 복사됨');
    } catch (_) {
      flashToast(url);
    }
  }

  function openModal(p) {
    // 대표사진(첫 장) 은 카드에 이미 보이니 모달에선 제외, 추가 사진만 노출
    const additionalImgs = (p.images || []).slice(1);
    const imgs = additionalImgs.map(src => `
      <div class="shop-modal-img"><img decoding="async" src="${escapeAttr(normalizeImageUrl(src))}" alt="${escapeAttr(p.title)}" loading="lazy" /></div>
    `).join('');
    const priceLine = (p.originalPrice && p.originalPrice > p.price)
      ? `<span class="shop-card-price-original">${escapeHtml(fmtPrice(p.originalPrice))}</span> <strong class="shop-modal-price">${escapeHtml(fmtPrice(p.price))}</strong>`
      : `<strong class="shop-modal-price">${escapeHtml(fmtPrice(p.price))}</strong>`;
    let buyButton;
    if (p.available === false && p.ebookSlug) {
      // 품절 실물 → 동일 이북으로 보기 (같은 사이트라 새 탭 아님)
      buyButton = `<a href="ebook-read.html?slug=${escapeAttr(p.ebookSlug)}" class="shop-buy-btn">품절 · 이북으로 보기 <span class="shop-buy-arrow">↗</span></a>`;
    } else if (!p.smartStoreUrl || p.available === false) {
      buyButton = `<button type="button" class="shop-buy-btn is-disabled" disabled>${p.available === false ? '품절' : '준비 중'}</button>`;
    } else {
      buyButton = `<a href="${escapeAttr(p.smartStoreUrl)}" target="_blank" rel="noopener" class="shop-buy-btn">Smart Store 에서 구매하기 <span class="shop-buy-arrow">↗</span></a>`;
    }
    const description = p.description
      ? `<div class="shop-modal-desc">${escapeHtml(p.description).replace(/\n/g, '<br>')}</div>`
      : '';
    const magazineLink = (p.category === 'book' || p.ebookSlug)
      ? `<a href="books.html${p.ebookSlug ? `?issue=${encodeURIComponent(p.ebookSlug)}` : ''}" class="shop-share-btn" data-action="view-magazine">이 호의 내용 보기 →</a>`
      : '';

    modalPanel.classList.toggle('has-images', !!imgs);
    modalPanel.innerHTML = `
      ${imgs ? `<div class="shop-modal-images">${imgs}</div>` : ''}
      <div class="shop-modal-info">
        <span class="shop-modal-cat">${escapeHtml(categoryLabel(p.category))}</span>
        <h2 class="shop-modal-title" id="shopModalTitle">${escapeHtml(p.title)}</h2>
        <div class="shop-modal-price-row">${priceLine}</div>
        ${p.excerpt ? `<p class="shop-modal-excerpt">${escapeHtml(p.excerpt)}</p>` : ''}
        ${description}
        <div class="shop-modal-actions">
          ${buyButton}
          ${magazineLink}
          <button type="button" class="shop-share-btn" data-action="share-product" data-slug="${escapeAttr(p.slug)}" aria-label="이 상품 공유">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            공유
          </button>
        </div>
        <p class="shop-modal-note">
          <strong>재고·가격은 Smart Store 에서 최종 확인해 주세요.</strong> 사이트 정보와 다를 수 있습니다.
          ${p.updatedAt ? `<br><span class="shop-modal-checked">(마지막 확인: ${escapeHtml(lastCheckedHtml(p.updatedAt))})</span>` : ''}
        </p>
        <p class="shop-modal-note">결제·배송·환불은 Naver Smart Store 에서 진행됩니다.</p>
      </div>
    `;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    shopTrapRelease = window.createFocusTrap ? window.createFocusTrap(modal) : null;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('p', p.slug);
      history.replaceState({ shopSlug: p.slug }, '', u.toString());
    } catch (_) {}
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (shopTrapRelease) { shopTrapRelease(); shopTrapRelease = null; }
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has('p')) {
        u.searchParams.delete('p');
        history.replaceState({}, '', u.toString());
      }
    } catch (_) {}
  }

  // 모달 안 공유 버튼 위임
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="share-product"]');
    if (btn) {
      const slug = btn.dataset.slug;
      const p = STATE.products.find(x => x.slug === slug);
      if (p) shareProduct(p);
    }
  });

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

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="view-magazine"]')) {
      window.trackEvent?.('shop_magazine_link_clicked');
    }
  });

  // DB row → camelCase 형태 (build-shop.mjs 의 rowToJson 와 동일)
  function rowToJson(r) {
    return {
      slug: r.slug,
      title: r.title || '',
      category: r.category || 'goods',
      price: Number(r.price) || 0,
      originalPrice: r.original_price ?? null,
      excerpt: r.excerpt || '',
      description: r.description || '',
      images: Array.isArray(r.images) ? r.images : [],
      smartStoreUrl: r.smart_store_url || '',
      ebookSlug: r.ebook_slug || r.ebookSlug || '',
      available: r.available !== false,
      sortOrder: Number(r.sort_order) || 0,
      updatedAt: r.updated_at || r.updatedAt || null,
    };
  }

  // "마지막 확인" 표시. updated_at 이 너무 오래되면 안내 강도 높임.
  function lastCheckedHtml(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    return `${Y}.${M}.${D}`;
  }

  async function waitForDB(maxMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (window.MagDB && window.MagDB.isReady && window.MagDB.isReady() && window.MagDB.shop) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  }

  // DB 우선 — admin 에서 등록·수정한 게 즉시 반영. 실패 시 정적 JSON 폴백.
  // 정적 data/shop.json 은 Netlify 빌드시 함께 갱신되긴 하지만 어디까지나
  // SEO / 오프라인 / DB 다운 시 대비용.
  async function loadProducts() {
    if (await waitForDB()) {
      try {
        const rows = await window.MagDB.shop.listPublished();
        if (Array.isArray(rows)) return rows.map(rowToJson);
      } catch (e) {
        console.warn('[shop] DB fetch 실패, 정적 JSON 으로 폴백:', e);
      }
    }
    try {
      const res = await fetch('data/shop.json', { cache: 'no-cache' });
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[shop] 정적 JSON 도 실패:', e);
      return [];
    }
  }

  loadProducts()
    .then(data => {
      STATE.products = data;
      updateChipCounts();
      applyFilter();
      // ?p={slug} 로 진입 시 해당 상품 자동 모달
      try {
        const slug = new URL(window.location.href).searchParams.get('p');
        if (slug) {
          const p = STATE.products.find(x => x.slug === slug);
          if (p) openModal(p);
        }
      } catch (_) {}
    })
    .catch(err => {
      console.error('[shop] load 실패:', err);
      empty.hidden = false;
      empty.textContent = '상품을 불러오지 못했어요. 잠시 후 새로고침 해주세요.';
    });
})();
