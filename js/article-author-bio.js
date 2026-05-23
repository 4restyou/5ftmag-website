// stories/*.html 페이지의 끝에 작가 bio 카드 + 같은 작가의 다른 글 3개를 inject.
// .article-author .author-name 의 텍스트를 읽어 authors.json·stories.json 과 매칭.

(async function () {
  const nameEl = document.querySelector('.article-author .author-name');
  const articleEl = document.querySelector('article');
  if (!nameEl || !articleEl) return;

  const authorName = nameEl.textContent.trim();
  if (!authorName) return;

  let authors, stories;
  try {
    [authors, stories] = await Promise.all([
      fetch('/data/authors.json').then((r) => r.json()),
      fetch('/data/stories.json').then((r) => r.json()),
    ]);
  } catch (_) {
    return;
  }

  const author = authors.find((a) => a.name === authorName);
  if (!author) return;

  const currentPath = location.pathname.replace(/^\//, '');
  const related = stories
    .filter((s) => s.author === authorName && s.published !== false && s.page !== currentPath)
    .slice(0, 3);

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
    relatedSection.innerHTML = `
      <h4 class="related-header">${escapeText(authorName)}의 다른 글</h4>
      <div class="related-grid">
        ${related.map((s) => `
          <a class="related-card" href="/${escapeAttr(s.page)}">
            ${s.thumbnail ? `<div class="related-card-img"><img src="/${escapeAttr(s.thumbnail)}" alt="${escapeAttr(s.title)}" loading="lazy"></div>` : '<div class="related-card-img is-text"></div>'}
            <h5>${escapeText(s.title)}</h5>
          </a>`).join('')}
      </div>`;
  }

  const shareBar = articleEl.querySelector('.share-bar');
  if (shareBar) {
    articleEl.insertBefore(bioSection, shareBar);
    if (relatedSection) articleEl.insertBefore(relatedSection, shareBar);
  } else {
    articleEl.appendChild(bioSection);
    if (relatedSection) articleEl.appendChild(relatedSection);
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
