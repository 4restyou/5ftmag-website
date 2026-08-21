// 필름 표기를 카탈로그에서 골라 넣는 모달.
//
// 예전에는 관리자 화면에서 prompt() 로 직접 타이핑했다. 그러다 보니 카탈로그에
// 없는 표기가 들어가고("Kodak Vision3 50d"), 그런 사진은 어느 필름에도 붙지
// 않아 고쳤는데도 카탈로그에서 그대로인 것처럼 보였다. 목록에서 고르게 한다.
//
// 관리자 투고 검토 화면과 공개 카탈로그(편집부 로그인 시) 양쪽에서 쓴다.
// 마크업과 스타일은 처음 열 때 직접 만들어 붙이므로 페이지에 넣을 것이 없다.
//
//   const name = await window.FilmNamePicker.open({ films, current });
//   // 고르면 카탈로그의 정식 표기, 취소하면 null

(function () {
  'use strict';

  const STYLE_ID = 'fnp-style';
  const ROOT_ID = 'fnp-root';
  const MAX_SHOWN = 60;

  // films-utils 의 normalizeFilmLabel 과 같은 규칙. 그 파일이 로드되지 않은
  // 페이지에서도 쓰이므로 여기서 자체적으로 판정한다.
  function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const CSS = `
.fnp-backdrop { position: fixed; inset: 0; z-index: 3200; background: rgba(0,0,0,.45);
  display: flex; align-items: flex-start; justify-content: center; padding: 8vh 16px; }
.fnp-backdrop[hidden] { display: none; }
.fnp-panel { background: var(--bg, #fff); border: 1px solid var(--border, #e0e0e0);
  width: 100%; max-width: 520px; max-height: 76vh; display: flex; flex-direction: column;
  border-radius: 4px; color: var(--text, #000); }
.fnp-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--border, #e0e0e0); }
.fnp-head h2 { margin: 0 0 4px; font-size: 16px; font-weight: var(--fw-heading, 700); }
.fnp-head p { margin: 0; font-size: 12px; color: var(--text-muted, #666); }
.fnp-search { width: 100%; margin-top: 12px; padding: 9px 11px; font: inherit; font-size: 14px;
  border: 1px solid var(--border, #e0e0e0); border-radius: 3px;
  background: var(--bg, #fff); color: var(--text, #000); }
.fnp-list { overflow-y: auto; padding: 6px 0; flex: 1; }
.fnp-item { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 9px 18px;
  border: 0; background: none; cursor: pointer; font: inherit; text-align: left; color: inherit; }
.fnp-item:hover, .fnp-item.is-active { background: var(--bg-sub, #f4f4f4); }
.fnp-item-name { font-weight: var(--fw-heading, 700); font-size: 14px; }
.fnp-item-spec { font-size: 11px; color: var(--text-muted, #666); margin-left: auto; white-space: nowrap; }
.fnp-empty { padding: 18px; font-size: 13px; color: var(--text-muted, #666); line-height: 1.6; }
.fnp-foot { padding: 12px 18px; border-top: 1px solid var(--border, #e0e0e0);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.fnp-warn { font-size: 12px; color: #b91c1c; flex: 1 1 100%; margin: 0; line-height: 1.5; }
.fnp-btn { font: inherit; font-size: 13px; padding: 7px 14px; cursor: pointer;
  border: 1px solid var(--border, #e0e0e0); background: none; color: inherit; border-radius: 3px; }
.fnp-btn:disabled { opacity: .45; cursor: default; }
`;

  function ensureDom() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'fnp-backdrop';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '필름 고르기');
    root.innerHTML = `
      <div class="fnp-panel">
        <div class="fnp-head">
          <h2>필름 고르기</h2>
          <p>카탈로그에 있는 이름으로 골라야 사진이 그 필름에 붙습니다.</p>
          <input type="text" class="fnp-search" placeholder="필름 이름으로 검색 (예: 포트라, vision, 400)" autocomplete="off" />
        </div>
        <div class="fnp-list"></div>
        <div class="fnp-foot">
          <p class="fnp-warn" hidden></p>
          <button type="button" class="fnp-btn" data-fnp="cancel">취소</button>
          <button type="button" class="fnp-btn" data-fnp="raw">입력한 그대로 저장</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function open({ films, current } = {}) {
    const root = ensureDom();
    const search = root.querySelector('.fnp-search');
    const list = root.querySelector('.fnp-list');
    const warn = root.querySelector('.fnp-warn');
    const rawBtn = root.querySelector('[data-fnp="raw"]');
    const cancelBtn = root.querySelector('[data-fnp="cancel"]');

    const entries = Object.entries(films || {}).map(([slug, film]) => ({
      name: film.displayName || film.name || slug,
      spec: [film.brand, film.iso && `ISO ${film.iso}`, film.format].filter(Boolean).join(' · '),
      haystack: [film.displayName, film.name, film.brand, slug, ...(film.aliases || [])]
        .filter(Boolean).join(' ').toLowerCase(),
      keys: [film.displayName, film.name, ...(film.aliases || [])].filter(Boolean).map(normalize),
    })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    const matchesCatalog = (typed) => {
      const q = normalize(typed);
      return !!q && entries.some((entry) => entry.keys.includes(q));
    };

    let shown = [];
    let active = 0;

    function render() {
      // 낱말 단위로 찾는다. "kodak vision 250d" 처럼 띄어쓰기가 카탈로그 표기와
      // 달라도 걸리게 하려는 것이다(카탈로그는 "Kodak Vision3 250D").
      const tokens = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      shown = (tokens.length
        ? entries.filter((entry) => tokens.every((token) => entry.haystack.includes(token)))
        : entries).slice(0, MAX_SHOWN);
      active = 0;
      list.innerHTML = shown.length
        ? shown.map((entry, i) => `<button type="button" class="fnp-item${i === 0 ? ' is-active' : ''}" data-i="${i}">
            <span class="fnp-item-name">${esc(entry.name)}</span>
            <span class="fnp-item-spec">${esc(entry.spec)}</span>
          </button>`).join('')
        : '<p class="fnp-empty">카탈로그에 없는 필름입니다. 그대로 저장하면 이 사진은 카탈로그의 어느 필름에도 붙지 않습니다.</p>';
      const typed = search.value.trim();
      warn.hidden = !typed || matchesCatalog(typed);
      if (!warn.hidden) warn.textContent = '이 표기는 카탈로그의 필름과 맞지 않습니다. 그대로 저장하면 카탈로그에 나타나지 않습니다.';
      rawBtn.disabled = !typed;
    }

    function setActive(next) {
      if (!shown.length) return;
      active = (next + shown.length) % shown.length;
      const items = list.querySelectorAll('.fnp-item');
      items.forEach((el, i) => el.classList.toggle('is-active', i === active));
      items[active]?.scrollIntoView({ block: 'nearest' });
    }

    return new Promise((resolve) => {
      function close(value) {
        root.hidden = true;
        search.removeEventListener('input', render);
        search.removeEventListener('keydown', onKey);
        list.removeEventListener('click', onClick);
        cancelBtn.removeEventListener('click', onCancel);
        rawBtn.removeEventListener('click', onRaw);
        root.removeEventListener('click', onBackdrop);
        resolve(value);
      }
      function onCancel() { close(null); }
      function onRaw() { const v = search.value.trim(); if (v) close(v); }
      function onBackdrop(event) { if (event.target === root) close(null); }
      function onClick(event) {
        const item = event.target.closest('[data-i]');
        if (item) close(shown[Number(item.dataset.i)].name);
      }
      function onKey(event) {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
        else if (event.key === 'Enter') { event.preventDefault(); if (shown[active]) close(shown[active].name); }
        else if (event.key === 'Escape') { event.preventDefault(); close(null); }
      }

      search.value = current || '';
      render();
      root.hidden = false;
      search.focus();
      search.select();
      search.addEventListener('input', render);
      search.addEventListener('keydown', onKey);
      list.addEventListener('click', onClick);
      cancelBtn.addEventListener('click', onCancel);
      rawBtn.addEventListener('click', onRaw);
      root.addEventListener('click', onBackdrop);
    });
  }

  window.FilmNamePicker = { open };
})();
