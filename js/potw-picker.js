'use strict';

// 이주의 사진 선정 — 관리 화면과 사진 라이트박스가 함께 쓰는 공용 흐름.
//
// 편집부가 사진을 실제로 보는 자리는 관리 목록이 아니라 카탈로그와 홈이다.
// 좋은 사진을 발견한 순간에 그 자리에서 바로 걸 수 있어야 자연스러워서,
// 필름 표기 수정(js/film-name-picker.js)과 같은 방식으로 떼어 놓았다.
//
//   const done = await window.PotwPicker.pick(submissionId, { current, note });
//   // done === true 면 선정됨, false 면 취소하거나 실패
//
// 대상은 승인된 독자 사진뿐이다. 편집부가 카탈로그에 올린 샘플 이미지
// (editorial)는 투고가 아니라서 선정 대상이 아니고, submissionId 가 없어
// 호출부에서 이미 걸러진다.
//
// 예전에는 prompt() 로 "2026-09-21" 을 직접 타이핑하게 했다. 폰에서 특히
// 불편했고 오타로 날짜가 틀리기 쉬웠다. 지금은 달력(input[type=date])과
// 코멘트를 한 모달에서 받는다. 모달 마크업과 스타일을 이 파일이 직접
// 만들어 붙이므로, 이 스크립트만 넣으면 어느 페이지에서든 쓸 수 있다.
(function () {
  const db = () => window.MagDB;

  // 아직 비어 있는 다음 월요일. 예약을 쌓아 두는 것이 이 기능의 전제라
  // 매번 오늘을 제안하지 않고 빈 자리를 찾아 준다.
  async function suggestDate(taken) {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); // 다음 월요일
    for (let i = 0; i < 104; i++) {
      const iso = d.toISOString().slice(0, 10);
      if (!taken.has(iso)) return iso;
      d.setDate(d.getDate() + 7);
    }
    return new Date().toISOString().slice(0, 10);
  }

  async function takenDates() {
    try {
      const rows = await db().review.listFeatured();
      return new Set((rows || []).map((r) => String(r.featured_at)));
    } catch (_) {
      return new Set();
    }
  }

  // ── 모달 ──
  // 리더 오버레이가 2200 이라 그 위에 올린다.
  const STYLE_ID = 'potw-picker-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
.potw-modal { position: fixed; inset: 0; z-index: 2400; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); padding: 20px; }
.potw-modal.is-open { display: flex; }
.potw-card { background: var(--bg, #fff); color: var(--text, #111); width: 100%; max-width: 400px; border-radius: 10px; padding: 22px; box-shadow: 0 18px 48px rgba(0,0,0,.3); }
.potw-card h3 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
.potw-card .potw-lead { margin: 0 0 18px; font-size: 13px; line-height: 1.6; color: var(--text-muted, #666); }
.potw-field { margin-bottom: 16px; }
.potw-field label { display: block; font-size: 12px; font-weight: 700; letter-spacing: .04em; margin-bottom: 6px; }
.potw-field input, .potw-field textarea { font: inherit; font-size: 15px; width: 100%; box-sizing: border-box; padding: 10px 12px; background: var(--bg, #fff); color: var(--text, #111); border: 1px solid var(--border, #ddd); border-radius: 6px; }
.potw-field textarea { min-height: 72px; resize: vertical; font-size: 14px; }
.potw-hint { font-size: 12px; color: var(--text-muted, #666); line-height: 1.6; margin-top: 6px; }
.potw-hint.warn { color: #b45309; }
.potw-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
.potw-actions button { font: inherit; font-size: 14px; font-weight: 700; padding: 10px 18px; border-radius: 6px; cursor: pointer; }
.potw-actions .potw-cancel { background: none; color: var(--text-muted, #666); border: 1px solid var(--border, #ddd); }
.potw-actions .potw-save { background: #92400e; color: #fff; border: none; }
.potw-actions .potw-save:disabled { opacity: .6; cursor: progress; }
`;
    document.head.appendChild(el);
  }

  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'potw-modal';
    wrap.innerHTML = `
      <div class="potw-card" role="dialog" aria-modal="true" aria-labelledby="potwTitle">
        <h3 id="potwTitle">이주의 사진으로 걸기</h3>
        <p class="potw-lead"></p>
        <div class="potw-field">
          <label for="potwDate">게재일</label>
          <input type="date" id="potwDate" />
          <p class="potw-hint" data-role="date-hint"></p>
        </div>
        <div class="potw-field">
          <label for="potwNote">편집부 한 줄 (선택)</label>
          <textarea id="potwNote" maxlength="300" placeholder="비워 두면 사진과 작가만 나옵니다."></textarea>
        </div>
        <div class="potw-actions">
          <button type="button" class="potw-cancel">취소</button>
          <button type="button" class="potw-save">저장</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    modal = wrap;
    return wrap;
  }

  // 달력에서 날짜와 코멘트를 받는다. 취소하면 null.
  function askDateAndNote(opts, taken) {
    return new Promise((resolve) => {
      const el = ensureModal();
      const dateInput = el.querySelector('#potwDate');
      const noteInput = el.querySelector('#potwNote');
      const hint = el.querySelector('[data-role="date-hint"]');
      const saveBtn = el.querySelector('.potw-save');
      const cancelBtn = el.querySelector('.potw-cancel');

      el.querySelector('#potwTitle').textContent = opts.current ? '게재일 바꾸기' : '이주의 사진으로 걸기';
      el.querySelector('.potw-lead').textContent = opts.current
        ? '이 사진이 홈에 걸리는 날짜를 바꿉니다.'
        : '오늘 이후 날짜를 고르면 그 날짜에 자동으로 걸립니다. 미리 여러 장을 잡아 두면 매주 들어오지 않아도 됩니다.';

      dateInput.value = opts.suggested || '';
      // min 을 걸지 않는다. 지난 사진의 날짜를 고쳐야 할 때가 있고,
      // 빈 값을 넣으면 "undefined" 라는 문자열이 속성에 박힌다.
      dateInput.removeAttribute('min');
      noteInput.value = opts.note || '';

      // 이미 다른 사진이 잡고 있는 날짜인지 그 자리에서 알려 준다.
      // 막지는 않는다. 같은 날짜면 나중에 등록한 쪽이 홈에 걸린다.
      const refreshHint = () => {
        const v = dateInput.value;
        if (v && taken.has(v) && v !== opts.current) {
          hint.textContent = `${v} 에 이미 다른 사진이 걸려 있습니다. 그대로 저장하면 이 사진이 걸립니다.`;
          hint.className = 'potw-hint warn';
        } else {
          hint.textContent = opts.current
            ? '지금 잡혀 있는 날짜입니다.'
            : '비어 있는 다음 자리를 먼저 채워 두었습니다.';
          hint.className = 'potw-hint';
        }
      };
      refreshHint();

      const close = (result) => {
        el.classList.remove('is-open');
        dateInput.removeEventListener('input', refreshHint);
        saveBtn.removeEventListener('click', onSave);
        cancelBtn.removeEventListener('click', onCancel);
        el.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onSave = () => {
        const date = String(dateInput.value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          hint.textContent = '날짜를 골라 주세요.';
          hint.className = 'potw-hint warn';
          return;
        }
        close({ date, note: noteInput.value });
      };
      const onCancel = () => close(null);
      const onBackdrop = (e) => { if (e.target === el) close(null); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };

      dateInput.addEventListener('input', refreshHint);
      saveBtn.addEventListener('click', onSave);
      cancelBtn.addEventListener('click', onCancel);
      el.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);

      el.classList.add('is-open');
      setTimeout(() => dateInput.focus(), 50);
    });
  }

  async function pick(submissionId, opts = {}) {
    if (!submissionId) return false;
    if (!db()?.isReady?.()) {
      window.notify?.('잠시 후 다시 시도해 주세요.', 'info');
      return false;
    }

    const taken = await takenDates();
    const todayIso = new Date().toISOString().slice(0, 10);
    const picked = await askDateAndNote({
      current: opts.current || '',
      note: opts.note || '',
      suggested: opts.current || await suggestDate(taken),
      todayIso,
    }, taken);
    if (!picked) return false;

    const { error, notified, notifyError } = await db().review.feature(submissionId, picked.date, picked.note);
    if (error) {
      window.notify?.('이주의 사진 등록에 실패했어요. (' + (error.message || '권한을 확인해 주세요') + ')', 'danger');
      return false;
    }
    // 알림이 실패해도 선정은 이미 저장됐다. 되돌리지 않고 알리기만 한다.
    if (notifyError) window.notify?.('선정은 저장했지만 알림을 보내지 못했어요. (' + notifyError.message + ')', 'danger');
    else if (notified) window.notify?.('선정하고 제출자에게 알렸어요.', 'info');
    else window.notify?.('게재일을 바꿨어요. (알림은 처음 걸 때만 나갑니다)', 'info');
    return true;
  }

  window.PotwPicker = { pick, suggestDate, takenDates };
})();
