(function () {
  'use strict';

  function bindFilmPicker({
    films,
    normalizeFilmName,
    findFilmMatch,
    clearOutsideClickHandler = () => {},
    setOutsideClickHandler = () => {},
  } = {}) {
    const picker = document.getElementById('rs-film-picker');
    const filmInput = document.getElementById('rs-film-input');
    const trigger = document.getElementById('rs-film-trigger');
    const selectedLabel = document.getElementById('rs-film-selected');
    const themeRoot = document.querySelector('.rs-theme');
    // theme_apply 는 이제 hidden input — 필름 일치 시 value 채우고, 아닐 때 비움.
    // (이전엔 checkbox 였지만 응모 자동 포함 으로 단일 동의 모델로 전환.)
    const themeInput = themeRoot?.querySelector('input[name="theme_apply"]') || null;
    const themeStatus = themeRoot?.querySelector('.rs-theme-status') || null;
    const themeMonth = themeStatus?.dataset?.themeMonth || themeInput?.defaultValue || '';
    const themeHint = document.getElementById('rs-theme-hint');
    const themeCanonical = themeRoot?.dataset?.themeCanonical || '';
    const dropdown = document.getElementById('rs-film-dropdown');
    const search = document.getElementById('rs-film-search');
    const optionList = document.getElementById('rs-film-list');
    const reqToggle = document.getElementById('rs-film-request-toggle');
    const reqInput = document.getElementById('rs-film-request-input');
    const reqCancel = document.getElementById('rs-film-request-cancel');

    function filmMatchesTheme(filmName) {
      if (!themeCanonical || !filmName || !normalizeFilmName) return false;
      if (normalizeFilmName(filmName) === normalizeFilmName(themeCanonical)) return true;
      const m = typeof findFilmMatch === 'function' ? findFilmMatch(filmName, films) : null;
      return !!(m?.type === 'exact' &&
        normalizeFilmName(m.canonical) === normalizeFilmName(themeCanonical));
    }

    function syncThemeCheckbox(filmName) {
      const match = filmMatchesTheme(filmName);
      if (themeInput) themeInput.value = match ? themeMonth : '';
      if (themeRoot) themeRoot.classList.toggle('is-theme-matched', match);
      if (themeHint) themeHint.hidden = match || !filmName;
    }

    function setMode(mode) {
      if (picker) picker.dataset.mode = mode;
    }

    function openDropdown() {
      if (!dropdown || !trigger) return;
      dropdown.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      setTimeout(() => search?.focus(), 50);
    }

    function closeDropdown() {
      if (!dropdown || !trigger) return;
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    syncThemeCheckbox(filmInput?.value || '');

    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown?.hidden) openDropdown(); else closeDropdown();
    });

    clearOutsideClickHandler();
    const outsideClickHandler = (e) => {
      if (!picker || dropdown?.hidden) return;
      if (!picker.contains(e.target)) closeDropdown();
    };
    setOutsideClickHandler(outsideClickHandler);
    document.addEventListener('click', outsideClickHandler);

    search?.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      const groups = optionList?.querySelectorAll('.rs-film-group') || [];
      groups.forEach(group => {
        let groupHasMatch = false;
        group.querySelectorAll('.rs-film-option').forEach(opt => {
          const tokens = opt.dataset.search || '';
          const match = !q || tokens.includes(q);
          opt.hidden = !match;
          if (match) groupHasMatch = true;
        });
        group.hidden = !groupHasMatch;
      });
    });

    optionList?.addEventListener('click', (e) => {
      const opt = e.target.closest('.rs-film-option');
      if (!opt) return;
      const name = opt.dataset.filmName || '';
      optionList.querySelectorAll('.rs-film-option.is-selected').forEach(el => el.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      if (selectedLabel) selectedLabel.textContent = name;
      if (filmInput) filmInput.value = name;
      setMode('catalog');
      closeDropdown();
      syncThemeCheckbox(name);
    });

    reqToggle?.addEventListener('click', () => {
      setMode('request');
      closeDropdown();
      optionList?.querySelectorAll('.rs-film-option.is-selected').forEach(el => el.classList.remove('is-selected'));
      if (selectedLabel) selectedLabel.textContent = '필름을 선택해 주세요';
      if (filmInput) filmInput.value = reqInput?.value?.trim() || '';
      setTimeout(() => reqInput?.focus(), 50);
      syncThemeCheckbox(filmInput?.value || '');
    });

    reqInput?.addEventListener('input', () => {
      if (filmInput) filmInput.value = reqInput.value.trim();
      syncThemeCheckbox(reqInput.value.trim());
    });

    reqCancel?.addEventListener('click', () => {
      setMode('catalog');
      if (reqInput) reqInput.value = '';
      if (filmInput) filmInput.value = '';
      syncThemeCheckbox('');
    });

    return {
      syncThemeCheckbox,
      closeDropdown,
    };
  }

  window.ReaderFilmPicker = {
    bindFilmPicker,
  };
})();
