'use strict';

// 이주의 사진 선정 — 관리 화면과 사진 라이트박스가 함께 쓰는 공용 흐름.
//
// 편집부가 사진을 실제로 보는 자리는 관리 목록이 아니라 카탈로그와 홈이다.
// 좋은 사진을 발견한 순간에 그 자리에서 바로 걸 수 있어야 자연스러워서,
// 필름 표기 수정(js/film-name-picker.js)과 같은 방식으로 떼어 놓았다.
//
//   const done = await window.PotwPicker.pick(submissionId, { current });
//   // done === true 면 선정됨, false 면 취소하거나 실패
//
// 대상은 승인된 독자 사진뿐이다. 편집부가 카탈로그에 올린 샘플 이미지
// (editorial)는 투고가 아니라서 선정 대상이 아니고, submissionId 가 없어
// 호출부에서 이미 걸러진다.
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

  async function pick(submissionId, opts = {}) {
    if (!submissionId) return false;
    if (!db()?.isReady?.()) {
      window.notify?.('잠시 후 다시 시도해 주세요.', 'info');
      return false;
    }

    const taken = await takenDates();
    const already = Boolean(opts.current);

    const dateStr = prompt(
      already
        ? '이 사진의 게재일을 바꿉니다.\n\n언제부터 걸까요? (YYYY-MM-DD)'
        : '이 사진을 이주의 사진으로 겁니다.\n\n'
          + '언제부터 걸까요? (YYYY-MM-DD)\n'
          + '오늘 이후 날짜를 넣으면 그 날짜에 자동으로 걸립니다. 미리 여러 장을 잡아 두면 매주 들어오지 않아도 됩니다.',
      opts.current || await suggestDate(taken),
    );
    if (dateStr === null) return false;

    const date = String(dateStr).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      window.notify?.('날짜는 2026-09-07 처럼 넣어 주세요.', 'danger');
      return false;
    }
    if (taken.has(date) && date !== opts.current) {
      if (!confirm(date + ' 에 이미 다른 사진이 걸려 있습니다.\n그래도 이 사진으로 바꿀까요? (같은 날짜면 나중에 등록한 쪽이 홈에 걸립니다)')) return false;
    }

    const note = prompt('편집부 한 줄을 적어 주세요. 비워 두면 사진과 작가만 나옵니다. (선택, 300자)', opts.note || '');
    if (note === null) return false;

    const { error, notified, notifyError } = await db().review.feature(submissionId, date, note);
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
