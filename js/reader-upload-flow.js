(function () {
  'use strict';

  const FALLBACK_LONG_SIDE = 1200;
  const FALLBACK_JPEG_QUALITY = 0.68;
  const TERTIARY_LONG_SIDE = 800;
  const TERTIARY_JPEG_QUALITY = 0.55;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  function withNetworkTimeout(operation, ms, label) {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        const error = new Error(`${label} 시간 초과 (${Math.round(ms / 1000)}초). 네트워크 상태 확인 후 다시 시도해 주세요.`);
        error.code = 'UPLOAD_TIMEOUT';
        reject(error);
      }, ms);
      Promise.resolve().then(() => typeof operation === 'function' ? operation(controller.signal) : operation)
        .then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  function readerUploadTimeoutMs(kind = 'primary') {
    const override = Number(window.__readerUploadTimeoutMs || 0);
    if (override > 0) return override;
    if (kind === 'tertiary') return 20000;
    if (kind === 'fallback') return 30000;
    return 45000;
  }

  function retryable(error) {
    const status = Number(error?.status || error?.statusCode);
    if (status >= 400 && status < 500 && ![408, 413, 429].includes(status)) return false;
    return !/로그인|권한|세션|row.level security|unauthorized|forbidden|TUS 클라이언트/i.test(error?.message || '');
  }

  async function uploadPhoto({
    file,
    db,
    fmtBytes,
    readLocalJwtUser,
    resizeToJpeg,
    uuid,
    withNetworkTimeout,
    setSubmitText = () => {},
    markProgress = () => {},
    uploadMeta = {},
    uploadState = {},
  }) {
    const started = Date.now();
    const totalBudget = Number(window.__readerUploadTotalTimeoutMs) || 180000;
    function remaining(ms) {
      const left = totalBudget - (Date.now() - started);
      if (left <= 0) throw new Error('사진 업로드 시간 초과. 입력 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.');
      return Math.min(ms, left);
    }
    uploadMeta.attempts = Array.isArray(uploadMeta.attempts) ? uploadMeta.attempts : [];
    uploadMeta.finalError = '';
    if (navigator.onLine === false) {
      markProgress('storage', '네트워크 연결 필요', '연결을 확인한 뒤 다시 시도해 주세요.');
      throw new Error('네트워크 연결이 끊겼어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    setSubmitText(`사진 디코딩 중… (${fmtBytes(file.size)})`);
    markProgress('decode', '사진을 읽는 중', `${fmtBytes(file.size)} 파일을 웹용 이미지로 준비하고 있어요.`);
    const { blob } = await withNetworkTimeout(
      signal => resizeToJpeg(file, ({ stage, width: w, height: h }) => {
        if (signal.aborted) return;
        if (stage === 'decode') {
          setSubmitText(`사진 디코딩 중… (${fmtBytes(file.size)})`);
          markProgress('decode', '사진을 읽는 중', '큰 사진은 이 단계에서 몇 초 걸릴 수 있어요.');
        } else if (stage === 'resize') {
          setSubmitText(`사진 크기 줄이는 중… (${w}×${h})`);
          markProgress('resize', '사진 크기 줄이는 중', `${w}×${h} 크기로 변환하고 있어요.`);
        } else if (stage === 'encode') {
          setSubmitText(`사진 인코딩 중… (${w}×${h})`);
          markProgress('encode', '사진을 압축하는 중', '업로드 전에 용량을 줄이고 있어요.');
        }
      }),
      remaining(52000),
      '사진 변환'
    );
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('사진 용량이 큽니다. 5MB 이하 이미지로 다시 시도해 주세요.');

    markProgress('auth', '로그인 상태 확인 중', '업로드 권한을 확인하고 있어요.');
    let user = readLocalJwtUser();
    if (!user) {
      const session = await withNetworkTimeout(db.auth.getSession(), remaining(6000), '로그인 확인');
      user = session?.user;
    }
    if (!user) throw new Error('로그인이 만료되었어요. 다시 로그인한 뒤 제출해 주세요.');

    if (uploadState.userId !== user.id) {
      uploadState.userId = user.id;
      uploadState.initialPath = `${user.id}/${Date.now()}-${uuid()}.jpg`;
      uploadState.triedPaths = [];
    }
    const initialPath = uploadState.initialPath;
    let path = initialPath;
    let activeBlob = blob;
    const triedPaths = uploadState.triedPaths;
    if (!triedPaths.includes(initialPath)) triedPaths.push(initialPath);
    uploadMeta.triedPaths = triedPaths.slice();

    async function tryUpload(targetPath, targetBlob, attemptLabel, timeoutKind) {
      const attempt = {
        label: attemptLabel,
        kind: timeoutKind,
        path: targetPath,
        bytes: targetBlob.size,
        simple: 'pending',
        resumable: 'not-started',
      };
      uploadMeta.attempts.push(attempt);
      setSubmitText(`${attemptLabel} (${fmtBytes(targetBlob.size)})`);
      markProgress('storage', attemptLabel, `${fmtBytes(targetBlob.size)} 전송 중입니다. 창을 닫지 마세요.`);
      const simple = await withNetworkTimeout(
        signal => db.submissions.uploadPhoto(targetPath, targetBlob, { signal }),
        remaining(readerUploadTimeoutMs(timeoutKind)),
        attemptLabel
      ).catch(err => ({ error: { message: err.message, code: err.code } }));
      if (simple && !simple.error) {
        attempt.simple = 'ok';
        uploadMeta.lastSuccessfulPath = targetPath;
        uploadMeta.lastSuccessfulKind = timeoutKind;
        return { error: null };
      }
      attempt.simple = simple?.error?.message || 'error';
      uploadMeta.lastError = attempt.simple;

      async function alreadyStored() {
        if (!db.submissions.photoExists) return false;
        const result = await withNetworkTimeout(
          signal => db.submissions.photoExists(targetPath, targetBlob.size, { signal }), remaining(6000), '사진 저장 확인'
        ).catch(() => null);
        if (!result?.exists) return false;
        uploadMeta.lastSuccessfulPath = targetPath;
        uploadMeta.lastSuccessfulKind = timeoutKind;
        return true;
      }
      if (await alreadyStored()) { attempt.simple = 'recovered'; return { error: null }; }
      if (!retryable(simple?.error)) return simple;

      let lastPct = -1;
      const onProgress = (sent, total) => {
        const pct = Math.max(0, Math.min(100, Math.round((sent / (total || targetBlob.size)) * 100)));
        if (pct === lastPct) return;
        lastPct = pct;
        setSubmitText(`${attemptLabel} ${pct}% (${fmtBytes(sent)} / ${fmtBytes(targetBlob.size)})`);
        markProgress('storage', attemptLabel, `${pct}% · ${fmtBytes(sent)} / ${fmtBytes(targetBlob.size)} 전송 중`);
      };
      setSubmitText(`${attemptLabel} 재시도 0%`);
      markProgress('storage', attemptLabel, '다시 청크 단위로 보내는 중입니다. 창을 닫지 마세요.');
      const resumable = await withNetworkTimeout(
        signal => db.submissions.uploadPhotoResumable(targetPath, targetBlob, {
          signal, onProgress: (sent, total) => { if (!signal.aborted) onProgress(sent, total); },
        }),
        remaining(readerUploadTimeoutMs(timeoutKind)),
        attemptLabel
      ).catch(err => ({ error: { message: err.message, code: err.code } }));
      if (resumable && !resumable.error) {
        attempt.resumable = 'ok';
        uploadMeta.lastSuccessfulPath = targetPath;
        uploadMeta.lastSuccessfulKind = timeoutKind;
        return { error: null };
      }
      attempt.resumable = resumable?.error?.message || 'error';
      uploadMeta.lastError = attempt.resumable;
      if (await alreadyStored()) { attempt.resumable = 'recovered'; return { error: null }; }
      return resumable || { error: { message: '업로드 응답을 확인하지 못했어요.' } };
    }

    async function reencode(longSide, quality, attemptLabel) {
      setSubmitText(`${attemptLabel} 준비 중…`);
      markProgress('storage', `${attemptLabel} 준비 중`, `더 가벼운 ${longSide}px 이미지로 다시 인코딩하고 있어요.`);
      const out = await withNetworkTimeout(
        signal => resizeToJpeg(file, ({ stage, width: w, height: h }) => {
          if (signal.aborted) return;
          if (stage === 'resize') {
            setSubmitText(`${attemptLabel} 준비 중… (${w}×${h})`);
          } else if (stage === 'encode') {
            setSubmitText(`${attemptLabel} 압축 중… (${w}×${h})`);
          }
        }, { maxLongSide: longSide, quality }),
        remaining(52000),
        `${attemptLabel} 변환`
      );
      return out.blob;
    }

    uploadMeta.uploadBytes = activeBlob.size;
    let { error: upErr } = await tryUpload(path, activeBlob, '사진 업로드 중…', 'primary');

    if (upErr && retryable(upErr)) {
      activeBlob = await reencode(FALLBACK_LONG_SIDE, FALLBACK_JPEG_QUALITY, '저용량 사진');
      path = initialPath.replace(/\.jpg$/, '-lite.jpg');
      if (!triedPaths.includes(path)) triedPaths.push(path);
      uploadMeta.triedPaths = triedPaths.slice();
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, '저용량 사진 업로드 중…', 'fallback'));
    }

    if (upErr && retryable(upErr)) {
      activeBlob = await reencode(TERTIARY_LONG_SIDE, TERTIARY_JPEG_QUALITY, '최소용량 사진');
      path = initialPath.replace(/\.jpg$/, '-tiny.jpg');
      if (!triedPaths.includes(path)) triedPaths.push(path);
      uploadMeta.triedPaths = triedPaths.slice();
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, '최소용량 사진 업로드 중…', 'tertiary'));
    }

    if (upErr) {
      uploadMeta.finalError = upErr.message || String(upErr);
      if (!retryable(upErr)) throw new Error(upErr.message);
      throw new Error('사진 업로드가 완료되지 않았어요. 네트워크가 매우 불안정한 것 같습니다. 아래 안내된 경로로 보내주시면 직접 등록해 드릴게요. (' + upErr.message + ')');
    }

    return {
      path,
      triedPaths,
      user,
      uploadBytes: activeBlob.size,
    };
  }

  window.ReaderUploadFlow = {
    uploadPhoto,
    readerUploadTimeoutMs,
    retryable,
    withNetworkTimeout,
  };
})();
