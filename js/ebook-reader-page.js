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
      // 예전에는 여기서 무엇이 잘못됐든 "PDF 가 등록되지 않았어요" 하나만 띄웠다.
      // 서버가 못 열린 것인지, 이북이 내려간 것인지, 파일만 빠진 것인지 구분이
      // 안 돼서 신고를 받아도 어디를 봐야 할지 알 수 없었다. 원인별로 나눈다.
      console.error('[ebook] 열람 실패', { slug, access });
      if (!access) {
        gate('<h2>연결 실패</h2><p>이북 서버에 닿지 못했어요. 잠시 후 새로고침해 주세요.</p>'
          + '<p class="ebook-gate-code">문제가 이어지면 이 화면을 캡처해 알려주세요. (code: network)</p>');
        return;
      }
      if (access.error === 'not found') {
        gate('<h2>없는 이북</h2><p>공개되지 않았거나 삭제된 이북이에요.</p>'
          + '<p class="ebook-gate-code">(code: not-found)</p>');
        return;
      }
      // file unavailable — 어느 쪽이 빠졌는지에 따라 안내가 달라진다.
      // full 이 없으면 구매자만 막히고, preview 가 없으면 모두가 막힌다.
      const full = access.missing === 'full.pdf' || access.entitled === true;
      gate(`<h2>준비 중</h2><p>${full
        ? '전체 PDF 가 아직 올라오지 않았어요.'
        : '미리보기 PDF 가 아직 올라오지 않았어요.'} 편집부에 알려주시면 바로 확인할게요.</p>`
        + `<p class="ebook-gate-code">(code: ${esc(access.error || 'unknown')}${access.missing ? ' / ' + esc(access.missing) : ''})</p>`);
      return;
    }

    const priceLabel = product.price ? product.price.toLocaleString('ko-KR') + '원 · 구매하고 전체 보기' : '구매하고 전체 보기';
    const opts = {
      // 책장(소개 화면)에서 왔으면 뒤로 가서 그 책의 소개 화면으로 돌아간다(표지가 다시 덮인다). 아니면 그 책의 소개 화면을 연다
      onClose: () => {
        let fromShelf = false;
        try { fromShelf = new URL(document.referrer).origin === location.origin && /\/books(\.html)?$/.test(new URL(document.referrer).pathname); } catch (_) {}
        if (fromShelf && history.length > 1) history.back();
        else location.href = 'books.html?issue=' + encodeURIComponent(slug);
      },
      cta: access.entitled ? null : { label: priceLabel, note: '미리보기는 여기까지예요', onClick: onBuy },
    };
    // 책장 뷰어(무료 웹진과 동일) 열기
    gate('');
    window.WebzineReader.open(access.url, product.title, opts);
    // 책장에서 "구매하고 전체 보기" 로 왔으면(?buy=1) 결제 창을 바로 띄운다
    if (!access.entitled && new URLSearchParams(location.search).get('buy') === '1') setTimeout(onBuy, 300);
  }

  init();
})();
