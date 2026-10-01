(function () {
  'use strict';

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const i18n = window.i18n || { isEn: false, locale: 'ko-KR', t: (ko) => ko, url: (u) => u };
  const tr = i18n.t;

  function create(options = {}) {
    const notify = (message, type) => {
      if (typeof options.notify === 'function') options.notify(message, type);
      else if (typeof window.notify === 'function') window.notify(message, type);
    };

    function slugStamp() {
      const d = new Date();
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }

    function updateContributorSelectionControls(group) {
      if (!group) return;
      const selectedCount = group.querySelectorAll('.reader-contributor-photo.is-selected').length;
      const saveMenu = group.querySelector('[data-contrib-save-menu]');
      const popover = group.querySelector('[data-save-menu-popover]');
      const menuToggle = group.querySelector('[data-save-menu-toggle="contrib"]');
      const selectedSave = group.querySelector('[data-save-selected-contrib]');
      const cancel = group.querySelector('[data-cancel-contrib-select]');
      const selecting = group.classList.contains('is-selecting');
      if (saveMenu) saveMenu.hidden = selecting;
      if (popover) popover.hidden = true;
      if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
      if (selectedSave) {
        selectedSave.hidden = !selecting;
        selectedSave.disabled = selectedCount < 1;
        selectedSave.textContent = tr(`선택한 ${selectedCount}장 저장`, `Save ${selectedCount} selected`, `選択した${selectedCount}枚を保存`);
      }
      if (cancel) cancel.hidden = !selecting;
    }

    function setContributorSelectionMode(group, next) {
      if (!group) return;
      group.classList.toggle('is-selecting', !!next);
      group.querySelectorAll('.reader-contributor-photo').forEach(photo => {
        photo.classList.remove('is-selected');
        delete photo.dataset.selectedOrder;
        photo.setAttribute('aria-pressed', 'false');
        const check = photo.querySelector('.reader-contributor-photo-check');
        if (check) check.textContent = '';
      });
      updateContributorSelectionControls(group);
    }

    function renumberContributorSelection(group) {
      if (!group) return;
      const selectedPhotos = [...group.querySelectorAll('.reader-contributor-photo.is-selected')]
        .sort((a, b) => Number(a.dataset.selectedOrder || 0) - Number(b.dataset.selectedOrder || 0));
      selectedPhotos.forEach((item, idx) => {
        item.dataset.selectedOrder = String(idx + 1);
        const check = item.querySelector('.reader-contributor-photo-check');
        if (check) check.textContent = String(idx + 1);
      });
    }

    function toggleContributorPhotoSelection(photo) {
      if (!photo) return;
      const group = photo.closest('.reader-contributor-group');
      const selected = !photo.classList.contains('is-selected');
      photo.classList.toggle('is-selected', selected);
      photo.setAttribute('aria-pressed', String(selected));
      if (selected) {
        const maxOrder = Math.max(0, ...[...(group?.querySelectorAll('.reader-contributor-photo.is-selected') || [])]
          .map(item => Number(item.dataset.selectedOrder) || 0));
        photo.dataset.selectedOrder = String(maxOrder + 1);
      } else {
        delete photo.dataset.selectedOrder;
      }
      const check = photo.querySelector('.reader-contributor-photo-check');
      if (check && !selected) check.textContent = '';
      renumberContributorSelection(group);
      updateContributorSelectionControls(group);
    }

    async function handleSaveContribFilmImage(btn) {
      const personKey = btn.dataset.personKey;
      const filmName = btn.dataset.filmName;
      const authorLabel = btn.dataset.authorLabel || personKey;
      const section = btn.closest('.reader-contributor-group');
      const target = section?.querySelector('.reader-contributor-grid');
      if (!target) return;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = tr('저장 중…', 'Saving…', '保存中…');
      try {
        const stripCanvas = await window.FilmsRollExport.renderRollStripCanvas(target, 'contrib');
        const authors = window.FilmsRollExport.collectAuthorsForExport(target, 'contrib', { authorLabel });
        const filmThumb = options.findFilmThumbByName?.(filmName);
        const canvas = await window.FilmsRollExport.composeBrandedRollCanvas(stripCanvas, { filmName, authors, filmThumb });
        const personSlug = window.FilmsRollExport.slugifyExportName(personKey);
        const filmSlug = window.FilmsRollExport.slugifyExportName(filmName);
        window.FilmsRollExport.downloadCanvas(canvas, `5ftmag-${personSlug || 'contributor'}-${filmSlug || 'film'}-${slugStamp()}.jpg`);
      } catch (err) {
        console.error('[save-contrib]', err);
        notify(tr('이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.', "Couldn't save the image. Please try again in a moment.", '画像を保存できませんでした。しばらくしてからもう一度お試しください。'), 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    async function handleSaveSelectedContribImage(btn) {
      const personKey = btn.dataset.personKey;
      const filmName = btn.dataset.filmName;
      const authorLabel = btn.dataset.authorLabel || personKey;
      const section = btn.closest('.reader-contributor-group');
      const target = section?.querySelector('.reader-contributor-grid');
      if (!target) return;
      const selectedCount = target.querySelectorAll('.reader-contributor-photo.is-selected').length;
      if (selectedCount < 1) {
        notify(tr('저장할 사진을 먼저 선택해 주세요.', 'Select the photos to save first.', '保存する写真を先に選んでください。'), 'danger');
        return;
      }
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = tr('저장 중…', 'Saving…', '保存中…');
      try {
        const stripCanvas = await window.FilmsRollExport.renderRollStripCanvas(target, 'contrib', { onlySelected: true });
        const authors = window.FilmsRollExport.collectAuthorsForExport(target, 'contrib', { authorLabel });
        const filmThumb = options.findFilmThumbByName?.(filmName);
        const canvas = await window.FilmsRollExport.composeBrandedRollCanvas(stripCanvas, { filmName, authors, filmThumb });
        const personSlug = window.FilmsRollExport.slugifyExportName(personKey);
        const filmSlug = window.FilmsRollExport.slugifyExportName(filmName);
        window.FilmsRollExport.downloadCanvas(canvas, `5ftmag-${personSlug || 'contributor'}-${filmSlug || 'film'}-selected-${slugStamp()}.jpg`);
        setContributorSelectionMode(section, false);
      } catch (err) {
        console.error('[save-selected-contrib]', err);
        notify(tr('선택 이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.', "Couldn't save the selected image. Please try again in a moment.", '選択した画像を保存できませんでした。しばらくしてからもう一度お試しください。'), 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    async function handleSaveRollImage(btn) {
      const kind = btn.dataset.saveRoll;
      const filmKey = btn.dataset.filmKey;
      const target = kind === 'reader'
        ? document.getElementById(`readerGrid-${filmKey}`)
        : document.getElementById(`editorialGallery-${filmKey}`);
      if (!target) return;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = tr('저장 중…', 'Saving…', '保存中…');
      try {
        const stripCanvas = await window.FilmsRollExport.renderRollStripCanvas(target, kind);
        const f = options.getFilm?.(filmKey) || {};
        const filmName = (f.displayName || f.name || filmKey).toString();
        const photographers = Array.isArray(f.photographers) ? f.photographers : [];
        const authors = window.FilmsRollExport.collectAuthorsForExport(target, kind, { photographers });
        const filmThumb = (f.canThumbnailStatus === 'set' && f.canThumbnail) ? f.canThumbnail : null;
        const canvas = await window.FilmsRollExport.composeBrandedRollCanvas(stripCanvas, { filmName, authors, filmThumb });
        const slug = window.FilmsRollExport.slugifyExportName(filmName);
        window.FilmsRollExport.downloadCanvas(canvas, `5ftmag-${kind === 'reader' ? 'readers-roll' : 'editorial'}-${slug}-${slugStamp()}.jpg`);
      } catch (err) {
        console.error('[save-roll]', err);
        notify(tr('이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.', "Couldn't save the image. Please try again in a moment.", '画像を保存できませんでした。しばらくしてからもう一度お試しください。'), 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    async function handleSaveSelectedRollImage(btn) {
      const kind = btn.dataset.saveSelectedRoll;
      const filmKey = btn.dataset.filmKey;
      const target = kind === 'reader'
        ? document.getElementById(`readerGrid-${filmKey}`)
        : null;
      if (!target) return;
      const selectedCount = target.querySelectorAll('.reader-slot.is-filled.is-selected').length;
      if (selectedCount < 1) {
        notify(tr('저장할 사진을 먼저 선택해 주세요.', 'Select the photos to save first.', '保存する写真を先に選んでください。'), 'danger');
        return;
      }
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = tr('저장 중…', 'Saving…', '保存中…');
      try {
        const stripCanvas = await window.FilmsRollExport.renderRollStripCanvas(target, kind, { onlySelected: true });
        const f = options.getFilm?.(filmKey) || {};
        const filmName = (f.displayName || f.name || filmKey).toString();
        const authors = window.FilmsRollExport.collectAuthorsForExport(target, kind, { onlySelected: true });
        const filmThumb = (f.canThumbnailStatus === 'set' && f.canThumbnail) ? f.canThumbnail : null;
        const canvas = await window.FilmsRollExport.composeBrandedRollCanvas(stripCanvas, { filmName, authors, filmThumb });
        const slug = window.FilmsRollExport.slugifyExportName(filmName);
        window.FilmsRollExport.downloadCanvas(canvas, `5ftmag-readers-roll-selected-${slug}-${slugStamp()}.jpg`);
        target.dispatchEvent(new CustomEvent('reader-select-cancel', { bubbles: false }));
      } catch (err) {
        console.error('[save-selected-roll]', err);
        notify(tr('선택 이미지 저장에 실패했어요. 잠시 후 다시 시도해 주세요.', "Couldn't save the selected image. Please try again in a moment.", '選択した画像を保存できませんでした。しばらくしてからもう一度お試しください。'), 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    return {
      setContributorSelectionMode,
      toggleContributorPhotoSelection,
      handleSaveContribFilmImage,
      handleSaveSelectedContribImage,
      handleSaveRollImage,
      handleSaveSelectedRollImage,
    };
  }

  window.FilmsReaderExport = { create };
})();
