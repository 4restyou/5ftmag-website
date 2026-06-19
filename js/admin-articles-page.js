// admin/articles.html 백엔드
// data/stories.json 의 published 플래그를 GitHub API 로 토글한다.
// 동선: 토글 클릭 → main 브랜치의 stories.json 가져옴 → 해당 entry published 뒤집고 → main 에 commit (직접).
// 토큰: 기존 article-editor 와 같은 localStorage 키 ('5ft-gh-pat') 공유.

(function () {
  'use strict';

  const REPO = '4restyou/5ftmag-website';
  const BASE_BRANCH = 'main';
  const PAT_KEY = '5ft-gh-pat';

  const $ = (id) => document.getElementById(id);
  const db = () => window.MagDB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATE = {
    stories: [],          // raw JSON array
    filter: 'all',        // all / published / hidden
    category: '',         // category filter
    query: '',            // search
    sha: null,            // last known stories.json sha on main
    pendingToggle: null,  // {id, nextPublished} when waiting for PAT
  };

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

  // ── GitHub PAT ──
  const getPat = () => localStorage.getItem(PAT_KEY) || '';
  const setPat = (v) => v ? localStorage.setItem(PAT_KEY, v) : localStorage.removeItem(PAT_KEY);

  function openPatModal() {
    $('patInput').value = getPat();
    $('patModal').classList.add('is-open');
    setTimeout(() => $('patInput').focus(), 50);
  }
  $('patCancel').addEventListener('click', () => $('patModal').classList.remove('is-open'));
  $('patApply').addEventListener('click', async () => {
    setPat($('patInput').value.trim());
    $('patModal').classList.remove('is-open');
    if (STATE.pendingToggle) {
      const { id, nextPublished } = STATE.pendingToggle;
      STATE.pendingToggle = null;
      await doToggle(id, nextPublished);
    }
  });

  // ── GitHub API helpers ──
  async function gh(method, path, body) {
    const pat = getPat();
    if (!pat) throw new Error('PAT 없음');
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : await res.json();
  }
  const b64encodeUtf8 = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64decodeUtf8 = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

  // ── 로드 (main 브랜치의 stories.json 직접) ──
  async function loadStories() {
    // 우선 정적 파일에서 빠르게 (Netlify 캐시).
    try {
      const r = await fetch('/data/stories.json', { cache: 'no-store' });
      if (r.ok) STATE.stories = await r.json();
    } catch {}
    render();
    // 동시에 GitHub API 로 가져와 sha 갱신 (PAT 없으면 패스).
    if (getPat()) {
      try {
        const cur = await gh('GET', `/repos/${REPO}/contents/data/stories.json?ref=${BASE_BRANCH}`);
        STATE.stories = JSON.parse(b64decodeUtf8(cur.content));
        STATE.sha = cur.sha;
        render();
      } catch (err) {
        console.warn('GitHub stories.json fetch 실패:', err.message);
      }
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
      if (STATE.filter === 'published' && s.published === false) return false;
      if (STATE.filter === 'hidden' && s.published !== false) return false;
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
    const isPub = s.published !== false;
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
  async function doToggle(id, nextPublished) {
    if (!getPat()) {
      STATE.pendingToggle = { id, nextPublished };
      openPatModal();
      // 토글 입력 원복 (PAT 적용 후 다시 시도)
      revertCheckbox(id, !nextPublished);
      return;
    }

    const row = document.querySelector(`.article-row[data-id="${cssEsc(id)}"]`);
    if (row) row.classList.add('is-busy');

    try {
      // 1) 최신 stories.json 가져오기 (sha 가 stale 일 수 있어 매번 새로)
      const cur = await gh('GET', `/repos/${REPO}/contents/data/stories.json?ref=${BASE_BRANCH}`);
      const list = JSON.parse(b64decodeUtf8(cur.content));
      const idx = list.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error(`entry not found: ${id}`);
      const before = list[idx].published !== false;
      const after = nextPublished;
      if (before === after) {
        // 이미 같은 상태 — 바로 종료
        STATE.stories = list;
        STATE.sha = cur.sha;
        render();
        return;
      }
      list[idx].published = after;
      const nextText = JSON.stringify(list, null, 2) + '\n';

      // 2) main 에 직접 commit (한 줄 토글이라 PR 분기 비용 회피)
      const commitMsg = `chore(stories): ${id} ${after ? '공개' : '비공개'}`;
      await gh('PUT', `/repos/${REPO}/contents/data/stories.json`, {
        message: commitMsg,
        content: b64encodeUtf8(nextText),
        sha: cur.sha,
        branch: BASE_BRANCH,
      });

      // 3) 로컬 상태 갱신
      STATE.stories = list;
      STATE.sha = null; // 다음 토글 때 다시 가져오도록
      toast(`"${list[idx].title}" ${after ? '공개' : '비공개'} 처리됨. Netlify 빌드 1~2분.`);
      render();
    } catch (err) {
      console.error(err);
      toast('토글 실패: ' + err.message.slice(0, 80), 'error');
      revertCheckbox(id, !nextPublished);
      if (/401|PAT 없음/.test(err.message)) openPatModal();
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
