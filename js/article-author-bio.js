// 글 페이지(article) 하단 보강:
//   1) 작가 bio 카드 + 같은 작가의 다른 글 3개
//   2) 이전/다음 글 네비게이션 (.article-nav 채우기)
// .article-author .author-name 텍스트와 location.pathname 을 authors.json·stories.json 과 매칭.

(async function () {
  const articleEl = document.querySelector('article');
  if (!articleEl) return;

  let authors, stories;
  try {
    [authors, stories] = await Promise.all([
      fetch('/data/authors.json').then((r) => r.json()),
      fetch('/data/stories.json').then((r) => r.json()),
    ]);
  } catch (_) {
    return;
  }

  const currentPath = location.pathname.replace(/^\//, '');

  buildAuthorBio(authors, stories, currentPath);
  buildPrevNext(stories, currentPath);

  // ── 작가 bio + 같은 작가 다른 글 ──
  function buildAuthorBio(authors, stories, currentPath) {
    const nameEl = document.querySelector('.article-author .author-name');
    if (!nameEl) return;
    const authorName = nameEl.textContent.trim();
    if (!authorName) return;

    const author = authors.find((a) => a.name === authorName);
    if (!author) return;

    // 1순위: 같은 작가의 다른 글. 부족하면 같은 카테고리 글로 보충 (최신순).
    const current = stories.find((s) => s.page === currentPath);
    const sameAuthor = stories
      .filter((s) => s.author === authorName && s.published !== false && s.page !== currentPath);
    let related = sameAuthor.slice(0, 3);
    let relatedFromCategory = false;
    if (related.length < 3 && current) {
      const usedPages = new Set(related.map((s) => s.page).concat(currentPath));
      const sameCategory = stories
        .filter((s) => s.published !== false && !usedPages.has(s.page)
          && (s.category === current.category || s.categoryLabel === current.categoryLabel))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      if (sameCategory.length) relatedFromCategory = true;
      related = related.concat(sameCategory).slice(0, 3);
    }

    const bioSection = document.createElement('section');
    bioSection.className = 'article-author-bio';
    bioSection.innerHTML = `
      <a class="author-bio-card" href="/authors/${escapeAttr(author.slug)}.html">
        <h3>${escapeText(author.name)}</h3>
        <p>${escapeText(author.note || '')}</p>
        <span class="author-bio-link">${author.count}개의 글 보기 →</span>
      </a>`;

    let relatedSection = null;
    if (related.length > 0) {
      relatedSection = document.createElement('section');
      relatedSection.className = 'related-by-author';
      const relatedHeader = (sameAuthor.length > 0 && !relatedFromCategory)
        ? `${escapeText(authorName)}의 다른 글`
        : '함께 보면 좋은 글';
      relatedSection.innerHTML = `
        <h4 class="related-header">${relatedHeader}</h4>
        <div class="related-grid">
          ${related.map((s) => `
            <a class="related-card" href="/${escapeAttr(s.page)}">
              ${s.thumbnail ? `<div class="related-card-img"><img src="/${escapeAttr(s.thumbnail)}" alt="${escapeAttr(s.title)}" loading="lazy"></div>` : '<div class="related-card-img is-text"></div>'}
              <h5>${escapeText(s.title)}</h5>
            </a>`).join('')}
        </div>`;
    }

    // .share-bar 는 .article-end 안에 중첩돼 있어 article 의 직계 자식이 아니다.
    // insertBefore 의 기준 노드는 직계 자식이어야 하므로, share-bar 를 품은
    // 최상위 자식(보통 .article-end)을 찾아 그 앞에 끼운다.
    const shareBar = articleEl.querySelector('.share-bar');
    let ref = shareBar;
    while (ref && ref.parentNode !== articleEl) ref = ref.parentNode;
    if (ref) {
      articleEl.insertBefore(bioSection, ref);
      if (relatedSection) articleEl.insertBefore(relatedSection, ref);
    } else {
      articleEl.appendChild(bioSection);
      if (relatedSection) articleEl.appendChild(relatedSection);
    }
  }

  // ── 이전/다음 글 네비 ──
  function buildPrevNext(stories, currentPath) {
    const nav = document.querySelector('.article-nav');
    if (!nav) return;

    const sorted = stories
      .filter((s) => s.published !== false)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const idx = sorted.findIndex((s) => s.page === currentPath);
    if (idx === -1) return; // 매칭 실패 시 기존 "목록으로" 유지

    const newer = sorted[idx - 1]; // 더 최신 (다음 글)
    const older = sorted[idx + 1]; // 더 오래된 (이전 글)
    if (!newer && !older) return;

    function cell(story, dir) {
      const cls = dir === 'prev' ? 'prev-article' : 'next-article';
      if (story) {
        const label = dir === 'prev' ? '← 이전 글' : '다음 글 →';
        return `<a class="${cls}" href="/${escapeAttr(story.page)}">
          <span class="nav-label">${label}</span>
          <span class="nav-title">${escapeText(story.title)}</span>
        </a>`;
      }
      const label = dir === 'prev' ? '← 목록으로' : '목록으로 →';
      return `<a class="${cls}" href="/stories.html">
        <span class="nav-label">${label}</span>
        <span class="nav-title">Stories 전체 보기</span>
      </a>`;
    }

    nav.style.gridTemplateColumns = '1fr 1fr';
    nav.innerHTML = cell(older, 'prev') + cell(newer, 'next');
  }

  function escapeText(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
  }
  function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
})();
