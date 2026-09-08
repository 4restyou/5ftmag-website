(function () {
  'use strict';

  async function waitForRollRangeApi({ hasCameraFilter, timeoutMs = 2500 }) {
    if (hasCameraFilter) return null;
    const step = 100;
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += step) {
      const api = window.MagDB?.submissions;
      if (
        window.MagDB?.isReady?.() &&
        typeof api?.countApprovedByFilms === 'function' &&
        typeof api?.listApprovedByFilms === 'function'
      ) {
        return api;
      }
      await new Promise(resolve => setTimeout(resolve, step));
    }
    return null;
  }

  function clampRollNumber(number, currentNumber) {
    return Math.max(1, Math.min(Number(number) || currentNumber, currentNumber));
  }

  async function createSource({
    rawAliases,
    normalize,
    rollLimit = 36,
    currentCameras,
    getStaticReaders,
    getApprovedSubmissions,
    buildReaderRollState,
    resolveCanonicalCameraKey,
  }) {
    const cameraFilter = currentCameras instanceof Set ? currentCameras : new Set(currentCameras || []);
    let rangeApi = await waitForRollRangeApi({ hasCameraFilter: cameraFilter.size > 0 });
    const aliasSet = new Set(rawAliases.map(normalize));

    if (rangeApi) {
      const staticReaders = await getStaticReaders();
      if (staticReaders.some(row => aliasSet.has(normalize(row.film)))) rangeApi = null;
    }

    let fallbackSubmissions = null;
    let rollTotal = 0;
    let currentNumber = 1;
    const rollRowsCache = new Map();

    if (rangeApi) {
      rollTotal = await rangeApi.countApprovedByFilms(rawAliases);
      currentNumber = Math.max(1, Math.ceil(Math.max(rollTotal, 1) / rollLimit));
    } else {
      fallbackSubmissions = await getApprovedSubmissions();
      fallbackSubmissions = Array.isArray(fallbackSubmissions) ? fallbackSubmissions : [];
      let matched = fallbackSubmissions.filter(row => aliasSet.has(normalize(row.film)));
      if (cameraFilter.size > 0 && typeof window.normalizeCamera === 'function') {
        matched = matched.filter(row => cameraFilter.has(resolveCanonicalCameraKey(window.normalizeCamera(row.camera).key)));
      }
      const fallbackRollState = buildReaderRollState(matched);
      rollTotal = fallbackRollState.total;
      currentNumber = fallbackRollState.currentNumber;
      fallbackRollState.rolls.forEach(roll => rollRowsCache.set(roll.number, roll.rows));
    }

    async function rollRowsByNumber(number) {
      const safeNumber = clampRollNumber(number, currentNumber);
      if (rollRowsCache.has(safeNumber)) return rollRowsCache.get(safeNumber);
      if (!rangeApi) return [];
      const from = (safeNumber - 1) * rollLimit;
      const rows = await rangeApi.listApprovedByFilms(rawAliases, {
        from,
        to: from + rollLimit - 1,
        ascending: true,
      });
      rollRowsCache.set(safeNumber, Array.isArray(rows) ? rows : []);
      return rollRowsCache.get(safeNumber);
    }

    function rollMeta(number) {
      const safeNumber = clampRollNumber(number, currentNumber);
      return {
        number: safeNumber,
        current: safeNumber === currentNumber,
        rows: rollRowsCache.get(safeNumber) || [],
      };
    }

    // 그 사람이 올린 사진 전부. 자르지 않는다.
    //
    // 예전에는 120장에서 잘랐다. 그래서 120장을 넘긴 작가는 화면이 늘 정확히
    // "120 photos" 로 멈췄고, 필름별 개수도 실제보다 적게 나왔다. 목록 순서대로
    // 앞 120장만 남으니 뒤쪽 필름이 통째로 깎였다. 개수가 거짓이 되는 쪽이
    // DOM 이 늘어나는 것보다 나쁘다. 썸네일은 lazy 로딩이라 실제 부담은 작다.
    async function submissionsForPerson(personKey, personKeyOf) {
      if (!fallbackSubmissions) {
        fallbackSubmissions = await getApprovedSubmissions();
      }
      return (fallbackSubmissions || [])
        .filter(sub => personKeyOf(sub) === personKey);
    }

    function cachedRows(number) {
      return rollRowsCache.get(clampRollNumber(number, currentNumber)) || [];
    }

    return {
      get rangeApi() { return rangeApi; },
      get fallbackSubmissions() { return fallbackSubmissions; },
      rollTotal,
      currentNumber,
      cachedRows,
      rollMeta,
      rollRowsByNumber,
      submissionsForPerson,
    };
  }

  window.FilmsReaderRollData = {
    createSource,
    waitForRollRangeApi,
  };
})();
