// "새 필름 제안" 모달 + 신청 처리.
// 구독자가 라이브러리에 없는 필름을 신청 → film_proposals 테이블에 pending 으로 인서트.
// 편집부 검토 후 승인 시 films 테이블로 promote(admin/films 에서).
(function () {
  'use strict';

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const i18n = window.i18n || { isEn: false, locale: 'ko-KR', t: (ko) => ko, url: (u) => u };
  const tr = i18n.t;

  const SENT_LABEL = tr('보냄 ✓', 'Sent ✓');
  const $ = (id) => document.getElementById(id);
  const btn   = $('proposeFilmBtn');
  const modal = $('proposeModal');
  if (!btn || !modal) return;

  const form    = $('proposeForm');
  const msgEl   = $('proposeFormMsg');
  const closeBtn = $('proposeModalClose');
  const cancelBtn = $('proposeCancel');
  const submitBtn = $('proposeSubmit');

  function db() { return window.MagDB; }

  function open() {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => form.querySelector('[name="brand"]').focus(), 30);
  }
  function close() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    form.reset();
    msgEl.textContent = '';
    msgEl.className = 'propose-form-msg';
  }

  async function ensureLogin() {
    const d = db();
    if (!d || !d.isReady || !d.isReady()) {
      window.notify?.(tr('로그인 확인이 어려워요. 잠시 후 다시 시도해 주세요.', "Couldn't check your sign-in. Please try again in a moment."), 'danger');
      return null;
    }
    const session = await d.auth.getSession();
    if (session && session.user) return session.user;
    // 비로그인 — 로그인 유도
    const ok = window.confirm(tr('필름 제안은 로그인 후 가능해요. 로그인 페이지로 이동할까요?', 'Sign in to suggest a film. Go to sign in?'));
    if (ok) {
      try { await d.auth.signInWithGoogle(window.location.href); } catch (_) {}
    }
    return null;
  }

  btn.addEventListener('click', async () => {
    const user = await ensureLogin();
    if (!user) return;
    open();
  });
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (!modal.hidden && e.key === 'Escape') close();
  });

  function parseAliases(raw) {
    return String(raw || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = 'propose-form-msg';
    submitBtn.disabled = true;
    submitBtn.textContent = tr('보내는 중…', 'Sending…');
    try {
      const fd = new FormData(form);
      const rec = {
        brand: fd.get('brand'),
        name:  fd.get('name'),
        displayName: fd.get('displayName'),
        iso:    fd.get('iso'),
        type:   fd.get('type'),
        format: fd.get('format'),
        description: fd.get('description'),
        aliases: parseAliases(fd.get('aliases')),
      };
      const { error } = await db().filmProposals.create(rec);
      if (error) {
        msgEl.textContent = tr('제안에 실패했어요: ', "Couldn't send your suggestion: ") + (error.message || '');
        msgEl.className = 'propose-form-msg error';
        return;
      }
      msgEl.textContent = tr('제안을 보냈어요. 마이페이지 → 내 제안 탭에서 진행 상태를 확인할 수 있어요.', 'Suggestion sent. You can track its status under My page → My suggestions.');
      msgEl.className = 'propose-form-msg success';
      submitBtn.textContent = SENT_LABEL;
      setTimeout(close, 1800);
    } catch (err) {
      msgEl.textContent = tr('오류: ', 'Error: ') + (err?.message || err);
      msgEl.className = 'propose-form-msg error';
    } finally {
      submitBtn.disabled = false;
      if (submitBtn.textContent !== SENT_LABEL) submitBtn.textContent = tr('제안하기', 'Suggest');
    }
  });
})();
