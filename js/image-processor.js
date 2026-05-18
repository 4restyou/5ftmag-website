// 5ft.mag image-processor
//   사진 업로드용 변환 모듈 — HEIC 가드 + Worker(OffscreenCanvas) 우선 +
//   메인스레드 createImageBitmap fallback + 전 단계 timeout.
//
// 사용:
//   const { blob, width, height } = await window.processImageForUpload(file, {
//     maxLongSide: 2000,
//     quality: 0.85,
//     onProgress: ({ stage, ... }) => { ... },
//   });
//
// stage 종류 (onProgress):
//   'guard'   — 사전 검사 (HEIC 거부 등)
//   'decode'  — 디코드 시작
//   'resize'  — 캔버스 그리기 시작 (목표 치수 결정 후)
//   'encode'  — JPEG 인코딩 시작
//   'done'    — 변환 완료 (결과는 별도 return)

(function () {
  'use strict';

  const DEFAULTS = {
    maxLongSide: 2000,
    quality: 0.85,
    decodeTimeoutMs: 20000,
    encodeTimeoutMs: 15000,
  };

  // 깐깐한 환경 감지 — Worker + OffscreenCanvas + createImageBitmap 셋 다 있어야 worker path
  function canUseWorker() {
    return typeof Worker !== 'undefined'
      && typeof OffscreenCanvas !== 'undefined'
      && typeof createImageBitmap === 'function';
  }

  // 메인 스레드 환경에서도 createImageBitmap 만 있으면 충분히 빠른 경로
  function canUseCreateImageBitmap() {
    return typeof createImageBitmap === 'function';
  }

  // HEIC/HEIF 사전 거부 — iPhone 카메라 기본 포맷, 대부분 브라우저 디코드 불가
  function rejectIfHeic(file) {
    const name = (file && file.name) ? String(file.name).toLowerCase() : '';
    const type = (file && file.type) ? String(file.type).toLowerCase() : '';
    if (type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name)) {
      throw new Error('HEIC/HEIF 형식은 이 브라우저에서 변환할 수 없어요. 사진을 JPG 로 저장한 뒤 다시 올려 주세요. (아이폰: 설정 → 카메라 → 포맷 → 호환성 우선)');
    }
  }

  function withTimeout(promise, ms, stage) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`${stage} 단계에서 ${Math.round(ms / 1000)}초 동안 응답이 없어 중단했습니다. 사진을 더 작게 줄이거나 다른 파일로 시도해 주세요.`));
      }, ms);
      promise.then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); }
      );
    });
  }

  // ════════════════════════════════════════════════
  // Worker 경로
  // ════════════════════════════════════════════════
  let _worker = null;
  function workerInstance() {
    if (_worker) return _worker;
    // stories/, admin/ 하위에서도 호출될 수 있어 상대 경로 보정
    const isNested = /\/(stories|admin|authors)\//.test(location.pathname);
    const url = (isNested ? '../' : './') + 'js/image-processor.worker.js?v=20260518-uploadstable';
    _worker = new Worker(url);
    return _worker;
  }

  function processInWorker(file, opts) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = workerInstance(); }
      catch (e) { return reject(new Error('Worker 초기화 실패: ' + e.message)); }

      let settled = false;
      let timer = null;
      const totalTimeoutMs = opts.decodeTimeoutMs + opts.encodeTimeoutMs + 10000;
      const onMessage = (ev) => {
        cleanup();
        if (settled) return;
        settled = true;
        const { ok, blob, width, height, error } = ev.data || {};
        if (ok) resolve({ blob, width, height });
        else reject(new Error(error || 'Worker 변환 실패'));
      };
      const onError = (ev) => {
        cleanup();
        if (settled) return;
        settled = true;
        try { w.terminate(); } catch (_) {}
        _worker = null;
        reject(new Error('Worker 오류: ' + (ev.message || '알 수 없는')));
      };
      function cleanup() {
        if (timer) clearTimeout(timer);
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
      }
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      timer = setTimeout(() => {
        cleanup();
        if (settled) return;
        settled = true;
        try { w.terminate(); } catch (_) {}
        _worker = null;
        reject(new Error('사진 변환 응답이 지연되어 중단했습니다. 변환기를 다시 준비했으니 사진을 더 작게 줄이거나 다시 시도해 주세요.'));
      }, totalTimeoutMs);
      w.postMessage({
        file,
        maxLongSide: opts.maxLongSide,
        quality: opts.quality,
        decodeTimeoutMs: opts.decodeTimeoutMs,
        encodeTimeoutMs: opts.encodeTimeoutMs,
      });
    });
  }

  // ════════════════════════════════════════════════
  // 메인 스레드 경로 — Worker 미지원 또는 Worker 실패 시
  //   1) createImageBitmap (있으면) — Image 보다 안정·EXIF 자동
  //   2) Image 태그 fallback
  // ════════════════════════════════════════════════
  async function decodeBitmapMain(file, decodeTimeoutMs) {
    if (canUseCreateImageBitmap()) {
      try {
        return await withTimeout(
          createImageBitmap(file, { imageOrientation: 'from-image' }),
          decodeTimeoutMs,
          '사진 디코드'
        );
      } catch (_) {
        // 옵션 미지원 → 옵션 없이
        return withTimeout(createImageBitmap(file), decodeTimeoutMs, '사진 디코드');
      }
    }
    // 진짜 옛 브라우저 fallback — Image 태그
    return withTimeout(new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 읽지 못했어요. 다른 파일이거나 손상되었을 수 있습니다.')); };
      img.src = url;
    }), decodeTimeoutMs, '사진 디코드');
  }

  async function processInMain(file, opts, onProgress) {
    onProgress({ stage: 'decode' });
    const src = await decodeBitmapMain(file, opts.decodeTimeoutMs);
    let { width: w, height: h } = src;
    if (Math.max(w, h) > opts.maxLongSide) {
      if (w >= h) { h = Math.round(h * opts.maxLongSide / w); w = opts.maxLongSide; }
      else        { w = Math.round(w * opts.maxLongSide / h); h = opts.maxLongSide; }
    }
    onProgress({ stage: 'resize', width: w, height: h });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) try { src.close(); } catch (_) {}

    onProgress({ stage: 'encode', width: w, height: h });
    const blob = await withTimeout(new Promise((resolve, reject) => {
      canvas.toBlob(b => {
        if (!b) return reject(new Error('사진 인코딩 결과가 비어 있어요. 다른 파일로 다시 시도해 주세요.'));
        resolve(b);
      }, 'image/jpeg', opts.quality);
    }), opts.encodeTimeoutMs, '사진 인코딩');
    return { blob, width: w, height: h };
  }

  // ════════════════════════════════════════════════
  // 공개 API
  // ════════════════════════════════════════════════
  async function processImageForUpload(file, userOpts = {}) {
    const opts = Object.assign({}, DEFAULTS, userOpts);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    onProgress({ stage: 'guard', name: file?.name, size: file?.size });
    rejectIfHeic(file);

    // 1) Worker 경로 우선
    if (canUseWorker()) {
      try {
        onProgress({ stage: 'decode' });
        const result = await processInWorker(file, opts);
        onProgress({ stage: 'done', width: result.width, height: result.height, bytes: result.blob.size });
        return result;
      } catch (e) {
        // Worker 실패 — 콘솔에만 기록하고 메인스레드 fallback 으로
        console.warn('[image-processor] Worker fallback:', e?.message || e);
      }
    }

    // 2) 메인스레드 경로
    const result = await processInMain(file, opts, onProgress);
    onProgress({ stage: 'done', width: result.width, height: result.height, bytes: result.blob.size });
    return result;
  }

  window.processImageForUpload = processImageForUpload;
})();
