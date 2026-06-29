'use strict';

// 이북 결제 — PortOne V2 간편결제(카카오페이 / 네이버페이).
// ebook-reader-page.js 의 구매 CTA 가 window.EbookCheckout.start(product) 를 호출한다.
//
// 흐름:
//   1) 로그인 확인 (Google) — 비로그인이면 로그인 유도 후 종료
//   2) 결제수단 선택 (카카오 / 네이버)
//   3) PortOne.requestPayment() — 데스크톱은 팝업(Promise), 모바일은 redirect
//   4) 결제 성공 → Edge Function(ebook-purchase)로 검증 + 열람권 부여 → 페이지 새로고침(전체 열람)
//
// Store ID / Channel Key 는 공개키라 클라이언트에 둬도 안전하다.
// (검증은 서버에서 PortOne API + 비밀키로 다시 한다.)

(function () {
  const CFG = {
    storeId: 'store-4c794b21-bbaa-466c-8fa9-17f42db08940',
    channels: {
      naver: { key: 'channel-key-8deed153-6989-4904-8d8b-7d29313810b2', label: '네이버페이' },
      kakao: { key: 'channel-key-6eb4e2ce-a4f7-4a99-99cb-f4998d60e1b2', label: '카카오페이' },
    },
  };
  const SDK_SRC = 'https://cdn.portone.io/v2/browser-sdk.js';

  function db() { return window.MagDB; }
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
    // PortOne paymentId 는 짧게 — slug 는 customData 로 전달
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

  // ── 결제수단 선택 모달 ──
  function pickMethod(product) {
    const avail = Object.keys(CFG.channels).filter(k => CFG.channels[k].key);
    // 결제수단이 하나뿐이면 바로 진행
    if (avail.length === 1) { pay(product, avail[0]); return; }

    const back = document.createElement('div');
    back.className = 'ebk-pay-modal-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'ebkPayTitle');

    const won = product.price ? product.price.toLocaleString('ko-KR') + '원' : '';
    const buttons = Object.keys(CFG.channels).map((k) => {
      const c = CFG.channels[k];
      const disabled = c.key ? '' : 'disabled';
      const note = c.key ? '' : ' <span class="ebk-pay-soon">준비 중</span>';
      return `<button type="button" class="ebk-pay-method" data-method="${k}" ${disabled}>${c.label}${note}</button>`;
    }).join('');

    back.innerHTML = `
      <div class="ebk-pay-modal">
        <h2 id="ebkPayTitle" class="ebk-pay-modal-title">결제 수단 선택</h2>
        <p class="ebk-pay-modal-sub">${product.title}${won ? ` · ${won}` : ''}</p>
        <div class="ebk-pay-methods">${buttons}</div>
        <button type="button" class="ebk-pay-cancel" data-cancel>취소</button>
      </div>`;

    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.hasAttribute('data-cancel')) { close(); return; }
      const btn = e.target.closest('[data-method]');
      if (btn && !btn.disabled) { const m = btn.getAttribute('data-method'); close(); pay(product, m); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = back.querySelector('.ebk-pay-method:not([disabled])');
    if (first) first.focus();
  }

  // ── 결제 요청 ──
  async function pay(product, method) {
    const ch = CFG.channels[method];
    if (!ch || !ch.key) { alert('아직 준비되지 않은 결제수단이에요.'); return; }
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
        channelKey: ch.key,
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
      // 사용자가 취소했거나 실패
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
    pickMethod(product);
  }

  window.EbookCheckout = { start };
  // 모바일 결제 복귀 시 자동 검증
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkReturn);
  } else {
    checkReturn();
  }
})();
