(() => {
  // 필름스트립 이미지 저장 유틸.
  // DOM 캡처 대신 캔버스에 직접 그려 CORS/오프스크린 캡처 실패로 저장 이미지가
  // 검게 비는 문제를 줄이고, 컷 사이 간격도 정수 픽셀로 제어한다.

  function resolveCanvasSrc(src) {
    if (!src) return '';
    if (/^(data:|blob:|https?:|\/\/)/i.test(src)) return src;
    try {
      return new URL(src, document.baseURI || window.location.href).href;
    } catch (_) {
      return src;
    }
  }

  function loadCanvasImage(src, useCors = false) {
    return new Promise((resolve) => {
      const resolvedSrc = resolveCanvasSrc(src);
      if (!resolvedSrc) {
        resolve(null);
        return;
      }
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      try {
        img.decoding = 'async';
        img.loading = 'eager';
      } catch (_) {}
      img.onload = async () => {
        try {
          if (typeof img.decode === 'function') await img.decode();
        } catch (_) {}
        resolve(img.naturalWidth && img.naturalHeight ? img : null);
      };
      img.onerror = () => resolve(null);
      img.src = resolvedSrc;
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

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }

  function drawSprocketRow(ctx, x, y, w, h, rowY) {
    const count = 8;
    const holeW = w * 0.065;
    const holeH = h * 0.072;
    const startX = x + w * 0.085;
    const gap = (w * 0.83 - holeW) / (count - 1);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < count; i += 1) {
      const hx = startX + i * gap;
      ctx.beginPath();
      roundedRect(ctx, hx, rowY, holeW, holeH, h * 0.014);
      ctx.fill();
    }
  }

  function drawFilmFrameBase(ctx, x, y, w, h) {
    ctx.fillStyle = '#080301';
    ctx.fillRect(x, y, w, h);
  }

  function drawFilmFrameOverlay(ctx, x, y, w, h, variant = 0) {
    const topY = y + h * 0.048;
    const bottomY = y + h * 0.882;
    drawSprocketRow(ctx, x, y, w, h, topY);
    drawSprocketRow(ctx, x, y, w, h, bottomY);

    // variant 0: 5FT MAG / 4rest (위) + 아래 화살표 (filmstrip-frame.svg 패턴)
    // variant 1: Film Social Club / Street Photo Club (아래) + 위 화살표 (filmstrip-frame-2.svg 패턴)
    ctx.save();
    ctx.fillStyle = 'rgba(227, 166, 86, 0.82)';
    ctx.textBaseline = 'top';
    const labelFontPx = Math.max(11, Math.round(h * 0.04));
    const arrowFontPx = Math.max(12, Math.round(h * 0.045));

    if (variant === 0) {
      ctx.font = `800 ${labelFontPx}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('5FT MAG', x + w * 0.16, y + h * 0.008);
      ctx.textAlign = 'right';
      ctx.fillText('4rest', x + w * 0.85, y + h * 0.008);
      ctx.textAlign = 'center';
      ctx.font = `900 ${arrowFontPx}px Arial, sans-serif`;
      ctx.fillText('➜', x + w * 0.5, y + h * 0.94);
    } else {
      ctx.textAlign = 'center';
      ctx.font = `900 ${arrowFontPx}px Arial, sans-serif`;
      ctx.fillText('➜', x + w * 0.5, y + h * 0.008);
      ctx.font = `800 ${labelFontPx}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('Film Social Club', x + w * 0.12, y + h * 0.94);
      ctx.textAlign = 'right';
      ctx.fillText('Street Photo Club', x + w * 0.88, y + h * 0.94);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  function drawFilmThumbFallback(ctx, filmName, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#ffdf24';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = Math.max(3, Math.round(h * 0.04));
    ctx.beginPath();
    roundedRect(ctx, x, y + h * 0.12, w, h * 0.76, h * 0.05);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111111';
    ctx.fillRect(x + w * 0.42, y + h * 0.14, w * 0.18, h * 0.72);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.16)}px Arial, sans-serif`;
    ctx.fillText('FILM', x + w * 0.51, y + h * 0.5);

    ctx.fillStyle = '#111111';
    ctx.font = `800 ${Math.round(h * 0.08)}px Pretendard, Arial, sans-serif`;
    ctx.fillText(truncateText(ctx, filmName || '5ft.mag', w * 0.86), x + w * 0.5, y + h * 0.94);
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

    const loaded = await Promise.all(frames.map(frame => (
      frame?.src ? loadCanvasImage(frame.src, true) : Promise.resolve(null)
    )));
    frames.forEach((frame, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * tileW;
      const y = row * (tileH + rowGap);
      drawFilmFrameBase(ctx, x, y, tileW, tileH);
      const img = loaded[idx];
      if (img) {
        drawPhotoWindow(ctx, img, x, y + tileH * 0.145, tileW, tileH * 0.7246, !!frame.portrait);
      }
      drawFilmFrameOverlay(ctx, x, y, tileW, tileH, idx % 2);
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
      const thumbH = Math.round(headerH * 0.88);
      const thumbW = canImg
        ? Math.round(canImg.width * (thumbH / canImg.height))
        : Math.round(thumbH * 1.28);
      const thumbX = width - pad - thumbW;
      const thumbY = Math.round((headerH - thumbH) / 2);
      if (canImg) {
        ctx.drawImage(canImg, thumbX, thumbY, thumbW, thumbH);
      } else {
        drawFilmThumbFallback(ctx, filmName, thumbX, thumbY, thumbW, thumbH);
      }
      textRightX = thumbX - Math.max(20, Math.round(pad * 0.4));
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
