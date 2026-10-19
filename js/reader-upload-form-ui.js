(function () {
  'use strict';
  // 모든 페이지가 js/i18n.js 를 먼저 싣는다(한국어판에선 한국어를 돌려준다).
  const tr = window.i18n.t;

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
          setUploadStatus('progress', tr('아직 처리 중입니다', 'Still working', 'まだ処理中です'), tr('모바일 네트워크나 큰 사진은 시간이 더 걸릴 수 있어요. 같은 버튼을 다시 누르지 않아도 됩니다.', 'Mobile networks and large photos can take longer. No need to press the button again.', 'モバイル回線や大きな写真は時間がかかることがあります。同じボタンをもう一度押す必要はありません。'));
        }, 18000),
        setTimeout(() => {
          setUploadStatus('progress', tr('서버 응답을 기다리는 중', 'Waiting for the server', 'サーバーの応答を待っています'), tr('전송이 지연되면 자동으로 재시도합니다. 사진 전송은 최대 3분 안에 중단되며 입력 내용은 유지됩니다.', 'If the upload stalls it retries automatically. It stops after 3 minutes at most, and what you entered is kept.', '送信が遅れると自動で再試行します。写真の送信は最長3分で中止され、入力内容は保持されます。'));
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
          : tr('선택된 사진 없음', 'No photo selected', '写真が選択されていません');
      }
      if (file) {
        // 편집한 사본이 있으면 그것을 보여 준다. 다시 편집하면 언제나 원본에서 시작한다
        const shown = fileInput?.__editedFile || file;
        const url = URL.createObjectURL(shown);
        const img = document.createElement('img');
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);
        preview.appendChild(img);
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'rs-preview-edit';
        editBtn.textContent = fileInput?.__editedFile
          ? tr('편집됨 · 다시 편집', 'Edited · edit again', '編集済み · もう一度編集')
          : tr('회전·자르기', 'Rotate · crop', '回転・切り抜き');
        editBtn.addEventListener('click', () => openEditor(file));
        preview.appendChild(editBtn);
      }
    }

    // 회전·크롭 편집 창. js/photo-editor.js 는 처음 누를 때 불러온다
    function loadEditor() {
      if (window.PhotoEditor) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/js/photo-editor.js?v=20261019-photo-straighten';
        s.onload = resolve;
        s.onerror = () => reject(new Error('load failed'));
        document.head.appendChild(s);
      });
    }
    async function openEditor(file) {
      try {
        await loadEditor();
      } catch (_) {
        showError(tr('편집 도구를 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요.', 'Could not load the editor. Please refresh and try again.', '編集ツールを読み込めませんでした。再読み込みしてからもう一度お試しください。'));
        return;
      }
      const edited = await window.PhotoEditor.open(file);
      if (!edited || !fileInput) return;
      fileInput.__editedFile = edited;
      renderPhotoPreview(file, tr('편집됨', 'edited', '編集済み'));
    }

    function setDroppedPhoto(files) {
      const list = Array.from(files || []);
      const file = list.find(isAcceptedImage);
      if (!file) {
        showError(tr('JPG, PNG, WebP, HEIC 이미지만 올릴 수 있어요.', 'Only JPG, PNG, WebP and HEIC images can be uploaded.', 'JPG・PNG・WebP・HEIC の画像のみアップロードできます。'));
        return;
      }
      if (!fileInput || fileInput.disabled) return;
      if (typeof DataTransfer === 'undefined') {
        showError(tr('이 브라우저에서는 드래그앤드롭 파일 지정이 지원되지 않아요. 파일 선택 버튼을 사용해 주세요.', 'Drag and drop is not supported in this browser. Please use the file button.', 'このブラウザではドラッグ＆ドロップでのファイル指定に対応していません。ファイル選択ボタンを使ってください。'));
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      renderPhotoPreview(file, list.length > 1 ? tr('첫 번째 사진만 선택됨', 'Only the first photo was selected', '最初の1枚だけが選択されました') : '');
      showError('');
    }

    fileInput?.addEventListener('change', () => {
      fileInput.__editedFile = null; // 새 사진을 고르면 이전 편집은 버린다
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
