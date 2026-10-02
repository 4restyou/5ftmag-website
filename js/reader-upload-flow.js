(function () {
  'use strict';

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const i18n = window.i18n || { isEn: false, locale: 'ko-KR', t: (ko) => ko, url: (u) => u };
  const tr = i18n.t;

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
        const error = new Error(tr(`${label} 시간 초과 (${Math.round(ms / 1000)}초). 네트워크 상태 확인 후 다시 시도해 주세요.`, `${label} timed out (${Math.round(ms / 1000)}s). Check your network connection and try again.`, `${label}がタイムアウトしました（${Math.round(ms / 1000)}秒）。ネットワークの状態を確認してから、もう一度お試しください。`));
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
    return !/로그인|권한|세션|ログイン|権限|セッション|row.level security|unauthorized|forbidden|TUS 클라이언트/i.test(error?.message || '');
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
      if (left <= 0) throw new Error(tr('사진 업로드 시간 초과. 입력 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.', 'Photo upload timed out. Your entries are kept. Check your connection and try again.', '写真のアップロードがタイムアウトしました。入力内容は保持されています。接続を確認してから、もう一度お試しください。'));
      return Math.min(ms, left);
    }
    uploadMeta.attempts = Array.isArray(uploadMeta.attempts) ? uploadMeta.attempts : [];
    uploadMeta.finalError = '';
    if (navigator.onLine === false) {
      markProgress('storage', tr('네트워크 연결 필요', 'No network connection', 'ネットワーク接続が必要です'), tr('연결을 확인한 뒤 다시 시도해 주세요.', 'Check your connection and try again.', '接続を確認してから、もう一度お試しください。'));
      throw new Error(tr('네트워크 연결이 끊겼어요. 연결을 확인한 뒤 다시 시도해 주세요.', 'Your network connection dropped. Check your connection and try again.', 'ネットワーク接続が切れました。接続を確認してから、もう一度お試しください。'));
    }
    setSubmitText(tr(`사진 읽는 중… (${fmtBytes(file.size)})`, `Reading photo… (${fmtBytes(file.size)})`, `写真を読み込み中…（${fmtBytes(file.size)}）`));
    markProgress('decode', tr('사진을 읽는 중', 'Reading the photo', '写真を読み込んでいます'), tr(`${fmtBytes(file.size)} 파일을 웹용 이미지로 준비하고 있어요.`, `Preparing the ${fmtBytes(file.size)} file for the web.`, `${fmtBytes(file.size)} のファイルを Web 用の画像に準備しています。`));
    const { blob } = await withNetworkTimeout(
      signal => resizeToJpeg(file, ({ stage, width: w, height: h }) => {
        if (signal.aborted) return;
        if (stage === 'decode') {
          setSubmitText(tr(`사진 읽는 중… (${fmtBytes(file.size)})`, `Reading photo… (${fmtBytes(file.size)})`, `写真を読み込み中…（${fmtBytes(file.size)}）`));
          markProgress('decode', tr('사진을 읽는 중', 'Reading the photo', '写真を読み込んでいます'), tr('큰 사진은 이 단계에서 몇 초 걸릴 수 있어요.', 'Large photos can take a few seconds at this step.', '大きな写真はこの段階で数秒かかることがあります。'));
        } else if (stage === 'resize') {
          setSubmitText(tr(`사진 크기 줄이는 중… (${w}×${h})`, `Resizing photo… (${w}×${h})`, `写真を縮小中…（${w}×${h}）`));
          markProgress('resize', tr('사진 크기 줄이는 중', 'Resizing the photo', '写真を縮小しています'), tr(`${w}×${h} 크기로 변환하고 있어요.`, `Converting to ${w}×${h}.`, `${w}×${h} のサイズに変換しています。`));
        } else if (stage === 'encode') {
          setSubmitText(tr(`사진 크기 줄이는 중… (${w}×${h})`, `Resizing photo… (${w}×${h})`, `写真を縮小中…（${w}×${h}）`));
          markProgress('encode', tr('사진을 압축하는 중', 'Compressing the photo', '写真を圧縮しています'), tr('업로드 전에 용량을 줄이고 있어요.', 'Reducing the file size before upload.', 'アップロード前に容量を小さくしています。'));
        }
      }),
      remaining(52000),
      tr('사진 변환', 'Photo conversion', '写真の変換')
    );
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error(tr('사진 용량이 큽니다. 5MB 이하 이미지로 다시 시도해 주세요.', 'The photo is too large. Please try an image under 5MB.', '写真の容量が大きすぎます。5MB 以下の画像でもう一度お試しください。'));

    markProgress('auth', tr('로그인 상태 확인 중', 'Checking sign-in', 'ログイン状態を確認中'), tr('업로드 권한을 확인하고 있어요.', 'Checking your upload permission.', 'アップロードの権限を確認しています。'));
    let user = readLocalJwtUser();
    if (!user) {
      const session = await withNetworkTimeout(db.auth.getSession(), remaining(6000), tr('로그인 확인', 'Sign-in check', 'ログイン確認'));
      user = session?.user;
    }
    if (!user) throw new Error(tr('로그인이 만료되었어요. 다시 로그인한 뒤 제출해 주세요.', 'Your sign-in has expired. Please sign in again and submit.', 'ログインの有効期限が切れました。もう一度ログインしてから送信してください。'));

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
      markProgress('storage', attemptLabel, tr(`${fmtBytes(targetBlob.size)} 전송 중입니다. 창을 닫지 마세요.`, `Sending ${fmtBytes(targetBlob.size)}. Please keep this window open.`, `${fmtBytes(targetBlob.size)} を送信中です。ウィンドウを閉じないでください。`));
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
          signal => db.submissions.photoExists(targetPath, targetBlob.size, { signal }), remaining(6000), tr('사진 저장 확인', 'Photo save check', '写真の保存確認')
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
        markProgress('storage', attemptLabel, tr(`${pct}% · ${fmtBytes(sent)} / ${fmtBytes(targetBlob.size)} 전송 중`, `${pct}% · Sending ${fmtBytes(sent)} / ${fmtBytes(targetBlob.size)}`, `${pct}% · ${fmtBytes(sent)} / ${fmtBytes(targetBlob.size)} を送信中`));
      };
      setSubmitText(tr(`${attemptLabel} 재시도 0%`, `${attemptLabel} retry 0%`, `${attemptLabel} を再試行 0%`));
      markProgress('storage', attemptLabel, tr('다시 청크 단위로 보내는 중입니다. 창을 닫지 마세요.', 'Resending in smaller chunks. Please keep this window open.', '小さく分けて送り直しています。ウィンドウを閉じないでください。'));
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
      return resumable || { error: { message: tr('업로드 응답을 확인하지 못했어요.', 'Could not confirm the upload response.', 'アップロードの応答を確認できませんでした。') } };
    }

    async function reencode(longSide, quality, attemptLabel) {
      setSubmitText(tr(`${attemptLabel} 준비 중…`, `Preparing ${attemptLabel}…`, `${attemptLabel} を準備中…`));
      markProgress('storage', tr(`${attemptLabel} 준비 중`, `Preparing ${attemptLabel}`, `${attemptLabel} を準備中`), tr(`더 가벼운 ${longSide}px 이미지로 다시 인코딩하고 있어요.`, `Re-encoding a lighter ${longSide}px image.`, `より軽い ${longSide}px の画像にエンコードし直しています。`));
      const out = await withNetworkTimeout(
        signal => resizeToJpeg(file, ({ stage, width: w, height: h }) => {
          if (signal.aborted) return;
          if (stage === 'resize') {
            setSubmitText(tr(`${attemptLabel} 준비 중… (${w}×${h})`, `Preparing ${attemptLabel}… (${w}×${h})`, `${attemptLabel} を準備中…（${w}×${h}）`));
          } else if (stage === 'encode') {
            setSubmitText(tr(`${attemptLabel} 압축 중… (${w}×${h})`, `Compressing ${attemptLabel}… (${w}×${h})`, `${attemptLabel} を圧縮中…（${w}×${h}）`));
          }
        }, { maxLongSide: longSide, quality }),
        remaining(52000),
        tr(`${attemptLabel} 변환`, `Converting ${attemptLabel}`, `${attemptLabel} の変換`)
      );
      return out.blob;
    }

    uploadMeta.uploadBytes = activeBlob.size;
    let { error: upErr } = await tryUpload(path, activeBlob, tr('사진 업로드 중…', 'Uploading photo…', '写真をアップロード中…'), 'primary');

    if (upErr && retryable(upErr)) {
      activeBlob = await reencode(FALLBACK_LONG_SIDE, FALLBACK_JPEG_QUALITY, tr('저용량 사진', 'smaller photo', '軽量版の写真'));
      path = initialPath.replace(/\.jpg$/, '-lite.jpg');
      if (!triedPaths.includes(path)) triedPaths.push(path);
      uploadMeta.triedPaths = triedPaths.slice();
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, tr('저용량 사진 업로드 중…', 'Uploading smaller photo…', '軽量版の写真をアップロード中…'), 'fallback'));
    }

    if (upErr && retryable(upErr)) {
      activeBlob = await reencode(TERTIARY_LONG_SIDE, TERTIARY_JPEG_QUALITY, tr('최소용량 사진', 'smallest photo', '最小サイズの写真'));
      path = initialPath.replace(/\.jpg$/, '-tiny.jpg');
      if (!triedPaths.includes(path)) triedPaths.push(path);
      uploadMeta.triedPaths = triedPaths.slice();
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, tr('최소용량 사진 업로드 중…', 'Uploading smallest photo…', '最小サイズの写真をアップロード中…'), 'tertiary'));
    }

    if (upErr) {
      uploadMeta.finalError = upErr.message || String(upErr);
      if (!retryable(upErr)) throw new Error(upErr.message);
      throw new Error(tr('사진 업로드가 완료되지 않았어요. 네트워크가 매우 불안정한 것 같습니다. 아래 안내된 경로로 보내주시면 직접 등록해 드릴게요. (', 'The photo upload did not finish. Your network seems very unstable. Send the photo through one of the options below and we will add it for you. (', '写真のアップロードが完了しませんでした。ネットワークがかなり不安定なようです。下記の方法で写真を送っていただければ、こちらで登録します。(') + upErr.message + ')');
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
