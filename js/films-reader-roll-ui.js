(function () {
  'use strict';

  function rollIntroText({ roll, rollTotal, rollLimit = 36, isFeatured = false }) {
    const count = roll?.rows?.length || 0;
    if (roll?.current && count === rollLimit) {
      return `${roll.number}번째 롤이 ${rollLimit}컷으로 채워졌습니다. 다음 첫 컷이 올라오면 새 롤이 시작됩니다.`;
    }
    if (roll?.current && rollTotal > rollLimit) {
      return `${roll.number}번째 롤이 진행 중입니다. 지난 롤은 따로 다시 볼 수 있어요.`;
    }
    if (!roll?.current) {
      return `${roll.number}번째 지난 롤입니다. ${rollLimit}컷으로 채워진 한 롤을 다시 보고 있어요.`;
    }
    if (isFeatured) {
      return count > 0
        ? '독자들이 같은 필름으로 채워가는 또 하나의 한 롤입니다. 남은 빈 자리에 당신의 한 컷도 더해보세요.'
        : '독자들이 같은 필름으로 채워가는 또 하나의 한 롤. 빈 자리에 당신의 한 컷을 넣어보세요.';
    }
    return count > 0
      ? `${count}컷이 먼저 채워졌습니다. 남은 빈 자리를 독자들의 사진으로 함께 채워가요.`
      : `아직 시작된 롤. 빈 ${rollLimit} 자리를 독자들이 함께 채워갑니다. 첫 자리를 차지해 보세요.`;
  }

  function exportKeyOf(sub, { personKeyOf }) {
    return String(sub?.id || sub?.storage_path || sub?.image || `${personKeyOf(sub)}-${sub?.created_at || sub?.createdAt || ''}`);
  }

  function authorsForRoll(rows, { personKeyOf, personLabelOf }) {
    const authorBuckets = new Map();
    rows.forEach((sub) => {
      const key = personKeyOf(sub);
      if (!key) return;
      if (!authorBuckets.has(key)) authorBuckets.set(key, { label: personLabelOf(sub), count: 0 });
      authorBuckets.get(key).count += 1;
    });
    return [...authorBuckets.entries()].sort((a, b) => {
      const countDiff = b[1].count - a[1].count;
      if (countDiff) return countDiff;
      return a[1].label.localeCompare(b[1].label, 'ko');
    });
  }

  function readerSelectionControls({ grid, filmKey }) {
    const section = grid.closest('.modal-section-reader');
    return {
      saveMenu: section?.querySelector('[data-reader-save-menu]'),
      saveMenuToggle: section?.querySelector(`[data-save-menu-toggle="reader"][data-film-key="${filmKey}"]`),
      saveMenuPopover: section?.querySelector('[data-save-menu-popover]'),
      fullSave: section?.querySelector(`[data-save-roll="reader"][data-film-key="${filmKey}"]`),
      selectStart: section?.querySelector(`[data-select-roll="reader"][data-film-key="${filmKey}"]`),
      selectedSave: section?.querySelector(`[data-save-selected-roll="reader"][data-film-key="${filmKey}"]`),
      cancel: section?.querySelector(`[data-select-cancel="reader"][data-film-key="${filmKey}"]`),
    };
  }

  function updateReaderSelectionControls({ grid, filmKey, visibleCount, selectionMode, selectedCount }) {
    const { saveMenu, saveMenuToggle, saveMenuPopover, selectedSave, cancel } = readerSelectionControls({ grid, filmKey });
    const hasPhotos = visibleCount > 0;
    if (saveMenu) saveMenu.hidden = !hasPhotos || selectionMode;
    if ((!hasPhotos || selectionMode) && saveMenuPopover) saveMenuPopover.hidden = true;
    if ((!hasPhotos || selectionMode) && saveMenuToggle) saveMenuToggle.setAttribute('aria-expanded', 'false');
    if (selectedSave) {
      selectedSave.hidden = !selectionMode;
      selectedSave.disabled = selectedCount < 1;
      selectedSave.textContent = `선택한 ${selectedCount}장 저장`;
    }
    if (cancel) cancel.hidden = !selectionMode;
    grid.classList.toggle('is-selecting', selectionMode);
  }

  function closeReaderSaveMenu({ grid, filmKey }) {
    const { saveMenuToggle, saveMenuPopover } = readerSelectionControls({ grid, filmKey });
    if (saveMenuPopover) saveMenuPopover.hidden = true;
    if (saveMenuToggle) saveMenuToggle.setAttribute('aria-expanded', 'false');
  }

  function renderRollSwitcher({ rollSwitcher, currentNumber, activeRoll, archiveOpen }) {
    if (!rollSwitcher) return;
    if (currentNumber < 2) {
      rollSwitcher.hidden = true;
      rollSwitcher.innerHTML = '';
      return;
    }
    const isViewingCurrent = activeRoll === currentNumber;
    const pastNumbers = Array.from({ length: currentNumber - 1 }, (_, i) => currentNumber - 1 - i);
    const expanded = archiveOpen || !isViewingCurrent;
    rollSwitcher.hidden = false;
    rollSwitcher.innerHTML = `
      <span class="reader-control-label">롤 보기</span>
      <button type="button" class="reader-roll-toggle${expanded ? ' is-active' : ''}" data-roll-action="${isViewingCurrent ? 'toggle' : 'current'}" aria-expanded="${expanded ? 'true' : 'false'}">
        ${isViewingCurrent ? `지난 롤 보기 <span>${pastNumbers.length}</span>` : `현재 롤로 돌아가기 <span>${currentNumber}</span>`}
      </button>
      <div class="reader-roll-numbers" ${expanded ? '' : 'hidden'} aria-label="지난 롤 번호">
        ${pastNumbers.map((number) => `
          <button type="button" class="reader-roll-number${number === activeRoll ? ' is-active' : ''}" data-roll-number="${number}" aria-label="${number}번째 지난 롤 보기">
            ${number}
          </button>
        `).join('')}
      </div>`;
  }

  function renderPersonFilter({ personFilter, rollRows, activePerson, personKeyOf, personLabelOf, escapeAttr }) {
    const authors = authorsForRoll(rollRows, { personKeyOf, personLabelOf });
    if (!personFilter) return;
    if (authors.length < 1) {
      personFilter.hidden = true;
      personFilter.innerHTML = '';
      return;
    }
    personFilter.hidden = false;
    personFilter.innerHTML = `
      <span class="reader-control-label">작가 필터</span>
      ${authors.length > 1 ? `<button type="button" class="reader-person-chip${activePerson === 'all' ? ' is-active' : ''}" data-person-key="all">
        ALL <span>${rollRows.length}</span>
      </button>` : ''}
      ${authors.map(([key, info]) => `
        <button type="button" class="reader-person-chip${activePerson === key || authors.length === 1 ? ' is-active' : ''}" data-person-key="${escapeAttr(key)}">
          ${escapeAttr(info.label)} <span>${info.count}</span>
          <em class="reader-person-all">전체</em>
        </button>
      `).join('')}`;
  }

  function renderReaderSlots({
    grid,
    rollLimit = 36,
    visible,
    selectedExportKeys,
    selectionMode,
    personKeyOf,
    personLabelOf,
    escapeAttr,
    classifyPhotoOrientation,
    counter,
    activePerson,
    rollRows,
    activeRoll,
    modalContent,
    filmKey,
    exportKey,
  }) {
    for (let i = 0; i < rollLimit; i++) {
      const slot = grid.querySelector(`[data-slot-index="${i}"]`);
      if (!slot) continue;
      const sub = visible[i];
      if (!sub) {
        slot.className = 'reader-slot is-empty';
        delete slot.dataset.exportKey;
        slot.setAttribute('aria-label', `프레임 ${i + 1} — 비어 있음`);
        slot.innerHTML = `<span class="reader-slot-frame">${String(i + 1).padStart(2, '0')}</span>`;
        continue;
      }
      const personKey = personKeyOf(sub);
      const key = exportKey(sub);
      const isSelected = selectedExportKeys.has(key);
      const selectionNumber = isSelected ? Array.from(selectedExportKeys).indexOf(key) + 1 : '';
      const instaHandle = (sub.instagram || '').replace(/^@/, '');
      slot.className = `reader-slot is-filled${selectionMode ? ' is-selecting' : ''}${isSelected ? ' is-selected' : ''}`;
      slot.dataset.exportKey = key;
      slot.setAttribute('aria-label', `${personLabelOf(sub)}의 사진`);
      if (instaHandle) slot.setAttribute('data-instagram', instaHandle);
      slot.innerHTML = `
        <button type="button" class="reader-slot-link" aria-label="${escapeAttr(selectionMode ? `${personLabelOf(sub)}의 사진 선택` : `${personLabelOf(sub)}의 사진 크게 보기`)}" aria-pressed="${selectionMode ? String(isSelected) : 'false'}">
          <span class="reader-slot-window">
            <img src="${escapeAttr(sub.image)}" alt="" loading="lazy" />
          </span>
          <span class="reader-slot-check" aria-hidden="true">${selectionNumber}</span>
          <span class="reader-slot-author" data-person-key="${escapeAttr(personKey)}">${escapeAttr(personLabelOf(sub))}</span>
        </button>`;
      const img = slot.querySelector('img');
      if (img) classifyPhotoOrientation(img);
    }
    if (counter) {
      counter.textContent = activePerson === 'all'
        ? `${rollRows.length} / ${rollLimit} · ${activeRoll}롤`
        : `${visible.length} / ${rollRows.length} · ${activeRoll}롤`;
    }
    const saveBtn = modalContent.querySelector(`[data-save-roll="reader"][data-film-key="${filmKey}"]`);
    if (saveBtn) saveBtn.hidden = visible.length === 0;
    updateReaderSelectionControls({
      grid,
      filmKey,
      visibleCount: visible.length,
      selectionMode,
      selectedCount: selectedExportKeys.size,
    });
  }

  window.FilmsReaderRollUI = {
    rollIntroText,
    exportKeyOf,
    authorsForRoll,
    readerSelectionControls,
    updateReaderSelectionControls,
    closeReaderSaveMenu,
    renderRollSwitcher,
    renderPersonFilter,
    renderReaderSlots,
  };
})();
