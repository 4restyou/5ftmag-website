// 5ft.mag 독자 사진 투고 지연 로더
//
// 투고 창(reader-submissions.js)과 그 폼 모듈(reader-camera-input·reader-film-picker·
// reader-upload-form-ui·reader-upload-flow)은 홈·films 첫 화면에 필요 없다. 이 파일만
// 먼저 싣고, 투고 창을 처음 여는 순간(data-action="open-submission" 클릭, 또는 로그인
// 뒤 자동 재진입 표시가 남아 있을 때) 위 모듈을 순서대로 불러온 뒤 창을 연다.
// tus·image-processor·camera-brands 는 reader-submissions.js 가 폼을 열 때 따로 불러온다.
//
// 투고 창 없이도 쓰는 읽기 쪽 함수(필름명 매칭, 승인된 제출 목록)도 여기 둔다.
// films·홈·admin/submissions 가 이 함수들을 쓴다.
//
// 캐시버스트: 아래 MODULES 의 ?v= 는 scripts/bump-version.mjs 가 HTML 과 함께 갱신하고,
// validate-assets 의 단일 버전 가드가 검사한다. 손으로 고치지 않는다.

(function () {
  'use strict';

  const i18n = window.i18n;
  const tr = i18n.t;

  // ════════════════════════════════════════════════════════════
  // 필름명 정규화 + 매칭 (films.html, admin과 공유)
  //  - 정규화: 소문자 + 공백/하이픈/언더스코어/괄호 등 제거 (Hangul은 그대로)
  //  - exact match: 정규화된 alias 집합에 hit
  //  - fuzzy match: 부분 포함 + Levenshtein 거리 ≤ 임계값
  // ════════════════════════════════════════════════════════════
  // util.js 보다 먼저 실릴 수 있는 관리 화면이 있어 MagUtil 은 부를 때 찾는다.
  const normalizeFilmName = (s) => window.MagUtil.normalizeFilmLabel(s);

  // films 객체에서 정규화된 alias → 필름 entry 매핑 빌드
  function buildAliasIndex(films) {
    const buckets = new Map();
    for (const slug of Object.keys(films || {})) {
      const f = films[slug];
      const all = (f.aliases || []).concat([f.displayName, f.name]).filter(Boolean);
      for (const a of all) {
        const k = normalizeFilmName(a);
        if (!k) continue;
        if (!buckets.has(k)) buckets.set(k, new Map());
        buckets.get(k).set(slug, { slug, film: f });
      }
    }
    const map = new Map();
    for (const [alias, entriesBySlug] of buckets) {
      const entries = [...entriesBySlug.values()];
      map.set(alias, entries.length === 1
        ? entries[0]
        : { ambiguous: true, entries });
    }
    return map;
  }

  // Levenshtein 거리 (작은 입력에 최적, films 매칭 용도)
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : Math.min(prev[j - 1], prev[j], curr[j - 1]) + 1;
      }
      prev = curr;
    }
    return prev[n];
  }

  // 사용자 입력 → 가장 그럴듯한 필름 후보
  //   - exact: alias 일치 → { type: 'exact', film, canonical }
  //   - fuzzy: 부분 포함 또는 Levenshtein ≤ 임계값 → { type: 'fuzzy', film, canonical, score }
  //   - none: null
  function findFilmMatch(input, films) {
    const q = normalizeFilmName(input);
    if (!q) return null;
    const aliasIndex = buildAliasIndex(films);

    // 1) Exact match (alias 집합 내)
    const exactEntry = aliasIndex.get(q);
    if (exactEntry && !exactEntry.ambiguous) {
      const entry = exactEntry;
      return { type: 'exact', film: entry.film, slug: entry.slug, canonical: entry.film.displayName || entry.film.name };
    }

    // 2) Fuzzy: 부분 포함(양방향) 우선, 그다음 Levenshtein
    const candidates = [];
    for (const [normAlias, entry] of aliasIndex) {
      if (entry.ambiguous) continue;
      // 너무 짧은 입력은 잘못된 매칭 위험 — 최소 길이 3 이상에서만 부분 매칭 인정
      if (q.length >= 3 && (normAlias.includes(q) || q.includes(normAlias))) {
        const score = Math.max(q.length, normAlias.length) - Math.min(q.length, normAlias.length);
        candidates.push({ entry, score });
        continue;
      }
      // Levenshtein 임계값: 입력 길이의 30% 또는 3 중 작은 값
      const threshold = Math.min(3, Math.max(1, Math.floor(q.length * 0.3)));
      const d = levenshtein(q, normAlias);
      if (d <= threshold) candidates.push({ entry, score: d });
    }
    if (!candidates.length) return null;
    // 가장 가까운 후보
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0].entry;
    return { type: 'fuzzy', film: best.film, slug: best.slug, canonical: best.film.displayName || best.film.name };
  }

  // 외부에서 사용할 수 있게 노출 (films.html, admin과 공유)
  window.normalizeFilmName = normalizeFilmName;
  window.buildFilmAliasIndex = buildAliasIndex;
  window.findFilmMatch = findFilmMatch;

  // 외부 노출: 승인된 제출 가져오기 (MagDB 위임)
  window.fetchApprovedSubmissions = async function (limit = null) {
    const db = window.MagDB;
    if (!db || !db.isReady()) return [];
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('승인된 사진 목록 불러오기 시간 초과 (30초)')), 30000);
    });
    return Promise.race([db.submissions.listApproved(limit), timeout])
      .catch(err => {
        console.warn('[reader-submissions] approved list:', err?.message || err);
        return [];
      })
      .finally(() => clearTimeout(timer));
  };

  // ════════════════════════════════════════════════════════════
  // 투고 창 지연 로드
  // ════════════════════════════════════════════════════════════
  const MODULES = [
    '/js/reader-camera-input.js?v=20261002-f2',
    '/js/reader-film-picker.js?v=20261002-f2',
    '/js/reader-upload-form-ui.js?v=20261002-f2',
    '/js/reader-upload-flow.js?v=20261002-f2',
    '/js/reader-submissions.js?v=20261002-f2',
  ];

  // 관리 화면처럼 reader-submissions.js 를 직접 싣는 페이지에선 로더는 매칭 함수만 준다.
  if (document.querySelector('script[src*="reader-submissions.js"]')) return;

  const isLoaded = () => typeof window.ReaderSubmissions?.open === 'function';
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('스크립트 로드 실패: ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureUploadModules() {
    if (isLoaded()) return Promise.resolve();
    if (!loading) {
      loading = MODULES.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .catch(err => { loading = null; throw err; });
    }
    return loading;
  }

  // 첫 클릭만 여기서 받는다. 모듈이 실린 뒤로는 reader-submissions.js 의 위임이 처리한다.
  document.addEventListener('click', (e) => {
    if (isLoaded()) return;
    const btn = e.target.closest('[data-action="open-submission"]');
    if (!btn) return;
    e.preventDefault();
    if (loading) return; // 불러오는 중에 또 눌러도 한 번만 연다
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    ensureUploadModules()
      .then(() => window.ReaderSubmissions.open(btn))
      .catch(() => {
        window.notify?.(tr('업로드 도구를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.', 'Could not load the upload tools. Please refresh and try again.', 'アップロードツールを読み込めませんでした。再読み込みしてからもう一度お試しください。'), 'danger');
      })
      .finally(() => {
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
      });
  });

  // 로그인(OAuth)하고 돌아온 직후: reader-submissions.js 가 남긴 재진입 표시가 있으면
  // 모듈을 불러온다. 창은 reader-submissions.js 가 로드되며 스스로 다시 연다.
  function hasPendingReopen() {
    const maxAge = 10 * 60 * 1000;
    const read = (getStorage, key) => {
      try {
        const raw = getStorage().getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return parsed.value === '1' && Date.now() - Number(parsed.ts || 0) <= maxAge;
      } catch {
        return false;
      }
    };
    return read(() => sessionStorage, '5ft_pending_submission_open')
      || read(() => localStorage, '5ft_pending_submission_open_fallback');
  }
  if (hasPendingReopen()) ensureUploadModules().catch(() => {});
})();
