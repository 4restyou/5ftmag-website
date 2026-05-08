// 5ft.mag Reader's Roll 직접 제출 위젯
// 사용법:
//   <button data-action="open-submission">내 사진 올리기</button>
//   <script src="js/supabase-config.js"></script>
//   <script src="js/reader-submissions.js"></script>
//
// 의존성: window.sb (supabase-js), window.SUPABASE_CONFIG.url

(function () {
  'use strict';

  const MAX_LONG_SIDE = 2000;     // 긴 변 px
  const JPEG_QUALITY = 0.85;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const STORAGE_BUCKET = 'reader-submissions';
  const LS_KEY = '5ft_submission_meta'; // 인스타/필름 등 마지막 입력 기억
  const THEME_PATH = 'data/current-theme.json';

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
        Reader's Roll에 사진을 올리려면 로그인이 필요해요.<br />
        편집부 검토 후(보통 24~48시간) 메인에 게시됩니다.
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

  function renderSubmissionForm(theme) {
    const meta = (() => {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
      catch { return {}; }
    })();
    const themeIssue = theme?.issue || theme?.month || '다음 호';
    const themeFilm = theme?.film ? ` · 메인 필름: <strong>${escapeHtml(theme.film)}</strong>` : '';
    const themeBlock = (theme && theme.active) ? `
      <div class="rs-theme">
        <span class="rs-theme-tag">${escapeHtml(themeIssue)} 주제</span>
        <strong class="rs-theme-title">${escapeHtml(theme.title)}${theme.subtitle ? ` <small style="font-weight: var(--fw-all); color: inherit; opacity: 0.78;">— ${escapeHtml(theme.subtitle)}</small>` : ''}</strong>
        <p class="rs-theme-desc">${escapeHtml(theme.description || '')}${themeFilm}</p>
        <label class="rs-checkbox rs-theme-check">
          <input type="checkbox" name="theme_apply" value="${escapeAttr(theme.month)}" checked />
          <span>이 사진을 <strong>"${escapeHtml(theme.title)}"</strong> 주제 응모로 함께 보내기 — 우수작은 ${escapeHtml(themeIssue)} 종이 매거진 후보가 됩니다.</span>
        </label>
      </div>
    ` : '';
    return `
      <h2 id="rs-modal-title" class="rs-title">사진 올리기</h2>
      <p class="rs-desc">편집부 검토 후 Reader's Roll에 게시됩니다 (보통 24~48시간).</p>
      ${themeBlock}
      <form class="rs-form" id="rs-form">
        <label class="rs-field">
          <span class="rs-label">사진 <em>*</em></span>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required />
          <span class="rs-hint">JPG / PNG / WebP. 자동으로 웹용 크기로 줄여 업로드합니다.</span>
          <div class="rs-preview" id="rs-preview"></div>
        </label>
        <label class="rs-field">
          <span class="rs-label">인스타그램 ID <em>*</em></span>
          <input type="text" name="instagram" placeholder="@your_id" value="${escapeAttr(meta.instagram || '')}" required maxlength="60" />
        </label>
        <label class="rs-field">
          <span class="rs-label">필름 <em>*</em></span>
          <input type="text" name="film" placeholder="예: Kodak Portra 400" value="${escapeAttr(meta.film || '')}" required maxlength="60" />
        </label>
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
          <button type="submit" class="rs-btn rs-btn-primary">제출</button>
        </div>
        <p class="rs-error" id="rs-error" aria-live="polite"></p>
      </form>`;
  }

  function renderSubmittedConfirm(meta) {
    return `
      <h2 id="rs-modal-title" class="rs-title">제출 완료 🎞</h2>
      <p class="rs-desc">
        보내주신 한 컷 잘 받았습니다.<br />
        편집부 검토 후 Reader's Roll에 게시될 거예요 (보통 24~48시간).
      </p>
      <p class="rs-desc-sub">
        ${meta.instagram ? `인스타: <strong>${escapeHtml(meta.instagram)}</strong> · ` : ''}
        ${meta.film ? `필름: <strong>${escapeHtml(meta.film)}</strong>` : ''}
      </p>
      <div class="rs-actions" style="justify-content: center;">
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

  // ════════════════════════════════════════════════════════════
  // 핸들러
  // ════════════════════════════════════════════════════════════
  async function handleOpen() {
    if (!window.sb) {
      alert('잠시 후 다시 시도해주세요 (인증 모듈 로딩 중).');
      return;
    }
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      openModal(renderLoginPrompt());
      return;
    }
    const theme = await getCurrentTheme();
    openModal(renderSubmissionForm(theme));
    bindFormHandlers();
  }

  async function handleLogin() {
    const redirect = window.location.origin + window.location.pathname;
    await window.sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect }
    });
  }

  function bindFormHandlers() {
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = '업로드 중…';

      try {
        const fd = new FormData(form);
        const file = fd.get('photo');
        if (!file || !file.size) throw new Error('사진을 선택해주세요.');
        if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있어요.');

        const instagram = String(fd.get('instagram') || '').trim();
        const film = String(fd.get('film') || '').trim();
        const camera = String(fd.get('camera') || '').trim();
        const caption = String(fd.get('caption') || '').trim();
        const consent = fd.get('consent') === 'on';
        if (!instagram) throw new Error('인스타그램 ID를 입력해주세요.');
        if (!film) throw new Error('필름 종류를 입력해주세요.');
        if (!consent) throw new Error('게재 동의에 체크해주세요.');

        // 1) 클라이언트 리사이즈 → JPEG
        submitBtn.textContent = '사진 변환 중…';
        const { blob } = await resizeToJpeg(file);
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('파일이 너무 큽니다 (5MB 이하).');

        // 2) Storage 업로드
        const { data: { user } } = await window.sb.auth.getUser();
        if (!user) throw new Error('로그인이 만료되었어요. 다시 시도해주세요.');
        const path = `${user.id}/${Date.now()}-${uuid()}.jpg`;
        submitBtn.textContent = '업로드 중…';
        const { error: upErr } = await window.sb.storage
          .from(STORAGE_BUCKET)
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error('업로드 실패: ' + upErr.message);

        // 3) DB insert
        const igNorm = instagram.replace(/^@/, '');
        const themeApplyVal = fd.get('theme_apply'); // 체크돼있으면 'YYYY-MM', 아니면 null
        const { error: dbErr } = await window.sb.from('reader_submissions').insert({
          user_id: user.id,
          storage_path: path,
          instagram: '@' + igNorm,
          film,
          camera: camera || null,
          caption: caption || null,
          theme_month: themeApplyVal || null,
          consent_publish: true,
        });
        if (dbErr) {
          // 업로드된 객체 정리 (보내고 잊기)
          window.sb.storage.from(STORAGE_BUCKET).remove([path]).catch(() => {});
          throw new Error('등록 실패: ' + dbErr.message);
        }

        // 4) 메타 기억
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({
            instagram: '@' + igNorm, film, camera,
          }));
        } catch {}

        // 5) 확인 화면
        openModal(renderSubmittedConfirm({ instagram: '@' + igNorm, film }));
      } catch (err) {
        console.error('[5ft.mag submission]', err);
        showError(err.message || '오류가 발생했어요.');
        submitBtn.disabled = false;
        submitBtn.textContent = '제출';
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
      handleOpen();
    } else if (action === 'rs-login-google') {
      e.preventDefault();
      handleLogin();
    }
  });

  // ════════════════════════════════════════════════════════════
  // 외부에서 사용할 헬퍼: 승인된 제출 가져오기
  // ════════════════════════════════════════════════════════════
  window.fetchApprovedSubmissions = async function (limit = 50) {
    if (!window.sb) return [];
    const { data, error } = await window.sb
      .from('reader_submissions_approved')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[5ft.mag] fetchApprovedSubmissions:', error);
      return [];
    }
    const baseUrl = window.SUPABASE_CONFIG?.url;
    return (data || []).map(r => ({
      id: 'sub-' + r.id,
      image: `${baseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${r.storage_path}`,
      author: r.instagram,
      instagramUrl: r.instagram ? `https://instagram.com/${r.instagram.replace(/^@/, '')}` : '#',
      film: r.film,
      camera: r.camera,
      caption: r.caption,
      published: true,
      _source: 'submission',
    }));
  };
})();
