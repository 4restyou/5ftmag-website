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
    return res.json();
  }

  async function supplementFromStatic(data, staticPath, logger) {
    try {
      const staticObj = await fetchStaticCatalog(staticPath);
      let supplemented = 0;
      for (const [slug, entry] of Object.entries(staticObj || {})) {
        if (!data[slug]) {
          data[slug] = entry;
          supplemented++;
        }
      }
      if (supplemented) logger?.info?.('[films] supplemented from static JSON:', supplemented);
      return supplemented;
    } catch (_) {
      return 0;
    }
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
        if (obj && Object.keys(obj).length) data = obj;
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

    const supplemented = await supplementFromStatic(data, staticPath, logger);
    return {
      data: localize(data),
      source: supplemented ? 'db+static' : 'db',
      supplemented,
    };
  }

  window.FilmsCatalogLoader = {
    load,
    localize,
    waitForMagDB,
  };
})();
