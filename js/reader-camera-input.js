(function () {
  'use strict';
  const tr = window.i18n.t;

  function normalizeCameraLabel(s) {
    return String(s ?? '').trim().replace(/\s+/g, ' ');
  }

  function modelKeyHelper(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '');
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : Math.min(prev[j - 1], prev[j], curr[j - 1]) + 1;
      }
      prev = curr;
    }
    return prev[n];
  }

  function readRecentCameras({ recentKey, legacyMetaKey, limit }) {
    try {
      const rows = JSON.parse(localStorage.getItem(recentKey) || '[]');
      if (!Array.isArray(rows)) return [];
      if (!rows.length && legacyMetaKey) {
        try {
          const meta = JSON.parse(localStorage.getItem(legacyMetaKey) || '{}');
          if (meta.camera) rows.push(meta.camera);
        } catch {}
      }
      const seen = new Set();
      const out = [];
      for (const row of rows) {
        const label = normalizeCameraLabel(row);
        const key = label.toLowerCase();
        if (!label || seen.has(key)) continue;
        seen.add(key);
        out.push(label);
        if (out.length >= limit) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function saveRecentCamera(camera, options = {}) {
    const recentKey = options.recentKey || '5ft_recent_cameras';
    const legacyMetaKey = options.legacyMetaKey || '5ft_submission_meta';
    const limit = options.limit || 6;
    const label = normalizeCameraLabel(camera);
    if (!label) return;
    const next = [label]
      .concat(readRecentCameras({ recentKey, legacyMetaKey, limit }).filter(c => c.toLowerCase() !== label.toLowerCase()))
      .slice(0, limit);
    try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch {}
  }

  // 모델 키("fm2n", "eos5", "electro35gsn")를 읽기 좋은 이름으로 바꾼다.
  // 예전에는 글자와 숫자 사이마다 띄어 "FM 2 N" 처럼 나왔다. 실제 표기에 가깝게
  // 짧은 글자 묶음(FM·F·T·GSN)은 숫자에 붙여 대문자로, 긴 낱말(Electro·Retina)은
  // 띄어서 첫 글자만 대문자로 쓴다. 키에 브랜드가 들어 있으면 뺀다(nikonsp → SP).
  function prettifyCameraKey(brand, key) {
    if (!key) return '';
    let k = String(key).toLowerCase();
    const bk = String(brand || '').toLowerCase();
    if (bk && k !== bk) {
      if (k.startsWith(bk)) k = k.slice(bk.length);
      else if (k.endsWith(bk)) k = k.slice(0, -bk.length);
    }
    const parts = k.match(/[a-z\u00c0-\u024f]+|[0-9]+|[^a-z0-9\u00c0-\u024f]+/g) || [];
    let out = '';
    let prev = '';
    for (const part of parts) {
      const isWord = /^[a-z\u00c0-\u024f]+$/.test(part);
      const isNum = /^[0-9]+$/.test(part);
      // 로마 숫자: iiif → IIIF, retinaiia → Retina IIA, mjuii → Mju II
      const roman = isWord && /^(i{1,3}|iv|vi{0,3})[a-z]?$/.test(part);
      const tail = isWord && !roman ? part.match(/^([a-z\u00c0-\u024f]{3,}?)(i{2,3}|iv)([a-z]?)$/) : null;
      const longWord = isWord && !roman && part.length >= 4;
      const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
      const text = tail ? `${tail[1].length <= 3 ? tail[1].toUpperCase() : cap(tail[1])} ${(tail[2] + tail[3]).toUpperCase()}`
        : longWord ? cap(part) : part.toUpperCase();
      // 긴 낱말 앞뒤로만 띄운다. "EOS 5" 처럼 세 글자 이상 묶음 뒤 숫자도 띄운다.
      const prevLong = /^[a-z\u00c0-\u024f]{3,}$/.test(prev);
      const space = out && (longWord || (isNum && prevLong) || /^[a-z\u00c0-\u024f]{4,}$/.test(prev));
      out += (space ? ' ' : '') + text;
      prev = part;
    }
    const bl = brand ? (brand.charAt(0).toUpperCase() + brand.slice(1)) : '';
    return bl ? `${bl} ${out}`.trim() : out;
  }

  let cachedCameraList = null;
  async function buildCameraList() {
    if (cachedCameraList) return cachedCameraList;
    if (!window.normalizeCamera || !window.MagDB) return [];
    let subs = [];
    try { subs = await window.MagDB.submissions.listApproved(2000); } catch (_) { return []; }

    const buckets = new Map();
    for (const s of subs) {
      const cam = s.camera || '';
      if (!cam.trim()) continue;
      const n = window.normalizeCamera(cam);
      if (!n.key) continue;
      if (!buckets.has(n.key)) buckets.set(n.key, { originals: [], brand: n.brand || null });
      const b = buckets.get(n.key);
      b.originals.push(n.original);
      if (!b.brand && n.brand) b.brand = n.brand;
    }

    if (window.MagDB.cameraOverrides) {
      let overrides = null;
      try { overrides = await window.MagDB.cameraOverrides.list(); } catch (_) {}
      if (overrides && overrides.size) {
        for (const [aliasKey, o] of overrides) {
          if (!o.alias_of || !buckets.has(aliasKey)) continue;
          if (!buckets.has(o.alias_of)) buckets.set(o.alias_of, { originals: [], brand: o.brand || null });
          const target = buckets.get(o.alias_of);
          target.originals = target.originals.concat(buckets.get(aliasKey).originals);
          if (!target.brand && o.brand) target.brand = o.brand;
          buckets.delete(aliasKey);
        }
        for (const [key, o] of overrides) {
          if (o.alias_of) continue;
          if (!buckets.has(key)) continue;
          const b = buckets.get(key);
          b.brand = o.brand || b.brand;
          if (o.display) b.overrideDisplay = o.display;
        }
      }
    }

    const pickDisplay = window.pickCameraDisplay || ((arr) => arr[0] || '');
    const list = [];
    for (const [key, b] of buckets) {
      const display = b.overrideDisplay || pickDisplay(b.originals);
      if (!display) continue;
      list.push({ key, display, brand: b.brand || '' });
    }

    if (Array.isArray(window.MODEL_BRAND_HINTS)) {
      const seenKeys = new Set(list.map(c => c.key));
      for (const hint of window.MODEL_BRAND_HINTS) {
        const brandText = hint.brand || '';
        for (const m of (hint.models || [])) {
          const k = typeof m === 'string' ? m : (m && m.key);
          const explicit = typeof m === 'object' && m && m.display ? m.display : null;
          if (!k) continue;
          const mk = modelKeyHelper(k);
          if (!mk || seenKeys.has(mk)) continue;
          const display = explicit || prettifyCameraKey(brandText, k);
          list.push({ key: mk, display, brand: brandText });
          seenKeys.add(mk);
        }
      }
    }

    list.sort((a, b) => {
      if (!a.brand && b.brand) return 1;
      if (a.brand && !b.brand) return -1;
      const bc = (a.brand || '').localeCompare(b.brand || '', 'en');
      if (bc !== 0) return bc;
      return a.display.localeCompare(b.display, 'en');
    });
    cachedCameraList = list;
    return list;
  }

  function brandLabel(b) {
    if (!b) return '';
    return b.charAt(0).toUpperCase() + b.slice(1);
  }

  function formatCameraName(c) {
    if (!c || !c.display) return '';
    const bl = brandLabel(c.brand);
    if (!bl) return c.display;
    if (c.display.toLowerCase().includes(c.brand.toLowerCase())) return c.display;
    return `${bl} ${c.display}`;
  }

  function similarCameras(query, list, max = 4) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const qKey = modelKeyHelper(q);
    const scored = [];
    for (const c of list) {
      const formatted = formatCameraName(c);
      const d = formatted.toLowerCase();
      const display = c.display.toLowerCase();
      const brand = (c.brand || '').toLowerCase();
      const key = modelKeyHelper(c.key || '');
      const displayKey = modelKeyHelper(display);
      const formattedKey = modelKeyHelper(d);
      let score = -1;
      if (d === q || display === q || key === qKey || displayKey === qKey || formattedKey === qKey) score = 0;
      else if (key.startsWith(qKey)) score = 0;
      else if (displayKey.startsWith(qKey)) score = 0;
      else if (formattedKey.startsWith(qKey)) score = 0;
      else if (key.includes(qKey) || displayKey.includes(qKey) || formattedKey.includes(qKey)) score = 1;
      else if (d.startsWith(q)) score = 0;
      else if (display.startsWith(q)) score = 1;
      else if (brand && brand.startsWith(q)) score = 2;
      else if (d.includes(q) || display.includes(q) || q.includes(d)) score = Math.abs(d.length - q.length) + 4;
      else {
        const lev = levenshtein(q, d);
        const threshold = Math.min(3, Math.max(1, Math.floor(Math.max(q.length, d.length) * 0.35)));
        if (lev <= threshold) score = lev;
      }
      if (score >= 0) scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, max).map(s => s.c);
  }

  function renderRecentCameraChips(container, input, options) {
    if (!container || !input) return;
    const escapeHtml = options.escapeHtml || window.MagUtil.escapeHtml;
    const escapeAttr = options.escapeAttr || window.MagUtil.escapeAttr;
    const recent = readRecentCameras(options);
    if (!recent.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<span class="rs-recent-cameras-label">${tr('최근 사용', 'Recent', '最近使用')}</span>`
      + recent.map(camera => `<button type="button" class="rs-recent-camera" data-camera="${escapeAttr(camera)}">${escapeHtml(camera)}</button>`).join('');
    container.hidden = false;
  }

  async function bindCameraInput(options = {}) {
    // 내 정보의 사진 수정 칸처럼 한 화면에 여럿일 땐 요소를 직접 넘긴다.
    const input = options.input || document.getElementById('rs-camera-input');
    const recent = options.recent || document.getElementById('rs-recent-cameras');
    const hint = options.hint || document.getElementById('rs-camera-hint');
    if (!input) return;
    const escapeHtml = options.escapeHtml || window.MagUtil.escapeHtml;
    const escapeAttr = options.escapeAttr || window.MagUtil.escapeAttr;
    const list = await buildCameraList();

    renderRecentCameraChips(recent, input, options);
    recent?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-camera]');
      if (!btn) return;
      input.value = btn.dataset.camera || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });

    if (!hint) return;
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const v = input.value.trim();
        if (!v) { hint.hidden = true; return; }
        const matches = similarCameras(v, list, 6);
        if (!matches.length) { hint.hidden = true; return; }
        hint.innerHTML = `<span class="rs-camera-hint-label">${tr('혹시 이 카메라?', 'Did you mean?', 'このカメラですか？')}</span> `
          + matches.map(m => {
              const formatted = formatCameraName(m);
              // 이름에 이미 브랜드가 들어 있어 따로 붙이지 않는다("NIKON · Nikon FM" 중복).
              const labelHtml = escapeHtml(formatted);
              return `<button type="button" class="rs-cam-hint-btn" data-pick="${escapeAttr(formatted)}">${labelHtml}</button>`;
            }).join(' ');
        hint.hidden = false;
      }, 200);
    });
    hint.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      input.value = btn.dataset.pick;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      hint.hidden = true;
      input.focus();
    });
  }

  window.ReaderCameraInput = {
    bindCameraInput,
    saveRecentCamera,
    normalizeCameraLabel,
    similarCameras,
  };
})();
