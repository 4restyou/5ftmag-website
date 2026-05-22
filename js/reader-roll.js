// 5ft.mag Reader's Roll helpers
// Pure helpers only: no DOM, no Supabase. Keep roll policy testable.

(function () {
  'use strict';

  const DEFAULT_ROLL_LIMIT = 36;

  function sortSubmissionsOldestFirst(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const at = Date.parse(a.createdAt || a.created_at || '') || 0;
      const bt = Date.parse(b.createdAt || b.created_at || '') || 0;
      if (at !== bt) return at - bt;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function buildState(rows, limit = DEFAULT_ROLL_LIMIT) {
    const rollLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : DEFAULT_ROLL_LIMIT;
    const ordered = sortSubmissionsOldestFirst(rows);
    const currentIndex = Math.max(0, Math.ceil(Math.max(ordered.length, 1) / rollLimit) - 1);
    const rolls = [];

    for (let i = 0; i <= currentIndex; i++) {
      const rollRows = ordered.slice(i * rollLimit, (i + 1) * rollLimit);
      rolls.push({
        number: i + 1,
        rows: rollRows,
        complete: rollRows.length === rollLimit,
        current: i === currentIndex,
      });
    }

    const currentRoll = rolls[currentIndex];
    const pastRolls = rolls.filter(roll => !roll.current);

    return {
      total: ordered.length,
      rolls,
      pastRolls,
      currentNumber: currentRoll.number,
      currentRows: currentRoll.rows,
    };
  }

  function formatCardLabel(state, limit = DEFAULT_ROLL_LIMIT) {
    const rollLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Math.floor(Number(limit))
      : DEFAULT_ROLL_LIMIT;
    const currentNumber = Math.max(1, Number(state?.currentNumber) || 1);
    const currentCount = Array.isArray(state?.currentRows)
      ? state.currentRows.length
      : Math.max(0, Number(state?.currentCount) || 0);
    const progress = `${currentCount} / ${rollLimit}`;
    return currentNumber > 1 ? `Roll ${currentNumber} · ${progress}` : progress;
  }

  window.ReaderRoll = {
    DEFAULT_ROLL_LIMIT,
    sortSubmissionsOldestFirst,
    buildState,
    formatCardLabel,
  };
})();
