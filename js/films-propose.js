// "새 필름 제안" 모달 + 신청 처리.
// 구독자가 라이브러리에 없는 필름을 신청 → film_proposals 테이블에 pending 으로 인서트.
// 편집부 검토 후 승인 시 films 테이블로 promote(admin/films 에서).
(function () {
  'use strict';

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
      window.notify?.('로그인 확인이 어려워요. 잠시 후 다시 시도해 주세요.', 'danger');
      return null;
    }
    const session = await d.auth.getSession();
    if (session && session.user) return session.user;
    // 비로그인 — 로그인 유도
    const ok = window.confirm('필름 제안은 로그인 후 가능해요. 로그인 페이지로 이동할까요?');
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
    submitBtn.textContent = '보내는 중…';
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
        msgEl.textContent = '제안에 실패했어요: ' + (error.message || '');
        msgEl.className = 'propose-form-msg error';
        return;
      }
      msgEl.textContent = '제안을 보냈어요. 마이페이지 → 내 제안 탭에서 진행 상태를 확인할 수 있어요.';
      msgEl.className = 'propose-form-msg success';
      submitBtn.textContent = '보냄 ✓';
      setTimeout(close, 1800);
    } catch (err) {
      msgEl.textContent = '오류: ' + (err?.message || err);
      msgEl.className = 'propose-form-msg error';
    } finally {
      submitBtn.disabled = false;
      if (submitBtn.textContent !== '보냄 ✓') submitBtn.textContent = '제안하기';
    }
  });
})();
