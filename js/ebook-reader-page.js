'use strict';

// 이북 보호 뷰어 — 무료 웹진과 동일한 pdf.js 책장(WebzineReader) 재사용.
// ?slug=<ebook slug>. Edge Function 이 열람권에 따라 full/preview PDF 서명 URL 발급.

(function () {
  function $(id) { return document.getElementById(id); }
  function db() { return window.MagDB; }
  function esc(s) { return window.MagUtil ? window.MagUtil.escapeHtml(s) : String(s == null ? '' : s); }

  function gate(html) { const r = $('ebookRoot'); if (r) r.innerHTML = `<div class="ebook-gate">${html}</div>`; }

  let product = null, slug = '';

  function onBuy() {
    if (window.EbookCheckout && typeof window.EbookCheckout.start === 'function') {
      window.EbookCheckout.start(product);
      return;
    }
    alert('구매 안내\n\n결제 준비 중이에요. 구매를 원하시면 인스타그램 @film_socialclub DM 으로 문의해 주세요. 입금 확인 후 전체 열람권을 드립니다.');
  }

  async function init() {
    slug = (new URLSearchParams(location.search).get('slug') || '').trim();
    if (!slug) { gate('<h2>잘못된 주소</h2><p>이북을 찾을 수 없어요.</p>'); return; }

    for (let i = 0; i < 60; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    if (!db() || !db().isReady()) { gate('<p>서비스 준비에 실패했어요. 잠시 후 새로고침해 주세요.</p>'); return; }

    product = await db().ebooks.get(slug);
    if (!product || !product.published) { gate('<h2>없는 이북</h2><p>공개되지 않았거나 삭제된 이북이에요.</p>'); return; }
    document.title = `${product.title} | 5ft magazine`;

    const access = await db().ebooks.getAccess(slug);
    if (!access || !access.url) {
      gate(`<h2>준비 중</h2><p>아직 PDF 가 등록되지 않았어요. 잠시 후 다시 시도해 주세요.</p>`);
      return;
    }

    const priceLabel = product.price ? product.price.toLocaleString('ko-KR') + '원 · 구매하고 전체 보기' : '구매하고 전체 보기';
    const opts = {
      onClose: () => { location.href = 'books.html'; },
      cta: access.entitled ? null : { label: priceLabel, note: '미리보기는 여기까지예요', onClick: onBuy },
    };
    // 책장 뷰어(무료 웹진과 동일) 열기
    window.WebzineReader.open(access.url, product.title, opts);
  }

  init();
})();
