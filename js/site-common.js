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
  function copyCurrentLink() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(window.location.href).then(function () {
        alert('링크가 복사되었어요!');
      }).catch(function () {
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  }
  function fallbackCopy() {
    const ta = document.createElement('textarea');
    ta.value = window.location.href;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('링크가 복사되었어요!'); }
    catch { alert('복사에 실패했어요. 주소창에서 직접 복사해주세요.'); }
    ta.remove();
  }
  // 글로벌로도 노출 (기존 onclick="copyLink()" 호환)
  window.copyLink = copyCurrentLink;

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
      if (t) { e.preventDefault(); copyCurrentLink(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
