(function () {
  'use strict';

  function escapeText(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function createNoopLightbox() {
    return {
      show() {},
      openReader() {},
      close() {},
      isOpen() { return false; },
      currentPhotos() { return []; },
    };
  }

  function create(options = {}) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCap = document.getElementById('lightboxCaption');
    const lightboxCounter = document.getElementById('lightboxCounter');
    const lightboxClose = document.getElementById('lightboxClose');
    const lightboxPrev = document.getElementById('lightboxPrev');
    const lightboxNext = document.getElementById('lightboxNext');
    const lightboxZoom = document.getElementById('lightboxZoom');
    const lightboxFullscreen = document.getElementById('lightboxFullscreen');
    const lightboxThumbs = document.getElementById('lightboxThumbs');
    const lightboxInsta = document.getElementById('lightboxInsta');
    const lightboxFav = document.getElementById('lightboxFav');

    if (!lightbox || !lightboxImg || !lightboxCap || !lightboxCounter || !lightboxThumbs) {
      return createNoopLightbox();
    }

    let currentIndex = 0;
    let lastFocusedElement = null;
    let thumbsCacheKey = null;
    let mode = 'editorial';
    let readerPhotos = [];
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    function currentPhotos() {
      if (mode === 'reader') return readerPhotos;
      return options.getEditorialPhotos?.() || [];
    }

    function isOpen() {
      return lightbox.classList.contains('open');
    }

    function resetView() {
      lightbox.classList.remove('is-zoomed');
      if (lightboxZoom) {
        lightboxZoom.textContent = '확대';
        lightboxZoom.setAttribute('aria-label', '사진 확대');
      }
    }

    function getPhotoSource(photo, large = true) {
      const width = large ? 1200 : 220;
      const height = large ? 1500 : 280;
      const src = photo.src || `https://picsum.photos/seed/${photo.seed}/${width}/${height}`;
      const isReader = photo._source === 'reader' || /^https?:/.test(src);
      const webp = (isReader || !photo.src) ? src : photo.src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
      return { src, webp };
    }

    function setLoading(isLoading) {
      lightbox.classList.toggle('is-loading', isLoading);
    }

    function buildThumbs() {
      const photos = currentPhotos();
      const cacheKey = mode === 'reader'
        ? `reader:${options.getCurrentFilmKey?.() || ''}:${photos.length}`
        : `editorial:${options.getCurrentFilmKey?.() || ''}`;
      if (thumbsCacheKey === cacheKey) return;
      lightboxThumbs.innerHTML = photos.map((photo, idx) => {
        const source = getPhotoSource(photo, false);
        const label = `${idx + 1}번째 사진 보기${photo.author ? `, ${photo.author}` : ''}`;
        return `
          <button class="lightbox-thumb" type="button" data-photo-index="${idx}" aria-label="${escapeText(label)}">
            <img src="${source.webp}" alt="" loading="lazy" />
          </button>
        `;
      }).join('');
      thumbsCacheKey = cacheKey;
    }

    function updateActiveThumb() {
      lightboxThumbs.querySelectorAll('.lightbox-thumb').forEach((button) => {
        const active = Number(button.dataset.photoIndex) === currentIndex;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-current', active ? 'true' : 'false');
        if (active) {
          button.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
      });
    }

    function preloadNeighbors() {
      const photos = currentPhotos();
      if (!photos.length) return;
      [currentIndex - 1, currentIndex + 1].forEach((index) => {
        const safeIndex = (index + photos.length) % photos.length;
        const source = getPhotoSource(photos[safeIndex], true);
        const img = new Image();
        img.src = source.webp;
      });
    }

    function trapFocus(event) {
      const focusable = Array.from(lightbox.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function renderCaption(photo) {
      if (mode !== 'reader') {
        const film = options.getEditorialFilm?.() || {};
        return `<strong>${escapeText(photo.author || '')}</strong> ${escapeText(film.brand || '')} ${escapeText(film.name || '')}`;
      }

      const parts = [];
      const contributorKey = photo.contributorKey || options.normalizeContributorKey?.(photo.instagram || photo.author || '') || '';
      if (photo.author && contributorKey) {
        parts.push(`<button type="button" class="lightbox-caption-author lightbox-caption-link" data-jump-contributor="${escapeText(contributorKey)}">${escapeText(photo.author)}</button>`);
      } else if (photo.author) {
        parts.push(`<strong>${escapeText(photo.author)}</strong>`);
      }
      if (photo.film) {
        parts.push(`<button type="button" class="lightbox-caption-film lightbox-caption-link" data-jump-film="${escapeText(photo.film)}">${escapeText(photo.film)}</button>`);
      }
      if (photo.camera) {
        parts.push(`<button type="button" class="lightbox-caption-camera lightbox-caption-link" data-jump-camera="${escapeText(photo.camera)}">${escapeText(photo.camera)}</button>`);
      }
      const metaHtml = parts.join(' · ');
      const noteHtml = photo.caption ? `<span class="lightbox-note">${escapeText(photo.caption)}</span>` : '';
      return noteHtml ? `${metaHtml}<span class="lightbox-note-wrap">${noteHtml}</span>` : metaHtml;
    }

    function bindCaptionActions() {
      lightboxCap.querySelectorAll('[data-jump-contributor]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const key = button.dataset.jumpContributor;
          close();
          options.openContributor?.(key);
        });
      });

      lightboxCap.querySelectorAll('[data-jump-film]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const name = button.dataset.jumpFilm;
          const slug = options.resolveFilmSlug?.(name);
          if (!slug) return;
          close();
          options.openFilm?.(slug);
        });
      });

      lightboxCap.querySelectorAll('[data-jump-camera]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const key = options.resolveCameraKey?.(button.dataset.jumpCamera);
          if (!key) return;
          close();
          options.openCamera?.(key);
        });
      });
    }

    function syncFavoriteButton(photo) {
      if (!lightboxFav) return;
      const subId = photo.submissionId || '';
      if (mode === 'reader' && subId) {
        lightboxFav.hidden = false;
        lightboxFav.dataset.submissionId = subId;
        const isFav = options.hasPhotoFavorite?.(subId) || false;
        lightboxFav.classList.toggle('is-fav', isFav);
        lightboxFav.setAttribute('aria-pressed', String(isFav));
        lightboxFav.setAttribute('aria-label', isFav ? '즐겨찾기 해제' : '즐겨찾기 추가');
      } else {
        lightboxFav.hidden = true;
        lightboxFav.removeAttribute('data-submission-id');
      }
    }

    function show(index, nextMode) {
      if (nextMode) mode = nextMode;
      const photos = currentPhotos();
      if (!photos.length) return;
      if (index < 0) index = photos.length - 1;
      if (index >= photos.length) index = 0;
      const wasOpen = isOpen();
      if (!wasOpen) {
        lastFocusedElement = document.activeElement;
      }

      buildThumbs();
      currentIndex = index;

      const photo = photos[index];
      const source = getPhotoSource(photo, true);
      resetView();
      setLoading(true);
      lightboxImg.onload = () => setLoading(false);
      lightboxImg.onerror = () => {
        if (lightboxImg.dataset.fallback !== '1' && source.webp !== source.src) {
          lightboxImg.dataset.fallback = '1';
          lightboxImg.src = source.src;
          return;
        }
        setLoading(false);
      };
      lightboxImg.dataset.fallback = '0';
      lightboxImg.src = source.webp;
      lightboxImg.alt = [photo.author, photo.film].filter(Boolean).join(' · ') || '필름 사진';
      lightboxCap.innerHTML = renderCaption(photo);
      bindCaptionActions();
      lightboxCounter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}`;

      if (lightboxInsta) {
        if (mode === 'reader' && photo.instagramUrl) {
          lightboxInsta.href = photo.instagramUrl;
          lightboxInsta.hidden = false;
        } else {
          lightboxInsta.hidden = true;
          lightboxInsta.removeAttribute('href');
        }
      }

      syncFavoriteButton(photo);
      lightbox.dataset.mode = mode;
      lightbox.classList.add('open');
      updateActiveThumb();
      preloadNeighbors();
      if (!wasOpen && lightboxClose) lightboxClose.focus();
    }

    function openReader(photos, index) {
      readerPhotos = Array.isArray(photos) ? photos : [];
      thumbsCacheKey = null;
      show(index, 'reader');
    }

    function close() {
      lightbox.classList.remove('open');
      setLoading(false);
      resetView();
      if (document.fullscreenElement === lightbox && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      lightboxImg.src = '';
      mode = 'editorial';
      if (lightboxInsta) {
        lightboxInsta.hidden = true;
        lightboxInsta.removeAttribute('href');
      }
      if (lightboxFav) {
        lightboxFav.hidden = true;
        lightboxFav.removeAttribute('data-submission-id');
        lightboxFav.classList.remove('is-fav', 'is-busy');
      }
      if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
      }
    }

    async function togglePhotoFavorite() {
      if (!lightboxFav || lightboxFav.hidden) return;
      if (lightboxFav.classList.contains('is-busy')) return;
      const subId = lightboxFav.dataset.submissionId || '';
      if (!subId) return;
      const canContinue = await options.ensureFavoriteSession?.();
      if (!canContinue) return;

      const wasFav = options.hasPhotoFavorite?.(subId) || false;
      options.setPhotoFavorite?.(subId, !wasFav);
      lightboxFav.classList.toggle('is-fav', !wasFav);
      lightboxFav.setAttribute('aria-pressed', String(!wasFav));
      lightboxFav.setAttribute('aria-label', !wasFav ? '즐겨찾기 해제' : '즐겨찾기 추가');
      lightboxFav.classList.add('is-busy');
      const { error } = await (options.togglePhotoFavorite?.(subId, wasFav) || Promise.resolve({ error: null }));
      lightboxFav.classList.remove('is-busy');
      if (error) {
        options.setPhotoFavorite?.(subId, wasFav);
        lightboxFav.classList.toggle('is-fav', wasFav);
        lightboxFav.setAttribute('aria-pressed', String(wasFav));
        options.notify?.('처리 실패: ' + (error.message || '잠시 후 다시 시도'), 'danger');
      }
    }

    function toggleZoom() {
      const zoomed = lightbox.classList.toggle('is-zoomed');
      if (lightboxZoom) {
        lightboxZoom.textContent = zoomed ? '맞춤' : '확대';
        lightboxZoom.setAttribute('aria-label', zoomed ? '화면에 맞추기' : '사진 확대');
      }
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement && lightbox.requestFullscreen) {
        lightbox.requestFullscreen().catch(() => {});
        return;
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }

    lightboxClose?.addEventListener('click', close);
    lightboxPrev?.addEventListener('click', () => show(currentIndex - 1));
    lightboxNext?.addEventListener('click', () => show(currentIndex + 1));
    lightboxImg.addEventListener('click', toggleZoom);
    lightboxZoom?.addEventListener('click', toggleZoom);
    lightboxFullscreen?.addEventListener('click', toggleFullscreen);
    lightboxFav?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePhotoFavorite();
    });
    lightboxThumbs.addEventListener('click', (event) => {
      const thumb = event.target.closest('.lightbox-thumb');
      if (!thumb) return;
      const idx = parseInt(thumb.dataset.photoIndex, 10);
      if (!Number.isNaN(idx)) show(idx);
    });
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox || event.target.classList.contains('lightbox-img-wrap')) {
        close();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (isOpen()) {
        if (event.key === 'Escape') close();
        else if (event.key === 'ArrowLeft') show(currentIndex - 1);
        else if (event.key === 'ArrowRight') show(currentIndex + 1);
        else if (event.key === 'Home') show(0);
        else if (event.key === 'End') {
          const photos = currentPhotos();
          if (photos.length) show(photos.length - 1);
        } else if (event.key === '+' || event.key === '=') toggleZoom();
        else if (event.key === 'Tab') trapFocus(event);
        return;
      }
      if (event.key === 'Escape' && options.isModalOpen?.()) {
        options.closeModal?.();
      }
    });
    lightbox.addEventListener('touchstart', (event) => {
      if (!isOpen()) return;
      touchStartX = event.changedTouches[0].clientX;
      touchStartY = event.changedTouches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });
    lightbox.addEventListener('touchend', (event) => {
      if (!isOpen()) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      const dt = Date.now() - touchStartTime;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
        show(dx < 0 ? currentIndex + 1 : currentIndex - 1);
      }
    }, { passive: true });

    return { show, openReader, close, isOpen, currentPhotos };
  }

  window.FilmsLightbox = { create };
})();
