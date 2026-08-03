// 5ft.mag admin 공통 접근 게이트.
//
// 배경: admin 페이지 8곳이 showGate/checkAccess 를 각자 복붙해 두어 동작이
// 갈렸다 — analytics 만 DB 준비 폴링이 없어 로그인 직후 실패할 수 있었고,
// $('app').hidden 처리와 안내 문구도 페이지마다 달랐다. 여기로 통합해
// "가장 견고한 동작"(폴링 + app 숨김 + 통일 문구)으로 수렴시킨다.
//
// 보안 메모: 이 게이트는 UX 다. 실제 방어는 RLS(is_editor) 와 엣지 함수에
// 있으므로, 화면을 우회해도 데이터는 나오지 않는다.
//
// 사용:
//   const ok = await window.AdminGuard.requireEditor(STATE);
//   if (!ok) return;

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const db = () => window.MagDB;

  function showGate(msg) {
    const gate = $('gate');
    const app = $('app');
    if (gate) gate.hidden = false;
    if (app) app.hidden = true;
    if (msg && gate) {
      const p = gate.querySelector('p');
      if (p) p.textContent = msg;
      const loginBtn = $('gateLogin');
      // 권한 부족은 다시 로그인해도 소용없으므로 로그인 버튼을 감춘다.
      if (loginBtn && msg.includes('권한')) loginBtn.style.display = 'none';
    }
  }

  // db-client 는 defer 로드라 페이지 스크립트보다 늦게 준비될 수 있다.
  async function waitForDb(tries = 50, intervalMs = 50) {
    for (let i = 0; i < tries; i++) {
      if (db() && db().isReady()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return !!(db() && db().isReady());
  }

  // 편집부 권한 확인. 성공 시 state 에 user/isEditor/profile 을 채우고 true.
  async function requireEditor(state = {}) {
    if (!(await waitForDb())) {
      showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.');
      return false;
    }
    const session = await db().auth.getSession();
    if (!session) { showGate(); return false; }
    state.user = session.user;

    const profile = await db().profiles.getMine();
    if (!profile?.is_editor) {
      showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.');
      return false;
    }
    state.isEditor = true;
    state.profile = profile;

    const userEl = $('adminUser');
    if (userEl) {
      const name = window.MagUtil.escapeHtml(profile.display_name || session.user.email || '');
      userEl.innerHTML = `${name} · <button id="logout">로그아웃</button>`;
      $('logout')?.addEventListener('click', async () => {
        await db().auth.signOut();
        location.reload();
      });
    }
    return true;
  }

  // 게이트 화면의 로그인 버튼 배선 (페이지마다 중복하던 것)
  function bindGateLogin() {
    $('gateLogin')?.addEventListener('click', async () => {
      await db()?.auth.signInWithGoogle(window.location.href.split('#')[0]);
    });
  }

  window.AdminGuard = { requireEditor, showGate, waitForDb, bindGateLogin };
  bindGateLogin();
})();
