// 5ft.mag Films shared utilities
// Pure helpers only: no DOM mutation and no Supabase calls.

(function () {
  'use strict';

  const escapeAttr = window.MagUtil.escapeAttr;

  const normalizeFilmLabel = window.MagUtil.normalizeFilmLabel;

  function normalizeContributorKey(value) {
    return String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  }

  function filterCategoryOf(film) {
    const type = String(film?.type || '').toLowerCase();
    if (type.includes('color negative')) return 'color';
    if (type.includes('black') || type.includes('white')) return 'bw';
    if (type.includes('slide') || type.includes('e-6') || type.includes('reversal')) return 'slide';
    if (type.includes('tungsten') || type.includes('daylight') || type.includes('cinema')) return 'cinema';
    return 'other';
  }

  function isMobileFilms() {
    return window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  }

  // submissions 의 작가 식별 키 — instagram > submitterName > author 순.
  function contributorKeyOfSubmission(submission) {
    const s = submission || {};
    return normalizeContributorKey(s.instagram || s.submitterName || s.author || '');
  }

  // submissions 의 작가 표시 라벨 — 화면용 fallback 체인.
  function contributorLabelOfSubmission(submission) {
    const s = submission || {};
    return s.submitterName || s.author || s.instagram || '이름 없음';
  }

  // 사용자가 입력한 필름명을 filmsData 의 정식 slug 로 매핑.
  // 1) slug 자체와 일치하면 그대로 반환
  // 2) aliases / displayName / name 을 normalizeFilmLabel 비교
  function resolveFilmKey(input, filmsData) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const data = filmsData || {};
    if (data[raw]) return raw;
    const q = normalizeFilmLabel(raw);
    if (!q) return '';
    for (const [slug, film] of Object.entries(data)) {
      const aliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
      if (aliases.some(alias => normalizeFilmLabel(alias) === q)) return slug;
    }
    return '';
  }

  // Reader 사진을 통합 lightbox 포맷으로 정규화.
  // submissionId 는 'sub-' prefix 를 떼낸다 (DB favorites 의 raw id 와 매칭하기 위해).
  function toLightboxReaderPhoto(item) {
    const it = item || {};
    return {
      src: it.image || it.src,
      webp: it.webp || it.image || it.src,
      author: it.author || it.submitterName || '',
      instagram: it.instagram || '',
      film: it.film || '',
      camera: it.camera || '',
      caption: it.caption || '',
      instagramUrl: it.instagramUrl || '',
      contributorKey: it.contributorKey || contributorKeyOfSubmission(it),
      submissionId: typeof it.id === 'string' ? it.id.replace(/^sub-/, '') : (it.submissionId || ''),
      _source: 'reader',
    };
  }

  window.FilmsUtils = {
    escapeAttr,
    escapeHtml: escapeAttr,
    normalizeFilmLabel,
    normalizeContributorKey,
    filterCategoryOf,
    isMobileFilms,
    contributorKeyOfSubmission,
    contributorLabelOfSubmission,
    resolveFilmKey,
    toLightboxReaderPhoto,
  };
})();
