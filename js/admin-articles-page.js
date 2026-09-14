// admin/articles.html 백엔드
// 글의 공개/비공개를 토글한다.
//
// 예전에는 GitHub API 로 data/stories.json 을 main 에 직접 커밋했다. 반영에
// Netlify 재빌드 1~2분이 걸렸고 운영자가 토큰을 발급해 넣어야 했다(탭을 닫으면
// 사라진다). 이제 story_visibility 한 줄만 바꾸므로 즉시 반영되고 토큰이 필요
// 없다. 폰에서도 된다.
//
// stories.json 의 published 가 기본값이고 오버라이드가 이긴다. 기본값과 같아지면
// db-client 가 행을 지워서 원본이 둘로 갈라지지 않는다.
// 기사 작성(article-editor)은 여전히 GitHub 토큰을 쓴다. 그쪽은 자체 모달이 있다.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const db = () => window.MagDB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATE = {
    stories: [],          // raw JSON array
    filter: 'all',        // all / published / hidden
    category: '',         // category filter
    query: '',            // search
    overrides: new Map(),  // story_visibility — 기본값에서 벗어난 글만 들어 있다
  };

  // 화면에 보이는 현재 공개 상태. stories.json 이 기본값이고 오버라이드가 이긴다.
  function isPublishedNow(s) {
    const id = String(s && s.id != null ? s.id : '');
    return STATE.overrides.has(id) ? STATE.overrides.get(id) : (s.published !== false);
  }

  function showGate(msg) {
    $('gate').hidden = false;
    $('app').hidden = true;
    if (msg) $('gate').querySelector('p').textContent = msg;
  }

  async function checkAccess() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise((r) => setTimeout(r, 50)); }
    if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
    const session = await db().auth.getSession();
    if (!session) { showGate(); return false; }
    const profile = await db().profiles.getMine();
    if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
    $('adminUser').innerHTML = `${esc(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
    $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
    return true;
  }

  $('gateLogin').addEventListener('click', async () => { await db().auth.signInWithGoogle(window.location.href); });

  // ── Toast ──
  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast is-show' + (kind === 'error' ? ' is-error' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2400);
  }


  // ── 로드 ──
  // stories.json 이 기본값, story_visibility 가 오버라이드다. 둘을 따로 들고
  // 있어야 토글할 때 "기본값으로 되돌아왔는지" 를 판단할 수 있다.
  //
  // stories.json 은 배포 때만 바뀌므로 정적 파일이 곧 최신이다. 예전에는 여기서
  // GitHub API 로 한 번 더 가져와 sha 를 챙겼는데, 토글이 커밋을 만들지 않게
  // 되면서 그 sha 가 필요 없어졌다.
  async function loadStories() {
    try {
      const r = await fetch('/data/stories.json', { cache: 'no-store' });
      if (r.ok) STATE.stories = await r.json();
    } catch {}
    await loadOverrides();
    render();
  }

  async function loadOverrides() {
    try {
      const rows = await db().articles.visibility();
      STATE.overrides = new Map((rows || []).map((r) => [String(r.story_id), r.published !== false]));
    } catch (_) {
      STATE.overrides = new Map();
    }
  }

  // ── 카테고리 select 채우기 ──
  function populateCategories() {
    const sel = $('categorySelect');
    const cats = Array.from(new Set(STATE.stories.map((s) => s.categoryLabel).filter(Boolean))).sort();
    const cur = sel.value;
    sel.innerHTML = '<option value="">전체 카테고리</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (cats.includes(cur)) sel.value = cur;
  }

  // ── 필터 적용 ──
  function applyFilters() {
    const q = STATE.query.trim().toLowerCase();
    return STATE.stories.filter((s) => {
      if (STATE.filter === 'published' && !isPublishedNow(s)) return false;
      if (STATE.filter === 'hidden' && isPublishedNow(s)) return false;
      if (STATE.category && s.categoryLabel !== STATE.category) return false;
      if (q) {
        const hay = `${s.title || ''} ${s.author || ''} ${s.id || ''} ${s.excerpt || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ── 렌더 ──
  function render() {
    populateCategories();
    const list = applyFilters();
    $('articlesCount').textContent = `${list.length} / ${STATE.stories.length}편`;
    if (!list.length) {
      $('articlesList').innerHTML = '<div class="empty-state">조건에 맞는 기사가 없습니다.</div>';
      return;
    }
    $('articlesList').innerHTML = list.map(rowHtml).join('');
    // 토글 바인딩
    document.querySelectorAll('.pub-toggle input').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        const next = e.target.checked;
        // 옵티미스틱: 입력 해제 후 doToggle 에서 실패하면 원복
        doToggle(id, next);
      });
    });
  }

  function rowHtml(s) {
    const isPub = isPublishedNow(s);
    const thumb = s.thumbnail
      ? `<div class="article-thumb" style="background-image:url('${esc(s.thumbnail.startsWith('http') ? s.thumbnail : '/' + s.thumbnail)}')"></div>`
      : `<div class="article-thumb is-empty">no img</div>`;
    const date = s.date || '';
    const pageHref = s.page ? `/${esc(s.page)}` : '#';
    return `
      <div class="article-row ${isPub ? '' : 'is-hidden'}" data-id="${esc(s.id)}">
        ${thumb}
        <div class="article-meta">
          <h3 class="article-title-line"><a href="${pageHref}" target="_blank" rel="noopener">${esc(s.title)}</a></h3>
          <div class="article-sub">
            <span>${esc(s.id || '')}</span>
          </div>
        </div>
        <span class="article-badge">${esc(s.categoryLabel || s.category || '')}</span>
        <span class="article-author-chip">${esc(s.author || '')}</span>
        <span class="article-date-chip">${esc(date)}</span>
        <div class="article-actions">
          <a class="article-link-btn" href="/admin/article-editor.html?slug=${encodeURIComponent(s.id)}" title="에디터로">편집</a>
          <label class="pub-toggle" title="${isPub ? '비공개로 전환' : '공개로 전환'}">
            <input type="checkbox" data-id="${esc(s.id)}" ${isPub ? 'checked' : ''} />
            <span class="pub-toggle-track" aria-hidden="true"></span>
            <span class="pub-toggle-label">${isPub ? '공개' : '비공개'}</span>
          </label>
        </div>
      </div>
    `;
  }

  // ── 토글 ──
  // 예전에는 GitHub API 로 data/stories.json 을 main 에 직접 커밋해서 Netlify
  // 재빌드 1~2분을 기다려야 했고, 운영자가 토큰을 넣어야 했다. 이제 공개 여부만
  // story_visibility 한 줄로 바꾼다. 커밋이 없으니 재배포도 없고 즉시 반영된다.
  //
  // 기본값(stories.json)과 같아지면 db-client 가 행을 지운다. 그래서 한 글을
  // 내렸다가 다시 올리면 오버라이드가 남지 않는다.
  async function doToggle(id, nextPublished) {
    const story = STATE.stories.find((x) => String(x.id) === String(id));
    if (!story) {
      toast('글을 찾을 수 없습니다: ' + id, 'error');
      revertCheckbox(id, !nextPublished);
      return;
    }

    const row = document.querySelector(`.article-row[data-id="${cssEsc(id)}"]`);
    if (row) row.classList.add('is-busy');

    try {
      const base = story.published !== false;
      const { error, cleared } = await db().articles.setPublished(id, nextPublished, base);
      if (error) throw new Error(error.message || '저장하지 못했습니다');

      if (cleared) STATE.overrides.delete(String(id));
      else STATE.overrides.set(String(id), nextPublished);

      toast(`"${story.title}" ${nextPublished ? '공개' : '비공개'} 처리했어요. 바로 반영됩니다.`);
      render();
    } catch (err) {
      console.error(err);
      // 편집부 권한이 없으면 RLS 가 막는다. 실제 메시지를 그대로 띄워야
      // 캡처 한 장으로 원인이 잡힌다.
      toast('토글 실패: ' + String(err.message || err).slice(0, 120), 'error');
      revertCheckbox(id, !nextPublished);
    } finally {
      if (row) row.classList.remove('is-busy');
    }
  }

  function revertCheckbox(id, prev) {
    const cb = document.querySelector(`.pub-toggle input[data-id="${cssEsc(id)}"]`);
    if (cb) cb.checked = prev;
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  // ── 입력 바인딩 ──
  $('searchInput').addEventListener('input', (e) => { STATE.query = e.target.value; render(); });
  $('categorySelect').addEventListener('change', (e) => { STATE.category = e.target.value; render(); });
  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      STATE.filter = btn.dataset.filter;
      render();
    });
  });

  // ── 시작 ──
  (async function start() {
    if (!(await checkAccess())) return;
    $('app').hidden = false;
    await loadStories();
  })();
})();
