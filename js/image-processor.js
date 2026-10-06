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

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const i18n = window.i18n || { isEn: false, locale: 'ko-KR', t: (ko) => ko, url: (u) => u };
  const tr = i18n.t;

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

  // HEIC/HEIF — iPhone 카메라 기본 포맷. 일부 모바일 브라우저는 네이티브 디코드가 가능하므로
  // 사전 거부하지 않고 먼저 변환을 시도한 뒤, 실패할 때만 안내한다.
  function isHeic(file) {
    const name = (file && file.name) ? String(file.name).toLowerCase() : '';
    const type = (file && file.type) ? String(file.type).toLowerCase() : '';
    return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/i.test(name);
  }

  function heicHelpMessage() {
    return tr('이 브라우저에서는 HEIC/HEIF 사진을 읽지 못했어요. 사진 앱에서 JPG로 공유하거나, 아이폰 설정 → 카메라 → 포맷 → 호환성 우선으로 바꾼 뒤 다시 시도해 주세요.', 'This browser could not read the HEIC/HEIF photo. Share it as a JPG from your Photos app, or on iPhone go to Settings → Camera → Formats → Most Compatible, then try again.', 'このブラウザでは HEIC/HEIF の写真を読み込めませんでした。写真アプリから JPG で共有するか、iPhone の「設定」→「カメラ」→「フォーマット」→「互換性優先」に変更してから、もう一度お試しください。');
  }

  function withTimeout(promise, ms, stage) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(tr(`${stage} 단계에서 ${Math.round(ms / 1000)}초 동안 응답이 없어 중단했습니다. 사진을 더 작게 줄이거나 다른 파일로 시도해 주세요.`, `${stage} stopped after ${Math.round(ms / 1000)} seconds with no response. Try a smaller photo or a different file.`, `${stage}の段階で${Math.round(ms / 1000)}秒間応答がなかったため中止しました。写真を小さくするか、別のファイルでお試しください。`)));
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
        reject(new Error(tr('사진 변환 응답이 지연되어 중단했습니다. 변환기를 다시 준비했으니 사진을 더 작게 줄이거나 다시 시도해 주세요.', 'Photo conversion took too long and was stopped. The converter has been reset. Try a smaller photo or try again.', '写真の変換に時間がかかりすぎたため中止しました。変換処理をリセットしたので、写真を小さくするか、もう一度お試しください。')));
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
          tr('사진 디코드', 'Photo decoding', '写真のデコード')
        );
      } catch (_) {
        // 옵션 미지원 → 옵션 없이
        return withTimeout(createImageBitmap(file), decodeTimeoutMs, tr('사진 디코드', 'Photo decoding', '写真のデコード'));
      }
    }
    // 진짜 옛 브라우저 fallback — Image 태그
    return withTimeout(new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tr('사진을 읽지 못했어요. 다른 파일이거나 손상되었을 수 있습니다.', 'Could not read the photo. The file may be unsupported or damaged.', '写真を読み込めませんでした。対応していないファイルか、破損している可能性があります。'))); };
      img.src = url;
    }), decodeTimeoutMs, tr('사진 디코드', 'Photo decoding', '写真のデコード'));
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
        if (!b) return reject(new Error(tr('사진 인코딩 결과가 비어 있어요. 다른 파일로 다시 시도해 주세요.', 'Photo encoding returned nothing. Please try a different file.', '写真のエンコード結果が空でした。別のファイルでもう一度お試しください。')));
        resolve(b);
      }, 'image/jpeg', opts.quality);
    }), opts.encodeTimeoutMs, tr('사진 인코딩', 'Photo encoding', '写真のエンコード'));
    return { blob, width: w, height: h };
  }

  // ════════════════════════════════════════════════
  // 공개 API
  // ════════════════════════════════════════════════
  async function processImageForUpload(file, userOpts = {}) {
    const opts = Object.assign({}, DEFAULTS, userOpts);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    onProgress({ stage: 'guard', name: file?.name, size: file?.size });
    const heicLike = isHeic(file);

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
    try {
      const result = await processInMain(file, opts, onProgress);
      onProgress({ stage: 'done', width: result.width, height: result.height, bytes: result.blob.size });
      return result;
    } catch (e) {
      if (heicLike) throw new Error(heicHelpMessage());
      throw e;
    }
  }

  window.processImageForUpload = processImageForUpload;

  // ════════════════════════════════════════════════
  // 사진 지문 — 같은 사람이 같은 사진을 다시 올리는 것을 거른다
  //   sha256: 올린 원본 파일 바이트. 같은 파일이면 저장을 막는다(DB 유니크 인덱스).
  //   phash : 저장되는(줄인) 사진의 dHash 64비트. 닮으면 "중복 의심" 으로 표시만 한다.
  // 기존 사진의 phash 는 관리 화면이 저장된 파일로 같은 방식으로 계산한다(fromUrl).
  // ════════════════════════════════════════════════
  async function sha256Hex(file) {
    if (!file || !window.crypto?.subtle) return null;
    const buf = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function decodeForHash(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // dHash: 9×8 회색조로 줄여 이웃한 두 칸의 밝기를 비교한다. 한 번에 줄이면 큰 사진에서
  // 표본이 튀므로 72×64 를 거쳐 두 단계로 줄인다.
  async function dHashHex(blob) {
    if (!blob) return null;
    const src = await decodeForHash(blob);
    const mid = document.createElement('canvas');
    mid.width = 72; mid.height = 64;
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(src, 0, 0, 72, 64);
    if (typeof src.close === 'function') src.close();
    const small = document.createElement('canvas');
    small.width = 9; small.height = 8;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(mid, 0, 0, 9, 8);
    const px = sctx.getImageData(0, 0, 9, 8).data;
    const lum = (x, y) => {
      const i = (y * 9 + x) * 4;
      return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    };
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (lum(x, y) > lum(x + 1, y) ? 1 : 0);
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }

  // 올리는 경로: 원본 파일과 줄인 결과를 받아 두 지문을 낸다. 실패해도 업로드는 막지 않는다.
  async function fingerprintUpload(file, processedBlob) {
    const [sha256, phash] = await Promise.all([
      sha256Hex(file).catch(() => null),
      dHashHex(processedBlob).catch(() => null),
    ]);
    return { sha256, phash };
  }

  async function phashFromUrl(url, opts = {}) {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal: opts.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return dHashHex(await res.blob());
  }

  window.PhotoFingerprint = { sha256Hex, dHashHex, fingerprintUpload, phashFromUrl };
})();
