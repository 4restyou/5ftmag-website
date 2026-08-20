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

  const root = document.getElementById('filmReaderPhotos');
  if (!root) return;

  const escapeHtml = window.MagUtil?.escapeHtml || ((s) => String(s ?? ''));
  const escapeAttr = window.MagUtil?.escapeAttr || escapeHtml;

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
    const alt = `${filmLabel} 로 찍은 사진${who ? `. 촬영 ${who}` : ''}`;
    return `<button type="button" class="film-shot" data-shot="${index}" aria-label="${escapeAttr(alt)} 크게 보기">
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
    box.setAttribute('aria-label', '사진 크게 보기');
    box.innerHTML = `
      <button type="button" class="film-lightbox-close" aria-label="닫기">✕</button>
      <button type="button" class="film-lightbox-prev" aria-label="이전 사진">‹</button>
      <button type="button" class="film-lightbox-next" aria-label="다음 사진">›</button>
      <figure>
        <img alt="" />
        <figcaption></figcaption>
      </figure>`;
    document.body.appendChild(box);

    const img = box.querySelector('img');
    const caption = box.querySelector('figcaption');

    function paint() {
      const photo = photos[index];
      if (!photo) return;
      img.src = photo.image;
      const who = photo.submitterName || photo.instagram || '';
      img.alt = `${filmLabel} 로 찍은 사진${who ? `. 촬영 ${who}` : ''}`;
      const bits = [who, photo.camera, photo.caption].filter(Boolean).map(escapeHtml);
      caption.innerHTML = bits.join(' · ');
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
      <h2>${escapeHtml(filmLabel)} 로 찍은 독자 사진</h2>
      <div class="film-shots">${photos.map(cellHtml).join('')}</div>
      <p class="film-shots-more"><a href="/films.html?film=${encodeURIComponent(root.dataset.filmSlug || '')}">카탈로그에서 더 보기</a></p>`;
    root.hidden = false;

    const open = buildLightbox(photos);
    root.querySelector('.film-shots').addEventListener('click', (event) => {
      const cell = event.target.closest('[data-shot]');
      if (cell) open(Number(cell.dataset.shot));
    });
  })();
})();
