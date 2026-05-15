// 5ft.mag image-processor Worker
//   File 객체를 받아 createImageBitmap + OffscreenCanvas 로 디코드/리사이즈/JPEG 인코딩.
//   메인 스레드는 UI 만 잡고, 무거운 픽셀 작업은 여기서.
//
// 메시지 프로토콜:
//   in:  { file, maxLongSide, quality, decodeTimeoutMs, encodeTimeoutMs }
//   out: { ok: true,  blob, width, height }
//        { ok: false, error: '에러 메시지' }

self.addEventListener('message', async (ev) => {
  const { file, maxLongSide = 2000, quality = 0.85, decodeTimeoutMs = 20000, encodeTimeoutMs = 15000 } = ev.data || {};
  try {
    if (!file) throw new Error('파일이 비었습니다.');

    // ── 1) 디코드 ──
    //  createImageBitmap 은 EXIF orientation 자동 적용 (imageOrientation: 'from-image')
    //  Safari 16 미만은 옵션 미지원 → fallback 없이 호출만.
    let bitmap;
    try {
      bitmap = await withTimeout(
        createImageBitmap(file, { imageOrientation: 'from-image' }),
        decodeTimeoutMs,
        '사진 디코드'
      );
    } catch (e) {
      // 옵션 미지원 환경 — 옵션 없이 한 번 더
      bitmap = await withTimeout(
        createImageBitmap(file),
        decodeTimeoutMs,
        '사진 디코드'
      );
    }

    // ── 2) 리사이즈 치수 결정 ──
    let { width: w, height: h } = bitmap;
    if (Math.max(w, h) > maxLongSide) {
      if (w >= h) { h = Math.round(h * maxLongSide / w); w = maxLongSide; }
      else        { w = Math.round(w * maxLongSide / h); h = maxLongSide; }
    }

    // ── 3) OffscreenCanvas 로 그리기 + JPEG 인코딩 ──
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await withTimeout(
      canvas.convertToBlob({ type: 'image/jpeg', quality }),
      encodeTimeoutMs,
      '사진 인코딩'
    );

    // Blob 은 자동으로 transferable — postMessage 가 안전하게 처리
    self.postMessage({ ok: true, blob, width: w, height: h });
  } catch (err) {
    self.postMessage({ ok: false, error: humanizeError(err) });
  }
});

function withTimeout(promise, ms, stage) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${stage} 단계에서 ${Math.round(ms/1000)}초 동안 응답이 없어 중단했습니다. 사진을 더 작게 줄이거나 다른 파일로 시도해 주세요.`));
    }, ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

function humanizeError(err) {
  const msg = err && err.message ? err.message : String(err || '알 수 없는 오류');
  // createImageBitmap 실패 시 흔한 메시지 정리
  if (/decod|format|encoding|invalid|corrupt/i.test(msg) && !/단계에서/.test(msg)) {
    return '사진을 읽지 못했어요. 다른 파일이거나 손상되었을 수 있습니다 (' + msg + ').';
  }
  return msg;
}
