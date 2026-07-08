'use strict';

// 이북 구매 — 카카오페이(사이트 직접결제, PortOne V2) + 스마트스토어(주문번호 인증).
// ebook-reader-page.js 의 구매 CTA 가 window.EbookCheckout.start(product) 를 호출한다.
//
// 흐름:
//   1) 로그인 확인 (Google) — 비로그인이면 로그인 유도 후 종료
//   2) 구매 방법 선택 모달
//      - 카카오페이 → PortOne.requestPayment() → ebook-purchase 검증 → 열람권
//      - 스마트스토어 → 상품 페이지 새 탭 → 결제 후 "주문번호 인증"
//      - 주문번호 인증 → ebook-redeem 이 커머스 API 로 주문 확인 → 열람권
//   3) 성공 → 페이지 새로고침(전체 열람)
//
// Store ID / Channel Key 는 공개키라 클라이언트에 둬도 안전하다.
// (검증은 서버에서 비밀키로 다시 한다.)

(function () {
  const CFG = {
    storeId: 'store-4c794b21-bbaa-466c-8fa9-17f42db08940',
    // 카카오페이 채널 — 재심사 통과 후 라이브 키를 넣으면 버튼이 다시 나타남.
    // (테스트 키: channel-key-6eb4e2ce-a4f7-4a99-99cb-f4998d60e1b2)
    kakaoChannelKey: '',
  };
  const SDK_SRC = 'https://cdn.portone.io/v2/browser-sdk.js';

  function db() { return window.MagDB; }
  function esc(s) { return window.MagUtil ? window.MagUtil.escapeHtml(s) : String(s == null ? '' : s); }
  let busy = false;

  // ── PortOne SDK 지연 로드 ──
  let sdkPromise = null;
  function loadSdk() {
    if (window.PortOne) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_SRC;
      s.onload = () => resolve();
      s.onerror = () => { sdkPromise = null; reject(new Error('sdk load failed')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function shortId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `eb_${t}_${r}`;
  }
  function cleanUrl() {
    const slug = new URLSearchParams(location.search).get('slug') || '';
    return location.pathname + (slug ? `?slug=${encodeURIComponent(slug)}` : '');
  }

  // ── 오버레이 (확인 중 / 안내) ──
  function overlay(msg) {
    let el = document.getElementById('ebkPayOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ebkPayOverlay';
      el.className = 'ebk-pay-overlay';
      el.innerHTML = '<div class="ebk-pay-overlay-box"><span class="ebk-pay-spinner"></span><p></p></div>';
      document.body.appendChild(el);
    }
    el.querySelector('p').textContent = msg;
    el.style.display = 'flex';
    return el;
  }
  function hideOverlay() {
    const el = document.getElementById('ebkPayOverlay');
    if (el) el.style.display = 'none';
  }

  // ── 구매 방법 선택 모달 ──
  function openModal(product) {
    const won = product.price ? product.price.toLocaleString('ko-KR') + '원' : '';
    const hasKakao = !!CFG.kakaoChannelKey;
    const hasStore = !!(product.store_url && /\/products\/\d+/.test(product.store_url));

    if (!hasKakao && !hasStore) {
      alert('구매 안내\n\n결제 준비 중이에요. 구매를 원하시면 인스타그램 @film_socialclub DM 으로 문의해 주세요.');
      return;
    }

    const back = document.createElement('div');
    back.className = 'ebk-pay-modal-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'ebkPayTitle');

    const methodButtons = [
      hasKakao ? '<button type="button" class="ebk-pay-method" data-method="kakao">카카오페이로 결제</button>' : '',
      hasStore ? `<a href="${esc(product.store_url)}" target="_blank" rel="noopener" class="ebk-pay-method ebk-pay-method-link" data-store>스마트스토어에서 구매 ↗</a>` : '',
      hasStore ? '<button type="button" class="ebk-pay-method ebk-pay-method-sub" data-redeem>이미 구매했어요 · 주문번호 인증</button>' : '',
    ].join('');

    back.innerHTML = `
      <div class="ebk-pay-modal">
        <div data-pane="pick">
          <h2 id="ebkPayTitle" class="ebk-pay-modal-title">구매 방법 선택</h2>
          <p class="ebk-pay-modal-sub">${esc(product.title)}${won ? ` · ${won}` : ''}</p>
          <div class="ebk-pay-methods">${methodButtons}</div>
          <p class="ebk-pay-legal">열람을 시작하면 청약철회가 제한됩니다. <a href="/refund.html" target="_blank" rel="noopener">취소·환불 규정</a></p>
          <button type="button" class="ebk-pay-cancel" data-cancel>취소</button>
        </div>
        <div data-pane="redeem" hidden>
          <h2 class="ebk-pay-modal-title">주문번호 인증</h2>
          <p class="ebk-pay-modal-sub">스마트스토어 결제 후 받은 <b>주문번호</b>를 입력하면 이 계정에 열람권이 발급돼요. (네이버페이 주문내역 &gt; 주문번호)</p>
          <input type="text" class="ebk-pay-input" inputmode="numeric" placeholder="예: 2026070812345671" maxlength="32" aria-label="스마트스토어 주문번호" />
          <p class="ebk-pay-redeem-msg" aria-live="polite"></p>
          <div class="ebk-pay-methods">
            <button type="button" class="ebk-pay-method" data-redeem-go>인증하고 열람권 받기</button>
          </div>
          <button type="button" class="ebk-pay-cancel" data-back>← 뒤로</button>
        </div>
      </div>`;

    function pane(name) {
      back.querySelector('[data-pane="pick"]').hidden = name !== 'pick';
      back.querySelector('[data-pane="redeem"]').hidden = name !== 'redeem';
      if (name === 'redeem') setTimeout(() => back.querySelector('.ebk-pay-input')?.focus(), 30);
    }
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    async function doRedeem() {
      const input = back.querySelector('.ebk-pay-input');
      const msgEl = back.querySelector('.ebk-pay-redeem-msg');
      const orderNo = (input.value || '').trim();
      if (orderNo.replace(/[^0-9A-Za-z]/g, '').length < 8) {
        msgEl.textContent = '주문번호를 다시 확인해 주세요.';
        return;
      }
      if (busy) return;
      busy = true;
      msgEl.textContent = '주문 확인 중…';
      let r = null;
      try { r = await db().ebooks.redeemOrder(product.slug, orderNo); } catch (_) {}
      busy = false;
      if (r && r.ok) {
        close();
        overlay('인증 완료! 전체 페이지를 불러올게요…');
        location.replace(cleanUrl());
        return;
      }
      msgEl.textContent = (r && r.detail) || '인증에 실패했어요. 잠시 후 다시 시도하거나 @film_socialclub 으로 문의해 주세요.';
    }

    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.hasAttribute('data-cancel')) { close(); return; }
      if (e.target.hasAttribute('data-back')) { pane('pick'); return; }
      if (e.target.hasAttribute('data-redeem')) { pane('redeem'); return; }
      if (e.target.hasAttribute('data-redeem-go')) { doRedeem(); return; }
      const btn = e.target.closest('[data-method="kakao"]');
      if (btn) { close(); pay(product); }
      // data-store 링크는 기본 동작(새 탭)으로 두고 모달은 유지 — 돌아와서 바로 인증 가능
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList?.contains('ebk-pay-input')) { e.preventDefault(); doRedeem(); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = back.querySelector('.ebk-pay-method');
    if (first) first.focus();
  }

  // ── 카카오페이 결제 (PortOne V2) ──
  async function pay(product) {
    if (!CFG.kakaoChannelKey) { alert('아직 준비되지 않은 결제수단이에요.'); return; }
    if (busy) return;
    busy = true;
    try {
      await loadSdk();
    } catch (_) {
      busy = false;
      alert('결제 모듈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const paymentId = shortId();
    let resp = null;
    try {
      resp = await window.PortOne.requestPayment({
        storeId: CFG.storeId,
        channelKey: CFG.kakaoChannelKey,
        paymentId,
        orderName: String(product.title || '이북'),
        totalAmount: Number(product.price),
        currency: 'CURRENCY_KRW',
        payMethod: 'EASY_PAY',
        customData: JSON.stringify({ slug: product.slug }),
        redirectUrl: location.href.split('#')[0], // 모바일 복귀용 (slug 포함)
      });
    } catch (e) {
      busy = false;
      console.error('[ebook] requestPayment 실패', e);
      alert('결제를 시작하지 못했어요.\n' + (e && (e.message || e.code) ? (e.message || e.code) : '잠시 후 다시 시도해 주세요.'));
      return;
    }
    // 모바일은 redirect 되어 여기로 안 옴(복귀 시 checkReturn 처리).
    if (!resp) { busy = false; return; }
    if (resp.code != null && resp.code !== '') {
      busy = false;
      if (!/cancel/i.test(resp.code || '') && !/취소/.test(resp.message || '')) {
        alert('결제가 완료되지 않았어요.\n' + (resp.message || ''));
      }
      return;
    }
    await finishVerify(product.slug, resp.paymentId || paymentId);
  }

  // ── 결제 검증 + 열람권 부여 ──
  async function finishVerify(slug, paymentId) {
    overlay('결제 확인 중이에요…');
    let r = null;
    try { r = await db().ebooks.purchaseVerify(slug, paymentId); } catch (_) {}
    busy = false;
    if (r && r.ok) {
      overlay('완료! 전체 페이지를 불러올게요…');
      location.replace(cleanUrl());
      return;
    }
    hideOverlay();
    alert('결제는 처리됐지만 열람권 확인에 실패했어요.\n잠시 후 새로고침하거나 인스타그램 @film_socialclub 으로 문의해 주세요.');
  }

  // ── 모바일 redirect 복귀 처리 ──
  function checkReturn() {
    const p = new URLSearchParams(location.search);
    const paymentId = p.get('paymentId');
    if (!paymentId) return;
    const slug = p.get('slug') || '';
    const code = p.get('code');
    if (code != null && code !== '') {
      history.replaceState(null, '', cleanUrl()); // 실패/취소 — 흔적 제거
      return;
    }
    finishVerify(slug, paymentId);
  }

  // ── 진입점 ──
  async function start(product) {
    if (!product || !product.slug) return;
    const m = db();
    if (!m || !m.isReady()) { alert('잠시 후 다시 시도해 주세요.'); return; }
    let sess = null;
    try { sess = await m.auth.getSession(); } catch (_) {}
    if (!sess) {
      if (confirm('구매하려면 로그인이 필요해요. Google로 로그인할까요?')) {
        m.auth.signInWithGoogle(location.href.split('#')[0]);
      }
      return;
    }
    openModal(product);
  }

  window.EbookCheckout = { start };
  // 모바일 결제 복귀 시 자동 검증
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkReturn);
  } else {
    checkReturn();
  }
})();
