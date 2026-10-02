// /film/<slug> 상세 페이지에서 그 필름으로 찍은 독자 사진을 불러와 보여준다.
//
// 이 페이지는 공유 링크가 도착하는 자리다. 규격만 있고 사진이 없으면 공유받은
// 사람이 "카탈로그에서 보기" 를 한 번 더 눌러야 사진에 닿는데, 그건 공유한
// 의도와 맞지 않는다. 그래서 사진을 이 페이지에서 바로 보여준다.
//
// 사진은 Supabase 에 있어 정적 생성 시점에 넣을 수 없다. 페이지 뼈대(규격·설명·
// 별칭)는 HTML 에 들어 있으므로 크롤러가 읽을 내용은 이미 확보돼 있고,
// 여기서 더하는 것은 사람이 볼 사진이다.

(function () {
  'use strict';

  // 모든 페이지가 js/i18n.js 를 먼저 싣는다(한국어판에선 한국어를 돌려준다).
  const i18n = window.i18n;
  const tr = i18n.t;

  const root = document.getElementById('filmReaderPhotos');
  if (!root) return;

  const escapeHtml = window.MagUtil.escapeHtml;
  const escapeAttr = window.MagUtil.escapeAttr;

  const filmNames = (() => {
    try { return JSON.parse(root.dataset.filmNames || '[]'); } catch (_) { return []; }
  })();
  const filmLabel = root.dataset.filmLabel || '';
  const MAX_PHOTOS = 24;

  async function waitForDb(timeoutMs = 6000) {
    const step = 100;
    for (let waited = 0; waited < timeoutMs; waited += step) {
      if (window.MagDB?.isReady?.() && window.MagDB.submissions?.listApprovedByFilms) return true;
      await new Promise((resolve) => setTimeout(resolve, step));
    }
    return false;
  }

  function cellHtml(photo, index) {
    const who = photo.submitterName || photo.instagram || '';
    const alt = tr(`${filmLabel} 로 찍은 사진${who ? `. 촬영 ${who}` : ''}`, `Shot on ${filmLabel}${who ? ` by ${who}` : ''}`, `${filmLabel} で撮った写真${who ? `。撮影 ${who}` : ''}`);
    return `<button type="button" class="film-shot" data-shot="${index}" aria-label="${escapeAttr(tr(`${alt} 크게 보기`, `View larger: ${alt}`, `${alt} を拡大表示`))}">
      <img src="${escapeAttr(photo.image)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" />
      ${who ? `<span class="film-shot-who">${escapeHtml(who)}</span>` : ''}
    </button>`;
  }

  // 라이트박스는 이 페이지에서만 쓰므로 카탈로그 코드를 가져오지 않고 최소로 만든다.
  function buildLightbox(photos) {
    let index = 0;
    const box = document.createElement('div');
    box.className = 'film-lightbox';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', tr('사진 크게 보기', 'Photo viewer', '写真を拡大表示'));
    box.innerHTML = `
      <button type="button" class="film-lightbox-close" aria-label="${tr('닫기', 'Close', '閉じる')}">✕</button>
      <button type="button" class="film-lightbox-prev" aria-label="${tr('이전 사진', 'Previous photo', '前の写真')}">‹</button>
      <button type="button" class="film-lightbox-next" aria-label="${tr('다음 사진', 'Next photo', '次の写真')}">›</button>
      <figure>
        <img alt="" />
        <figcaption></figcaption>
      </figure>`;
    document.body.appendChild(box);

    const img = box.querySelector('img');
    const caption = box.querySelector('figcaption');

    // 편집부로 로그인했을 때만 이주의 사진으로 걸 수 있는 버튼이 캡션에 붙는다.
    // 검색으로 이 페이지에 들어온 편집부도 발견한 자리에서 바로 걸 수 있어야 한다.
    let isEditorUser = null;
    async function checkEditor() {
      if (isEditorUser !== null) return isEditorUser;
      isEditorUser = false;
      try {
        if (!window.MagDB?.isReady?.()) return false;
        if (!(await window.MagDB.auth.getSession())) return false;
        const profile = await window.MagDB.profiles?.getMine?.();
        isEditorUser = !!(profile && profile.is_editor);
      } catch (_) { isEditorUser = false; }
      return isEditorUser;
    }
    caption.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-feature-sub]');
      if (!btn || !window.PotwPicker) return;
      e.stopPropagation();
      await window.PotwPicker.pick(btn.dataset.featureSub);
    });

    function paint() {
      const photo = photos[index];
      if (!photo) return;
      img.src = photo.image;
      const who = photo.submitterName || photo.instagram || '';
      img.alt = tr(`${filmLabel} 로 찍은 사진${who ? `. 촬영 ${who}` : ''}`, `Shot on ${filmLabel}${who ? ` by ${who}` : ''}`, `${filmLabel} で撮った写真${who ? `。撮影 ${who}` : ''}`);
      const bits = [who, photo.camera, photo.caption].filter(Boolean).map(escapeHtml);
      caption.innerHTML = bits.join(' · ');

      // 'sub-' 접두사가 붙은 것만 독자 투고다.
      const subId = (typeof photo.id === 'string' && photo.id.startsWith('sub-')) ? photo.id.slice(4) : '';
      if (!subId) return;
      checkEditor().then((ok) => {
        if (!ok || photos[index] !== photo) return;   // 그새 사진이 넘어갔으면 붙이지 않는다
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'film-lightbox-potw';
        b.dataset.featureSub = subId;
        b.textContent = tr('이주의 사진으로 걸기', 'Set as Photo of the Week', '今週の写真に設定');
        caption.appendChild(b);
      });
    }
    function open(next) {
      index = next;
      paint();
      box.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      box.querySelector('.film-lightbox-close').focus();
    }
    function close() {
      box.hidden = true;
      document.documentElement.style.overflow = '';
    }
    function move(step) {
      index = (index + step + photos.length) % photos.length;
      paint();
    }

    box.addEventListener('click', (event) => {
      if (event.target.closest('.film-lightbox-close')) return close();
      if (event.target.closest('.film-lightbox-prev')) return move(-1);
      if (event.target.closest('.film-lightbox-next')) return move(1);
      if (event.target === box) close();
    });
    document.addEventListener('keydown', (event) => {
      if (box.hidden) return;
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === 'ArrowRight') move(1);
    });
    return open;
  }

  (async function load() {
    if (!filmNames.length) { root.remove(); return; }
    if (!(await waitForDb())) { root.remove(); return; }

    let photos = [];
    try {
      photos = await window.MagDB.submissions.listApprovedByFilms(filmNames, {
        from: 0, to: MAX_PHOTOS - 1, ascending: false,
      });
    } catch (_) {
      photos = [];
    }
    photos = (photos || []).filter((photo) => photo?.image);
    if (!photos.length) { root.remove(); return; }

    root.innerHTML = `
      <h2>${tr(`${escapeHtml(filmLabel)} 로 찍은 독자 사진`, `Reader photos shot on ${escapeHtml(filmLabel)}`, `${escapeHtml(filmLabel)} で撮った読者の写真`)}</h2>
      <div class="film-shots">${photos.map(cellHtml).join('')}</div>
      <p class="film-shots-more"><a href="${escapeAttr(i18n.url(`/films.html?film=${encodeURIComponent(root.dataset.filmSlug || '')}`))}">${tr('카탈로그에서 더 보기', 'See more in the catalog', 'カタログでもっと見る')}</a></p>`;
    root.hidden = false;

    const open = buildLightbox(photos);
    root.querySelector('.film-shots').addEventListener('click', (event) => {
      const cell = event.target.closest('[data-shot]');
      if (cell) open(Number(cell.dataset.shot));
    });
  })();
})();
