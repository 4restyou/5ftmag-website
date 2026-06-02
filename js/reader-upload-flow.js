(function () {
  'use strict';

  const FALLBACK_LONG_SIDE = 1200;
  const FALLBACK_JPEG_QUALITY = 0.68;
  const TERTIARY_LONG_SIDE = 800;
  const TERTIARY_JPEG_QUALITY = 0.55;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  function readerUploadTimeoutMs(kind = 'primary') {
    const override = Number(window.__readerUploadTimeoutMs || 0);
    if (override > 0) return override;
    if (kind === 'tertiary') return 300000;
    if (kind === 'fallback') return 240000;
    return 180000;
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
  }) {
    setSubmitText(`사진 디코딩 중… (${fmtBytes(file.size)})`);
    markProgress('decode', '사진을 읽는 중', `${fmtBytes(file.size)} 파일을 웹용 이미지로 준비하고 있어요.`);
    const { blob } = await withNetworkTimeout(
      resizeToJpeg(file, ({ stage, width: w, height: h }) => {
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
      52000,
      '사진 변환'
    );
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('사진 용량이 큽니다. 5MB 이하 이미지로 다시 시도해 주세요.');

    markProgress('auth', '로그인 상태 확인 중', '업로드 권한을 확인하고 있어요.');
    let user = readLocalJwtUser();
    if (!user) {
      const session = await withNetworkTimeout(db.auth.getSession(), 6000, '로그인 확인');
      user = session?.user;
    }
    if (!user) throw new Error('로그인이 만료되었어요. 다시 로그인한 뒤 제출해 주세요.');

    const initialPath = `${user.id}/${Date.now()}-${uuid()}.jpg`;
    let path = initialPath;
    let activeBlob = blob;
    const triedPaths = [initialPath];

    async function tryUpload(targetPath, targetBlob, attemptLabel, timeoutKind) {
      setSubmitText(`${attemptLabel} (${fmtBytes(targetBlob.size)})`);
      markProgress('storage', attemptLabel, `${fmtBytes(targetBlob.size)} 전송 중입니다. 창을 닫지 마세요.`);
      const simple = await withNetworkTimeout(
        db.submissions.uploadPhoto(targetPath, targetBlob),
        readerUploadTimeoutMs(timeoutKind),
        attemptLabel
      ).catch(err => ({ error: { message: err.message } }));
      if (!simple || !simple.error) return { error: null };

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
      return withNetworkTimeout(
        db.submissions.uploadPhotoResumable(targetPath, targetBlob, { onProgress }),
        readerUploadTimeoutMs(timeoutKind),
        attemptLabel
      ).catch(err => ({ error: { message: err.message } }));
    }

    async function reencode(longSide, quality, attemptLabel) {
      setSubmitText(`${attemptLabel} 준비 중…`);
      markProgress('storage', `${attemptLabel} 준비 중`, `더 가벼운 ${longSide}px 이미지로 다시 인코딩하고 있어요.`);
      const out = await withNetworkTimeout(
        resizeToJpeg(file, ({ stage, width: w, height: h }) => {
          if (stage === 'resize') {
            setSubmitText(`${attemptLabel} 준비 중… (${w}×${h})`);
          } else if (stage === 'encode') {
            setSubmitText(`${attemptLabel} 압축 중… (${w}×${h})`);
          }
        }, { maxLongSide: longSide, quality }),
        52000,
        `${attemptLabel} 변환`
      );
      return out.blob;
    }

    uploadMeta.uploadBytes = activeBlob.size;
    let { error: upErr } = await tryUpload(path, activeBlob, '사진 업로드 중…', 'primary');

    if (upErr) {
      activeBlob = await reencode(FALLBACK_LONG_SIDE, FALLBACK_JPEG_QUALITY, '저용량 사진');
      path = `${user.id}/${Date.now()}-${uuid()}-lite.jpg`;
      triedPaths.push(path);
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, '저용량 사진 업로드 중…', 'fallback'));
    }

    if (upErr) {
      activeBlob = await reencode(TERTIARY_LONG_SIDE, TERTIARY_JPEG_QUALITY, '최소용량 사진');
      path = `${user.id}/${Date.now()}-${uuid()}-tiny.jpg`;
      triedPaths.push(path);
      uploadMeta.uploadBytes = activeBlob.size;
      ({ error: upErr } = await tryUpload(path, activeBlob, '최소용량 사진 업로드 중…', 'tertiary'));
    }

    if (upErr) {
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
  };
})();
