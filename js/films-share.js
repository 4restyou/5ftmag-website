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

  function prettyFilmPath(filmKey) {
    return `/film/${encodeURIComponent(filmKey)}`;
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
    const url = `${window.location.origin}${prettyFilmPath(filmKey)}`;
    const filmName = film?.displayName || film?.name || filmKey;
    await shareOrCopy({
      title: `${filmName} · 5ft.mag Films`,
      text: `5ft.mag Films 에서 ${filmName} 보기`,
      url,
    });
  }

  async function shareCamera(key, info) {
    if (!info) return;
    const url = `${window.location.origin}${prettyCameraPath(key)}`;
    await shareOrCopy({
      title: `${info.display} · 5ft.mag Films`,
      text: `5ft.mag 에서 ${info.display} 으로 찍은 사진 보기`,
      url,
    });
  }

  window.FilmsShare = {
    routeParam,
    filmsBasePath,
    prettyFilmPath,
    prettyCameraPath,
    prettyContributorPath,
    shareFilm,
    shareCamera,
  };
})();
