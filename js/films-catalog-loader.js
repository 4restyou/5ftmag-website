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
        data: await fetchStaticCatalog(staticPath),
        source: 'static',
        supplemented: 0,
      };
    }

    const supplemented = await supplementFromStatic(data, staticPath, logger);
    return {
      data,
      source: supplemented ? 'db+static' : 'db',
      supplemented,
    };
  }

  window.FilmsCatalogLoader = {
    load,
    waitForMagDB,
  };
})();
