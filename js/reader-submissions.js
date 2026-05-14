// 5ft.mag Reader's Roll 직접 제출 위젯
// 사용법:
//   <button data-action="open-submission">내 사진 올리기</button>
//   <script src="js/db-client.js"></script>
//   <script src="js/reader-submissions.js"></script>

(function () {
  'use strict';

  const MAX_LONG_SIDE = 2000;
  const JPEG_QUALITY = 0.85;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const LS_KEY = '5ft_submission_meta';
  const THEME_PATH = 'data/current-theme.json';
  const FILMS_PATH = 'data/films.json';
  const db = () => window.MagDB;

  // 한 번 fetch한 테마는 페이지 로딩 동안 캐시
  let _themePromise = null;
  function getCurrentTheme() {
    if (_themePromise) return _themePromise;
    // 현재 페이지가 stories/, admin/ 아래라면 상대 경로 보정
    const depth = (location.pathname.match(/\/(stories|admin)\//) ? '../' : './');
    _themePromise = fetch(depth + THEME_PATH, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    return _themePromise;
  }

  // 필름 목록(autocomplete용) — 한 번만 fetch
  let _filmsPromise = null;
  function getFilms() {
    if (_filmsPromise) return _filmsPromise;
    const depth = (location.pathname.match(/\/(stories|admin)\//) ? '../' : './');
    _filmsPromise = fetch(depth + FILMS_PATH, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
    return _filmsPromise;
  }

  // ════════════════════════════════════════════════════════════
  // 필름명 정규화 + 매칭 (films.html, admin과 공유)
  //  - 정규화: 소문자 + 공백/하이픈/언더스코어/괄호 등 제거 (Hangul은 그대로)
  //  - exact match: 정규화된 alias 집합에 hit
  //  - fuzzy match: 부분 포함 + Levenshtein 거리 ≤ 임계값
  // ════════════════════════════════════════════════════════════
  function normalizeFilmName(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  // films 객체에서 정규화된 alias → 필름 entry 매핑 빌드
  function buildAliasIndex(films) {
    const map = new Map();
    for (const slug of Object.keys(films || {})) {
      const f = films[slug];
      const all = (f.aliases || []).concat([f.displayName, f.name]).filter(Boolean);
      for (const a of all) {
        const k = normalizeFilmName(a);
        if (k && !map.has(k)) map.set(k, { slug, film: f });
      }
    }
    return map;
  }

  // Levenshtein 거리 (작은 입력에 최적, films 매칭 용도)
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

  // 사용자 입력 → 가장 그럴듯한 필름 후보
  //   - exact: alias 일치 → { type: 'exact', film, canonical }
  //   - fuzzy: 부분 포함 또는 Levenshtein ≤ 임계값 → { type: 'fuzzy', film, canonical, score }
  //   - none: null
  function findFilmMatch(input, films) {
    const q = normalizeFilmName(input);
    if (!q) return null;
    const aliasIndex = buildAliasIndex(films);

    // 1) Exact match (alias 집합 내)
    if (aliasIndex.has(q)) {
      const entry = aliasIndex.get(q);
      return { type: 'exact', film: entry.film, slug: entry.slug, canonical: entry.film.displayName || entry.film.name };
    }

    // 2) Fuzzy: 부분 포함(양방향) 우선, 그다음 Levenshtein
    const candidates = [];
    for (const [normAlias, entry] of aliasIndex) {
      const f = entry.film;
      // 너무 짧은 입력은 잘못된 매칭 위험 — 최소 길이 3 이상에서만 부분 매칭 인정
      if (q.length >= 3 && (normAlias.includes(q) || q.includes(normAlias))) {
        const score = Math.max(q.length, normAlias.length) - Math.min(q.length, normAlias.length);
        candidates.push({ entry, score });
        continue;
      }
      // Levenshtein 임계값: 입력 길이의 30% 또는 3 중 작은 값
      const threshold = Math.min(3, Math.max(1, Math.floor(q.length * 0.3)));
      const d = levenshtein(q, normAlias);
      if (d <= threshold) candidates.push({ entry, score: d });
    }
    if (!candidates.length) return null;
    // 가장 가까운 후보
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0].entry;
    return { type: 'fuzzy', film: best.film, slug: best.slug, canonical: best.film.displayName || best.film.name };
  }

  // 외부에서 사용할 수 있게 노출 (films.html, admin과 공유)
  window.normalizeFilmName = normalizeFilmName;
  window.buildFilmAliasIndex = buildAliasIndex;
  window.findFilmMatch = findFilmMatch;

  // ════════════════════════════════════════════════════════════
  // 캔버스 리사이즈 + JPEG 인코딩
  // ════════════════════════════════════════════════════════════
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function resizeToJpeg(file) {
    const img = await loadImage(file);
    let { width: w, height: h } = img;
    if (Math.max(w, h) > MAX_LONG_SIDE) {
      if (w >= h) { h = Math.round(h * MAX_LONG_SIDE / w); w = MAX_LONG_SIDE; }
      else        { w = Math.round(w * MAX_LONG_SIDE / h); h = MAX_LONG_SIDE; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('이미지 변환 실패'));
        resolve({ blob, width: w, height: h });
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }

  // ════════════════════════════════════════════════════════════
  // 모달 마크업
  // ════════════════════════════════════════════════════════════
  function createModal() {
    if (document.getElementById('rs-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'rs-modal';
    wrap.className = 'rs-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'rs-modal-title');
    wrap.innerHTML = `
      <div class="rs-modal-backdrop" data-action="rs-close"></div>
      <div class="rs-modal-card">
        <button type="button" class="rs-modal-close" data-action="rs-close" aria-label="닫기">✕</button>
        <div class="rs-modal-body">
          <!-- 채워짐 -->
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.action === 'rs-close') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.classList.contains('open')) closeModal();
    });
  }

  function openModal(html) {
    createModal();
    const wrap = document.getElementById('rs-modal');
    wrap.querySelector('.rs-modal-body').innerHTML = html;
    wrap.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const wrap = document.getElementById('rs-modal');
    if (wrap) wrap.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ════════════════════════════════════════════════════════════
  // 화면들
  // ════════════════════════════════════════════════════════════
  function renderLoginPrompt() {
    return `
      <h2 id="rs-modal-title" class="rs-title">사진 올리기</h2>
      <p class="rs-desc">
        로그인하면 지금 보던 화면으로 돌아와 사진 올리기를 이어갈 수 있어요.<br />
        사진은 편집부 검토 후 보통 24~48시간 안에 Reader's Roll에 반영됩니다.
      </p>
      <button type="button" class="rs-btn rs-btn-google" data-action="rs-login-google">
        <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.78 2.72v2.26h2.88c1.69-1.55 2.66-3.84 2.66-6.62z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.88-2.26c-.8.54-1.83.86-3.07.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.34A8.99 8.99 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.3-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0C5.48 0 2.44 2.02.96 4.96l3 2.34C4.67 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        Google로 계속하기
      </button>`;
  }

  function renderSubmissionForm(theme, prefillFilm, films) {
    const meta = (() => {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
      catch { return {}; }
    })();
    const themeIssue = theme?.issue || theme?.month || '다음 호';
    const themeFilm = theme?.film ? ` · 메인 필름: <strong>${escapeHtml(theme.film)}</strong>` : '';
    // 테마 main film 의 canonical 이름 — 체크박스 ↔ 필름 picker 바인딩 기준
    const themeCanonical = (() => {
      if (!theme?.film) return '';
      const m = findFilmMatch(theme.film, films);
      return m?.type === 'exact' ? m.canonical : theme.film;
    })();

    // 필름 카탈로그 → 브랜드별 그룹화 (알파벳 정렬)
    const filmsArr = Object.values(films || {});
    const byBrand = {};
    for (const f of filmsArr) {
      const b = f.brand || 'OTHER';
      if (!byBrand[b]) byBrand[b] = [];
      byBrand[b].push(f);
    }
    for (const b of Object.keys(byBrand)) {
      byBrand[b].sort((x, y) => (x.displayName || x.name || '').localeCompare(y.displayName || y.name || '', 'en', { numeric: true }));
    }
    const brandKeys = Object.keys(byBrand).sort((a, b) => a.localeCompare(b));

    // prefillFilm 이 카탈로그에 있는지 확인 (있으면 picker 선택 상태로 시작)
    let initialSelectedName = '';
    let initialRequestMode = false;
    let initialRequestText = '';
    if (prefillFilm) {
      const match = findFilmMatch(prefillFilm, films);
      if (match && match.type === 'exact') {
        initialSelectedName = match.canonical;
      } else {
        initialRequestMode = true;
        initialRequestText = prefillFilm;
      }
    } else if (meta.film) {
      const match = findFilmMatch(meta.film, films);
      if (match && match.type === 'exact') {
        initialSelectedName = match.canonical;
      }
    }

    // 응모 체크박스 초기 상태 — 선택된 필름이 테마 main film 과 일치할 때만 자동 체크.
    // (이후 picker 변경 시 bindFormHandlers 의 syncThemeCheckbox 가 동기화)
    const initialThemeChecked = !!(themeCanonical && initialSelectedName &&
      normalizeFilmName(initialSelectedName) === normalizeFilmName(themeCanonical));

    const themeBlock = (theme && theme.active) ? `
      <div class="rs-theme" data-theme-canonical="${escapeAttr(themeCanonical)}">
        <span class="rs-theme-tag">${escapeHtml(themeIssue)} 주제</span>
        <strong class="rs-theme-title">${escapeHtml(theme.title)}${theme.subtitle ? ` <small style="font-weight: var(--fw-all); color: inherit; opacity: 0.78;">— ${escapeHtml(theme.subtitle)}</small>` : ''}</strong>
        <p class="rs-theme-desc">${escapeHtml(theme.description || '')}${themeFilm}</p>
        <label class="rs-checkbox rs-theme-check">
          <input type="checkbox" name="theme_apply" value="${escapeAttr(theme.month)}"${initialThemeChecked ? ' checked' : ''} />
          <span>이 사진을 <strong>"${escapeHtml(theme.title)}"</strong> 주제 응모로 함께 보내기 — 우수작은 ${escapeHtml(themeIssue)} 종이 매거진 후보가 됩니다.</span>
        </label>
        ${themeCanonical ? `<p class="rs-theme-hint" id="rs-theme-hint" hidden>이번 호 응모는 <strong>${escapeHtml(themeCanonical)}</strong> 사진만 함께 보낼 수 있어요.</p>` : ''}
      </div>
    ` : '';

    const groupsHtml = brandKeys.map(brand => `
      <div class="rs-film-group">
        <div class="rs-film-group-label">${escapeHtml(brand)}</div>
        ${byBrand[brand].map(f => {
          const name = f.displayName || f.name;
          const searchTokens = [
            f.displayName, f.name, brand, f.iso,
            ...(f.aliases || [])
          ].filter(Boolean).join(' ').toLowerCase();
          return `
            <button type="button" class="rs-film-option${name === initialSelectedName ? ' is-selected' : ''}"
                    data-film-name="${escapeAttr(name)}"
                    data-search="${escapeAttr(searchTokens)}">
              <span class="rs-film-option-name">${escapeHtml(name)}</span>
              <span class="rs-film-option-iso">ISO ${escapeHtml(f.iso)}</span>
            </button>`;
        }).join('')}
      </div>`).join('');

    return `
      <h2 id="rs-modal-title" class="rs-title">사진 올리기</h2>
      <p class="rs-desc">한 컷을 보내주세요. 편집부 검토 후 Reader's Roll에 게시됩니다 (보통 24~48시간).</p>
      ${themeBlock}
      <form class="rs-form" id="rs-form">
        <label class="rs-field">
          <span class="rs-label">사진 <em>*</em></span>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required />
          <span class="rs-hint">JPG / PNG / WebP. 자동으로 웹용 크기로 줄여 업로드합니다.</span>
          <div class="rs-preview" id="rs-preview"></div>
        </label>
        <label class="rs-field">
          <span class="rs-label">이름 <small>(선택)</small></span>
          <input type="text" name="submitter_name" placeholder="인스타그램이 없을 때 표시할 이름" value="${escapeAttr(meta.submitterName || '')}" maxlength="40" autocomplete="name" />
        </label>
        <label class="rs-field">
          <span class="rs-label">인스타그램 ID <small>(선택)</small></span>
          <input type="text" name="instagram" placeholder="@your_id" value="${escapeAttr(meta.instagram || '')}" maxlength="60" autocomplete="off" />
          <span class="rs-hint">이름과 인스타그램 ID 중 하나는 꼭 입력해 주세요.</span>
        </label>

        <div class="rs-field">
          <span class="rs-label">필름 <em>*</em></span>
          <div class="rs-film-picker" id="rs-film-picker" data-mode="${initialRequestMode ? 'request' : 'catalog'}">
            <!-- 카탈로그 모드: picker 버튼 + 드롭다운 -->
            <button type="button" class="rs-film-trigger" id="rs-film-trigger" aria-haspopup="listbox" aria-expanded="false">
              <span class="rs-film-selected" id="rs-film-selected">${initialSelectedName ? escapeHtml(initialSelectedName) : '필름을 선택해 주세요'}</span>
              <span class="rs-film-caret" aria-hidden="true">▾</span>
            </button>
            <div class="rs-film-dropdown" id="rs-film-dropdown" hidden>
              <input type="text" class="rs-film-search" id="rs-film-search" placeholder="🔍 브랜드 · 필름명 · ISO 검색" autocomplete="off" />
              <div class="rs-film-list" id="rs-film-list" role="listbox">
                ${groupsHtml}
              </div>
              <button type="button" class="rs-film-request-toggle" id="rs-film-request-toggle">
                목록에 없어요 — 필름 신청하기 →
              </button>
            </div>
            <!-- 신청 모드: 자유 텍스트 입력 -->
            <div class="rs-film-request" id="rs-film-request">
              <input type="text" id="rs-film-request-input" placeholder="예: Foma Retropan 320" maxlength="80" value="${escapeAttr(initialRequestText)}" />
              <span class="rs-hint">목록에 없는 필름. 편집부 검토 후 라이브러리에 추가될 수 있어요.</span>
              <button type="button" class="rs-film-request-cancel" id="rs-film-request-cancel">← 목록에서 선택하기</button>
            </div>
            <!-- 실제 form value -->
            <input type="hidden" name="film" id="rs-film-input" value="${escapeAttr(initialSelectedName || initialRequestText)}" required />
          </div>
        </div>

        <label class="rs-field">
          <span class="rs-label">카메라 <small>(선택)</small></span>
          <input type="text" name="camera" placeholder="예: Pentax 17" value="${escapeAttr(meta.camera || '')}" maxlength="60" />
        </label>
        <label class="rs-field">
          <span class="rs-label">한 줄 메모 <small>(선택, 200자)</small></span>
          <textarea name="caption" rows="2" maxlength="200" placeholder="이 컷에 얽힌 짧은 이야기"></textarea>
        </label>
        <label class="rs-checkbox">
          <input type="checkbox" name="consent" required />
          <span>이 사진의 저작권은 본인에게 있으며, 5ft.mag 사이트 / SNS / 종이 매거진 게재에 동의합니다. <em>*</em></span>
        </label>
        <div class="rs-actions">
          <button type="button" class="rs-btn-link" data-action="rs-close">취소</button>
          <button type="submit" class="rs-btn rs-btn-primary">검토 요청 보내기</button>
        </div>
        <p class="rs-error" id="rs-error" aria-live="polite"></p>
      </form>`;
  }

  function renderSubmittedConfirm(meta) {
    // 페이지 깊이에 따라 me.html 상대 경로 보정
    const meHref = /\/(stories|admin)\//.test(location.pathname) ? '../me.html' : 'me.html';
    return `
      <h2 id="rs-modal-title" class="rs-title">제출 완료 🎞</h2>
      <p class="rs-desc">
        보내주신 한 컷 잘 받았습니다.<br />
        편집부 검토 후 Reader's Roll에 게시될 거예요 (보통 24~48시간).
      </p>
      <p class="rs-desc-sub">
        ${meta.author ? `<strong>${escapeHtml(meta.author)}</strong>` : ''}
        ${meta.author && meta.film ? ' · ' : ''}
        ${meta.film ? `필름: <strong>${escapeHtml(meta.film)}</strong>` : ''}
      </p>
      <div class="rs-actions" style="justify-content: center; gap: 12px;">
        <a href="${meHref}" class="rs-btn-link">내 사진 보기 →</a>
        <button type="button" class="rs-btn rs-btn-primary" data-action="rs-close">확인</button>
      </div>`;
  }

  // ════════════════════════════════════════════════════════════
  // 유틸
  // ════════════════════════════════════════════════════════════
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function showError(msg) {
    const el = document.getElementById('rs-error');
    if (el) el.textContent = msg;
  }

  // OAuth 복귀 후 모달 상태 복원용 keys
  //  - 5ft_prefill_film : 로그인 전 클릭한 필름명 복원용
  //  - 5ft_pending_submission_open : 로그인 후 폼 모달 자동 재진입 플래그
  const SS_PREFILL = '5ft_prefill_film';
  const SS_PENDING = '5ft_pending_submission_open';
  const LS_PREFILL = '5ft_prefill_film_fallback';
  const LS_PENDING = '5ft_pending_submission_open_fallback';

  function saveTransient(key, fallbackKey, value) {
    const payload = JSON.stringify({ value, ts: Date.now() });
    try { sessionStorage.setItem(key, payload); } catch {}
    try { localStorage.setItem(fallbackKey, payload); } catch {}
  }

  function readTransient(key, fallbackKey, { remove = true } = {}) {
    const maxAge = 10 * 60 * 1000;
    const read = (storage, storageKey) => {
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return '';
        if (remove) storage.removeItem(storageKey);
        const parsed = JSON.parse(raw);
        if (Date.now() - Number(parsed.ts || 0) > maxAge) return '';
        return parsed.value || '';
      } catch {
        return '';
      }
    };
    return read(sessionStorage, key) || read(localStorage, fallbackKey);
  }

  function clearTransient(key, fallbackKey) {
    try { sessionStorage.removeItem(key); } catch {}
    try { localStorage.removeItem(fallbackKey); } catch {}
  }

  async function handleOpen(triggerEl) {
    if (!db() || !db().isReady()) {
      alert('잠시 후 다시 시도해주세요.');
      return;
    }
    const prefillFilm = triggerEl?.dataset?.prefillFilm || '';
    const session = await db().auth.getSession();
    if (!session) {
      if (prefillFilm) saveTransient(SS_PREFILL, LS_PREFILL, prefillFilm);
      saveTransient(SS_PENDING, LS_PENDING, '1');
      openModal(renderLoginPrompt());
      return;
    }
    let savedPrefill = prefillFilm;
    if (!savedPrefill) {
      savedPrefill = readTransient(SS_PREFILL, LS_PREFILL);
    }
    const [theme, films] = await Promise.all([getCurrentTheme(), getFilms()]);
    openModal(renderSubmissionForm(theme, savedPrefill, films));
    bindFormHandlers(films);
  }

  async function handleLogin() {
    const redirect = window.location.href.split('#')[0];
    await db().auth.signInWithGoogle(redirect);
  }

  async function autoReopenIfPending() {
    const pending = readTransient(SS_PENDING, LS_PENDING, { remove: false }) === '1';
    if (!pending) return;

    for (let i = 0; i < 60; i++) {
      if (db() && db().isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!db() || !db().isReady()) return;

    let session = null;
    for (let i = 0; i < 40; i++) {
      session = await db().auth.getSession();
      if (session) break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (!session) {
      return;
    }
    clearTransient(SS_PENDING, LS_PENDING);
    handleOpen({ dataset: {} });
  }

  function bindFormHandlers(films) {
    const form = document.getElementById('rs-form');
    if (!form) return;

    // 미리보기
    const fileInput = form.querySelector('input[name="photo"]');
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      const preview = document.getElementById('rs-preview');
      if (!preview) return;
      preview.innerHTML = '';
      if (file) {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
      }
    });

    // 필름 picker — 카탈로그 모드 / 신청 모드
    const picker         = document.getElementById('rs-film-picker');
    const filmInput      = document.getElementById('rs-film-input'); // hidden, 실제 form value
    const trigger        = document.getElementById('rs-film-trigger');
    const selectedLabel  = document.getElementById('rs-film-selected');

    // 테마 응모 체크박스 — 선택된 필름이 테마 main film 과 같을 때만 자동 체크.
    // 사용자가 수동 토글했어도 필름이 바뀌면 다시 동기화 (혼동 방지 — 매번 의도 재확인).
    const themeRoot     = document.querySelector('.rs-theme');
    const themeCheckbox = themeRoot?.querySelector('input[name="theme_apply"]') || null;
    const themeHint     = document.getElementById('rs-theme-hint');
    const themeCanonical = themeRoot?.dataset?.themeCanonical || '';

    function filmMatchesTheme(filmName) {
      if (!themeCanonical || !filmName) return false;
      if (normalizeFilmName(filmName) === normalizeFilmName(themeCanonical)) return true;
      const m = findFilmMatch(filmName, films);
      return !!(m?.type === 'exact' &&
        normalizeFilmName(m.canonical) === normalizeFilmName(themeCanonical));
    }
    function syncThemeCheckbox(filmName) {
      if (!themeCheckbox) return;
      const match = filmMatchesTheme(filmName);
      // 필름이 바뀔 때마다 의도를 다시 묻는다 — 일치하면 ON, 아니면 OFF.
      // disabled 는 걸지 않음 — 사용자가 의도적으로 다시 체크해 응모할 여지는 남김.
      themeCheckbox.checked = match;
      if (themeHint) themeHint.hidden = match || !filmName;
    }
    // 초기 동기화 — render 시점에 calc 한 initialThemeChecked 와 정합
    syncThemeCheckbox(filmInput?.value || '');
    const dropdown       = document.getElementById('rs-film-dropdown');
    const search         = document.getElementById('rs-film-search');
    const optionList     = document.getElementById('rs-film-list');
    const reqToggle      = document.getElementById('rs-film-request-toggle');
    const reqInput       = document.getElementById('rs-film-request-input');
    const reqCancel      = document.getElementById('rs-film-request-cancel');

    function setMode(mode) {
      if (picker) picker.dataset.mode = mode; // 'catalog' | 'request'
    }

    function openDropdown() {
      if (!dropdown || !trigger) return;
      dropdown.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // 검색창 포커스 (모바일에서는 자동 키보드 방지 위해 timeout)
      setTimeout(() => search?.focus(), 50);
    }
    function closeDropdown() {
      if (!dropdown || !trigger) return;
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.hidden) openDropdown(); else closeDropdown();
    });
    // 모달 외부(폼 아닌 곳) 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (!picker || dropdown?.hidden) return;
      if (!picker.contains(e.target)) closeDropdown();
    });

    // 검색 필터
    search?.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      const groups = optionList.querySelectorAll('.rs-film-group');
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

    // 옵션 선택
    optionList?.addEventListener('click', (e) => {
      const opt = e.target.closest('.rs-film-option');
      if (!opt) return;
      const name = opt.dataset.filmName || '';
      // 이전 선택 해제
      optionList.querySelectorAll('.rs-film-option.is-selected').forEach(el => el.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      if (selectedLabel) selectedLabel.textContent = name;
      if (filmInput) filmInput.value = name;
      setMode('catalog');
      closeDropdown();
      syncThemeCheckbox(name);
    });

    // 신청 모드 토글
    reqToggle?.addEventListener('click', () => {
      setMode('request');
      closeDropdown();
      // 기존 catalog 선택 해제, hidden input 은 reqInput 값으로 동기화
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = '업로드 중…';

      try {
        const fd = new FormData(form);
        const file = fd.get('photo');
        if (!file || !file.size) throw new Error('올릴 사진을 1장 선택해 주세요.');
        if (!file.type.startsWith('image/')) throw new Error('JPG, PNG, WebP 같은 이미지 파일만 올릴 수 있어요.');

        const submitterName = String(fd.get('submitter_name') || '').trim();
        const instagram = String(fd.get('instagram') || '').trim();
        let film = String(fd.get('film') || '').trim();
        const camera = String(fd.get('camera') || '').trim();
        const caption = String(fd.get('caption') || '').trim();
        const consent = fd.get('consent') === 'on';
        if (!submitterName && !instagram) throw new Error('이름이나 인스타그램 ID 중 하나는 입력해 주세요.');
        if (!film) throw new Error('촬영한 필름을 선택하거나 직접 신청해 주세요.');
        if (!consent) throw new Error('사이트와 매거진에 게재해도 되는 사진인지 확인 체크가 필요해요.');

        // 4겹 B: alias 정확히 일치 시 정식 표기로 자동 치환
        // (사용자가 "포트라400"이라 적었으면 DB엔 "Kodak Portra 400"으로 저장됨)
        if (films) {
          const m = findFilmMatch(film, films);
          if (m?.type === 'exact') film = m.canonical;
        }

        submitBtn.textContent = '사진 변환 중…';
        const { blob } = await resizeToJpeg(file);
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('사진 용량이 큽니다. 5MB 이하 이미지로 다시 시도해 주세요.');

        const user = await db().auth.getUser();
        if (!user) throw new Error('로그인이 만료되었어요. 다시 로그인한 뒤 제출해 주세요.');
        const path = `${user.id}/${Date.now()}-${uuid()}.jpg`;
        submitBtn.textContent = '업로드 중…';
        const { error: upErr } = await db().submissions.uploadPhoto(path, blob);
        if (upErr) throw new Error('사진 업로드가 완료되지 않았어요. 네트워크를 확인한 뒤 다시 시도해 주세요. (' + upErr.message + ')');

        const igNorm = instagram ? instagram.replace(/^@/, '') : '';
        const themeApplyVal = fd.get('theme_apply');
        const insertData = {
          user_id: user.id,
          storage_path: path,
          instagram: igNorm ? '@' + igNorm : null,
          film,
          camera: camera || null,
          caption: caption || null,
          theme_month: themeApplyVal || null,
          consent_publish: true,
        };
        // submitter_name 컬럼이 없는 구버전 환경 대비: 값 있을 때만 키 포함
        if (submitterName) insertData.submitter_name = submitterName;
        const { error: dbErr } = await db().submissions.create(insertData);
        if (dbErr) {
          db().submissions.removePhoto(path);
          throw new Error('사진은 올라갔지만 제출 기록 저장에 실패했어요. 잠시 뒤 다시 시도해 주세요. (' + dbErr.message + ')');
        }

        // 4) 메타 기억
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({
            submitterName,
            instagram: igNorm ? '@' + igNorm : '',
            film,
            camera,
          }));
        } catch {}

        // 5) 확인 화면
        const displayAuthor = submitterName && igNorm
          ? `${submitterName} (@${igNorm})`
          : submitterName || (igNorm ? '@' + igNorm : '');
        openModal(renderSubmittedConfirm({ author: displayAuthor, film }));
      } catch (err) {
        showError(err.message || '제출을 마치지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.');
        submitBtn.disabled = false;
        submitBtn.textContent = '검토 요청 보내기';
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // 글로벌 이벤트 위임
  // ════════════════════════════════════════════════════════════
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'open-submission') {
      e.preventDefault();
      handleOpen(btn);
    } else if (action === 'rs-login-google') {
      e.preventDefault();
      handleLogin();
    }
  });

  // 페이지 로드 시 자동 재진입 체크 (OAuth 콜백으로 돌아온 직후)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoReopenIfPending);
  } else {
    autoReopenIfPending();
  }

  // 외부 노출: 승인된 제출 가져오기 (MagDB 위임 — 호환성 유지)
  window.fetchApprovedSubmissions = async function (limit = 1000) {
    if (!db()) return [];
    return db().submissions.listApproved(limit);
  };
})();
