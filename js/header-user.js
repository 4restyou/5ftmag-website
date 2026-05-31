// 헤더 우측 인증 슬롯(#authSlot) 동적 렌더링.
// 비로그인 → "로그인" 버튼, 로그인 → 아바타 + 로그아웃.
// 검색 진입(stories.html#search) 은 헤더의 <a> 한 줄이 처리하므로 여기선 다루지 않음.
(function () {
  'use strict';

  const SLOT_ID = 'authSlot';

  function db() { return window.MagDB; }
  function dbReady() {
    const d = db();
    return !!(d && typeof d.isReady === 'function' && d.isReady() && d.auth);
  }

  function initial(name) {
    const s = String(name || '').trim();
    return (s[0] || 'U').toUpperCase();
  }

  function avatarInner(user) {
    const md = (user && user.user_metadata) || {};
    const url = md.avatar_url || md.picture || '';
    const name = md.full_name || md.name || md.preferred_username || (user && user.email) || '';
    if (url) {
      return '<img src="' + url.replace(/"/g, '&quot;') + '" alt="" referrerpolicy="no-referrer">';
    }
    return '<span aria-hidden="true">' + initial(name) + '</span>';
  }

  function bindLogin(slot) {
    const btn = slot.querySelector('#authLoginBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      try { db().auth.signInWithGoogle(window.location.href); } catch (_) { /* noop */ }
    });
  }

  function bindLogout(slot) {
    const btn = slot.querySelector('#authLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await db().auth.signOut(); } catch (_) { /* noop */ }
      // me/admin 페이지처럼 로그아웃 후 다른 페이지에 머무를 때 상태 일관성 위해 새로고침
      location.reload();
    });
  }

  async function render() {
    const slot = document.getElementById(SLOT_ID);
    if (!slot) return;
    if (!dbReady()) return;

    let session = null;
    try { session = await db().auth.getSession(); } catch (_) { session = null; }
    const user = (session && session.user) || null;

    if (!user) {
      slot.innerHTML = '<button type="button" class="auth-login" id="authLoginBtn">로그인</button>';
      bindLogin(slot);
    } else {
      slot.innerHTML =
        '<a href="me.html" class="auth-avatar" aria-label="내 정보">' + avatarInner(user) + '</a>' +
        '<button type="button" class="icon-btn" id="authLogoutBtn" aria-label="로그아웃" title="로그아웃">⏻</button>';
      bindLogout(slot);
    }
  }

  function init() {
    if (dbReady()) { render(); return; }
    // db-client 가 늦게 init 되는 페이지를 위해 짧게 폴링(최대 ~3초)
    let n = 0;
    const t = setInterval(() => {
      if (dbReady()) { clearInterval(t); render(); return; }
      if (++n > 30) clearInterval(t);
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
