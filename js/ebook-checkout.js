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
  const i18n = window.i18n;
  const CFG = {
    // 카카오페이 채널 — 재심사 통과 후 라이브 키를 넣으면 버튼이 다시 나타남.
    // (테스트 키: channel-key-6eb4e2ce-a4f7-4a99-99cb-f4998d60e1b2)
    kakaoChannelKey: '',
  };
  const SDK_SRC = 'https://cdn.portone.io/v2/browser-sdk.js';
  const PENDING_KEY = '5ft_ebook_pending_payment';

  function db() { return window.MagDB; }
  const esc = window.MagUtil.escapeHtml;
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

  function cleanUrl() {
    const slug = new URLSearchParams(location.search).get('slug') || '';
    return location.pathname + (slug ? `?slug=${encodeURIComponent(slug)}` : '');
  }
  function pendingPayment() {
    try {
      const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      if (!value?.slug || !value?.paymentId || Date.now() - Number(value.createdAt) > 24 * 3600_000) {
        sessionStorage.removeItem(PENDING_KEY);
        return null;
      }
      return value;
    } catch (_) { return null; }
  }
  function rememberPayment(slug, paymentId) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ slug, paymentId, createdAt: Date.now() })); } catch (_) {}
  }
  function forgetPayment(paymentId) {
    try {
      const value = pendingPayment();
      if (!paymentId || value?.paymentId === paymentId) sessionStorage.removeItem(PENDING_KEY);
    } catch (_) {}
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
    const won = product.price ? window.MagUtil.formatPrice(product.price) : '';
    const hasKakao = !!CFG.kakaoChannelKey;
    const hasStore = !!(product.store_url && /\/products\/\d+/.test(product.store_url));

    if (!hasKakao && !hasStore) {
      alert(i18n.t(`구매 안내\n\n결제 준비 중이에요. 구매를 원하시면 편집부로 연락해 주세요 (${window.MagContact.text()}).`, `How to buy\n\nOnline payment is not ready yet. To buy, contact the editors (${window.MagContact.text()}).`, `購入について\n\nオンライン決済は準備中です。ご購入希望の方は、編集部までご連絡ください（${window.MagContact.text()}）。`));
      return;
    }

    const back = document.createElement('div');
    back.className = 'ebk-pay-modal-back';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-labelledby', 'ebkPayTitle');

    const methodButtons = [
      hasKakao ? `<button type="button" class="ebk-pay-method" data-method="kakao">${i18n.t('카카오페이로 결제', 'Pay with KakaoPay', 'カカオペイで支払う')}</button>` : '',
      hasStore ? `<a href="${esc(product.store_url)}" target="_blank" rel="noopener" class="ebk-pay-method ebk-pay-method-link" data-store>${i18n.t('스마트스토어에서 구매', 'Buy on Smart Store', 'Smart Store で購入する')} ↗</a>` : '',
      hasStore ? `<button type="button" class="ebk-pay-method ebk-pay-method-sub" data-redeem>${i18n.t('이미 구매했어요 · 주문번호 인증', 'Already bought it? Verify your order number', '購入済みの方 · 注文番号で認証')}</button>` : '',
    ].join('');

    back.innerHTML = `
      <div class="ebk-pay-modal">
        <div data-pane="pick">
          <h2 id="ebkPayTitle" class="ebk-pay-modal-title">${i18n.t('구매 방법 선택', 'Choose how to buy', '購入方法を選択')}</h2>
          <p class="ebk-pay-modal-sub">${esc(product.title)}${won ? ` · ${won}` : ''}</p>
          <div class="ebk-pay-methods">${methodButtons}</div>
          <p class="ebk-pay-legal">${i18n.t('열람을 시작하면 청약철회가 제한됩니다.', 'Once you start reading, you can no longer cancel the purchase.', '閲覧を始めると、購入の取り消しはできなくなります。')} <a href="${i18n.url('/legal/refund.html')}" target="_blank" rel="noopener">${i18n.t('취소·환불 규정', 'Cancellation and refund policy', 'キャンセル・返金規定')}</a></p>
          <button type="button" class="ebk-pay-cancel" data-cancel>${i18n.t('취소', 'Cancel', 'キャンセル')}</button>
        </div>
        <div data-pane="redeem" hidden>
          <h2 class="ebk-pay-modal-title">${i18n.t('주문번호 인증', 'Verify your order', '注文番号の認証')}</h2>
          <p class="ebk-pay-modal-sub">${i18n.t('스마트스토어 결제 후 받은 <b>주문번호</b>와 <b>주문자 정보</b>를 입력하면 이 계정에 열람권이 발급돼요. (네이버페이 주문내역 &gt; 주문번호)', 'Enter the <b>order number</b> and <b>buyer details</b> from your Smart Store purchase, and this account gets full access. (Naver Pay order history &gt; order number)', 'Smart Store での決済後に届いた<b>注文番号</b>と<b>注文者情報</b>を入力すると、このアカウントに閲覧権が付与されます。（Naver Pay の注文履歴 &gt; 注文番号）')}</p>
          <input type="text" class="ebk-pay-input" data-redeem-order inputmode="numeric" placeholder="${i18n.t('주문번호 (예: 2026070812345671)', 'Order number (e.g. 2026070812345671)', '注文番号（例：2026070812345671）')}" maxlength="32" aria-label="${i18n.t('스마트스토어 주문번호', 'Smart Store order number', 'Smart Store の注文番号')}" />
          <input type="text" class="ebk-pay-input" data-redeem-name placeholder="${i18n.t('주문자 이름', 'Buyer name', '注文者の名前')}" maxlength="40" autocomplete="name" aria-label="${i18n.t('주문자 이름', 'Buyer name', '注文者の名前')}" />
          <input type="text" class="ebk-pay-input" data-redeem-phone inputmode="numeric" placeholder="${i18n.t('주문자 연락처 끝 4자리', 'Last 4 digits of buyer phone', '注文者の電話番号の下4桁')}" maxlength="16" autocomplete="tel" aria-label="${i18n.t('주문자 연락처 끝 4자리', 'Last 4 digits of buyer phone', '注文者の電話番号の下4桁')}" />
          <p class="ebk-pay-redeem-msg" aria-live="polite"></p>
          <div class="ebk-pay-methods">
            <button type="button" class="ebk-pay-method" data-redeem-go>${i18n.t('인증하고 열람권 받기', 'Verify and unlock', '認証して閲覧権を受け取る')}</button>
          </div>
          <button type="button" class="ebk-pay-cancel" data-back>← ${i18n.t('뒤로', 'Back', '戻る')}</button>
        </div>
      </div>`;

    function pane(name) {
      back.querySelector('[data-pane="pick"]').hidden = name !== 'pick';
      back.querySelector('[data-pane="redeem"]').hidden = name !== 'redeem';
      if (name === 'redeem') setTimeout(() => back.querySelector('[data-redeem-order]')?.focus(), 30);
    }
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    async function doRedeem() {
      const msgEl = back.querySelector('.ebk-pay-redeem-msg');
      const orderNo = (back.querySelector('[data-redeem-order]')?.value || '').trim();
      const buyerName = (back.querySelector('[data-redeem-name]')?.value || '').trim();
      const buyerPhone = (back.querySelector('[data-redeem-phone]')?.value || '').trim();
      if (orderNo.replace(/[^0-9A-Za-z]/g, '').length < 8) {
        msgEl.textContent = i18n.t('주문번호를 다시 확인해 주세요.', 'Please check the order number.', '注文番号をもう一度確認してください。');
        return;
      }
      if (!buyerName) {
        msgEl.textContent = i18n.t('주문자 이름을 입력해 주세요.', 'Please enter the buyer name.', '注文者の名前を入力してください。');
        return;
      }
      if (buyerPhone.replace(/\D/g, '').length < 4) {
        msgEl.textContent = i18n.t('주문자 연락처 끝 4자리를 입력해 주세요.', 'Please enter the last 4 digits of the buyer phone.', '注文者の電話番号の下4桁を入力してください。');
        return;
      }
      if (busy) return;
      busy = true;
      msgEl.textContent = i18n.t('주문 확인 중…', 'Checking your order…', '注文を確認中…');
      let r = null;
      try { r = await db().ebooks.redeemOrder(product.slug, orderNo, buyerName, buyerPhone); } catch (_) {}
      busy = false;
      if (r && r.ok) {
        close();
        overlay(i18n.t('인증 완료! 전체 페이지를 불러올게요…', 'Verified! Loading the full e-book…', '認証が完了しました。全ページを読み込みます…'));
        location.replace(cleanUrl());
        return;
      }
      // 주문 확인 실패는 서버가 이유를 가리지 않고 하나로 준다(남의 주문 정보를 하나씩 맞혀 보지 못하게).
      if (r?.error === 'order not verified') {
        msgEl.textContent = i18n.t('주문을 확인하지 못했어요. 주문번호와 주문자 이름·연락처 끝 4자리를 스마트스토어 주문 정보와 똑같이 입력했는지 확인해 주세요. 결제 직후라면 잠시 후 다시 시도해 주세요.', 'We couldn\'t verify this order. Check that the order number, buyer name and last 4 digits of the phone match your Smart Store order exactly. If you just paid, try again in a moment.', '注文を確認できませんでした。注文番号、注文者の名前、電話番号の下4桁が Smart Store の注文情報と同じか確認してください。決済直後の場合は、しばらくしてから再度お試しください。');
        return;
      }
      msgEl.textContent = (r && r.detail) || i18n.t(`인증에 실패했어요. 잠시 후 다시 시도하고, 그래도 안 되면 편집부에 알려주세요 (${window.MagContact.text()}).`, `Verification failed. Please try again in a moment. If it still fails, let the editors know (${window.MagContact.text()}).`, `認証に失敗しました。しばらくしてから再度お試しください。それでも続く場合は、編集部にお知らせください（${window.MagContact.text()}）。`);
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
    if (!CFG.kakaoChannelKey) { alert(i18n.t('아직 준비되지 않은 결제수단이에요.', 'This payment method is not available yet.', 'この決済方法はまだご利用いただけません。')); return; }
    if (busy) return;
    busy = true;
    try {
      await loadSdk();
    } catch (_) {
      busy = false;
      alert(i18n.t('결제 모듈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'Couldn\'t load the payment module. Please try again in a moment.', '決済モジュールを読み込めませんでした。しばらくしてから、もう一度お試しください。'));
      return;
    }
    let order;
    try {
      // Omitted paymentId asks ebook-purchase to create a server-bound order via
      // the existing authenticated MagDB transport. Never send a buyer UID.
      const created = await db().ebooks.purchaseVerify(product.slug);
      if (!created?.ok || !created.order?.paymentId) throw new Error(created?.error || 'order creation failed');
      order = created.order;
    } catch (e) {
      busy = false;
      alert(i18n.t('결제 주문을 만들지 못했어요.\n', 'Couldn\'t create the payment order.\n', '決済注文を作成できませんでした。\n') + (e?.message || 'order creation failed'));
      return;
    }
    const paymentId = order.paymentId;
    rememberPayment(order.slug, paymentId);
    let resp = null;
    try {
      resp = await window.PortOne.requestPayment({
        storeId: order.storeId,
        channelKey: CFG.kakaoChannelKey,
        paymentId,
        orderName: String(order.title || '이북'),
        totalAmount: order.price,
        currency: 'CURRENCY_KRW',
        payMethod: 'EASY_PAY',
        customData: JSON.stringify({ slug: order.slug }),
        redirectUrl: new URL(cleanUrl(), location.origin).href, // 모바일 복귀용 (slug 포함)
      });
    } catch (e) {
      busy = false;
      // A thrown SDK call does not establish whether the provider charged. Keep
      // the server order for a safe status lookup on the next visit.
      console.error('[ebook] requestPayment 실패', e);
      alert(i18n.t('결제를 시작하지 못했어요.\n', 'Couldn\'t start the payment.\n', '決済を開始できませんでした。\n') + (e && (e.message || e.code) ? (e.message || e.code) : i18n.t('잠시 후 다시 시도해 주세요.', 'Please try again in a moment.', 'しばらくしてから、もう一度お試しください。')));
      return;
    }
    // 모바일은 redirect 되어 여기로 안 옴(복귀 시 checkReturn 처리).
    if (!resp) { busy = false; return; }
    if (resp.code != null && resp.code !== '') {
      busy = false;
      forgetPayment(paymentId);
      if (!/cancel/i.test(resp.code || '') && !/취소/.test(resp.message || '')) {
        alert(i18n.t('결제가 완료되지 않았어요.\n', 'The payment was not completed.\n', '決済が完了しませんでした。\n') + (resp.message || ''));
      }
      return;
    }
    // The server-issued ID remains authoritative even if SDK/URL data differs.
    await finishVerify(order.slug, paymentId);
  }

  // ── 결제 검증 + 열람권 부여 ──
  async function finishVerify(slug, paymentId) {
    overlay(i18n.t('결제 확인 중이에요…', 'Confirming your payment…', '決済を確認しています…'));
    let r = null;
    try { r = await db().ebooks.purchaseVerify(slug, paymentId); } catch (_) {}
    busy = false;
    if (r && r.ok) {
      forgetPayment(paymentId);
      overlay(i18n.t('완료! 전체 페이지를 불러올게요…', 'Done! Loading the full e-book…', '完了しました。全ページを読み込みます…'));
      location.replace(cleanUrl());
      return;
    }
    hideOverlay();
    if (r?.error === 'login required') {
      if (window.MagAuthUI.confirmLogin(i18n.t('결제 확인을 계속하려면 다시 로그인이 필요해요. Google로 로그인할까요?', 'Please sign in again to finish confirming your payment. Sign in with Google?', '決済の確認を続けるには、もう一度ログインが必要です。Google でログインしますか？'))) {
        db().auth.signInWithGoogle(new URL(cleanUrl(), location.origin).href);
      }
      return;
    }
    if (r?.error === 'payment buyer mismatch') {
      alert(i18n.t('이 결제를 시작한 계정으로 로그인해 주세요.\n결제번호: ', 'Sign in with the account that started this payment.\nPayment ID: ', 'この決済を開始したアカウントでログインしてください。\n決済番号: ') + paymentId);
      return;
    }
    if (r?.error === 'legacy payment unbound') {
      forgetPayment(paymentId);
      alert(i18n.t('이전 결제의 구매 계정을 자동으로 확인할 수 없어요. 편집부에 결제번호와 영수증을 알려주세요.\n결제번호: ', 'We cannot automatically confirm the buyer of this older payment. Contact the editors with your payment ID and receipt.\nPayment ID: ', '以前の決済の購入アカウントを自動確認できません。編集部に決済番号と領収書をお知らせください。\n決済番号: ') + paymentId);
      return;
    }
    const terminalErrors = new Set([
      'payment not found', 'amount mismatch', 'currency mismatch',
      'store mismatch', 'product mismatch', 'payment mismatch', 'payment already used',
    ]);
    const endedPayment = r?.error === 'not paid' && ['FAILED', 'CANCELLED', 'PARTIAL_CANCELLED'].includes(r.status);
    if (terminalErrors.has(r?.error) || endedPayment) {
      forgetPayment(paymentId);
      alert(i18n.t('결제가 완료되지 않았거나 결제 정보가 일치하지 않아요. 결제 내역을 확인해 주세요.', 'The payment was not completed or its details don\'t match. Please check your payment history.', '決済が完了していないか、決済情報が一致しません。決済履歴を確認してください。'));
      return;
    }
    alert(i18n.t('결제 상태나 열람권을 아직 확인하지 못했어요.\n결제번호를 보관했으니 새로고침하면 자동으로 다시 확인합니다.', 'We could not confirm the payment status or unlock the e-book yet.\nWe saved your payment ID. Refresh the page and we\'ll check again automatically.', '決済状態または閲覧権をまだ確認できませんでした。\n決済番号を保存してあるので、ページを再読み込みすると自動で再確認します。'));
  }

  // ── 모바일 redirect 복귀 처리 ──
  function checkReturn() {
    const p = new URLSearchParams(location.search);
    const saved = pendingPayment();
    const returnedPaymentId = p.get('paymentId');
    const currentSlug = p.get('slug') || '';
    const savedForPage = saved?.slug === currentSlug ? saved : null;
    const paymentId = returnedPaymentId || savedForPage?.paymentId;
    if (!paymentId) return;
    const slug = currentSlug || savedForPage?.slug || '';
    const code = p.get('code');
    if (code != null && code !== '') {
      forgetPayment(paymentId);
      history.replaceState(null, '', cleanUrl()); // 실패/취소 — 흔적 제거
      return;
    }
    rememberPayment(slug, paymentId);
    if (returnedPaymentId) history.replaceState(null, '', cleanUrl());
    finishVerify(slug, paymentId);
  }

  // ── 진입점 ──
  async function start(product) {
    if (!product || !product.slug) return;
    const m = db();
    if (!m || !m.isReady()) { alert(i18n.t('잠시 후 다시 시도해 주세요.', 'Please try again in a moment.', 'しばらくしてから、もう一度お試しください。')); return; }
    let sess = null;
    try { sess = await m.auth.getSession(); } catch (_) {}
    if (!sess) {
      if (window.MagAuthUI.confirmLogin(i18n.t('구매하려면 로그인이 필요해요. Google로 로그인할까요?', 'You need to sign in to buy. Sign in with Google?', '購入するにはログインが必要です。Google でログインしますか？'))) {
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
