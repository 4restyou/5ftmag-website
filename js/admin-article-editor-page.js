'use strict';

// 5ft.mag Admin Article Editor
//   Vanilla contenteditable 기반. 자동저장(DB) + 이미지 업로드(Storage)
//   + GitHub API 로 PR 자동 생성 → stories/<slug>.html + data/stories.json 갱신.
//
// 핵심 흐름
//   1. 편집부 게이트 (is_editor) → app 노출
//   2. URL ?id=<uuid> 또는 ?slug=<slug> 가 있으면 기존 초안 로드, 없으면 새 초안
//   3. 메타·본문 입력 → 1.5s debounce 자동저장 (article_drafts upsert)
//   4. 이미지 업로드 → image-processor 로 1600px webp 변환 → Supabase Storage
//   5. PR 만들기 → buildArticleHtml() 로 정적 HTML 생성 → GitHub API 로 push
//
// GitHub PAT 는 localStorage('5ft-gh-pat') 에 저장. repo scope 필요.

(function () {
  const REPO = '4restyou/5ftmag-website';
  const BASE_BRANCH = 'main';
  const PAT_KEY = '5ft-gh-pat';
  const AUTOSAVE_MS = 1500;

  const STATE = {
    user: null,
    profile: null,
    id: null,                  // draft uuid (있으면 update)
    slugLocked: false,         // 한 번 저장된 slug 는 변경 시 새 초안 분리
    meta: {
      slug: '',
      title: '',
      subtitle: '',
      category: 'essay',
      category_label: 'ESSAY',
      byline: '5ft.mag 편집부',
      date_iso: new Date().toISOString().slice(0, 10),
      hero_image: '',
      hero_alt: '',
      hero_caption: '',
      excerpt: '',
    },
    bodyDirty: false,
    saving: false,
    saveTimer: null,
  };

  function $(id) { return document.getElementById(id); }
  function db() { return window.MagDB; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escAttr(s) { return esc(s); }

  function showGate(msg) {
    $('gate').hidden = false;
    $('app').hidden = true;
    if (msg) $('gate').querySelector('p').textContent = msg;
  }

  async function checkAccess() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise(r => setTimeout(r, 50)); }
    if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
    const session = await db().auth.getSession();
    if (!session) { showGate(); return false; }
    STATE.user = session.user;
    const profile = await db().profiles.getMine();
    if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
    STATE.profile = profile;
    $('adminUser').innerHTML = `${esc(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
    $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
    return true;
  }

  $('gateLogin').addEventListener('click', async () => { await db().auth.signInWithGoogle(window.location.href); });

  // ── Slug 자동 생성 ──
  function autoSlugFromTitle(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[ㄱ-힣]+/g, '')       // 한글 제거 (slug 는 영문만)
      .replace(/[^a-z0-9\s-]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60);
  }

  // ── 메타 ↔ UI 바인딩 ──
  function bindMeta() {
    const map = {
      'meta-slug': 'slug',
      'meta-title': 'title',
      'meta-subtitle': 'subtitle',
      'meta-category': 'category',
      'meta-category-label': 'category_label',
      'meta-byline': 'byline',
      'meta-date': 'date_iso',
      'meta-hero-alt': 'hero_alt',
      'meta-hero-caption': 'hero_caption',
      'meta-excerpt': 'excerpt',
    };
    for (const [id, key] of Object.entries(map)) {
      const el = $(id);
      el.addEventListener('input', () => {
        STATE.meta[key] = el.value;
        if (id === 'meta-title' && !STATE.slugLocked && !$('meta-slug').value) {
          const s = autoSlugFromTitle(el.value);
          $('meta-slug').value = s; STATE.meta.slug = s;
        }
        if (id === 'meta-category') {
          // 라벨 기본값 자동 채움 (사용자가 수정한 적 없으면)
          const labelEl = $('meta-category-label');
          if (!labelEl.dataset.touched) labelEl.value = el.value.toUpperCase();
        }
        scheduleSave();
      });
      if (id === 'meta-category-label') {
        el.addEventListener('input', () => { el.dataset.touched = '1'; });
      }
    }
    $('meta-date').value = STATE.meta.date_iso;
  }

  function loadMetaIntoUi() {
    $('meta-slug').value = STATE.meta.slug || '';
    $('meta-title').value = STATE.meta.title || '';
    $('meta-subtitle').value = STATE.meta.subtitle || '';
    $('meta-category').value = STATE.meta.category || 'essay';
    $('meta-category-label').value = STATE.meta.category_label || 'ESSAY';
    $('meta-byline').value = STATE.meta.byline || '5ft.mag 편집부';
    $('meta-date').value = STATE.meta.date_iso || new Date().toISOString().slice(0, 10);
    $('meta-hero-alt').value = STATE.meta.hero_alt || '';
    $('meta-hero-caption').value = STATE.meta.hero_caption || '';
    $('meta-excerpt').value = STATE.meta.excerpt || '';
    renderHeroPreview();
  }

  function renderHeroPreview() {
    const wrap = $('hero-preview');
    if (STATE.meta.hero_image) {
      wrap.innerHTML = `<img src="${escAttr(STATE.meta.hero_image)}" alt="" />`;
    } else {
      wrap.innerHTML = '<span class="placeholder">이미지 없음</span>';
    }
  }

  // ── 이미지 업로드 (image-processor 재활용) ──
  async function uploadImage(file) {
    if (!file) return null;
    if (typeof window.processImageForUpload !== 'function') {
      alert('이미지 변환 모듈이 로드되지 않았어요. 새로고침 후 다시 시도해주세요.');
      return null;
    }
    setStatus('이미지 업로드 중…', 'saving');
    try {
      const { blob } = await window.processImageForUpload(file, { maxLongSide: 1600, quality: 0.85 });
      const name = `${STATE.meta.slug || 'draft'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const path = `${STATE.user.id}/${name}`;
      const { error } = await db().articles.uploadMedia(path, blob);
      if (error) { alert('업로드 실패: ' + error.message); setStatus('업로드 실패', 'error'); return null; }
      const url = db().articles.publicUrl(path);
      setStatus('이미지 업로드 완료', 'ok');
      return url;
    } catch (err) {
      alert('이미지 변환 실패: ' + err.message);
      setStatus('업로드 실패', 'error');
      return null;
    }
  }

  // ── Hero 이미지 ──
  $('hero-upload-btn').addEventListener('click', () => $('hero-file').click());
  $('hero-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadImage(file);
    if (url) { STATE.meta.hero_image = url; renderHeroPreview(); scheduleSave(); }
    e.target.value = '';
  });
  $('hero-clear-btn').addEventListener('click', () => {
    STATE.meta.hero_image = ''; renderHeroPreview(); scheduleSave();
  });

  // ── 에디터: contenteditable 툴바 ──
  const editor = $('editor');

  function updateEmpty() {
    const isEmpty = editor.textContent.trim() === '' && editor.children.length <= 1
                    && (!editor.firstElementChild || editor.firstElementChild.textContent === '');
    editor.dataset.empty = isEmpty ? 'true' : 'false';
  }

  function exec(cmd, value = null) {
    editor.focus();
    document.execCommand(cmd, false, value);
    scheduleSave();
    updateToolbarState();
  }

  function setBlock(tag) {
    editor.focus();
    document.execCommand('formatBlock', false, tag.toUpperCase());
    scheduleSave();
    updateToolbarState();
  }

  function updateToolbarState() {
    const checks = ['bold', 'italic', 'underline'];
    for (const c of checks) {
      const btn = document.querySelector(`.ae-tb-btn[data-cmd="${c}"]`);
      if (btn) btn.classList.toggle('is-active', document.queryCommandState(c));
    }
  }

  document.querySelectorAll('.ae-tb-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => exec(btn.dataset.cmd));
  });
  document.querySelectorAll('.ae-tb-btn[data-block]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => setBlock(btn.dataset.block));
  });

  // 액션 버튼 (link/unlink/image/video/hr)
  document.querySelector('.ae-tb-btn[data-action="link"]').addEventListener('click', () => openLinkModal());
  document.querySelector('.ae-tb-btn[data-action="unlink"]').addEventListener('click', () => exec('unlink'));
  document.querySelector('.ae-tb-btn[data-action="image"]').addEventListener('click', () => $('image-file').click());
  document.querySelector('.ae-tb-btn[data-action="video"]').addEventListener('click', () => openVideoModal());
  document.querySelector('.ae-tb-btn[data-action="hr"]').addEventListener('click', () => {
    insertHtmlAtCursor('<hr />');
  });

  $('image-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const url = await uploadImage(file);
    if (url) {
      const fig = `<figure><img src="${escAttr(url)}" alt="" /><figcaption>캡션을 여기에 입력</figcaption></figure><p><br></p>`;
      insertHtmlAtCursor(fig);
    }
    e.target.value = '';
  });

  function insertHtmlAtCursor(html) {
    editor.focus();
    document.execCommand('insertHTML', false, html);
    scheduleSave();
  }

  // ── 링크 모달 ──
  let savedRange = null;
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  function openLinkModal() {
    saveSelection();
    $('link-url').value = '';
    $('link-modal').classList.add('is-open');
    setTimeout(() => $('link-url').focus(), 50);
  }
  $('link-cancel').addEventListener('click', () => $('link-modal').classList.remove('is-open'));
  $('link-apply').addEventListener('click', () => {
    const url = $('link-url').value.trim();
    if (!url) return;
    $('link-modal').classList.remove('is-open');
    restoreSelection();
    // createLink 후 새 탭 + rel 보정
    document.execCommand('createLink', false, url);
    // 방금 만든 <a> 찾기 — 선택 영역 기준
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const node = sel.getRangeAt(0).startContainer;
      const a = (node.nodeType === 1 ? node : node.parentElement)?.closest('a');
      if (a) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      }
    }
    scheduleSave();
  });

  // ── 영상 임베드 ──
  function openVideoModal() {
    saveSelection();
    $('video-url').value = '';
    $('video-modal').classList.add('is-open');
    setTimeout(() => $('video-url').focus(), 50);
  }
  $('video-cancel').addEventListener('click', () => $('video-modal').classList.remove('is-open'));
  $('video-apply').addEventListener('click', () => {
    const url = $('video-url').value.trim();
    const embed = videoEmbedUrl(url);
    if (!embed) { alert('YouTube 또는 Vimeo URL 만 지원합니다.'); return; }
    $('video-modal').classList.remove('is-open');
    restoreSelection();
    const html = `<figure><iframe src="${escAttr(embed)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe><figcaption>영상 캡션</figcaption></figure><p><br></p>`;
    insertHtmlAtCursor(html);
  });

  function videoEmbedUrl(url) {
    if (!url) return null;
    let m = url.match(/youtube\.com\/watch\?[^#]*v=([\w-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = url.match(/youtu\.be\/([\w-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }

  // ── 자동저장 ──
  function setStatus(text, cls = '') {
    const el = $('status');
    el.textContent = text;
    el.className = 'ae-status' + (cls ? ' is-' + cls : '');
  }

  function scheduleSave() {
    STATE.bodyDirty = true;
    clearTimeout(STATE.saveTimer);
    setStatus('편집 중…');
    STATE.saveTimer = setTimeout(doSave, AUTOSAVE_MS);
  }

  async function doSave() {
    if (STATE.saving) return;
    if (!STATE.meta.slug || !STATE.meta.title) { setStatus('slug 와 제목을 먼저 입력해주세요', 'error'); return; }
    STATE.saving = true;
    setStatus('저장 중…', 'saving');
    try {
      const body_html = sanitizeBodyHtml(editor.innerHTML);
      const row = { ...STATE.meta, body_html, body_json: { html: body_html } };
      if (STATE.id) row.id = STATE.id;
      const { data, error } = await db().articles.upsertDraft(row);
      if (error) { setStatus('저장 실패: ' + error.message, 'error'); STATE.saving = false; return; }
      STATE.id = data.id;
      STATE.slugLocked = true;
      const t = new Date(data.updated_at);
      setStatus(`저장 ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`, 'ok');
      // URL 에 id 반영 (새로고침 후 같은 초안 로드)
      const u = new URL(location.href);
      if (u.searchParams.get('id') !== data.id) {
        u.searchParams.set('id', data.id);
        history.replaceState(null, '', u.toString());
      }
    } catch (err) {
      setStatus('저장 실패: ' + err.message, 'error');
    } finally {
      STATE.saving = false;
    }
  }

  $('btn-save').addEventListener('click', () => { clearTimeout(STATE.saveTimer); doSave(); });

  // ── 본문 HTML 정리 (XSS·잡태그 제거) ──
  function sanitizeBodyHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // script/style 제거
    tmp.querySelectorAll('script, style').forEach(n => n.remove());
    // 위험한 속성 정리
    tmp.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        if (n === 'style') el.removeAttribute('style');
        if ((n === 'href' || n === 'src') && /^javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      });
    });
    return tmp.innerHTML.trim();
  }

  editor.addEventListener('input', () => { updateEmpty(); scheduleSave(); });
  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('mouseup', updateToolbarState);
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openLinkModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(STATE.saveTimer); doSave(); }
  });

  // ── 미리보기 ──
  $('btn-preview').addEventListener('click', () => {
    $('preview-meta').textContent = `${STATE.meta.category_label} · ${formatDateKr(STATE.meta.date_iso)}`;
    $('preview-title').textContent = STATE.meta.title || '(제목 없음)';
    $('preview-subtitle').textContent = STATE.meta.subtitle || '';
    $('preview-byline').textContent = STATE.meta.byline;
    const hero = $('preview-hero');
    if (STATE.meta.hero_image) {
      hero.innerHTML = `<img src="${escAttr(STATE.meta.hero_image)}" alt="${escAttr(STATE.meta.hero_alt)}" style="width:100%;border-radius:4px;" />` +
        (STATE.meta.hero_caption ? `<figcaption style="font-size:13px;color:var(--text-muted);text-align:center;margin-top:6px;">${esc(STATE.meta.hero_caption)}</figcaption>` : '');
    } else { hero.innerHTML = ''; }
    $('preview-body').innerHTML = sanitizeBodyHtml(editor.innerHTML);
    $('preview').classList.add('is-open');
  });
  $('preview-close').addEventListener('click', () => $('preview').classList.remove('is-open'));

  function formatDateKr(iso) {
    if (!iso) return '';
    return iso.replace(/-/g, '.');
  }

  // ── 정적 HTML 빌드 (scripts/templates/story.html 패턴 인라인) ──
  function buildArticleHtml() {
    const m = STATE.meta;
    const bodyHtml = sanitizeBodyHtml(editor.innerHTML);
    const heroAbs = m.hero_image; // 절대 URL (Supabase Storage)
    const heroPath = heroAbs.startsWith('http') ? heroAbs : `https://www.5ftmag.com/${heroAbs.replace(/^\//, '')}`;

    const title = esc(m.title);
    const desc = esc(m.excerpt || m.subtitle || m.title);
    const dateIso = m.date_iso;
    const heroAlt = esc(m.hero_alt || m.title);
    const heroCaption = m.hero_caption ? `<figcaption style="text-align:center; font-size:12px; color:var(--text-muted); margin-top:6px;">${esc(m.hero_caption)}</figcaption>` : '';
    const subtitle = m.subtitle ? `<p class="article-subtitle">${esc(m.subtitle)}</p>` : '';

    return `<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <base href="/">
  <meta name="color-scheme" content="light dark">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | 5ft magazine</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="https://www.5ftmag.com/stories/${esc(m.slug)}.html">

  <link rel="alternate" type="application/rss+xml" title="5ft magazine RSS" href="../rss.xml">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title} | 5ft magazine">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="${escAttr(heroPath)}">
  <meta property="og:url" content="https://www.5ftmag.com/stories/${esc(m.slug)}.html">
  <meta property="og:site_name" content="5ft magazine">
  <meta property="og:locale" content="ko_KR">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${escAttr(heroPath)}">

  <script type="application/ld+json">
  {
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": ${JSON.stringify(m.title)},
  "description": ${JSON.stringify(m.excerpt || m.subtitle || m.title)},
  "image": [
    ${JSON.stringify(heroPath)}
  ],
  "datePublished": "${dateIso}",
  "author": { "@type": "Organization", "name": ${JSON.stringify(m.byline)} },
  "publisher": { "@type": "Organization", "name": "5ft magazine", "logo": { "@type": "ImageObject", "url": "https://www.5ftmag.com/img/favicon/icon-512.png" } },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://www.5ftmag.com/stories/${esc(m.slug)}.html" },
  "articleSection": ${JSON.stringify(m.category_label)},
  "inLanguage": "ko-KR"
}
  </script>

  <link rel="icon" type="image/svg+xml" href="../img/favicon/icon.svg">
  <link rel="shortcut icon" href="../img/favicon/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="../img/favicon/icon-180.png">
  <script src="../js/theme-init.js"></script>
  <link rel="stylesheet" href="../pretendard.css" />
  <link rel="stylesheet" href="../css/tokens.css?v=20260613-editor">
  <link rel="stylesheet" href="../css/common.css?v=20260613-editor">
  <link rel="stylesheet" href="../css/article.css?v=20260612-shareclean">
  <link rel="stylesheet" href="../css/comments.css">
</head>
<body>

<header>
  <div class="header-inner">
    <a href="../index.html" class="site-logo"><img src="../img/symbol-b.svg" alt="5ft magazine" class="logo-light" /><img src="../img/symbol-w.svg" alt="5ft magazine" class="logo-dark" /></a>
    <ul class="main-nav">
      <li><a href="../stories.html" class="current">Articles</a></li>
      <li><a href="../films.html">Films</a></li>
      <li><a href="../webzine.html">Webzine</a></li>
      <li><a href="../labs.html">Labs</a></li>
      <li><a href="../market.html">Market</a></li>
      <li><a href="../about.html">About</a></li>
      <li><a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener" class="ext">Shop</a></li>
    </ul>
    <div class="nav-right">
      <a href="../search.html" class="icon-btn" aria-label="전체 검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg></a>
      <button class="icon-btn" id="themeBtn" type="button" aria-label="테마 전환">☽</button>
      <button class="icon-btn hamburger" id="menuBtn" type="button" aria-label="메뉴">☰</button>
    </div>
  </div>
  <nav class="mobile-nav" id="mobileNav">
    <a href="../stories.html">Articles</a><a href="../films.html">Films</a><a href="../webzine.html">Webzine</a>
    <a href="../labs.html">Labs</a><a href="../market.html">Market</a><a href="../about.html">About</a>
    <a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener">Shop ↗</a>
  </nav>
</header>

<article>
  <div class="article-header">
    <a href="../stories.html" class="article-back">← Stories</a>
    <div class="article-meta">
      <span class="article-tag">${esc(m.category_label)}</span>
      <span class="dot"></span>
      <span class="article-tag">${dateIso.slice(0, 4)} / ${parseInt(dateIso.slice(5, 7), 10)}</span>
    </div>
    <h1 class="article-title">${title}</h1>
    ${subtitle}
    <div class="article-author">
      <span class="author-name">${esc(m.byline)}</span>
      <span class="dot"></span>
      <span class="date">${formatDateKr(dateIso)}</span>
    </div>
  </div>

  <div class="article-hero">
    <picture><img src="${escAttr(heroPath)}" alt="${heroAlt}" loading="lazy" /></picture>
    ${heroCaption}
  </div>

  <div class="article-body">
${bodyHtml}
  </div>

  <div class="article-end">
    <p class="article-signature"><span class="role">글</span>${esc(m.byline)}</p>
    <div class="share-bar">
      <span class="share-label">SHARE</span>
      <button type="button" data-action="copy-link">링크 복사</button>
      <a href="https://www.instagram.com/5ft.magazine" target="_blank" rel="noopener">Instagram ↗</a>
    </div>
  </div>
</article>

<section data-comments data-page-id="stories/${esc(m.slug)}"></section>

<nav class="article-nav" style="grid-template-columns: 1fr;">
  <a href="../stories.html" class="prev-article" style="text-align: center;">
    <span class="nav-label">← 목록으로</span>
    <span class="nav-title">Stories 전체 보기</span>
  </a>
</nav>

<footer>
  <div class="footer-inner-left">
    <span class="footer-logo">5ft magazine</span>
    <span class="footer-publisher">발행처 4rest · 편집 박순렬 · 광주광역시 동구 충장로46번길 8, 2층</span>
  </div>
  <div class="footer-links">
    <a href="https://smartstore.naver.com/film_socialclub" target="_blank" rel="noopener">Shop ↗</a>
    <a href="https://instagram.com/5ft.magazine" target="_blank" rel="noopener">@5ft.magazine ↗</a>
    <a href="mailto:4rest_design@naver.com">4rest_design@naver.com</a>
    <a href="https://www.4rest.net" target="_blank" rel="noopener">4rest.net ↗</a>
  </div>
  <span class="footer-copy">© 2024 5ft magazine</span>
</footer>

<script src="../js/util.js?v=20260602-normalize" defer></script>
<script src="../js/site-common.js?v=20260609-share" defer></script>
<script src="../js/article-author-bio.js?v=20260609-related" defer></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" defer></script>
<script src="../js/db-client.js?v=20260613-editor" defer></script>
<script src="../js/comments.js?v=20260523-successtoast" defer></script>
</body>
</html>
`;
  }

  // ── stories.json patch (새 entry 최상단 추가) ──
  function buildStoriesJsonPatch(currentJsonText) {
    const list = JSON.parse(currentJsonText);
    const m = STATE.meta;
    const entry = {
      id: m.slug,
      title: m.title,
      category: m.category,
      categoryLabel: m.category_label,
      author: m.byline,
      date: m.date_iso,
      issue: '',
      thumbnail: m.hero_image.startsWith('http') ? m.hero_image : `img/${m.hero_image.replace(/^img\//, '')}`,
      excerpt: m.excerpt || m.subtitle || '',
      page: `stories/${m.slug}.html`,
      published: true,
      manual: true,
    };
    // 이미 있으면 갱신, 없으면 최상단 추가
    const idx = list.findIndex(x => x.id === m.slug);
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);
    return JSON.stringify(list, null, 2) + '\n';
  }

  // ── GitHub PAT ──
  function getPat() { return localStorage.getItem(PAT_KEY) || ''; }
  function setPat(v) { if (v) localStorage.setItem(PAT_KEY, v); else localStorage.removeItem(PAT_KEY); }

  function openPatModal() {
    $('pat-input').value = getPat();
    $('pat-modal').classList.add('is-open');
    setTimeout(() => $('pat-input').focus(), 50);
  }
  $('pat-cancel').addEventListener('click', () => $('pat-modal').classList.remove('is-open'));
  $('pat-apply').addEventListener('click', () => {
    setPat($('pat-input').value.trim());
    $('pat-modal').classList.remove('is-open');
    // 모달 닫힌 직후 PR 흐름 재시도
    if (STATE._pendingPublish) { STATE._pendingPublish = false; doPublish(); }
  });

  // ── GitHub API helpers ──
  async function gh(method, path, body) {
    const pat = getPat();
    if (!pat) throw new Error('PAT 없음');
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Accept': 'application/vnd.github+json',
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

  function b64encodeUtf8(s) {
    return btoa(unescape(encodeURIComponent(s)));
  }

  // ── 발행 (PR 만들기) ──
  $('btn-publish').addEventListener('click', () => doPublish());

  async function doPublish() {
    if (!STATE.meta.slug || !STATE.meta.title || !STATE.meta.hero_image) {
      alert('slug, 제목, 대표 이미지는 필수입니다.');
      return;
    }
    if (!getPat()) {
      STATE._pendingPublish = true;
      openPatModal();
      return;
    }

    const btn = $('btn-publish');
    btn.disabled = true;
    setStatus('PR 생성 중…', 'saving');
    try {
      // 1) 최신 저장
      await doSave();

      // 2) main 브랜치의 최신 SHA 얻기
      const mainRef = await gh('GET', `/repos/${REPO}/git/refs/heads/${BASE_BRANCH}`);
      const mainSha = mainRef.object.sha;

      // 3) 새 브랜치 생성 (이미 있으면 timestamp 붙임)
      let branch = `claude/publish-${STATE.meta.slug}`;
      try {
        await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: mainSha });
      } catch (err) {
        if (/422|already exists/i.test(err.message)) {
          branch = `${branch}-${Date.now().toString(36)}`;
          await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: mainSha });
        } else throw err;
      }

      // 4) stories/<slug>.html 생성
      const html = buildArticleHtml();
      await gh('PUT', `/repos/${REPO}/contents/stories/${STATE.meta.slug}.html`, {
        message: `feat(stories): ${STATE.meta.title}`,
        content: b64encodeUtf8(html),
        branch,
      });

      // 5) data/stories.json 갱신 (현재 main 의 파일 읽고 patch)
      const cur = await gh('GET', `/repos/${REPO}/contents/data/stories.json?ref=${branch}`);
      const curText = decodeURIComponent(escape(atob(cur.content.replace(/\n/g, ''))));
      const nextText = buildStoriesJsonPatch(curText);
      await gh('PUT', `/repos/${REPO}/contents/data/stories.json`, {
        message: `feat(stories): ${STATE.meta.title} 등록`,
        content: b64encodeUtf8(nextText),
        sha: cur.sha,
        branch,
      });

      // 6) PR 생성
      const pr = await gh('POST', `/repos/${REPO}/pulls`, {
        title: `feat(stories): ${STATE.meta.title}`,
        head: branch,
        base: BASE_BRANCH,
        body: `편집부 에디터에서 자동 생성된 PR.\n\n- slug: ${STATE.meta.slug}\n- 카테고리: ${STATE.meta.category_label}\n- 작성자: ${STATE.meta.byline}`,
      });

      setStatus('PR 생성 완료', 'ok');
      alert(`PR 생성됨: ${pr.html_url}\n\nCI 통과 후 머지하면 라이브에 노출됩니다.`);
      window.open(pr.html_url, '_blank');
    } catch (err) {
      console.error(err);
      setStatus('PR 생성 실패: ' + err.message, 'error');
      if (/PAT 없음|401/.test(err.message)) {
        alert('GitHub 인증 실패. PAT 을 다시 확인해주세요.');
        openPatModal();
      } else {
        alert('PR 생성 실패: ' + err.message);
      }
    } finally {
      btn.disabled = false;
    }
  }

  // ── 초안 로드 ──
  async function loadDraftIfAny() {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const slug = params.get('slug');
    if (!id && !slug) return false;
    const row = await db().articles.getDraft(id || slug);
    if (!row) return false;
    STATE.id = row.id;
    STATE.slugLocked = true;
    STATE.meta = {
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      category: row.category,
      category_label: row.category_label,
      byline: row.byline,
      date_iso: row.date_iso,
      hero_image: row.hero_image,
      hero_alt: row.hero_alt,
      hero_caption: row.hero_caption,
      excerpt: row.excerpt,
    };
    loadMetaIntoUi();
    editor.innerHTML = row.body_html || '';
    updateEmpty();
    setStatus('초안 로드됨');
    return true;
  }

  // ── 시작 ──
  (async function start() {
    if (!(await checkAccess())) return;
    $('app').hidden = false;
    bindMeta();
    loadMetaIntoUi();
    await loadDraftIfAny();
    updateEmpty();
    updateToolbarState();
  })();
})();
