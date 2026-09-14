// 5ft.mag 공통 유틸 — escapeHtml / escapeAttr 등 자주 중복되던 함수를 한 곳에 둔다.
// 사용처에서는 IIFE 안에 `const escapeHtml = window.MagUtil.escapeHtml;` 같이
// alias 로 받아 쓰면 호출 위치 변경 없이 정의만 통합된다.
//
// site-common.js 보다 먼저 로드돼야 한다 (page-specific js 가 site-common.js 로드 시점에
// 이미 정의돼 있다고 가정하므로). HTML 의 script 태그 순서 유지 필수.

(function () {
  'use strict';

  // HTML 안에 텍스트로 안전하게 박을 때 사용 (&<>"' 만 entity 화).
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }

  // HTML 속성값에 박을 때 사용. 현재 구현은 escapeHtml 과 동일하지만,
  // 시맨틱 분리를 위해 별도 함수로 노출한다 (필요 시 향후 발산 가능).
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // 필름·카메라 라벨 정규화 — 공백/하이픈/언더스코어/괄호/슬래시/점/+ 제거 + 소문자.
  // 검색·alias 매칭에서 "Portra 400" / "portra400" / "PORTRA-400" 을 같은 키로 묶는다.
  // 한글은 그대로 보존 (포트라 400 / 포트라400 도 같이 정규화됨).
  function normalizeFilmLabel(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  function seoulTodayIso(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date || new Date());
    const byType = Object.fromEntries(parts.map(function (part) { return [part.type, part.value]; }));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  // published=true 여도 한국 시간 기준 게시일 전에는 공개 화면에 노출하지 않는다.
  function isPublishedContent(item, todayIso) {
    if (!item || item.published === false) return false;
    const date = String(item.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
    const today = typeof todayIso === 'string' ? todayIso : seoulTodayIso();
    return date <= today;
  }

  // ── 글 목록 로딩 ──
  //
  // data/stories.json 은 배포 산출물이라 공개 여부를 바꾸려면 재배포가 필요했다.
  // 그래서 공개 여부만 Supabase(story_visibility)로 옮기고, 여기서 둘을 합친다.
  // JSON 의 published 가 기본값이고 DB 에 행이 있으면 그것이 이긴다.
  //
  // 목록을 읽는 페이지가 일곱이라 각자 fetch 하던 것을 이 함수 하나로 모았다.
  // 한 곳만 고치면 "홈에는 없는데 검색에는 나오는" 상태가 되기 때문이다.
  //
  // Supabase 설정을 db-client.js 에서 가져오지 않고 여기 둔 이유: db-client 는
  // supabase UMD CDN 에 의존하고 페이지마다 로드 순서가 달라서, 목록 렌더가
  // 그 둘에 묶이면 안 된다. 두 곳이 갈라지지 않게 tests/unit/story-override.spec.mjs
  // 가 값이 같은지 검사한다.
  const SB_URL  = 'https://pucpqsfwqouqohwsvmnd.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';
  const OVERRIDE_TIMEOUT_MS = 1500;

  // 오버라이드를 stories 배열에 덮어쓴다. 순수 함수 — 원본을 바꾸지 않는다.
  function applyVisibility(list, rows) {
    if (!Array.isArray(list)) return [];
    if (!Array.isArray(rows) || !rows.length) return list;
    const map = new Map();
    for (const r of rows) {
      if (r && r.story_id != null) map.set(String(r.story_id), r.published !== false);
    }
    if (!map.size) return list;
    return list.map(function (s) {
      const key = String(s && s.id != null ? s.id : '');
      return map.has(key) ? Object.assign({}, s, { published: map.get(key) }) : s;
    });
  }

  // 오버라이드 조회. 실패하거나 느리면 빈 배열로 떨어져 JSON 기본값을 쓴다.
  // 목록이 DB 때문에 멈추면 안 된다.
  function fetchVisibility() {
    let ctl = null;
    let timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctl = new AbortController();
        timer = setTimeout(function () { ctl.abort(); }, OVERRIDE_TIMEOUT_MS);
      }
    } catch (_) { ctl = null; }
    const done = function () { if (timer) clearTimeout(timer); };
    return fetch(SB_URL + '/rest/v1/story_visibility?select=story_id,published', {
      headers: { apikey: SB_ANON, accept: 'application/json' },
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { done(); return Array.isArray(rows) ? rows : []; })
      .catch(function () { done(); return []; });
  }

  // 한 페이지에서 여러 번 불러도 요청은 한 번이다.
  let storiesPromise = null;
  function loadStories() {
    if (storiesPromise) return storiesPromise;
    storiesPromise = Promise.all([
      // 두 요청을 동시에 띄운다. 오버라이드는 대개 비어 있어 stories.json 보다
      // 빨리 오므로 추가 지연이 사실상 없다.
      fetch('/data/stories.json').then(function (r) { return r.ok ? r.json() : []; }),
      fetchVisibility(),
    ]).then(function (pair) {
      return applyVisibility(pair[0], pair[1]);
    }).catch(function () {
      storiesPromise = null;   // 다음 호출에서 다시 시도한다
      return [];
    });
    return storiesPromise;
  }

  // 가격 표기 통합. 페이지마다 따로 구현돼 같은 금액이 다르게 보이던 것을 하나로.
  //   opts.empty    — 값이 없거나 0 이하일 때 표시 (기본 '')
  //   opts.keepText — 숫자가 아닌 값("가격 협의" 등)을 원문 그대로 살릴지 (기본 false)
  // keepText 경로는 사용자 입력이므로 escapeHtml 로 감싼다.
  function formatPrice(value, opts) {
    const empty = opts && 'empty' in opts ? opts.empty : '';
    const keepText = !!(opts && opts.keepText);
    const raw = String(value ?? '').trim();
    if (!raw) return empty;
    const n = Number(raw.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return keepText ? escapeHtml(raw) : empty;
    return n.toLocaleString('ko-KR') + '원';
  }

  // 사진 풀에서 작가를 한 명씩 돌아가며 뽑는다 (라운드로빈).
  // 모든 작가가 1장씩 받은 뒤에야 누군가의 2장째로 넘어가므로, 한 사람이 몰아
  // 올린 기간에도 메인이 한 작가로만 채워지지 않는다. 작가 수가 칸 수보다 적을
  // 때만 같은 작가의 다음 컷으로 채운다 — 상한을 숫자로 박지 않아도 실제 작가
  // 수에 맞춰 노출이 알아서 나뉜다.
  //
  // 버킷 안의 순서는 입력 순서를 그대로 유지한다. 최신순으로 정렬해 넘기면
  // 각 작가의 "가장 최근 컷"이 먼저 뽑히고, 셔플해 넘기면 무작위 컷이 뽑힌다.
  // 어느 작가가 뽑히느냐는 매번 달라지도록 버킷 순서만 섞는다.
  // 작성자 미상은 각자 다른 버킷으로 둔다 (한 명으로 묶으면 통째로 밀려난다).
  function pickByAuthorRoundRobin(pool, count, authorOf, random) {
    const list = Array.isArray(pool) ? pool : [];
    const want = Math.min(Math.floor(Number(count)) || 0, list.length);
    if (want <= 0) return [];
    const getAuthor = typeof authorOf === 'function' ? authorOf : function (item) {
      return item && item.author;
    };
    const rnd = typeof random === 'function' ? random : Math.random;

    const buckets = new Map();
    list.forEach(function (item, i) {
      const raw = String(getAuthor(item) ?? '').trim().toLowerCase();
      const key = raw || `__anon_${i}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    });

    const queues = [...buckets.values()];
    for (let i = queues.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [queues[i], queues[j]] = [queues[j], queues[i]];
    }

    const picked = [];
    for (let round = 0; picked.length < want; round++) {
      let advanced = false;
      for (const queue of queues) {
        if (round >= queue.length) continue;
        picked.push(queue[round]);
        advanced = true;
        if (picked.length >= want) break;
      }
      if (!advanced) break;
    }
    return picked;
  }

  window.MagUtil = Object.freeze({
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    normalizeFilmLabel: normalizeFilmLabel,
    seoulTodayIso: seoulTodayIso,
    isPublishedContent: isPublishedContent,
    formatPrice: formatPrice,
    pickByAuthorRoundRobin: pickByAuthorRoundRobin,
    applyVisibility: applyVisibility,
    loadStories: loadStories,
    supabaseConfig: { url: SB_URL, anonKey: SB_ANON },
  });
})();
