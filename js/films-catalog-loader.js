(function () {
  'use strict';

  async function waitForMagDB(timeoutMs = 3000) {
    const step = 50;
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += step) {
      if (window.MagDB && window.MagDB.isReady?.()) return window.MagDB;
      await new Promise(resolve => setTimeout(resolve, step));
    }
    return window.MagDB?.isReady?.() ? window.MagDB : null;
  }

  async function fetchStaticCatalog(staticPath) {
    const res = await fetch(staticPath);
    if (!res.ok) throw new Error(`Film catalog HTTP ${res.status}`);
    return res.json();
  }

  // 영문 페이지(<html lang="en">)에선 소개글을 영문(descEn)으로 바꿔 둔다. 화면 코드는 desc 만 본다.
  // 일문 페이지(<html lang="ja">)는 일문(descJa), 없으면 영문. 둘 다 없는 필름은 한국어 소개글 그대로.
  function localize(data) {
    const lang = document.documentElement.lang;
    if ((lang !== 'en' && lang !== 'ja') || !data) return data;
    for (const entry of Object.values(data)) {
      const desc = entry && ((lang === 'ja' && entry.descJa) || entry.descEn);
      if (desc) { entry.descKo = entry.desc; entry.desc = desc; }
    }
    return data;
  }

  async function load({
    staticPath = 'data/films.json',
    waitMs = 3000,
    logger = console,
  } = {}) {
    let data = null;
    const db = await waitForMagDB(waitMs);

    if (db?.films?.listAsObject) {
      try {
        const obj = await db.films.listAsObject();
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) data = obj;
      } catch (err) {
        logger?.warn?.('[films] DB catalog fallback:', err?.message || err);
      }
    }

    if (!data) {
      return {
        data: localize(await fetchStaticCatalog(staticPath)),
        source: 'static',
        supplemented: 0,
      };
    }

    return {
      data: localize(data),
      source: 'db',
      supplemented: 0,
    };
  }

  window.FilmsCatalogLoader = {
    load,
    localize,
    waitForMagDB,
  };
})();
