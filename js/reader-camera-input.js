(function () {
  'use strict';

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

  function prettifyCameraKey(brand, key) {
    if (!key) return '';
    let s = String(key).replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2');
    s = s.toUpperCase();
    s = s.replace(/\bTTL\b/g, 'TTL').replace(/\bMD\b/g, 'MD');
    const bl = brand ? (brand.charAt(0).toUpperCase() + brand.slice(1)) : '';
    return bl ? `${bl} ${s}` : s;
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
    const escapeHtml = options.escapeHtml || ((v) => String(v));
    const escapeAttr = options.escapeAttr || escapeHtml;
    const recent = readRecentCameras(options);
    if (!recent.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<span class="rs-recent-cameras-label">최근 사용</span>'
      + recent.map(camera => `<button type="button" class="rs-recent-camera" data-camera="${escapeAttr(camera)}">${escapeHtml(camera)}</button>`).join('');
    container.hidden = false;
  }

  async function bindCameraInput(options = {}) {
    const input = document.getElementById('rs-camera-input');
    const recent = document.getElementById('rs-recent-cameras');
    const hint = document.getElementById('rs-camera-hint');
    if (!input) return;
    const escapeHtml = options.escapeHtml || ((v) => String(v));
    const escapeAttr = options.escapeAttr || escapeHtml;
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
        hint.innerHTML = '<span class="rs-camera-hint-label">혹시 이 카메라?</span> '
          + matches.map(m => {
              const formatted = formatCameraName(m);
              const labelHtml = m.brand
                ? `<span class="rs-cam-hint-brand">${escapeHtml(brandLabel(m.brand))}</span> · ${escapeHtml(m.display)}`
                : escapeHtml(m.display);
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
