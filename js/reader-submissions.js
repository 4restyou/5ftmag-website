// 5ft.mag Reader's Roll 직접 제출 위젯
// 사용법:
//   <button data-action="open-submission">내 사진 올리기</button>
//   <script src="js/db-client.js"></script>
//   <script src="js/reader-submissions.js"></script>

(function () {
  'use strict';

  const MAX_LONG_SIDE = 1800;
  const JPEG_QUALITY = 0.8;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const LS_KEY = '5ft_submission_meta';
  const LS_RECENT_CAMERAS = '5ft_recent_cameras';
  const RECENT_CAMERA_LIMIT = 6;
  const THEME_PATH = 'data/current-theme.json';
  const FILMS_PATH = 'data/films.json';
  const db = () => window.MagDB;
  let formOutsideClickHandler = null;

  function clearFormOutsideClickHandler() {
    if (!formOutsideClickHandler) return;
    document.removeEventListener('click', formOutsideClickHandler);
    formOutsideClickHandler = null;
  }

  // ── fetch + timeout (8초) — 응답 안 오면 abort 해서 hang 방지 ──
  function fetchWithTimeout(url, ms = 8000, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...init, signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
  }

  function reportUploadFailure(stage, err, meta = {}) {
    const safeStage = String(stage || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
    const message = err?.message || String(err || '알 수 없는 업로드 오류');
    const details = [
      err?.stack || '',
      `stage=${safeStage}`,
      `online=${navigator.onLine ? '1' : '0'}`,
      `input_bytes=${Number(meta.inputBytes || 0)}`,
      `upload_bytes=${Number(meta.uploadBytes || 0)}`,
    ].filter(Boolean).join('\n');
    if (typeof window.reportClientError === 'function') {
      window.reportClientError({
        message: `[reader-upload:${safeStage}] ${message}`,
        source: `reader-submissions:${safeStage}`,
        stack: details,
      });
      return;
    }
    console.warn('[reader-submissions] upload failure', safeStage, message);
  }

  // 한 번 fetch한 테마는 페이지 로딩 동안 캐시 — 실패 시 캐시 무효화해서 다음 호출에서 재시도
  let _themePromise = null;
  function getCurrentTheme() {
    if (_themePromise) return _themePromise;
    const depth = (location.pathname.match(/\/(stories|admin)\//) ? '../' : './');
    _themePromise = fetchWithTimeout(depth + THEME_PATH, 8000, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => { _themePromise = null; return null; });
    return _themePromise;
  }

  // 필름 목록 — 실패 시 null 반환 + 캐시 무효화 (caller 에서 분기)
  let _filmsPromise = null;
  function getFilms() {
    if (_filmsPromise) return _filmsPromise;
    const depth = (location.pathname.match(/\/(stories|admin)\//) ? '../' : './');
    _filmsPromise = fetchWithTimeout(depth + FILMS_PATH, 8000, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => { _filmsPromise = null; return null; });
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
    const buckets = new Map();
    for (const slug of Object.keys(films || {})) {
      const f = films[slug];
      const all = (f.aliases || []).concat([f.displayName, f.name]).filter(Boolean);
      for (const a of all) {
        const k = normalizeFilmName(a);
        if (!k) continue;
        if (!buckets.has(k)) buckets.set(k, new Map());
        buckets.get(k).set(slug, { slug, film: f });
      }
    }
    const map = new Map();
    for (const [alias, entriesBySlug] of buckets) {
      const entries = [...entriesBySlug.values()];
      map.set(alias, entries.length === 1
        ? entries[0]
        : { ambiguous: true, entries });
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
    const exactEntry = aliasIndex.get(q);
    if (exactEntry && !exactEntry.ambiguous) {
      const entry = exactEntry;
      return { type: 'exact', film: entry.film, slug: entry.slug, canonical: entry.film.displayName || entry.film.name };
    }

    // 2) Fuzzy: 부분 포함(양방향) 우선, 그다음 Levenshtein
    const candidates = [];
    for (const [normAlias, entry] of aliasIndex) {
      if (entry.ambiguous) continue;
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
  // 사진 변환 — js/image-processor.js 의 Worker 경로 우선,
  //   미지원 시 메인스레드 createImageBitmap, 그 다음 Image 태그 폴백.
  //   HEIC 사전 거부 + 단계별 timeout 내장.
  //   onProgress(stage, info) 콜백으로 UI 업데이트 가능.
  // ════════════════════════════════════════════════════════════
  function resizeToJpeg(file, onProgress) {
    if (typeof window.processImageForUpload !== 'function') {
      return Promise.reject(new Error('이미지 변환 모듈이 로드되지 않았어요. 새로고침 후 다시 시도해 주세요.'));
    }
    return window.processImageForUpload(file, {
      maxLongSide: MAX_LONG_SIDE,
      quality: JPEG_QUALITY,
      onProgress: onProgress || (() => {}),
    });
  }

  // 업로드/네트워크 호출에도 timeout — supabase storage 가 모바일 약한 네트워크에서 hang 하는 경우 대응
  function withNetworkTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} 시간 초과 (${Math.round(ms/1000)}초). 네트워크 상태 확인 후 다시 시도해 주세요.`)), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  // Supabase JS v2 가 localStorage 의 'sb-<ref>-auth-token' 에 세션 JSON 을 둠.
  // access_token 은 JWT — payload 의 sub(user.id) 와 exp 를 sync 로 추출해서
  // Supabase 클라이언트 호출 자체를 우회. auth 엔드포인트 hang(8-12초) 누적의
  // 진짜 원인을 호출 회피로 푼다. 만료/없으면 null → 호출 fallback.
  function readLocalJwtUser() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
        const raw = localStorage.getItem(k);
        if (!raw || raw === 'null') continue;
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token;
        if (!token || typeof token !== 'string') continue;
        const parts = token.split('.');
        if (parts.length < 2) continue;
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = '='.repeat((4 - b64.length % 4) % 4);
        const payload = JSON.parse(atob(b64 + pad));
        const exp = Number(payload.exp || 0);
        // 만료 30초 전부터는 안전상 fallback 으로 refresh 유도
        if (!exp || Date.now() / 1000 > exp - 30) continue;
        const id = payload.sub || parsed?.user?.id;
        if (id) return { id };
      }
    } catch (_) { /* parse 실패는 fallback 으로 처리 */ }
    return null;
  }

  // 사진 사이즈 라벨 ('3.2MB · 4032×3024' 같은 형식)
  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(1)}MB`;
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
    clearFormOutsideClickHandler();
    wrap.querySelector('.rs-modal-body').innerHTML = html;
    wrap.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const wrap = document.getElementById('rs-modal');
    clearFormOutsideClickHandler();
    if (wrap) wrap.classList.remove('open');
    document.body.style.overflow = '';
    // 안전망: 모달이 닫혔으면 직전 흐름은 어떻든 끝났다고 보고 in-flight 플래그 reset.
    // 어떤 await 가 hang 되어 finally 미도달인 케이스에서 다음 CTA 가 영원히
    // 무시되는 걸 막는다.
    if (typeof clearOpenInFlight === 'function') clearOpenInFlight();
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
        <label class="rs-field rs-photo-field">
          <span class="rs-label">사진 <em>*</em></span>
          <input class="rs-file-input" type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" required />
          <span class="rs-dropzone" id="rs-dropzone" role="button" tabindex="0" aria-label="사진 파일 선택">
            <span class="rs-dropzone-title">사진을 끌어오거나 클릭해서 선택</span>
            <span class="rs-dropzone-meta">JPG / PNG / WebP · 1장</span>
            <span class="rs-dropzone-file" id="rs-file-name">선택된 사진 없음</span>
          </span>
          <span class="rs-hint">자동으로 웹용 크기로 줄여 업로드합니다.</span>
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
          <input type="text" name="camera" id="rs-camera-input"
                 placeholder="목록에서 고르거나 직접 입력 (예: Leica M6)"
                 value="${escapeAttr(meta.camera || '')}" maxlength="60" autocomplete="off" />
          <div class="rs-recent-cameras" id="rs-recent-cameras" hidden></div>
          <div class="rs-camera-hint" id="rs-camera-hint" hidden></div>
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
        <div class="rs-upload-status" id="rs-upload-status" aria-live="polite" hidden>
          <span class="rs-upload-dot" aria-hidden="true"></span>
          <span class="rs-upload-copy">
            <strong id="rs-upload-title">업로드 준비 중</strong>
            <small id="rs-upload-detail">창을 닫지 말고 잠시만 기다려 주세요.</small>
          </span>
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
      <div class="rs-actions" style="justify-content: center; gap: 12px; flex-wrap: wrap;">
        <a href="${meHref}" class="rs-btn-link">내 사진 보기 →</a>
        <button type="button" class="rs-btn-link" data-action="rs-close">닫기</button>
        <button type="button" class="rs-btn rs-btn-primary" data-action="open-submission">+ 다음 사진 올리기</button>
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

  function normalizeCameraLabel(s) {
    return String(s ?? '').trim().replace(/\s+/g, ' ');
  }

  function readRecentCameras() {
    try {
      const rows = JSON.parse(localStorage.getItem(LS_RECENT_CAMERAS) || '[]');
      if (!Array.isArray(rows)) return [];
      if (!rows.length) {
        try {
          const meta = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
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
        if (out.length >= RECENT_CAMERA_LIMIT) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function saveRecentCamera(camera) {
    const label = normalizeCameraLabel(camera);
    if (!label) return;
    const next = [label].concat(readRecentCameras().filter(c => c.toLowerCase() !== label.toLowerCase()))
      .slice(0, RECENT_CAMERA_LIMIT);
    try { localStorage.setItem(LS_RECENT_CAMERAS, JSON.stringify(next)); } catch {}
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

  // 중첩 진입 방지 — 사용자가 짧은 시간에 CTA 를 여러 번 눌러도 한 번만 처리.
  // 어떤 사유로 finally 가 미도달일 경우 다음 호출이 영원히 무시되는 걸 막기 위해
  // 진입 시점을 기록하고 10초 넘은 in-flight 는 stale 로 간주해 재진입을 허용한다.
  let _openInFlight = false;
  let _openInFlightAt = 0;
  function clearOpenInFlight() {
    _openInFlight = false;
    _openInFlightAt = 0;
  }
  function setTriggerLoading(el, on) {
    if (!el || !el.classList) return;
    el.classList.toggle('is-loading', !!on);
    if (on) el.setAttribute('aria-busy', 'true');
    else    el.removeAttribute('aria-busy');
  }

  async function handleOpen(triggerEl) {
    if (_openInFlight) {
      // 10초 이상 in-flight 면 어디선가 cleanup 누락된 stale 로 간주, 재진입 허용.
      if (Date.now() - _openInFlightAt < 10000) return;
      clearOpenInFlight();
    }
    _openInFlight = true;
    _openInFlightAt = Date.now();
    setTriggerLoading(triggerEl, true);
    try {
      if (!db() || !db().isReady()) {
        window.notify?.('잠시 후 다시 시도해주세요. (DB 연결 준비 중)', 'info');
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
      // 8초 외부 timeout — 안쪽 fetchWithTimeout 이 우회되는 극단적 케이스 대비
      const dataPromise = Promise.all([getCurrentTheme(), getFilms()]);
      const guard = new Promise((_, reject) => setTimeout(() => reject(new Error('open-timeout')), 9000));
      let theme = null, films = null;
      try {
        [theme, films] = await Promise.race([dataPromise, guard]);
      } catch (_) {
        window.notify?.('사진 폼을 여는 데 시간이 너무 걸려요. 새로고침 후 다시 시도해 주세요.', 'danger');
        return;
      }
      if (!films || !Object.keys(films).length) {
        window.notify?.('필름 목록을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.', 'danger');
        return;
      }
      openModal(renderSubmissionForm(theme, savedPrefill, films));
      bindFormHandlers(films);
    } finally {
      clearOpenInFlight();
      setTriggerLoading(triggerEl, false);
    }
  }

  async function handleLogin() {
    const redirect = window.location.href.split('#')[0];
    await db().auth.signInWithGoogle(redirect);
  }

  async function autoReopenIfPending() {
    if (document.documentElement.dataset.rsAutoReopenBound === '1') return;
    document.documentElement.dataset.rsAutoReopenBound = '1';
    const pending = readTransient(SS_PENDING, LS_PENDING, { remove: false }) === '1';
    if (!pending) return;

    for (let i = 0; i < 60; i++) {
      if (db() && db().isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    if (!db() || !db().isReady()) return;

    let opened = false;
    async function reopen() {
      if (opened) return;
      opened = true;
      clearTransient(SS_PENDING, LS_PENDING);
      await handleOpen({ dataset: {} });
    }

    if (typeof db().auth.onChange === 'function') {
      db().auth.onChange((_event, session) => {
        if (session?.user) reopen();
      });
    }

    let session = null;
    for (let i = 0; i < 80; i++) {
      session = await db().auth.getSession();
      if (session?.user) break;
      await new Promise(r => setTimeout(r, 150));
    }
    if (session?.user) reopen();
  }

  // ════════════════════════════════════════════════════════════
  // 카메라 옵션 — 승인된 제출 + DB 오버라이드 + MODEL_BRAND_HINTS 카탈로그.
  //   - 정규화로 같은 모델 묶고 브랜드 alias 병합
  //   - 카탈로그 모델은 첫 제출 전이라도 자동완성에 표시
  //   - 브랜드 A-Z, 그 안에서 display A-Z 정렬
  //   - 자유 입력은 그대로 받되 유사 모델은 힌트로 제안
  // ════════════════════════════════════════════════════════════
  function modelKeyHelper(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_]/g, '');
  }
  // 카메라 키를 보기 좋은 display 로 변환 — 카탈로그 default 표기용
  //   key='m6'   → 'M6'
  //   key='m6ttl'→ 'M6 TTL'  (숫자→문자 경계, 문자→숫자 경계에 공백)
  //   brand='leica' → 'Leica M6 TTL'
  function prettifyCameraKey(brand, key) {
    if (!key) return '';
    // 숫자/문자 경계에 공백 삽입
    let s = String(key).replace(/([a-z])(\d)/gi, '$1 $2').replace(/(\d)([a-z])/gi, '$1 $2');
    // 약어 (FM, EOS, OM, MD 등) 는 대문자 유지가 자연스러우니 전체 대문자화
    s = s.toUpperCase();
    // 일부 흔한 토큰은 mixed-case 보정
    s = s.replace(/\bTTL\b/g, 'TTL').replace(/\bMD\b/g, 'MD');
    const bl = brand ? (brand.charAt(0).toUpperCase() + brand.slice(1)) : '';
    return bl ? `${bl} ${s}` : s;
  }

  let cachedCameraList = null;
  async function buildCameraList() {
    if (cachedCameraList) return cachedCameraList;
    if (!window.normalizeCamera || !db()) return [];
    let subs = [];
    try { subs = await db().submissions.listApproved(2000); } catch (_) { return []; }

    // 1) submissions 를 model_key 로 그룹화
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

    // 2) DB 오버라이드 적용 (alias 병합 + brand/display)
    if (window.MagDB && window.MagDB.cameraOverrides) {
      let overrides = null;
      try { overrides = await window.MagDB.cameraOverrides.list(); } catch (_) {}
      if (overrides && overrides.size) {
        // alias 먼저
        for (const [aliasKey, o] of overrides) {
          if (!o.alias_of || !buckets.has(aliasKey)) continue;
          if (!buckets.has(o.alias_of)) buckets.set(o.alias_of, { originals: [], brand: o.brand || null });
          const target = buckets.get(o.alias_of);
          target.originals = target.originals.concat(buckets.get(aliasKey).originals);
          if (!target.brand && o.brand) target.brand = o.brand;
          buckets.delete(aliasKey);
        }
        // brand/display
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

    // 3) MODEL_BRAND_HINTS 카탈로그도 힌트 후보에 포함 — 첫 제출 전이라도
    //    이미 알려진 모델들이 제안에 떠야 사용자가 선택 가능.
    //    이미 submissions 에 있는 키는 건너뜀 (중복 방지).
    if (Array.isArray(window.MODEL_BRAND_HINTS)) {
      const seenKeys = new Set(list.map(c => c.key));
      for (const hint of window.MODEL_BRAND_HINTS) {
        const brandText = hint.brand || '';
        for (const m of (hint.models || [])) {
          // entry 는 string 또는 { key, display } 둘 다 지원
          const k = typeof m === 'string' ? m : (m && m.key);
          const explicit = typeof m === 'object' && m && m.display ? m.display : null;
          if (!k) continue;
          const mk = modelKeyHelper(k);
          if (!mk || seenKeys.has(mk)) continue;
          // display 자동 생성 — 명시값 없으면 brand+key 정형화
          const display = explicit || prettifyCameraKey(brandText, k);
          list.push({ key: mk, display, brand: brandText });
          seenKeys.add(mk);
        }
      }
    }

    // 브랜드 A-Z (빈 브랜드는 끝), 그 안에서 display A-Z
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

  // Levenshtein 거리 (작은 입력 대상 — 이미 위에 있는 함수 사용)
  function similarCameras(query, list, max = 4) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const scored = [];
    for (const c of list) {
      const formatted = formatCameraName(c);
      const d = formatted.toLowerCase();
      const display = c.display.toLowerCase();
      const brand = (c.brand || '').toLowerCase();
      if (d === q || display === q) return []; // 정확히 일치 → 힌트 불필요
      let score = -1;
      if (d.startsWith(q)) score = 0;
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

  // 브랜드명 표시 — 카메라 사전의 canonical 소문자 → 대문자 시작
  function brandLabel(b) {
    if (!b) return '';
    return b.charAt(0).toUpperCase() + b.slice(1);
  }
  // 브랜드 + 모델 형식 — 입력값/공유용
  function formatCameraName(c) {
    if (!c || !c.display) return '';
    const bl = brandLabel(c.brand);
    if (!bl) return c.display;
    // display 가 이미 브랜드를 포함하면 그대로 (e.g. 'Leica M6')
    if (c.display.toLowerCase().includes(c.brand.toLowerCase())) return c.display;
    return `${bl} ${c.display}`;
  }

  function renderRecentCameraChips(container, input) {
    if (!container || !input) return;
    const recent = readRecentCameras();
    if (!recent.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '<span class="rs-recent-cameras-label">최근 사용</span>'
      + recent.map(camera => `<button type="button" class="rs-recent-camera" data-camera="${escapeAttr(camera)}">${escapeHtml(camera)}</button>`).join('');
    container.hidden = false;
  }

  async function populateCameraDatalist() {
    const input    = document.getElementById('rs-camera-input');
    const recent   = document.getElementById('rs-recent-cameras');
    const hint     = document.getElementById('rs-camera-hint');
    if (!input) return;
    const list = await buildCameraList();

    renderRecentCameraChips(recent, input);
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

  function bindFormHandlers(films) {
    const form = document.getElementById('rs-form');
    if (!form) return;
    let submitting = false;
    let slowUploadTimers = [];

    // 카메라 입력 — 최근 사용 + 유사 모델 힌트
    populateCameraDatalist();

    // 사진 선택 / 드래그앤드롭 / 미리보기
    const fileInput = form.querySelector('input[name="photo"]');
    const dropzone = document.getElementById('rs-dropzone');
    const fileName = document.getElementById('rs-file-name');
    const uploadStatus = document.getElementById('rs-upload-status');
    const uploadTitle = document.getElementById('rs-upload-title');
    const uploadDetail = document.getElementById('rs-upload-detail');
    function setUploadStatus(state, title, detail = '') {
      if (!uploadStatus) return;
      uploadStatus.hidden = false;
      uploadStatus.dataset.state = state || 'progress';
      if (uploadTitle) uploadTitle.textContent = title || '';
      if (uploadDetail) uploadDetail.textContent = detail || '';
    }
    function clearUploadStatus() {
      if (!uploadStatus) return;
      uploadStatus.hidden = true;
      uploadStatus.dataset.state = '';
      if (uploadTitle) uploadTitle.textContent = '';
      if (uploadDetail) uploadDetail.textContent = '';
    }
    function startSlowUploadHints() {
      slowUploadTimers.forEach(clearTimeout);
      slowUploadTimers = [
        setTimeout(() => {
          setUploadStatus('progress', '아직 처리 중입니다', '모바일 네트워크나 큰 사진은 시간이 더 걸릴 수 있어요. 같은 버튼을 다시 누르지 않아도 됩니다.');
        }, 18000),
        setTimeout(() => {
          setUploadStatus('progress', '서버 응답을 기다리는 중', '1분 안에 완료되지 않으면 자동으로 중단되고 다시 시도할 수 있게 복구됩니다.');
        }, 38000),
      ];
    }
    function clearSlowUploadHints() {
      slowUploadTimers.forEach(clearTimeout);
      slowUploadTimers = [];
    }
    function renderPhotoPreview(file, note = '') {
      const preview = document.getElementById('rs-preview');
      if (!preview) return;
      preview.innerHTML = '';
      if (fileName) {
        fileName.textContent = file
          ? `${file.name}${note ? ` · ${note}` : ''}`
          : '선택된 사진 없음';
      }
      if (file) {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
      }
    }
    function isAcceptedImage(file) {
      if (!file) return false;
      if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '')) return true;
      return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    }
    function setDroppedPhoto(files) {
      const list = Array.from(files || []);
      const file = list.find(isAcceptedImage);
      if (!file) {
        showError('JPG, PNG, WebP 이미지만 올릴 수 있어요.');
        return;
      }
      if (typeof DataTransfer === 'undefined') {
        showError('이 브라우저에서는 드래그앤드롭 파일 지정이 지원되지 않아요. 파일 선택 버튼을 사용해 주세요.');
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      renderPhotoPreview(file, list.length > 1 ? '첫 번째 사진만 선택됨' : '');
      showError('');
    }
    fileInput?.addEventListener('change', () => {
      renderPhotoPreview(fileInput.files?.[0] || null);
      clearUploadStatus();
    });
    dropzone?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fileInput?.click();
    });
    ['dragenter', 'dragover'].forEach(type => {
      dropzone?.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach(type => {
      dropzone?.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });
    dropzone?.addEventListener('drop', (e) => {
      setDroppedPhoto(e.dataTransfer?.files);
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
    // 모달 외부(폼 아닌 곳) 클릭 시 닫기. 폼이 다시 렌더될 때 이전 리스너는 제거.
    clearFormOutsideClickHandler();
    formOutsideClickHandler = (e) => {
      if (!picker || dropdown?.hidden) return;
      if (!picker.contains(e.target)) closeDropdown();
    };
    document.addEventListener('click', formOutsideClickHandler);

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
      if (submitting || submitBtn?.disabled) return;
      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = '업로드 중…';
      setUploadStatus('progress', '제출 준비 중', '사진과 입력 내용을 확인하고 있어요.');
      startSlowUploadHints();
      let uploadStage = 'validate';
      const uploadMeta = { inputBytes: 0, uploadBytes: 0 };
      const markProgress = (stage, title, detail) => {
        uploadStage = stage;
        setUploadStatus('progress', title, detail);
      };

      try {
        const fd = new FormData(form);
        const file = fd.get('photo');
        if (!file || !file.size) throw new Error('올릴 사진을 1장 선택해 주세요.');
        if (!isAcceptedImage(file)) throw new Error('JPG, PNG, WebP, HEIC 같은 이미지 파일만 올릴 수 있어요.');
        uploadMeta.inputBytes = file.size;

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

        // 변환 — 단계별로 버튼 텍스트 갱신해 "멈춘 것처럼 보이는" 무음 hang 방지
        submitBtn.textContent = `사진 디코딩 중… (${fmtBytes(file.size)})`;
        markProgress('decode', '사진을 읽는 중', `${fmtBytes(file.size)} 파일을 웹용 이미지로 준비하고 있어요.`);
        const { blob, width, height } = await withNetworkTimeout(
          resizeToJpeg(file, ({ stage, width: w, height: h }) => {
            if (stage === 'decode') {
              submitBtn.textContent = `사진 디코딩 중… (${fmtBytes(file.size)})`;
              markProgress('decode', '사진을 읽는 중', '큰 사진은 이 단계에서 몇 초 걸릴 수 있어요.');
            } else if (stage === 'resize') {
              submitBtn.textContent = `사진 크기 줄이는 중… (${w}×${h})`;
              markProgress('resize', '사진 크기 줄이는 중', `${w}×${h} 크기로 변환하고 있어요.`);
            } else if (stage === 'encode') {
              submitBtn.textContent = `사진 인코딩 중… (${w}×${h})`;
              markProgress('encode', '사진을 압축하는 중', '업로드 전에 용량을 줄이고 있어요.');
            }
          }),
          52000,
          '사진 변환'
        );
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('사진 용량이 큽니다. 5MB 이하 이미지로 다시 시도해 주세요.');

        markProgress('auth', '로그인 상태 확인 중', '업로드 권한을 확인하고 있어요.');
        // 1) localStorage 의 JWT 를 sync 로 파싱 — Supabase 클라이언트 호출 없이
        //    user.id 와 exp 추출. 만료 안 됐으면 즉시 진행.
        // 2) 토큰이 없거나 만료됐으면 db.auth.getSession() 으로 refresh 시도.
        //    실제 권한 검증은 RLS 가 백엔드에서 다시 확인하므로 사전 검증은 생략.
        let user = readLocalJwtUser();
        if (!user) {
          const session = await withNetworkTimeout(db().auth.getSession(), 6000, '로그인 확인');
          user = session?.user;
        }
        if (!user) throw new Error('로그인이 만료되었어요. 다시 로그인한 뒤 제출해 주세요.');
        const path = `${user.id}/${Date.now()}-${uuid()}.jpg`;
        submitBtn.textContent = `사진 업로드 중… (${fmtBytes(blob.size)})`;
        uploadMeta.uploadBytes = blob.size;
        markProgress('storage', '사진 업로드 중', `${fmtBytes(blob.size)} 파일을 서버에 보내는 중입니다. 창을 닫지 마세요.`);
        const { error: upErr } = await withNetworkTimeout(
          db().submissions.uploadPhoto(path, blob),
          90000,
          '사진 업로드'
        ).catch(err => ({ error: { message: err.message } }));
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
        submitBtn.textContent = '제출 기록 저장 중…';
        markProgress('database', '제출 기록 저장 중', '사진 정보와 필름 정보를 함께 저장하고 있어요.');
        const { error: dbErr } = await withNetworkTimeout(
          db().submissions.create(insertData),
          25000,
          '제출 기록 저장'
        ).catch(err => ({ error: { message: err.message } }));
        if (dbErr) {
          markProgress('cleanup', '업로드 정리 중', '기록 저장에 실패해 올라간 사진 파일을 정리하고 있어요.');
          await withNetworkTimeout(
            db().submissions.removePhoto(path),
            12000,
            '실패한 업로드 정리'
          ).catch(err => console.warn('[reader-submissions] cleanup failed:', err?.message || err));
          throw new Error('사진은 올라갔지만 제출 기록 저장에 실패했어요. 잠시 뒤 다시 시도해 주세요. (' + dbErr.message + ')');
        }

        // 4) 메타 기억
        saveRecentCamera(camera);
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
        setUploadStatus('done', '제출 완료', 'Reader’s Roll 검토 큐에 들어갔어요.');
        openModal(renderSubmittedConfirm({ author: displayAuthor, film }));
      } catch (err) {
        if (uploadStage !== 'validate') reportUploadFailure(uploadStage, err, uploadMeta);
        setUploadStatus('error', '제출이 중단됐어요', '입력한 내용은 유지됩니다. 메시지를 확인한 뒤 다시 시도해 주세요.');
        showError(err.message || '제출을 마치지 못했어요. 입력 내용을 확인한 뒤 다시 시도해 주세요.');
        submitBtn.disabled = false;
        submitBtn.textContent = '검토 요청 보내기';
      } finally {
        submitting = false;
        clearSlowUploadHints();
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
  window.fetchApprovedSubmissions = async function (limit = null) {
    if (!db() || !db().isReady()) return [];
    return withNetworkTimeout(
      db().submissions.listApproved(limit),
      30000,
      '승인된 사진 목록 불러오기'
    ).catch(err => {
      console.warn('[reader-submissions] approved list:', err?.message || err);
      return [];
    });
  };
})();
