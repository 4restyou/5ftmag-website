(() => {
  // 필름스트립 이미지 저장 유틸.
  // DOM 캡처 대신 캔버스에 직접 그려 CORS/오프스크린 캡처 실패로 저장 이미지가
  // 검게 비는 문제를 줄이고, 컷 사이 간격도 정수 픽셀로 제어한다.

  function loadCanvasImage(src, useCors = false) {
    return new Promise((resolve) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function collectRollExportFrames(target, kind) {
    if (kind === 'reader') {
      return [...target.querySelectorAll('.reader-slot.is-filled')].map(slot => {
        const img = slot.querySelector('.reader-slot-window img');
        if (!img) return null;
        return {
          src: img.currentSrc || img.src,
          portrait: img.classList.contains('is-portrait'),
        };
      }).filter(Boolean);
    }
    if (kind === 'contrib') {
      return [...target.querySelectorAll('.reader-contributor-photo')].map(cell => {
        const img = cell.querySelector('img');
        if (!img) return null;
        return {
          src: img.currentSrc || img.src,
          portrait: cell.classList.contains('is-portrait') || img.classList.contains('is-portrait'),
        };
      }).filter(Boolean);
    }
    return [...target.children].map(cell => {
      const photo = cell.querySelector('.modal-photo');
      const img = cell.querySelector('.modal-photo img');
      if (!img) return null;
      return {
        src: img.currentSrc || img.src,
        portrait: img.classList.contains('is-portrait') || photo?.classList.contains('is-portrait'),
      };
    }).filter(Boolean);
  }

  function drawImageCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale;
    const sh = h / scale;
    const sx = Math.max(0, (img.width - sw) / 2);
    const sy = Math.max(0, (img.height - sh) / 2);
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function drawPhotoWindow(ctx, img, x, y, w, h, portrait) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (portrait) {
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(Math.PI / 2);
      drawImageCover(ctx, img, -h / 2, -w / 2, h, w);
    } else {
      drawImageCover(ctx, img, x, y, w, h);
    }
    ctx.restore();
  }

  function collectAuthorsForExport(target, kind, ctx) {
    const seen = new Set();
    const list = [];
    function push(raw) {
      const v = (raw || '').toString().trim();
      if (!v) return;
      const key = v.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(v);
    }
    if (kind === 'reader') {
      target.querySelectorAll('.reader-slot.is-filled').forEach(slot => {
        const ig = slot.getAttribute('data-instagram');
        if (ig) push(ig);
        else push(slot.querySelector('.reader-slot-author')?.textContent || '');
      });
    } else if (kind === 'contrib') {
      push(ctx?.authorLabel || '');
    } else if (kind === 'editorial') {
      (ctx?.photographers || []).forEach(push);
    }
    return list;
  }

  function formatAuthorLine(authors) {
    if (!authors || !authors.length) return '';
    return authors.map(a => /^@/.test(a) ? a : `@${a}`).join('  ');
  }

  function truncateText(ctx, text, maxWidth) {
    if (!text || ctx.measureText(text).width <= maxWidth) return text;
    const ell = '...';
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + ell;
  }

  async function renderRollStripCanvas(target, kind) {
    const frames = collectRollExportFrames(target, kind);
    const cols = 6;
    const tileW = 380;
    const tileH = 345;
    const rowGap = 0;
    const rows = Math.max(1, Math.ceil(frames.length / cols));
    const scale = 1.5;
    const innerW = cols * tileW;
    const innerH = rows * tileH + Math.max(0, rows - 1) * rowGap;
    const canvas = document.createElement('canvas');
    canvas.width = innerW * scale;
    canvas.height = innerH * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, innerW, innerH);

    const [frameImgA, frameImgB] = await Promise.all([
      loadCanvasImage('img/filmstrip-frame.svg?v=6'),
      loadCanvasImage('img/filmstrip-frame-2.svg?v=6'),
    ]);
    const loaded = await Promise.all(frames.map(frame => (
      frame?.src ? loadCanvasImage(frame.src, true) : Promise.resolve(null)
    )));
    frames.forEach((frame, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * tileW;
      const y = row * (tileH + rowGap);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, tileW, tileH);
      const img = loaded[idx];
      if (img) {
        drawPhotoWindow(ctx, img, x, y + tileH * 0.145, tileW, tileH * 0.7246, !!frame.portrait);
      }
      const frameImg = (idx % 2 === 0) ? frameImgA : frameImgB;
      if (frameImg) ctx.drawImage(frameImg, x, y, tileW, tileH);
    });
    return canvas;
  }

  async function composeBrandedRollCanvas(stripCanvas, { filmName, authors, filmThumb }) {
    const width = stripCanvas.width;
    const headerH = Math.max(148, Math.round(width * 0.075));
    const footerH = Math.max(116, Math.round(width * 0.052));
    const pad = Math.max(56, Math.round(width * 0.032));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = headerH + stripCanvas.height + footerH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const logo = await loadCanvasImage('img/logo-5ft-b.svg?v=20260518-exportlogo');
    const logoH = Math.min(70, Math.round(headerH * 0.42));
    if (logo) {
      const logoW = Math.round(logo.width * (logoH / logo.height));
      ctx.drawImage(logo, pad, Math.round((headerH - logoH) / 2), logoW, logoH);
    } else {
      ctx.fillStyle = '#111111';
      ctx.font = `800 ${Math.round(headerH * 0.3)}px Pretendard, Arial, sans-serif`;
      ctx.fillText('5ft.mag', pad, Math.round(headerH * 0.58));
    }

    let textRightX = width - pad;
    if (filmThumb) {
      const canImg = await loadCanvasImage(filmThumb);
      if (canImg) {
        const thumbH = Math.round(headerH * 0.88);
        const thumbW = Math.round(canImg.width * (thumbH / canImg.height));
        const thumbX = width - pad - thumbW;
        const thumbY = Math.round((headerH - thumbH) / 2);
        ctx.drawImage(canImg, thumbX, thumbY, thumbW, thumbH);
        textRightX = thumbX - Math.max(20, Math.round(pad * 0.4));
      }
    }

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'right';
    ctx.font = `800 ${Math.round(headerH * 0.26)}px Pretendard, Arial, sans-serif`;
    ctx.fillText(filmName, textRightX, Math.round(headerH * 0.46));
    const authorLine = formatAuthorLine(authors);
    if (authorLine) {
      ctx.fillStyle = '#888888';
      ctx.font = `500 ${Math.round(headerH * 0.12)}px Pretendard, Arial, sans-serif`;
      const maxLineW = Math.max(80, textRightX - pad);
      ctx.fillText(truncateText(ctx, authorLine, maxLineW), textRightX, Math.round(headerH * 0.72));
    }

    ctx.drawImage(stripCanvas, 0, headerH);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, headerH + stripCanvas.height, width, footerH);
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(footerH * 0.28)}px Pretendard, Arial, sans-serif`;
    ctx.fillText('www.5ftmag.com', Math.round(width / 2), headerH + stripCanvas.height + Math.round(footerH * 0.58));

    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = Math.max(1, Math.round(width * 0.0008));
    ctx.beginPath();
    ctx.moveTo(0, headerH - ctx.lineWidth / 2);
    ctx.lineTo(width, headerH - ctx.lineWidth / 2);
    ctx.moveTo(0, headerH + stripCanvas.height + ctx.lineWidth / 2);
    ctx.lineTo(width, headerH + stripCanvas.height + ctx.lineWidth / 2);
    ctx.stroke();

    return canvas;
  }

  function slugifyExportName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function downloadCanvas(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.92);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  window.FilmsRollExport = {
    collectAuthorsForExport,
    composeBrandedRollCanvas,
    downloadCanvas,
    renderRollStripCanvas,
    slugifyExportName,
  };

  // 기존 regression test 와 콘솔 디버깅 경로 호환.
  window.composeBrandedRollCanvas = composeBrandedRollCanvas;
  window.renderRollStripCanvas = renderRollStripCanvas;
})();
