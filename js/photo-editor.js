// Reader's Roll 사진 올리기의 간단한 편집: 90° 회전, 수평 맞추기(±45°), 좌우 반전, 크롭.
//
// reader-upload-form-ui.js 의 미리보기 「편집」 버튼을 누를 때 이 파일을 불러와
// PhotoEditor.open(file) 을 부른다. 평소에는 싣지 않는다.
//   - 화면에서는 줄인 미리보기로 작업하고, 「적용」하면 원본에서 한 번만 자르고 돌린다.
//   - 결과는 긴 변 3200px 이하 JPEG(품질 0.95) File. 업로드 때 image-processor 가 다시 1600px 로 줄인다.
//     (iOS 의 캔버스 한도를 넘지 않게 원본 크기 그대로 만들지 않는다)
//   - 중복 사진 검사(지문)는 업로드 흐름이 원본 파일로 계산한다. 여기서는 손대지 않는다.
// 비율은 필름 포맷 이름으로 고른다. 기본은 「자유」. 가로/세로 버튼으로 비율을 뒤집는다.
// 수평 맞추기로 사진을 기울이면 자르기 틀이 사진 밖(빈 모서리)으로 나가지 않게 틀을 줄이고, 끌 때도 막는다.
(function () {
  'use strict';
  if (window.PhotoEditor) return;
  const t = (window.i18n || { t: (ko) => ko }).t;
  const OUT_MAX = 3200;
  const PREVIEW_MAX = 1400;
  const MIN_PX = 40; // 미리보기에서 크롭 틀의 최소 한 변
  const MAX_ANGLE = 45;
  const DEG_PX = 10; // 다이얼 눈금 1° 의 간격(px). 끌기 감도는 1px = 0.1°

  // [키, 라벨, 가로/세로 비율(가로 기준)]. null = 제한 없음, 'orig' = 원본 비율
  const RATIOS = [
    ['free', () => t('자유', 'Free', 'フリー'), null],
    ['orig', () => t('원본', 'Original', 'オリジナル'), 'orig'],
    ['135', () => '35mm · 6×9', 3 / 2],
    ['half', () => t('하프 프레임', 'Half frame', 'ハーフ'), 24 / 17],
    ['110', () => '110 · 6×4.5', 4 / 3],
    ['66', () => '6×6', 1],
    ['67', () => '6×7', 5 / 4],
    ['612', () => '6×12', 2],
    ['617', () => '6×17', 3],
    ['xpan', () => 'XPan', 65 / 24], // 24×65mm, 약 2.71:1
  ];

  const ICON = {
    left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    flip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M8 7 3 17h5z"/><path d="M16 7l5 10h-5z"/></svg>',
    orient: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="12" height="9" rx="1.5"/><rect x="11" y="3" width="9" height="13" rx="1.5"/></svg>',
  };

  const CSS = `
.pe-dialog { position: fixed; inset: 0; margin: auto; width: min(760px, calc(100vw - 16px)); max-height: calc(100vh - 16px); height: fit-content;
  padding: 0; border: 0; border-radius: 14px; background: #111; color: #fff; overflow: hidden; }
.pe-dialog::backdrop { background: rgba(0,0,0,0.6); }
.pe-wrap { display: grid; grid-template-rows: auto auto auto; }
.pe-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: 15px; font-weight: 700; }
.pe-head small { font-weight: 400; color: #aaa; font-size: 12px; }
.pe-stage { position: relative; display: grid; place-items: center; background: #000; height: min(62vh, 520px); touch-action: none; user-select: none; -webkit-user-select: none; }
.pe-canvas-box { position: relative; line-height: 0; }
.pe-canvas-box canvas { display: block; max-width: 100%; }
.pe-crop { position: absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); outline: 1px solid rgba(255,255,255,0.9); cursor: move; }
.pe-crop::before, .pe-crop::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(to right, transparent 33.2%, rgba(255,255,255,0.35) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,0.35) 66.6%, transparent 66.8%); }
.pe-crop::after { background-image: linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,0.35) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255,255,255,0.35) 66.6%, transparent 66.8%); }
.pe-handle { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; touch-action: none; }
.pe-handle::after { content: ''; position: absolute; left: 9px; top: 9px; width: 10px; height: 10px; background: #fff; border-radius: 2px; }
.pe-handle[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.pe-handle[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.pe-handle[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.pe-handle[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.pe-tools { display: flex; align-items: center; gap: 6px; padding: 10px 12px 0; }
.pe-tools button { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; padding: 0 10px; border: 1px solid #333; border-radius: 8px; background: none; color: #fff; font: inherit; font-size: 13px; cursor: pointer; }
.pe-tools button[aria-pressed="true"] { background: #fff; color: #111; }
.pe-tools .pe-spacer { flex: 1; }
.pe-ratios { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px; scrollbar-width: none; }
.pe-ratios::-webkit-scrollbar { display: none; }
.pe-ratios button { flex: 0 0 auto; min-height: 36px; padding: 0 12px; border: 1px solid #333; border-radius: 999px; background: none; color: #ddd; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.pe-ratios button.is-active { background: #ffd400; border-color: #ffd400; color: #111; font-weight: 700; }
.pe-crop.is-straightening::before { background-image: repeating-linear-gradient(to right, rgba(255,255,255,0.3) 0 1px, transparent 1px 12.5%); }
.pe-crop.is-straightening::after { background-image: repeating-linear-gradient(to bottom, rgba(255,255,255,0.3) 0 1px, transparent 1px 12.5%); }
.pe-dial { position: relative; margin: 10px 12px 0; height: 54px; overflow: hidden; touch-action: none; cursor: ew-resize; outline: none; }
.pe-dial:focus-visible { box-shadow: inset 0 0 0 2px #ffd400; border-radius: 8px; }
.pe-dial-value { position: absolute; left: 50%; top: 0; transform: translateX(-50%); font-size: 13px; font-weight: 700; color: #ffd400; font-variant-numeric: tabular-nums; pointer-events: none; }
.pe-dial-ticks { position: absolute; left: 0; bottom: 6px; height: 18px; display: flex; align-items: flex-end; will-change: transform; pointer-events: none; }
.pe-dial-ticks i { flex: 0 0 ${DEG_PX}px; height: 8px; border-left: 1px solid #777; box-sizing: border-box; }
.pe-dial-ticks i.is-major { height: 16px; border-left-color: #ddd; }
.pe-dial-ticks i.is-zero { border-left: 2px solid #fff; }
.pe-dial::after { content: ''; position: absolute; left: 50%; bottom: 4px; width: 2px; height: 26px; margin-left: -1px; background: #ffd400; border-radius: 1px; }
.pe-dial .pe-dial-fade { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, #111, transparent 18%, transparent 82%, #111); z-index: 1; }
.pe-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 12px 14px; }
.pe-foot button { min-height: 42px; padding: 0 18px; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; border: 1px solid #444; background: none; color: #fff; }
.pe-foot .pe-apply { background: #fff; color: #111; border-color: #fff; font-weight: 700; }
.pe-foot .pe-apply:disabled { opacity: .5; cursor: default; }
`;

  function injectCss() {
    if (document.getElementById('photoEditorCss')) return;
    const style = document.createElement('style');
    style.id = 'photoEditorCss';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // 장면 그리기: 90° 회전된 좌표계(rw×rh, 원본 픽셀) 기준으로 가운데를 축으로 미세 각도(angle°)를 돌리고,
  // 좌우 반전(flip)한 뒤 90° 단위 회전(rot)으로 원본을 그린다. 미리보기와 적용이 같은 함수를 쓴다.
  function drawScene(ctx, bmp, st, rw, rh) {
    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(st.angle * Math.PI / 180);
    ctx.translate(-rw / 2, -rh / 2);
    if (st.flip) { ctx.translate(rw, 0); ctx.scale(-1, 1); }
    drawRotated(ctx, bmp, st.rot);
  }

  // 원본 이미지를 회전된 좌표계에 그린다. rot: 0·90·180·270(시계 방향)
  function drawRotated(ctx, bmp, rot) {
    const w = bmp.width, h = bmp.height;
    if (rot === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(bmp, 0, 0);
  }

  async function decode(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (_) { /* 아래 Image 태그로 */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img; // width/height 를 가진 그릴 수 있는 객체
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  function open(file) {
    return new Promise(async (resolve) => {
      injectCss();
      let bmp;
      try {
        bmp = await decode(file);
      } catch (_) {
        window.notify?.(t('이 사진은 편집할 수 없는 형식이에요. 편집 없이 올려 주세요.', 'This photo format can\'t be edited. Please upload it as is.', 'この写真の形式は編集できません。そのままアップロードしてください。'), 'danger');
        resolve(null);
        return;
      }
      const iw = bmp.width || bmp.naturalWidth, ih = bmp.height || bmp.naturalHeight;
      const state = { rot: 0, angle: 0, flip: false, ratio: 'free', portrait: false, crop: null, view: null };

      const dlg = document.createElement('dialog');
      dlg.className = 'pe-dialog';
      dlg.innerHTML = `
        <div class="pe-wrap">
          <div class="pe-head"><span>${t('사진 편집', 'Edit photo', '写真を編集')}</span><small>${t('틀을 끌어 자르고, 버튼으로 돌려요', 'Drag the frame to crop, use the buttons to rotate', '枠をドラッグして切り抜き、ボタンで回転')}</small></div>
          <div class="pe-stage"><div class="pe-canvas-box"><canvas></canvas>
            <div class="pe-crop"><span class="pe-handle" data-h="nw"></span><span class="pe-handle" data-h="ne"></span><span class="pe-handle" data-h="sw"></span><span class="pe-handle" data-h="se"></span></div>
          </div></div>
          <div class="pe-tools">
            <button type="button" data-act="left" aria-label="${t('왼쪽으로 90° 회전', 'Rotate 90° left', '左に90°回転')}">${ICON.left}</button>
            <button type="button" data-act="right" aria-label="${t('오른쪽으로 90° 회전', 'Rotate 90° right', '右に90°回転')}">${ICON.right}</button>
            <button type="button" data-act="flip" aria-pressed="false" aria-label="${t('좌우 반전', 'Flip horizontally', '左右反転')}">${ICON.flip}</button>
            <button type="button" data-act="orient" aria-pressed="false">${ICON.orient}<span>${t('세로', 'Portrait', '縦')}</span></button>
            <span class="pe-spacer"></span>
            <button type="button" data-act="reset">${t('되돌리기', 'Reset', 'リセット')}</button>
          </div>
          <div class="pe-dial" role="slider" tabindex="0" aria-label="${t('수평 맞추기', 'Straighten', '水平補正')}" aria-valuemin="-45" aria-valuemax="45" aria-valuenow="0" title="${t('끌어서 기울이기 · 두 번 누르면 0°', 'Drag to tilt · double-tap for 0°', 'ドラッグで傾き調整 · ダブルタップで0°')}">
            <span class="pe-dial-value">0°</span><div class="pe-dial-ticks"></div><span class="pe-dial-fade"></span>
          </div>
          <div class="pe-ratios" role="group" aria-label="${t('자르기 비율', 'Crop ratio', '切り抜き比率')}">
            ${RATIOS.map(([k, label]) => `<button type="button" data-ratio="${k}"${k === 'free' ? ' class="is-active"' : ''}>${label()}</button>`).join('')}
          </div>
          <div class="pe-foot">
            <button type="button" data-act="cancel">${t('취소', 'Cancel', 'キャンセル')}</button>
            <button type="button" class="pe-apply" data-act="apply">${t('적용', 'Apply', '適用')}</button>
          </div>
        </div>`;
      document.body.appendChild(dlg);
      const stage = dlg.querySelector('.pe-stage');
      const canvas = dlg.querySelector('canvas');
      const cropEl = dlg.querySelector('.pe-crop');
      const orientBtn = dlg.querySelector('[data-act="orient"]');
      const flipBtn = dlg.querySelector('[data-act="flip"]');
      const dial = dlg.querySelector('.pe-dial');
      const dialTicks = dial.querySelector('.pe-dial-ticks');
      const dialValue = dial.querySelector('.pe-dial-value');
      dialTicks.innerHTML = Array.from({ length: MAX_ANGLE * 2 + 1 }, (_, i) => {
        const d = i - MAX_ANGLE;
        return `<i class="${d === 0 ? 'is-zero' : d % 5 === 0 ? 'is-major' : ''}"></i>`;
      }).join('');

      function paintDial() {
        const a = Math.round(state.angle * 10) / 10;
        dialValue.textContent = `${a > 0 ? '+' : ''}${a.toFixed(Number.isInteger(a) ? 0 : 1)}°`;
        dial.setAttribute('aria-valuenow', String(a));
        // 0° 눈금(왼쪽에서 MAX_ANGLE 번째)이 가운데 표시선에 오도록 옮기고, 각도만큼 반대로 민다
        const x = dial.clientWidth / 2 - MAX_ANGLE * DEG_PX - state.angle * DEG_PX;
        dialTicks.style.transform = `translateX(${x}px)`;
      }
      function setAngle(next) {
        let a = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, next));
        if (Math.abs(a) < 0.25) a = 0; // 0° 근처에서 살짝 걸리게
        a = Math.round(a * 10) / 10;
        if (a === state.angle) return;
        state.angle = a;
        renderPreview();
        shrinkToFit();
        paintCrop();
        paintDial();
      }
      let dialDrag = null;
      dial.addEventListener('pointerdown', (e) => {
        dialDrag = { x: e.clientX, start: state.angle };
        dial.setPointerCapture(e.pointerId);
        cropEl.classList.add('is-straightening');
      });
      dial.addEventListener('pointermove', (e) => {
        if (!dialDrag) return;
        setAngle(dialDrag.start - (e.clientX - dialDrag.x) / DEG_PX);
      });
      const endDial = () => { dialDrag = null; cropEl.classList.remove('is-straightening'); };
      dial.addEventListener('pointerup', endDial);
      dial.addEventListener('pointercancel', endDial);
      dial.addEventListener('dblclick', () => setAngle(0));
      dial.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 1 : 0.1;
        if (e.key === 'ArrowLeft') { e.preventDefault(); setAngle(state.angle - step); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setAngle(state.angle + step); }
        else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); setAngle(0); }
      });

      // 회전된 이미지의 크기
      const rotSize = () => (state.rot % 180 ? { w: ih, h: iw } : { w: iw, h: ih });

      // 미리보기 캔버스를 무대 크기에 맞춰 다시 그린다
      function renderPreview() {
        const { w, h } = rotSize();
        const box = stage.getBoundingClientRect();
        const maxW = Math.max(100, box.width - 24), maxH = Math.max(100, box.height - 24);
        const s = Math.min(maxW / w, maxH / h, PREVIEW_MAX / Math.max(w, h));
        const cw = Math.round(w * s), ch = Math.round(h * s);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
        ctx.imageSmoothingQuality = 'high';
        drawScene(ctx, bmp, state, w, h);
        state.view = { cw, ch };
      }

      function currentRatio() {
        const entry = RATIOS.find(([k]) => k === state.ratio);
        let r = entry ? entry[2] : null;
        if (r === 'orig') { const { w, h } = rotSize(); r = w / h; return r; }
        if (r && state.portrait) r = 1 / r;
        return r;
      }

      // 틀의 네 모서리가 모두 (기울어진) 사진 안에 있는가. 미리보기 좌표 기준
      function fits(c) {
        const { cw, ch } = state.view;
        const a = -state.angle * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
        const ox = cw / 2, oy = ch / 2;
        // 기울였을 때는 경계에서 1px 안쪽까지만 허용한다(경계에 딱 붙으면 결과 모서리에 검은 테두리가 남는다)
        const e = state.angle ? -1 : 0.5;
        if (c.x < -0.5 || c.y < -0.5 || c.x + c.w > cw + 0.5 || c.y + c.h > ch + 0.5) return false;
        return [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].every(([px, py]) => {
          const dx = px - ox, dy = py - oy;
          const qx = dx * cos - dy * sin + ox, qy = dx * sin + dy * cos + oy;
          return qx >= -e && qx <= cw + e && qy >= -e && qy <= ch + e;
        });
      }
      // 틀을 제자리(가운데 기준)에서 사진 안에 들어올 때까지 줄인다. 가운데가 밖이면 사진 가운데로 옮긴다
      function shrinkToFit() {
        let c = state.crop;
        if (fits(c)) return;
        const scaled = (k, cx, cy) => ({ x: cx - c.w * k / 2, y: cy - c.h * k / 2, w: c.w * k, h: c.h * k });
        let cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        if (!fits(scaled(0.02, cx, cy))) { cx = state.view.cw / 2; cy = state.view.ch / 2; }
        let lo = 0, hi = 1;
        for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (fits(scaled(m, cx, cy))) lo = m; else hi = m; }
        state.crop = scaled(lo, cx, cy);
      }
      // 시작 틀 a 에서 바라는 틀 b 쪽으로 사진 밖에 나가지 않는 데까지만 옮긴다
      function clampToward(a, b) {
        if (fits(b)) return b;
        const mix = (k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });
        let lo = 0, hi = 1;
        for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (fits(mix(m))) lo = m; else hi = m; }
        return mix(lo);
      }

      // 비율에 맞는 가장 큰 틀을 가운데에 놓고, 기울어져 있으면 사진 안으로 줄인다
      function fitCrop() {
        const { cw, ch } = state.view;
        const r = currentRatio();
        if (!r) state.crop = { x: 0, y: 0, w: cw, h: ch };
        else {
          let w = cw, h = cw / r;
          if (h > ch) { h = ch; w = ch * r; }
          state.crop = { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
        }
        shrinkToFit();
      }

      function paintCrop() {
        const c = state.crop;
        Object.assign(cropEl.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
      }

      function relayout(keepFraction) {
        const prev = state.view, c = state.crop;
        renderPreview();
        if (keepFraction && prev && c) {
          const fx = state.view.cw / prev.cw, fy = state.view.ch / prev.ch;
          state.crop = { x: c.x * fx, y: c.y * fy, w: c.w * fx, h: c.h * fy };
        } else {
          fitCrop();
        }
        paintCrop();
      }

      // 끌기: 틀 이동(move) 또는 모서리(nw·ne·sw·se) 크기 조절
      let drag = null;
      cropEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const h = e.target.closest('.pe-handle')?.dataset.h || 'move';
        drag = { h, sx: e.clientX, sy: e.clientY, start: { ...state.crop } };
        cropEl.setPointerCapture(e.pointerId);
      });
      cropEl.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const { cw, ch } = state.view;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        const s = drag.start;
        if (drag.h === 'move') {
          const want = { ...s, x: Math.min(Math.max(0, s.x + dx), cw - s.w), y: Math.min(Math.max(0, s.y + dy), ch - s.h) };
          state.crop = clampToward(s, want);
        } else {
          // 반대쪽 모서리를 고정점으로 둔다
          const west = drag.h.includes('w'), north = drag.h.includes('n');
          const ax = west ? s.x + s.w : s.x, ay = north ? s.y + s.h : s.y;
          let w = Math.max(MIN_PX, west ? s.w - dx : s.w + dx);
          let h = Math.max(MIN_PX, north ? s.h - dy : s.h + dy);
          const maxW = west ? ax : cw - ax, maxH = north ? ay : ch - ay;
          const r = currentRatio();
          if (r) {
            // 더 크게 움직인 쪽을 따르고 비율을 지킨다
            if (Math.abs(dx) >= Math.abs(dy)) h = w / r; else w = h * r;
            if (w > maxW) { w = maxW; h = w / r; }
            if (h > maxH) { h = maxH; w = h * r; }
          } else {
            w = Math.min(w, maxW); h = Math.min(h, maxH);
          }
          state.crop = clampToward(s, { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h });
        }
        paintCrop();
      });
      const endDrag = () => { drag = null; };
      cropEl.addEventListener('pointerup', endDrag);
      cropEl.addEventListener('pointercancel', endDrag);

      function finish(result) {
        window.removeEventListener('resize', onResize);
        dlg.close();
        dlg.remove();
        bmp.close?.();
        resolve(result);
      }

      async function apply() {
        const applyBtn = dlg.querySelector('.pe-apply');
        applyBtn.disabled = true;
        applyBtn.textContent = t('적용하는 중…', 'Applying…', '適用中…');
        try {
          const { cw, ch } = state.view;
          const { w: rw, h: rh } = rotSize();
          const c = state.crop;
          // 미리보기 좌표 → 회전된 원본 좌표
          const sx = c.x / cw * rw, sy = c.y / ch * rh, sw = c.w / cw * rw, sh = c.h / ch * rh;
          const scale = Math.min(1, OUT_MAX / Math.max(sw, sh));
          const out = document.createElement('canvas');
          out.width = Math.max(1, Math.round(sw * scale));
          out.height = Math.max(1, Math.round(sh * scale));
          // 비율이 고정이면 짧은 변을 긴 변/비율로 다시 맞춘다. 가로·세로를 따로 반올림하면 3:2 가 1px 어긋났다.
          const r = currentRatio();
          if (r) {
            if (out.width >= out.height) out.height = Math.max(1, Math.round(out.width / r));
            else out.width = Math.max(1, Math.round(out.height * r));
          }
          const ctx = out.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.scale(out.width / sw, out.height / sh);
          ctx.translate(-sx, -sy);
          drawScene(ctx, bmp, state, rw, rh);
          const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.95));
          if (!blob) throw new Error('encode failed');
          const name = String(file.name || 'photo').replace(/\.[^.]+$/, '') + '-edit.jpg';
          finish(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
        } catch (err) {
          applyBtn.disabled = false;
          applyBtn.textContent = t('적용', 'Apply', '適用');
          window.notify?.(t('편집을 적용하지 못했어요: ', 'Could not apply the edit: ', '編集を適用できませんでした: ') + (err?.message || ''), 'danger');
        }
      }

      dlg.addEventListener('click', (e) => {
        const ratioBtn = e.target.closest('[data-ratio]');
        if (ratioBtn) {
          state.ratio = ratioBtn.dataset.ratio;
          dlg.querySelectorAll('[data-ratio]').forEach((b) => b.classList.toggle('is-active', b === ratioBtn));
          fitCrop(); paintCrop();
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'left' || act === 'right') {
          state.rot = (state.rot + (act === 'right' ? 90 : 270)) % 360;
          relayout(false);
        } else if (act === 'flip') {
          state.flip = !state.flip;
          flipBtn.setAttribute('aria-pressed', String(state.flip));
          relayout(true);
          // 사진이 좌우로 뒤집혔으니 자르기 틀도 따라 뒤집는다(같은 부분을 계속 가리키게).
          // 기울기가 있으면 뒤집힌 자리가 사진 밖에 걸칠 수 있어 안으로 줄인다.
          state.crop = { ...state.crop, x: state.view.cw - state.crop.x - state.crop.w };
          shrinkToFit();
          paintCrop();
        } else if (act === 'orient') {
          state.portrait = !state.portrait;
          orientBtn.setAttribute('aria-pressed', String(state.portrait));
          fitCrop(); paintCrop();
        } else if (act === 'reset') {
          state.rot = 0; state.angle = 0; state.flip = false; state.ratio = 'free'; state.portrait = false;
          orientBtn.setAttribute('aria-pressed', 'false');
          flipBtn.setAttribute('aria-pressed', 'false');
          paintDial();
          dlg.querySelectorAll('[data-ratio]').forEach((b) => b.classList.toggle('is-active', b.dataset.ratio === 'free'));
          relayout(false);
        } else if (act === 'cancel') {
          finish(null);
        } else if (act === 'apply') {
          apply();
        }
      });
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      const onResize = () => { relayout(true); shrinkToFit(); paintCrop(); paintDial(); };
      window.addEventListener('resize', onResize);

      dlg.showModal();
      relayout(false);
      paintDial();
    });
  }

  window.PhotoEditor = { open };
})();
