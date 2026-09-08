// 5ft.mag Films sharing and short-route helpers

(function () {
  'use strict';

  function routeParam(kind) {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0] === kind) return decodeURIComponent(parts.slice(1).join('/'));
    } catch (_) {}
    return '';
  }

  function filmsBasePath() {
    return '/films';
  }

  function prettyCameraPath(key) {
    return `/camera/${encodeURIComponent(key)}`;
  }

  function prettyContributorPath(key) {
    return `/contributor/${encodeURIComponent(key)}`;
  }

  async function shareOrCopy({ title, text, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (_) {
        return;
      }
    }

    const ok = await window.copyTextToClipboard?.(url);
    window.notify?.(
      ok ? '링크 복사 완료' : '복사 실패 — 주소창에서 직접 복사해주세요',
      ok ? 'info' : 'danger'
    );
  }

  async function shareFilm(filmKey, film) {
    // 상세 페이지(/film/<slug>)는 검색용이다. 독자가 공유한 링크는 카탈로그를
    // 열어 사진을 바로 보게 한다. prettyShareUrl 이 /films?film= 로 다듬는다.
    const path = `/films.html?film=${encodeURIComponent(filmKey)}`;
    const url = window.prettyShareUrl
      ? window.prettyShareUrl(path)
      : `https://5ftmag.com/films?film=${encodeURIComponent(filmKey)}`;
    const filmName = film?.displayName || film?.name || filmKey;
    await shareOrCopy({
      title: `${filmName} · 5ft.mag Films`,
      text: `5ft.mag Films 에서 ${filmName} 보기`,
      url,
    });
  }

  async function shareCamera(key, info) {
    if (!info) return;
    const path = prettyCameraPath(key);
    const url = window.prettyShareUrl ? window.prettyShareUrl(path) : `https://5ftmag.com${path}`;
    await shareOrCopy({
      title: `${info.display} · 5ft.mag Films`,
      text: `5ft.mag 에서 ${info.display} 으로 찍은 사진 보기`,
      url,
    });
  }

  // 작가 뷰는 필름 모달 안에서 열린다. 그래서 공유 버튼이 필름만 보고 있으면
  // 작가를 공유해도 필름 링크가 나갔다. 작가를 먼저 확인해 이 함수로 보낸다.
  async function shareContributor(key, label) {
    if (!key) return;
    const path = prettyContributorPath(key);
    const url = window.prettyShareUrl ? window.prettyShareUrl(path) : `https://5ftmag.com${path}`;
    const who = label || '@' + key;
    await shareOrCopy({
      title: `${who} 의 필름 사진 · 5ft magazine`,
      text: `${who} 님이 5ft.mag 에 올린 필름 사진 보기`,
      url,
    });
  }

  window.FilmsShare = {
    routeParam,
    filmsBasePath,
    prettyCameraPath,
    prettyContributorPath,
    shareFilm,
    shareCamera,
    shareContributor,
  };
})();
