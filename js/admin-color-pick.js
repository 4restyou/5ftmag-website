'use strict';

// 관리 화면 공용 — 책장 색(책등·배경, 박) 직접 지정 + 표지 스포이드.
// 값이 비면 공개 화면이 표지에서 자동으로 뽑고, 값이 있으면 그 색을 쓴다.
// 스포이드는 표지를 캔버스에 그려 클릭한 픽셀을 읽는다(브라우저 EyeDropper API 는 사파리에 없어서 쓰지 않는다).
// 사용: AdminColorPick.mount({ root, fields: { spine: input, foil: input }, getImageSrc })
(function () {
  const CSS = `
  .cp { display: grid; gap: 8px; }
  .cp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cp-name { font-size: 13px; min-width: 64px; color: var(--text); }
  .cp-swatch { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); flex: 0 0 auto; }
  .cp-swatch.is-auto { background: repeating-linear-gradient(45deg, var(--bg-sub) 0 4px, var(--border) 4px 6px); }
  .cp input[type="text"] { width: 96px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .cp button { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; }
  .cp button:hover { background: var(--bg-sub); }
  .cp button.is-armed { background: var(--text); color: var(--bg); }
  .cp-preview { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 2px; padding: 0 14px; width: 260px; height: 34px; border-radius: 3px;
    background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.04) 30%, rgba(0,0,0,.1) 65%, rgba(0,0,0,.4)), var(--cp-bg, #444); color: var(--cp-fg, #eee); font-size: 12px; font-weight: 600; letter-spacing: .01em; }
  .cp-preview i { font-style: italic; font-weight: 400; opacity: .85; }
  .cp-warn { font-size: 12px; color: #c00; min-height: 16px; }
  .cp-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,.72); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; }
  .cp-overlay canvas { max-width: min(92vw, 420px); max-height: 70vh; cursor: crosshair; box-shadow: 0 20px 60px rgba(0,0,0,.5); background: #fff; }
  .cp-overlay p { margin: 0; color: #fff; font-size: 14px; }
  .cp-overlay button { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.5); background: none; color: #fff; cursor: pointer; }`;

  function hex6(v) {
    const m = String(v || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
    return m ? '#' + m[1].toLowerCase() : '';
  }
  function lum(h) { const n = parseInt(h.slice(1), 16); return ((n >> 16 & 255) * 299 + (n >> 8 & 255) * 587 + (n & 255) * 114) / 255000; }

  function mount({ root, fields, getImageSrc }) {
    if (!root || !fields) return;
    if (!document.getElementById('cp-style')) { const st = document.createElement('style'); st.id = 'cp-style'; st.textContent = CSS; document.head.appendChild(st); }
    root.classList.add('cp');
    const preview = root.querySelector('.cp-preview');
    const warn = root.querySelector('.cp-warn');

    function refresh() {
      Object.entries(fields).forEach(([key, input]) => {
        const sw = root.querySelector(`.cp-swatch[data-swatch="${key}"]`);
        const v = hex6(input.value);
        if (sw) { sw.style.background = v || ''; sw.classList.toggle('is-auto', !v); }
      });
      const spine = hex6(fields.spine.value), foil = hex6(fields.foil.value);
      if (preview) {
        preview.style.setProperty('--cp-bg', spine || '#5a5a66');
        preview.style.setProperty('--cp-fg', foil || (spine && lum(spine) > .56 ? '#1a1a1a' : '#f2e9c9'));
        preview.style.opacity = (spine || foil) ? '1' : '.6';
      }
      if (warn) warn.textContent = (spine && foil && Math.abs(lum(spine) - lum(foil)) < .22) ? '책등 색과 박 색의 밝기 차가 작아 글씨가 잘 안 읽힐 수 있어요.' : '';
    }

    function pickFromCover(target) {
      const src = typeof getImageSrc === 'function' ? getImageSrc() : '';
      if (!src) { if (warn) warn.textContent = '표지 이미지를 먼저 올려 주세요.'; return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ov = document.createElement('div'); ov.className = 'cp-overlay';
        const cv = document.createElement('canvas');
        const scale = Math.min(1, 420 / img.naturalWidth, (window.innerHeight * .7) / img.naturalHeight);
        cv.width = Math.max(1, Math.round(img.naturalWidth * scale)); cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const p = document.createElement('p'); p.textContent = '표지에서 색을 찍을 지점을 클릭하세요';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소';
        ov.append(cv, p, cancel); document.body.appendChild(ov);
        const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        cancel.addEventListener('click', close);
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        cv.addEventListener('click', (e) => {
          const r = cv.getBoundingClientRect();
          const x = Math.floor((e.clientX - r.left) / r.width * cv.width), y = Math.floor((e.clientY - r.top) / r.height * cv.height);
          try {
            const d = ctx.getImageData(x, y, 1, 1).data;
            fields[target].value = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            fields[target].dispatchEvent(new Event('input', { bubbles: true }));
          } catch (_) { if (warn) warn.textContent = '이 표지는 브라우저가 픽셀을 읽지 못하게 막혀 있어요. 색 코드를 직접 적어 주세요.'; }
          close();
        });
      };
      img.onerror = () => { if (warn) warn.textContent = '표지 이미지를 불러오지 못했어요.'; };
      img.src = src;
    }

    Object.values(fields).forEach(input => {
      input.addEventListener('input', refresh);
      input.addEventListener('change', () => {
        const raw = input.value.trim(), v = hex6(raw);
        input.value = v; refresh();
        if (raw && !v && warn) warn.textContent = `'${raw}' 는 색 코드가 아니어서 비웠어요. #rrggbb 형식으로 적거나 스포이드를 쓰세요.`;
      });
    });
    root.querySelectorAll('.cp-drop').forEach(btn => btn.addEventListener('click', () => pickFromCover(btn.dataset.target)));
    root.querySelectorAll('.cp-clear').forEach(btn => btn.addEventListener('click', () => { fields[btn.dataset.target].value = ''; refresh(); }));
    refresh();
    return { refresh };
  }

  // 관리 폼에 넣을 마크업. fields 의 name/id 는 페이지마다 다르므로 인자로 받는다.
  function markup({ spineId, foilId }) {
    return `
      <div class="hint">비우면 표지에서 자동으로 뽑습니다. 스포이드를 누른 뒤 표지에서 원하는 지점을 클릭하세요. 색 코드(#rrggbb)를 직접 적어도 됩니다.</div>
      <div class="cp-row"><span class="cp-swatch" data-swatch="spine"></span><span class="cp-name">책등·배경</span><input type="text" id="${spineId}" name="spine_color" placeholder="자동" maxlength="7" autocomplete="off" /><button type="button" class="cp-drop" data-target="spine">스포이드</button><button type="button" class="cp-clear" data-target="spine">자동</button></div>
      <div class="cp-row"><span class="cp-swatch" data-swatch="foil"></span><span class="cp-name">박(글씨)</span><input type="text" id="${foilId}" name="foil_color" placeholder="자동" maxlength="7" autocomplete="off" /><button type="button" class="cp-drop" data-target="foil">스포이드</button><button type="button" class="cp-clear" data-target="foil">자동</button></div>
      <div class="cp-preview" aria-hidden="true"><i>5ft.mag</i><span>책등 글씨</span><span></span></div>
      <div class="cp-warn" aria-live="polite"></div>`;
  }

  window.AdminColorPick = { mount, markup, hex6 };
})();
