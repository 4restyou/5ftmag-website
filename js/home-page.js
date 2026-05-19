
  // ════════════════════════════
  // XSS 가드: 동적 HTML 삽입 시 사용자/외부 입력은 반드시 escapeHtml/escapeAttr
  // (Notion 데이터도 일관성 위해 동일 적용 — 편집자 계정 탈취 대비)
  // ════════════════════════════
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
    ));
  }
  const escapeAttr = escapeHtml;

  // ════════════════════════════
  // 메인의 Stories: JSON 로딩
  // (stories.html과 같은 데이터를 읽어서 메인에 표시)
  // ════════════════════════════
  const storyList = document.getElementById('storyList');
  const isMobileHome = () => window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

  if (storyList) {
    function formatDateMain(dateStr) {
      return dateStr.replace(/-/g, '.');
    }

    fetch('data/stories.json')
      .then(res => res.json())
      .then(data => {
        // 발행된 글만, 최신순
        // 데스크톱은 최신 글 10장, 모바일은 스크롤 피로를 줄이기 위해 5장 노출
        // 나머지는 stories.html 페이지네이션으로 이어짐
        const all = data
          .filter(s => s.published !== false)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        const storyLimit = isMobileHome() ? 5 : 10;
        const stories = all.slice(0, storyLimit);

        // 페이지 번호 네비게이션 (stories.html 의 pageSize=12 와 동일하게 계산)
        const numNav = document.getElementById('storyNumNav');
        if (numNav) {
          const PAGE_SIZE = 12;
          const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
          let html = '';
          for (let p = 1; p <= totalPages; p++) {
            const href = p === 1 ? 'stories.html' : `stories.html?page=${p}`;
            // 메인은 1페이지(최신 12개)에 해당하는 카드를 보여 주므로 1페이지를 'cur'로 강조
            html += `<a href="${href}" class="page-num${p === 1 ? ' cur' : ''}" aria-label="${p}페이지">${p}</a>`;
          }
          numNav.innerHTML = html;
        }

        if (stories.length === 0) {
          storyList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">아직 공개된 글이 없습니다. 새 이슈가 발행되면 이곳에 먼저 쌓입니다.</div>';
          return;
        }

        storyList.innerHTML = stories.map((s, idx) => {
          const link = s.page || '#';
          const authorPart = s.author ? `${escapeHtml(s.author)} — ` : '';
          const categoryLabel = (s.categoryLabel || s.category || '').toUpperCase();
          const cardLabel = idx === 0 ? `LATEST · ${categoryLabel}` : categoryLabel;

          // 썸네일 없으면 노란 타이포그래피 카드, 있으면 사진
          // thumbnailWhiteBg: true 면 흰 배경 보더 추가 (스토리 카드 가장자리 정의)
          const whiteBgCls = s.thumbnailWhiteBg ? ' is-on-white' : '';
          const imgBlock = s.thumbnail
            ? `<div class="post-img${whiteBgCls}">
                 <span class="post-label">${escapeHtml(cardLabel)}</span>
                 <img src="${escapeAttr(s.thumbnail)}" loading="eager" alt="${escapeAttr(s.title)}" />
               </div>`
            : `<div class="post-img text-only">
                 <span class="post-label">${escapeHtml(cardLabel)}</span>
                 <span class="post-img-title">${escapeHtml(s.title)}</span>
               </div>`;

          return `
            <a href="${escapeAttr(link)}" class="post-item" data-category="${escapeAttr(s.category || '')}" data-issue="${escapeAttr(s.issue || '')}">
              <div class="post-img-wrap">${imgBlock}</div>
              <div class="post-text">
                <h3 class="post-title">${escapeHtml(s.title)}</h3>
                <p class="post-excerpt">${authorPart}${escapeHtml(s.excerpt)}</p>
              </div>
            </a>
          `;
        }).join('');
      })
      .catch(err => {
        console.error('Stories 로딩 실패:', err);
        storyList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">글 목록을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 새로고침해 주세요.</div>';
      });
  }

  // ════════════════════════════
  // 메인의 News: JSON 로딩
  // ════════════════════════════
  const newsList = document.getElementById('newsList');

  if (newsList) {
    fetch('data/news.json')
      .then(res => res.json())
      .then(data => {
        // 발행된 소식만, 최신순, 최대 4개
        const news = data
          .filter(n => n.published !== false)
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 4);

        if (news.length === 0) {
          newsList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 14px;">아직 등록된 소식이 없습니다.</div>';
          return;
        }

        newsList.innerHTML = news.map(n => {
          const isExternal = n.external === true;
          const target = isExternal ? ' target="_blank" rel="noopener"' : '';
          const thumb = n.thumbnail || `https://picsum.photos/seed/news${n.id}/200/200`;
          const date = n.date ? n.date.replace(/-/g, '.') : '';
          return `
            <a href="${escapeAttr(n.link || '#')}"${target} class="news-card">
              <div class="news-thumb">
                <img src="${escapeAttr(thumb)}" loading="lazy" alt="${escapeAttr(n.title)}" />
              </div>
              <div class="news-body">
                <span class="news-tag">${escapeHtml(n.tag)}</span>
                <h4 class="news-title">${escapeHtml(n.title)}</h4>
                <span class="news-date">${escapeHtml(date)}</span>
              </div>
            </a>
          `;
        }).join('');
      })
      .catch(err => {
        console.error('News 로딩 실패:', err);
        newsList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 14px;">소식 데이터를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.</div>';
      });
  }

  // 다음 호 주제 sticky 블록 (active 일 때만 노출 — 우측 패널 끝)
  (function renderNextIssueBlock() {
    const slot = document.getElementById('nextIssueBlock');
    if (!slot) return;
    fetch('data/current-theme.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(theme => {
        if (!theme || !theme.active) return;
        slot.hidden = false;
        const tag = (theme.issue || theme.month || '다음 호') + ' 주제';
        slot.innerHTML = `
          <span class="ni-tag">${escapeStr(tag)}</span>
          <h2 class="ni-title">${escapeStr(theme.title || '')}</h2>
          ${theme.subtitle ? `<p class="ni-sub">${escapeStr(theme.subtitle)}</p>` : ''}
          <p class="ni-desc">${escapeStr(theme.description || '')}</p>
          ${theme.film ? `<p class="ni-film">메인 필름 · ${escapeStr(theme.film)}</p>` : ''}
          <button type="button" class="ni-cta" data-action="open-submission">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
            지금 응모하기
          </button>`;
      })
      .catch(() => {});
    function escapeStr(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  })();

  // ════════════════════════════
  // Photo 그리드 (통합): editorial + 독자 사진 랜덤 18장
  // ════════════════════════════
  const photoGrid = document.getElementById('photoGrid');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalContent = document.getElementById('modalContent');
  const modalClose = document.getElementById('modalClose');
  let filmsData = {};

  function normalizeFilmLabel(s) {
    return String(s ?? '').toLowerCase().replace(/[\s\-_+()/.]+/g, '');
  }

  function resolveFilmKeyByName(filmName) {
    const q = normalizeFilmLabel(filmName);
    if (!q) return '';
    for (const [slug, film] of Object.entries(filmsData || {})) {
      const aliases = (film.aliases || []).concat([film.displayName, film.name]).filter(Boolean);
      if (aliases.some(alias => normalizeFilmLabel(alias) === q)) return slug;
    }
    return '';
  }

  function contributorKeyOf(photo) {
    return String(photo.instagram || photo.author || '').trim().replace(/^@/, '').toLowerCase();
  }

  function filmLinkFor(photo) {
    const filmKey = photo.filmKey || resolveFilmKeyByName(photo.filmName);
    if (!filmKey) return 'films.html';
    const params = new URLSearchParams({ film: filmKey });
    return `films.html?${params.toString()}`;
  }

  function contributorLinkFor(photo) {
    const key = contributorKeyOf(photo);
    if (!key) return filmLinkFor(photo);
    const params = new URLSearchParams({ contributor: key });
    const filmKey = photo.filmKey || resolveFilmKeyByName(photo.filmName);
    if (filmKey) params.set('film', filmKey);
    return `films.html?${params.toString()}`;
  }

  if (photoGrid) {
    // reader-submissions.js 가 body 끝에서 로드되어 fetchApprovedSubmissions 가
    // 아직 정의되지 않았을 수 있음 → 최대 3초 폴링 후 사용 (없으면 빈 배열)
    async function waitForSupabaseFetcher(timeoutMs = 3000) {
      const step = 100;
      for (let elapsed = 0; elapsed < timeoutMs; elapsed += step) {
        if (
          typeof window.fetchApprovedSubmissions === 'function' &&
          window.MagDB &&
          window.MagDB.isReady()
        ) {
          return window.fetchApprovedSubmissions(1000).catch(() => []);
        }
        await new Promise(r => setTimeout(r, step));
      }
      return [];
    }

    // 통합 풀: editorial(films.json) + 독자 승인 제출(readers.json + Supabase)
    Promise.all([
      fetch('data/films.json').then(r => r.json()).catch(() => ({})),
      fetch('data/readers.json').then(r => r.json()).catch(() => []),
      waitForSupabaseFetcher()
    ])
      .then(([data, staticReaders, supabaseReaders]) => {
        filmsData = data;

        const allPhotos = [];

        // 1) Editorial (featured 필름의 photos)
        Object.entries(data).forEach(([filmKey, film]) => {
          (film.photos || []).forEach(photo => {
            allPhotos.push({
              source: 'editorial',
              src: photo.src,
              seed: photo.seed,
              author: photo.author || '',
              filmName: film.displayName || film.name,
              filmKey: filmKey,
            });
          });
        });

        // 2) 독자 사진 (정적 readers.json — 발행된 것)
        (Array.isArray(staticReaders) ? staticReaders : [])
          .filter(r => r.published !== false && r.image)
          .forEach(r => {
            allPhotos.push({
              source: 'reader',
              src: r.image,
              author: r.author || '',
              filmName: r.film || '',
              filmKey: resolveFilmKeyByName(r.film),
              camera: r.camera || '',
              caption: r.caption || '',
              instagram: r.instagram || '',
              instagramUrl: r.instagramUrl || '',
            });
          });

        // 3) 독자 사진 (Supabase 승인된 제출) — submissionId 도 함께 보관 (♡ 토글용)
        (Array.isArray(supabaseReaders) ? supabaseReaders : [])
          .filter(r => r.image)
          .forEach(r => {
            allPhotos.push({
              source: 'reader',
              src: r.image,
              author: r.author || '',
              filmName: r.film || '',
              filmKey: resolveFilmKeyByName(r.film),
              camera: r.camera || '',
              caption: r.caption || '',
              instagram: r.instagram || '',
              instagramUrl: r.instagramUrl || '',
              submissionId: typeof r.id === 'string' ? r.id.replace(/^sub-/, '') : '',
            });
          });

        // 매 로드마다 새 시드 — 새로고침할 때마다 다른 선택
        const seed = Math.floor(Math.random() * 0xFFFFFFFF);
        function makeRng(seed) {
          let t = seed >>> 0;
          return function() {
            t = (t + 0x6D2B79F5) >>> 0;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          };
        }
        const rng = makeRng(seed);
        function shuffleSeeded(arr) {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        }

        // 데스크톱은 24장, 모바일은 12장. 모바일에서는 Photo 섹션의 길이를 줄인다.
        // editorial(5ft.mag 작가) 사진은 풀이 커도 노출 비율을 2% 로 제한 — 메인 Photo 는
        // 독자 사진 중심으로 보이게. 나머지 자리는 reader 풀에서 채움.
        const PHOTO_COUNT = isMobileHome() ? 12 : 24;
        const EDITORIAL_RATIO = 0.02;
        const editorialPool = allPhotos.filter(p => p.source === 'editorial');
        const readerPool    = allPhotos.filter(p => p.source !== 'editorial');
        // 같은 작성자 사진이 한 번에 몰리지 않도록 작가별 1장씩 우선 뽑고,
        // 자리가 남으면 나머지로 채움.
        function diversifyByAuthor(pool, count) {
          if (count <= 0) return [];
          const byAuthor = new Map();
          pool.forEach((p, i) => {
            const raw = (p.author || '').trim().toLowerCase();
            // 작성자 미상은 각자 다른 버킷으로 — 한 명으로 묶지 않기
            const key = raw || `__anon_${i}`;
            if (!byAuthor.has(key)) byAuthor.set(key, []);
            byAuthor.get(key).push(p);
          });
          const primary = [];
          const leftover = [];
          for (const group of byAuthor.values()) {
            const shuffled = shuffleSeeded(group);
            primary.push(shuffled[0]);
            if (shuffled.length > 1) leftover.push(...shuffled.slice(1));
          }
          const primaryShuffled = shuffleSeeded(primary);
          if (primaryShuffled.length >= count) return primaryShuffled.slice(0, count);
          // 작가 수보다 자리가 많으면 leftover 에서 보충
          return [...primaryShuffled, ...shuffleSeeded(leftover)].slice(0, count);
        }
        // 24 × 0.02 = 0.48 → 정수 부분(0) + 소수 부분 확률(0.48)로 0 또는 1장
        const expectedEditorial = PHOTO_COUNT * EDITORIAL_RATIO;
        const editorialN = Math.floor(expectedEditorial) + (rng() < (expectedEditorial % 1) ? 1 : 0);
        const editorialPick = shuffleSeeded(editorialPool).slice(0, Math.min(editorialN, editorialPool.length));
        const readerPick    = diversifyByAuthor(readerPool, PHOTO_COUNT - editorialPick.length);
        const selected = shuffleSeeded([...editorialPick, ...readerPick]);

        if (selected.length === 0) {
          photoGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px;">아직 공개된 독자 사진이 없습니다. 첫 컷이 승인되면 이곳에 표시됩니다.</div>';
          return;
        }

        photoGrid.innerHTML = selected.map((photo, idx) => {
          const imgSrc = photo.src || `https://picsum.photos/seed/${photo.seed || idx}/600/600`;
          const webpSrc = (photo.source === 'editorial' && photo.src)
            ? photo.src.replace(/\.(jpg|jpeg|png)$/i, '.webp')
            : null;
          const author = photo.author || '';
          const filmName = photo.filmName || '';
          const pictureBlock = webpSrc
            ? `<picture>
                 <source srcset="${escapeAttr(webpSrc)}" type="image/webp">
                 <img src="${escapeAttr(imgSrc)}" loading="lazy" alt="${escapeAttr(author)}" />
               </picture>`
            : `<img src="${escapeAttr(imgSrc)}" loading="lazy" alt="${escapeAttr(author)}" />`;
          return `
            <button type="button" class="disc-cell" data-photo-index="${idx}" aria-label="${escapeAttr(filmName + ' - ' + author)}">
              ${pictureBlock}
              <span class="disc-info">
                <span class="disc-author">${escapeHtml(author)}</span>
                <span class="disc-film">${escapeHtml(filmName)}</span>
              </span>
            </button>
          `;
        }).join('');

        photoGrid.querySelectorAll('.disc-cell').forEach(cell => {
          cell.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = parseInt(cell.dataset.photoIndex, 10);
            openPhotoLightbox(selected, idx);
          });
        });
      })
      .catch(err => {
        console.error('Photo 그리드 로딩 실패:', err);
        photoGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">사진 목록을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 새로고침해 주세요.</div>';
      });
  }

  // 모달 열기
  function openFilmModal(filmKey) {
    const film = filmsData[filmKey];
    if (!film) return;

    let photosHTML = '';
    film.photos.forEach(photo => {
      const imgSrc = photo.src || `https://picsum.photos/seed/${photo.seed}/600/750`;
      const webpSrc = photo.src ? photo.src.replace(/\.(jpg|jpeg|png)$/i, '.webp') : null;
      const pictureBlock = webpSrc
        ? `<picture>
             <source srcset="${escapeAttr(webpSrc)}" type="image/webp">
             <img src="${escapeAttr(imgSrc)}" loading="lazy" alt="${escapeAttr(photo.author || '')}" />
           </picture>`
        : `<img src="${escapeAttr(imgSrc)}" loading="lazy" alt="" />`;
      photosHTML += `
        <div>
          <div class="modal-photo">
            ${pictureBlock}
          </div>
          <p class="modal-photo-caption">${escapeHtml(photo.author || '')}</p>
        </div>
      `;
    });

    modalContent.innerHTML = `
      <div class="modal-header">
        <span class="modal-brand">${escapeHtml(film.brand || '')}</span>
        <h2 class="modal-name">${escapeHtml(film.name || '')}</h2>
        <p class="modal-desc">${escapeHtml(film.desc || '')}</p>
        <div class="modal-meta">
          <span>ISO <strong>${escapeHtml(film.iso || '')}</strong></span>
          <span>Type <strong>${escapeHtml(film.type || '')}</strong></span>
          <span>Format <strong>${escapeHtml(film.format || '')}</strong></span>
          <span>Photographers <strong>${escapeHtml((film.photographers || []).join(', '))}</strong></span>
        </div>
        <a href="films.html" class="modal-cta">필름 페이지에서 더 보기 →</a>
      </div>
      <span class="modal-gallery-title">Photos · ${film.photos.length}</span>
      <div class="modal-gallery">
        ${photosHTML}
      </div>
    `;

    modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');
    modalOverlay.scrollTop = 0;
  }

  // 모달 닫기
  function closeFilmModal() {
    if (modalOverlay) {
      modalOverlay.classList.remove('open');
      document.body.classList.remove('modal-open');
    }
  }

  if (modalClose) modalClose.addEventListener('click', closeFilmModal);
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeFilmModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('open')) {
      closeFilmModal();
    }
  });

  // ════════════════════════════
  // 뉴스레터 구독
  // ════════════════════════════
  // 현재는 외부 발송 서비스 미연동 상태 — 안내 메시지만 표시.
  // 실제 운영 시 Buttondown / Mailchimp / Substack 폼 액션으로 교체할 것.
  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterMessage = document.getElementById('newsletterMessage');
  const newsletterEmail = document.getElementById('newsletterEmail');

  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = newsletterEmail.value.trim();

      // 간단한 이메일 형식 검증
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newsletterMessage.textContent = '올바른 이메일 주소를 입력해주세요.';
        newsletterMessage.className = 'nl-message error';
        return;
      }

      // 현재는 발송 시스템 미준비 — 임시 안내
      newsletterMessage.textContent = '준비 중인 기능이에요. 인스타그램(@5ft.magazine)이나 hello@5ftmag.com으로 연락주시면 새 이슈 소식을 직접 보내드릴게요.';
      newsletterMessage.className = 'nl-message success';
      newsletterEmail.value = '';

      // 5초 후 메시지 자동 제거
      setTimeout(() => {
        newsletterMessage.textContent = '';
        newsletterMessage.className = 'nl-message';
      }, 8000);
    });
  }

  // ════════════════════════════
  // Photo 라이트박스 (통합 — editorial + 독자 사진)
  // ════════════════════════════
  const photoLightbox  = document.getElementById('photoLightbox');
  const photoLbImg     = document.getElementById('photoLbImg');
  const photoLbAuthor  = document.getElementById('photoLbAuthor');
  const photoLbFilm    = document.getElementById('photoLbFilm');
  const photoLbCamera  = document.getElementById('photoLbCamera');
  const photoLbCounter = document.getElementById('photoLbCounter');
  const photoLbLink    = document.getElementById('photoLbFilmLink');
  const photoLbContributorLink = document.getElementById('photoLbContributorLink');
  const photoLbClose   = document.getElementById('photoLbClose');
  const photoLbPrev    = document.getElementById('photoLbPrev');
  const photoLbNext    = document.getElementById('photoLbNext');
  const photoLbFav     = document.getElementById('photoLbFav');

  let currentPhotos = [];
  let currentPhotoIndex = 0;
  // 본인이 ♡ 한 submission id 집합 — 로그인 후 비동기 로드
  let photoFavIds = new Set();

  async function loadPhotoFavorites() {
    if (!window.MagDB || !window.MagDB.isReady()) return;
    try {
      const sess = await window.MagDB.auth.getSession();
      if (!sess) { photoFavIds = new Set(); return; }
      photoFavIds = await window.MagDB.favorites.idsForType('submission');
    } catch (_) {
      photoFavIds = new Set();
    }
  }
  // db-client 준비된 뒤 비동기 로드 — 라이트박스 열 때 사용
  (async () => {
    for (let i = 0; i < 60; i++) {
      if (window.MagDB && window.MagDB.isReady()) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await loadPhotoFavorites();
  })();

  function openPhotoLightbox(photos, index) {
    currentPhotos = photos;
    showPhoto(index);
  }

  function syncPhotoLbFav() {
    if (!photoLbFav) return;
    const p = currentPhotos[currentPhotoIndex];
    const subId = p && p.source === 'reader' && p.submissionId ? p.submissionId : '';
    if (!subId) {
      photoLbFav.hidden = true;
      photoLbFav.removeAttribute('data-submission-id');
      photoLbFav.classList.remove('is-fav', 'is-busy');
      return;
    }
    photoLbFav.hidden = false;
    photoLbFav.dataset.submissionId = subId;
    const isFav = photoFavIds.has(subId);
    photoLbFav.classList.toggle('is-fav', isFav);
    photoLbFav.setAttribute('aria-pressed', String(isFav));
    photoLbFav.setAttribute('aria-label', isFav ? '즐겨찾기 해제' : '즐겨찾기 추가');
  }

  async function togglePhotoLbFav() {
    if (!photoLbFav || photoLbFav.hidden) return;
    if (photoLbFav.classList.contains('is-busy')) return;
    const subId = photoLbFav.dataset.submissionId || '';
    if (!subId) return;
    if (!window.MagDB || !window.MagDB.isReady()) {
      window.notify?.('잠시 후 다시 시도해주세요.', 'info');
      return;
    }
    const sess = await window.MagDB.auth.getSession();
    if (!sess) {
      if (!confirm('즐겨찾기는 로그인이 필요해요. Google로 로그인할까요?')) return;
      window.MagDB.auth.signInWithGoogle(window.location.href.split('#')[0]);
      return;
    }
    const wasFav = photoFavIds.has(subId);
    if (wasFav) photoFavIds.delete(subId); else photoFavIds.add(subId);
    photoLbFav.classList.toggle('is-fav', !wasFav);
    photoLbFav.setAttribute('aria-pressed', String(!wasFav));
    photoLbFav.classList.add('is-busy');
    const { error } = await window.MagDB.favorites.toggle('submission', subId, wasFav);
    photoLbFav.classList.remove('is-busy');
    if (error) {
      if (wasFav) photoFavIds.add(subId); else photoFavIds.delete(subId);
      photoLbFav.classList.toggle('is-fav', wasFav);
      photoLbFav.setAttribute('aria-pressed', String(wasFav));
      window.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
    }
  }
  if (photoLbFav) photoLbFav.addEventListener('click', togglePhotoLbFav);

  function showPhoto(index) {
    if (currentPhotos.length === 0) return;
    if (index < 0) index = currentPhotos.length - 1;
    if (index >= currentPhotos.length) index = 0;
    currentPhotoIndex = index;

    const p = currentPhotos[index];
    const src = p.src || `https://picsum.photos/seed/${p.seed}/1200/1500`;
    // editorial은 WebP 우선 시도, 독자 사진은 그대로 사용
    const webpSrc = (p.source === 'editorial' && p.src)
      ? p.src.replace(/\.(jpg|jpeg|png)$/i, '.webp')
      : src;
    photoLbImg.onerror = () => { photoLbImg.onerror = null; photoLbImg.src = src; };
    photoLbImg.src = webpSrc;
    photoLbImg.alt = p.author || '';

    photoLbAuthor.textContent = p.author || '';
    photoLbFilm.textContent = p.filmName || '';
    if (photoLbFilm) {
      // 필름명 클릭 → films.html?film=<slug or name>
      photoLbFilm.href = p.filmKey
        ? `films.html?film=${encodeURIComponent(p.filmKey)}`
        : (p.filmName ? `films.html?film=${encodeURIComponent(p.filmName)}` : 'films.html');
      photoLbFilm.hidden = !p.filmName;
    }
    if (photoLbCamera) {
      photoLbCamera.textContent = p.camera || '';
      photoLbCamera.href = p.camera
        ? `films.html?camera=${encodeURIComponent(p.camera)}`
        : 'films.html';
      photoLbCamera.hidden = !p.camera;
    }
    photoLbCounter.textContent = `${index + 1} / ${currentPhotos.length}`;
    syncPhotoLbFav();

    if (photoLbLink) {
      photoLbLink.href = filmLinkFor(p);
      photoLbLink.removeAttribute('target');
      photoLbLink.removeAttribute('rel');
      photoLbLink.textContent = '필름 보기 →';
    }
    if (photoLbContributorLink) {
      photoLbContributorLink.href = contributorLinkFor(p);
      photoLbContributorLink.removeAttribute('target');
      photoLbContributorLink.removeAttribute('rel');
      photoLbContributorLink.hidden = !contributorKeyOf(p);
    }

    photoLightbox.classList.add('open');
  }

  function closePhotoLightbox() {
    photoLightbox.classList.remove('open');
    photoLbImg.src = '';
  }

  if (photoLbClose) photoLbClose.addEventListener('click', closePhotoLightbox);
  if (photoLbPrev)  photoLbPrev.addEventListener('click', () => showPhoto(currentPhotoIndex - 1));
  if (photoLbNext)  photoLbNext.addEventListener('click', () => showPhoto(currentPhotoIndex + 1));

  // 빈 영역 클릭 시 닫기
  if (photoLightbox) {
    photoLightbox.addEventListener('click', (e) => {
      if (e.target === photoLightbox || e.target.classList.contains('photo-lb-wrap')) {
        closePhotoLightbox();
      }
    });
  }

  // 키보드
  document.addEventListener('keydown', (e) => {
    if (photoLightbox && photoLightbox.classList.contains('open')) {
      if (e.key === 'Escape') closePhotoLightbox();
      else if (e.key === 'ArrowLeft') showPhoto(currentPhotoIndex - 1);
      else if (e.key === 'ArrowRight') showPhoto(currentPhotoIndex + 1);
    }
  });

  // 터치 스와이프
  let pTouchStartX = 0, pTouchStartY = 0, pTouchStartTime = 0;
  if (photoLightbox) {
    photoLightbox.addEventListener('touchstart', (e) => {
      if (!photoLightbox.classList.contains('open')) return;
      pTouchStartX = e.changedTouches[0].clientX;
      pTouchStartY = e.changedTouches[0].clientY;
      pTouchStartTime = Date.now();
    }, { passive: true });

    photoLightbox.addEventListener('touchend', (e) => {
      if (!photoLightbox.classList.contains('open')) return;
      const dx = e.changedTouches[0].clientX - pTouchStartX;
      const dy = e.changedTouches[0].clientY - pTouchStartY;
      const dt = Date.now() - pTouchStartTime;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        if (dx < 0) showPhoto(currentPhotoIndex + 1);
        else        showPhoto(currentPhotoIndex - 1);
      }
    }, { passive: true });
  }
