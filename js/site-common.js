// 5ft.mag 공통 헤더/테마/메뉴 핸들러
// 모든 페이지 <head> 에서 FOUC 방지용 1줄로 테마 초기 적용:
//   <script>document.documentElement.dataset.theme=localStorage.getItem('5ftTheme')||'light';</script>
// 모든 페이지 <body> 끝에 이 파일을 로드:
//   <script src="./js/site-common.js"></script>  (또는 ../js/site-common.js)

(function () {
  'use strict';

  const THEME_KEY = '5ftTheme';

  // ════════════════════════════════════════════════
  // 테마 버튼 SVG 업데이트
  // ════════════════════════════════════════════════
  function updateThemeButton(btn) {
    if (!btn) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    btn.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('type', 'button');
    btn.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2.5v3M12 18.5v3M4.5 4.5l2.1 2.1M17.4 17.4l2.1 2.1M2.5 12h3M18.5 12h3M4.5 19.5l2.1-2.1M17.4 6.6l2.1-2.1"></path></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M20.5 14.2A7.8 7.8 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z"></path></svg>';
  }

  // ════════════════════════════════════════════════
  // 햄버거 버튼 SVG 업데이트
  // ════════════════════════════════════════════════
  function updateMenuButton(btn, nav) {
    if (!btn || !nav) return;
    const isOpen = nav.classList.contains('open');
    btn.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.setAttribute('aria-controls', nav.id || 'mobileNav');
    btn.setAttribute('type', 'button');
    btn.innerHTML = isOpen
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"></path></svg>';
  }

  // ════════════════════════════════════════════════
  // 글 끝 SHARE 영역의 "링크 복사" 버튼
  // ════════════════════════════════════════════════
  function setCopyButtonState(btn, text) {
    if (!btn) return;
    const original = btn.dataset.copyLabel || btn.textContent;
    btn.dataset.copyLabel = original;
    btn.textContent = text;
    window.clearTimeout(btn._copyTimer);
    btn._copyTimer = window.setTimeout(function () {
      btn.textContent = btn.dataset.copyLabel || original;
    }, 1600);
  }

  function copyWithTextarea() {
    const ta = document.createElement('textarea');
    ta.value = window.location.href;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); }
    catch { ok = false; }
    ta.remove();
    return ok;
  }

  function copyCurrentLink(btn) {
    // execCommand is still the most reliable path for click-initiated copy
    // across older WebViews; clipboard.writeText covers modern browsers.
    if (copyWithTextarea()) {
      setCopyButtonState(btn, '복사 완료');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(window.location.href).then(function () {
        setCopyButtonState(btn, '복사 완료');
      }).catch(function () {
        setCopyButtonState(btn, '복사 실패');
      });
      return;
    }

    setCopyButtonState(btn, '복사 실패');
  }
  // 글로벌로도 노출 (기존 onclick="copyLink()" 호환)
  window.copyLink = copyCurrentLink;

  // ════════════════════════════════════════════════
  // 글 상세 author 이름을 author archive로 연결
  // ════════════════════════════════════════════════
  const AUTHOR_LINKS = {
    '5ft.mag 편집부': '../authors/5ftmag.html',
    'Film Social Club': '../authors/film-social-club.html',
    'Shin Noguchi': '../authors/shin-noguchi.html',
    'Brisnap TV': '../authors/brisnap-tv.html',
    '김현아': '../authors/kim-hyuna.html',
    '명수경': '../authors/myeong-sugyeong.html',
    '강혜원': '../authors/kang-hyewon.html',
    '윤동규': '../authors/yoon-donggyu.html',
    '심규동': '../authors/shim-kyudong.html',
  };

  function linkArticleAuthor() {
    const el = document.querySelector('.article-author .author-name');
    if (!el || el.querySelector('a')) return;
    const text = el.textContent.trim();
    const key = Object.keys(AUTHOR_LINKS).find(function (name) {
      return text.includes(name);
    });
    if (!key) return;
    const link = document.createElement('a');
    link.href = AUTHOR_LINKS[key];
    link.className = 'author-link';
    link.textContent = text;
    el.textContent = '';
    el.appendChild(link);
  }

  // ════════════════════════════════════════════════
  // 초기화
  // ════════════════════════════════════════════════
  function init() {
    // 테마: head에서 이미 적용됐지만, 안전하게 재확인
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
    }

    const themeBtn = document.getElementById('themeBtn');
    const menuBtn = document.getElementById('menuBtn');
    const mobileNav = document.getElementById('mobileNav');

    updateThemeButton(themeBtn);
    updateMenuButton(menuBtn, mobileNav);

    // 테마 토글
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        const html = document.documentElement;
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
        html.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
        updateThemeButton(themeBtn);
      });
    }

    // 햄버거 메뉴 토글
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', function () {
        mobileNav.classList.toggle('open');
        updateMenuButton(menuBtn, mobileNav);
      });

      // 네비게이션 링크 클릭 시 메뉴 닫기
      mobileNav.addEventListener('click', function (event) {
        if (event.target.closest('a')) {
          mobileNav.classList.remove('open');
          updateMenuButton(menuBtn, mobileNav);
        }
      });
    }

    // 글 끝 SHARE 영역 "링크 복사" 버튼 이벤트 위임
    // (기존 inline onclick="copyLink()" 도 동작하지만, data-action 패턴도 지원)
    document.addEventListener('click', function (e) {
      const t = e.target.closest('[data-action="copy-link"]');
      if (t) { e.preventDefault(); copyCurrentLink(t); }
    });

    linkArticleAuthor();
    setupAuthNav();
    setupArticleScrap();
    injectFooterLegalLinks();
    loadAnalyticsOnce();
  }

  // js/analytics.js (Plausible + Sentry bootstrapper) + js/icons.js 한 번만 로드
  let _aux = false;
  function loadAnalyticsOnce() {
    if (_aux) return;
    _aux = true;
    const base = /\/(stories|admin|authors|legal)\//.test(location.pathname) ? '../' : './';
    [['analytics.js', '20260515-bootstrap'], ['icons.js', '20260515-icons']].forEach(([f, v]) => {
      const s = document.createElement('script');
      s.defer = true;
      s.src = `${base}js/${f}?v=${v}`;
      document.head.appendChild(s);
    });
  }

  // ════════════════════════════════════════════════
  // Toast — alert() 대체. 단순 정보 노출 용도.
  //   showToast('저장됐어요')                        — default
  //   showToast('실패했어요', { type: 'danger' })     — 강조
  //   showToast('처리 중…', { type: 'info', duration: 0 })  — 수동 dismiss 만
  // 반환: dismiss() 함수
  // ════════════════════════════════════════════════
  let _toastHost = null;
  function ensureToastHost() {
    if (_toastHost && document.body.contains(_toastHost)) return _toastHost;
    _toastHost = document.createElement('div');
    _toastHost.className = 'ft-toast-host';
    _toastHost.setAttribute('aria-live', 'polite');
    _toastHost.setAttribute('aria-atomic', 'true');
    document.body.appendChild(_toastHost);
    return _toastHost;
  }
  function showToast(msg, opts = {}) {
    const { type = 'default', duration = 2200 } = opts;
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = `ft-toast ft-toast-${type}`;
    el.textContent = String(msg ?? '');
    el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    host.appendChild(el);
    // 들어올 때 animation
    requestAnimationFrame(() => el.classList.add('is-in'));
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return; dismissed = true;
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 400);
    };
    if (duration > 0) setTimeout(dismiss, duration);
    el.addEventListener('click', dismiss);
    return dismiss;
  }
  window.showToast = showToast;

  // 원본 alert 백업 — 아래 monkey-patch / notify 폴백에서 모두 참조
  const _origAlert = window.alert.bind(window);

  // notify(msg, type) — showToast 있으면 toast, 없으면 alert
  window.notify = function (msg, type) {
    if (typeof window.showToast === 'function') return window.showToast(msg, { type });
    _origAlert(String(msg ?? ''));
  };

  // ════════════════════════════════════════════════
  // alert() 자동 토스트화 (monkey-patch)
  //   기존 코드의 alert('실패…') 들을 일괄 변환하지 않고도 토스트로 라우팅.
  //   confirm/prompt 는 입력 받는 동기 동작이라 건드리지 않음.
  // ════════════════════════════════════════════════
  window.alert = function (msg) {
    const text = String(msg ?? '');
    // 알림 톤 추정 — 메시지 어조로 type 결정
    let type = 'default';
    if (/실패|오류|거부|에러|못했어요|중단|시간 초과|불가|잘못/.test(text))   type = 'danger';
    else if (/접수|완료|저장|등록|로그인|승인|성공/.test(text))                type = 'info';
    if (typeof window.showToast === 'function') {
      return window.showToast(text, { type, duration: type === 'danger' ? 3500 : 2400 });
    }
    return _origAlert(text);
  };

  // ════════════════════════════════════════════════
  // 법무 페이지 링크 — 모든 페이지 푸터에 동적 inject
  //   기존 footer-links 4개 (Shop/IG/이메일/4rest) 다음 자리에
  //   "이용약관 · 개인정보 · 저작권" 3개 추가
  // ════════════════════════════════════════════════
  function injectFooterLegalLinks() {
    const links = document.querySelector('.footer-links');
    if (!links) return;
    if (links.querySelector('[data-legal]')) return; // 이미 inject 됨
    const base = /\/(stories|admin|authors|legal)\//.test(location.pathname) ? '../' : './';
    const entries = [
      ['이용약관', base + 'legal/terms.html'],
      ['개인정보', base + 'legal/privacy.html'],
      ['저작권',  base + 'legal/copyright.html'],
    ];
    entries.forEach(([label, href]) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      a.setAttribute('data-legal', '1');
      links.appendChild(a);
    });
  }

  // ════════════════════════════════════════════════
  // Auth nav — 로그인 상태/편집부 여부에 따라 헤더에 항목 inject
  //   기본 헤더 마크업은 28개 페이지에 중복돼 있어서 DOM 변경은 여기서만 함.
  //   - 비로그인: "로그인"
  //   - 로그인  : "내 정보"
  //   - 편집부  : "관리" + "내 정보"
  //   - Shop ↗ 다음 자리에 노출 (메인 nav + 모바일 nav 모두)
  // ════════════════════════════════════════════════
  function isStoryPath() { return /\/stories\//.test(location.pathname); }
  function isAdminPath() { return /\/admin\//.test(location.pathname); }
  function authPathTo(name) {
    // me.html · admin/submissions.html 로의 상대 경로 계산
    if (isStoryPath() || isAdminPath()) {
      return '../' + name;
    }
    return name;
  }
  async function setupAuthNav() {
    const mainNav = document.querySelector('.main-nav');
    const mobileNav = document.getElementById('mobileNav');
    if (!mainNav && !mobileNav) return;
    // db-client 준비 대기 (최대 3초)
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    let session = null;
    let isEditor = false;
    if (window.MagDB && window.MagDB.isReady()) {
      try {
        session = await window.MagDB.auth.getSession();
        if (session && window.MagDB.profiles && typeof window.MagDB.profiles.getMine === 'function') {
          const profile = await window.MagDB.profiles.getMine();
          isEditor = !!(profile && profile.is_editor);
        }
      } catch (_) { /* silent — 익명/오프라인 모두 OK */ }
    }
    renderAuthNav({ mainNav, mobileNav, loggedIn: !!session, isEditor });
    if (window.MagDB && window.MagDB.auth && typeof window.MagDB.auth.onChange === 'function' && !document.documentElement.dataset.authNavBound) {
      document.documentElement.dataset.authNavBound = '1';
      window.MagDB.auth.onChange(async (_event, nextSession) => {
        let nextIsEditor = false;
        if (nextSession && window.MagDB.profiles && typeof window.MagDB.profiles.getMine === 'function') {
          try {
            const profile = await window.MagDB.profiles.getMine();
            nextIsEditor = !!(profile && profile.is_editor);
          } catch (_) { /* keep anonymous fallback */ }
        }
        renderAuthNav({ mainNav, mobileNav, loggedIn: !!nextSession, isEditor: nextIsEditor });
      });
    }
  }
  function renderAuthNav({ mainNav, mobileNav, loggedIn, isEditor }) {
    // 기존 inject 항목 제거 (auth 상태 바뀌었을 때 재호출 가능)
    document.querySelectorAll('[data-nav-auth]').forEach(el => el.remove());
    const meHref    = authPathTo('me.html');
    const adminHref = authPathTo('admin/submissions.html');
    const items = [];
    if (!loggedIn) {
      items.push({ label: '로그인', action: 'auth-login' });
    } else {
      if (isEditor) items.push({ label: '관리', href: adminHref });
      items.push({ label: '내 정보', href: meHref });
    }
    // 메인 nav (Shop 다음에 끼움 — Shop 은 .ext 클래스로 식별)
    if (mainNav) {
      const shopLi = mainNav.querySelector('.ext')?.parentElement || null;
      items.forEach(it => {
        const li = document.createElement('li');
        li.setAttribute('data-nav-auth', '1');
        const a = document.createElement('a');
        if (it.href) a.href = it.href;
        else {
          a.href = '#';
          a.dataset.action = it.action;
        }
        a.textContent = it.label;
        li.appendChild(a);
        if (shopLi && shopLi.nextSibling) shopLi.parentNode.insertBefore(li, shopLi.nextSibling);
        else mainNav.appendChild(li);
      });
    }
    // 모바일 nav (Shop 링크 뒤에 끼움)
    if (mobileNav) {
      const shopA = mobileNav.querySelector('a[href*="smartstore"]') || null;
      items.forEach(it => {
        const a = document.createElement('a');
        a.setAttribute('data-nav-auth', '1');
        if (it.href) a.href = it.href;
        else { a.href = '#'; a.dataset.action = it.action; }
        a.textContent = it.label;
        if (shopA && shopA.nextSibling) shopA.parentNode.insertBefore(a, shopA.nextSibling);
        else mobileNav.appendChild(a);
      });
    }
  }
  // 로그인 액션 위임
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action="auth-login"]');
    if (!t) return;
    e.preventDefault();
    if (!window.MagDB || !window.MagDB.isReady()) {
      alert('잠시 후 다시 시도해주세요.');
      return;
    }
    // 현재 페이지로 복귀 (site-common.js · db-client.js 의 origin restore 가 처리)
    window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
  });

  // ════════════════════════════════════════════════
  // Article scrap — 글 페이지에 "스크랩" 토글 버튼 자동 inject
  //   - 모든 stories/*.html 에 중복된 share-bar 마크업 그대로 두고
  //     site-common.js 가 페이지 로드 후 share-bar 첫 자리에 버튼 삽입
  //   - 글 식별자는 <section data-comments data-page-id="stories/<id>"> 에서 추출
  // ════════════════════════════════════════════════
  function bookmarkIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z"/></svg>';
  }
  async function setupArticleScrap() {
    const cmt = document.querySelector('[data-comments][data-page-id]');
    if (!cmt) return;
    const pageId = cmt.dataset.pageId || '';
    if (!pageId.startsWith('stories/')) return;
    const articleId = pageId.replace(/^stories\//, '');
    if (!articleId) return;
    const shareBar = document.querySelector('.share-bar');
    if (!shareBar) return;

    // 버튼 inject — SHARE 라벨 바로 다음 자리
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'article-fav';
    btn.dataset.articleId = articleId;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '스크랩 추가');
    btn.innerHTML = bookmarkIconSvg() + '<span class="article-fav-label">스크랩</span>';
    const shareLabel = shareBar.querySelector('.share-label');
    if (shareLabel && shareLabel.nextSibling) {
      shareBar.insertBefore(btn, shareLabel.nextSibling);
    } else {
      shareBar.insertBefore(btn, shareBar.firstChild);
    }

    // 초기 상태 — db 준비 후 본인 즐겨찾기 확인
    let isFav = false;
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (window.MagDB && window.MagDB.isReady()) {
      try {
        const sess = await window.MagDB.auth.getSession();
        if (sess) {
          const ids = await window.MagDB.favorites.idsForType('article');
          isFav = ids.has(articleId);
        }
      } catch (_) {}
    }
    setArticleFavState(btn, isFav);

    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-busy')) return;
      if (!window.MagDB || !window.MagDB.isReady()) {
        alert('잠시 후 다시 시도해주세요.');
        return;
      }
      const sess = await window.MagDB.auth.getSession();
      if (!sess) {
        if (!confirm('스크랩은 로그인이 필요해요. Google로 로그인할까요?')) return;
        window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
        return;
      }
      const wasFav = btn.classList.contains('is-fav');
      setArticleFavState(btn, !wasFav);
      btn.classList.add('is-busy');
      const { error } = await window.MagDB.favorites.toggle('article', articleId, wasFav);
      btn.classList.remove('is-busy');
      if (error) {
        setArticleFavState(btn, wasFav);
        alert('처리 실패: ' + (error.message || '잠시 후 다시 시도'));
      }
    });
  }
  function setArticleFavState(btn, on) {
    btn.classList.toggle('is-fav', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '스크랩 해제' : '스크랩 추가');
    const label = btn.querySelector('.article-fav-label');
    if (label) label.textContent = on ? '스크랩됨' : '스크랩';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
