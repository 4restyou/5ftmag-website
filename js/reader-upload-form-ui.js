(function () {
  'use strict';

  function isAcceptedImage(file) {
    if (!file) return false;
    if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '')) return true;
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
  }

  function createUploadUi({ form, showError = () => {} }) {
    const fileInput = form?.querySelector('input[name="photo"]') || null;
    const dropzone = document.getElementById('rs-dropzone');
    const fileName = document.getElementById('rs-file-name');
    const uploadStatus = document.getElementById('rs-upload-status');
    const uploadTitle = document.getElementById('rs-upload-title');
    const uploadDetail = document.getElementById('rs-upload-detail');
    let slowUploadTimers = [];

    function setUploadStatus(state, title, detail = '') {
      if (!uploadStatus) return;
      uploadStatus.hidden = false;
      uploadStatus.dataset.state = state || 'progress';
      if (uploadTitle) uploadTitle.textContent = title || '';
      if (uploadDetail) uploadDetail.textContent = detail || '';
    }

    function clearUploadStatus() {
      if (!uploadStatus) return;
      uploadStatus.hidden = true;
      uploadStatus.dataset.state = '';
      if (uploadTitle) uploadTitle.textContent = '';
      if (uploadDetail) uploadDetail.textContent = '';
    }

    function startSlowUploadHints() {
      clearSlowUploadHints();
      slowUploadTimers = [
        setTimeout(() => {
          setUploadStatus('progress', '아직 처리 중입니다', '모바일 네트워크나 큰 사진은 시간이 더 걸릴 수 있어요. 같은 버튼을 다시 누르지 않아도 됩니다.');
        }, 18000),
        setTimeout(() => {
          setUploadStatus('progress', '서버 응답을 기다리는 중', '1분 안에 완료되지 않으면 자동으로 중단되고 다시 시도할 수 있게 복구됩니다.');
        }, 38000),
      ];
    }

    function clearSlowUploadHints() {
      slowUploadTimers.forEach(clearTimeout);
      slowUploadTimers = [];
    }

    function renderPhotoPreview(file, note = '') {
      const preview = document.getElementById('rs-preview');
      if (!preview) return;
      preview.innerHTML = '';
      if (fileName) {
        fileName.textContent = file
          ? `${file.name}${note ? ` · ${note}` : ''}`
          : '선택된 사진 없음';
      }
      if (file) {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
      }
    }

    function setDroppedPhoto(files) {
      const list = Array.from(files || []);
      const file = list.find(isAcceptedImage);
      if (!file) {
        showError('JPG, PNG, WebP 이미지만 올릴 수 있어요.');
        return;
      }
      if (!fileInput) return;
      if (typeof DataTransfer === 'undefined') {
        showError('이 브라우저에서는 드래그앤드롭 파일 지정이 지원되지 않아요. 파일 선택 버튼을 사용해 주세요.');
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      renderPhotoPreview(file, list.length > 1 ? '첫 번째 사진만 선택됨' : '');
      showError('');
    }

    fileInput?.addEventListener('change', () => {
      renderPhotoPreview(fileInput.files?.[0] || null);
      clearUploadStatus();
    });

    dropzone?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fileInput?.click();
    });

    ['dragenter', 'dragover'].forEach(type => {
      dropzone?.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach(type => {
      dropzone?.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone?.addEventListener('drop', (e) => {
      setDroppedPhoto(e.dataTransfer?.files);
    });

    return {
      setUploadStatus,
      clearUploadStatus,
      startSlowUploadHints,
      clearSlowUploadHints,
      isAcceptedImage,
      renderPhotoPreview,
    };
  }

  window.ReaderUploadFormUi = {
    createUploadUi,
    isAcceptedImage,
  };
})();
