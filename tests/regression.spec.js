import { test, expect } from '@playwright/test';

test('알림 항목 클릭 시 전체 읽음 처리', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.__notif = { markAllRead: 0, unread: 2 };
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      notifications: {
        unreadCount: async () => window.__notif.unread,
        list: async () => [
          { id: 'n1', title: '새 사진이 승인됐어요', body: "Reader's Roll에 반영됐습니다.", link: '#', created_at: new Date().toISOString(), read_at: null },
          { id: 'n2', title: '매물 신고 처리', body: '처리가 완료됐습니다.', link: '#', created_at: new Date().toISOString(), read_at: null },
        ],
        markAllRead: async () => {
          window.__notif.markAllRead += 1;
          window.__notif.unread = 0;
          return { error: null };
        },
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
    };
  });

  await page.goto('/');
  await expect(page.locator('#notifBell')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#notifBadge')).toHaveText('2');

  await page.locator('#notifBell').click();
  await expect(page.locator('#notifList .notif-item.is-unread')).toHaveCount(2);
  await page.locator('#notifList .notif-item').first().click();

  await page.waitForFunction(() => window.__notif.markAllRead === 1);
  await expect(page.locator('#notifList .notif-item.is-unread')).toHaveCount(0);
  await expect(page.locator('#notifBadge')).toBeHidden();
});

test('알림 링크는 내부 경로만 href 로 렌더링한다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      notifications: {
        unreadCount: async () => 1,
        list: async () => [
          { id: 'n1', title: '안전하지 않은 링크', body: 'href 가 실행 URL 이면 안 됩니다.', link: 'javascript:alert(1)', created_at: new Date().toISOString(), read_at: null },
          { id: 'n2', title: '정상 링크', body: '내부 경로는 유지됩니다.', link: '/me.html#photos', created_at: new Date().toISOString(), read_at: null },
        ],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
    };
  });

  await page.goto('/');
  await page.locator('#notifBell').click();
  await expect(page.locator('#notifList .notif-item').first()).toHaveAttribute('href', '#');
  await expect(page.locator('#notifList .notif-item').nth(1)).toHaveAttribute('href', '/me.html#photos');
});

test('필름스트립 저장 캔버스 상단 로고가 흰 배경에서 보인다', async ({ page }) => {
  await page.goto('/films.html');
  const result = await page.evaluate(async () => {
    const strip = document.createElement('canvas');
    strip.width = 1200;
    strip.height = 600;
    const stripCtx = strip.getContext('2d');
    stripCtx.fillStyle = '#ffffff';
    stripCtx.fillRect(0, 0, strip.width, strip.height);

    const canvas = await composeBrandedRollCanvas(strip, {
      filmName: 'Fujifilm 200',
      kind: 'reader',
      authors: ['@5ft.mag'],
      filmThumb: null,
    });
    const ctx = canvas.getContext('2d');
    const sample = ctx.getImageData(30, 30, 240, 90).data;
    let darkPixels = 0;
    let coloredPixels = 0;
    for (let i = 0; i < sample.length; i += 4) {
      const avg = (sample[i] + sample[i + 1] + sample[i + 2]) / 3;
      if (avg < 140) darkPixels += 1;
      if (avg < 245) coloredPixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      darkPixels,
      coloredPixels,
    };
  });

  expect(result.width).toBe(1200);
  expect(result.height).toBeGreaterThan(800);
  expect(result.darkPixels).toBeGreaterThan(500);
  expect(result.coloredPixels).toBeGreaterThan(1000);
});

test('필름스트립 저장 캔버스는 모바일에서도 프레임과 필름 이미지를 함께 그린다', async ({ page }) => {
  await page.goto('/films.html');
  const result = await page.evaluate(async () => {
    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = 160;
    photoCanvas.height = 110;
    const photoCtx = photoCanvas.getContext('2d');
    const grad = photoCtx.createLinearGradient(0, 0, photoCanvas.width, photoCanvas.height);
    grad.addColorStop(0, '#174de8');
    grad.addColorStop(1, '#f24b2a');
    photoCtx.fillStyle = grad;
    photoCtx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);

    const target = document.createElement('div');
    target.innerHTML = `
      <div class="reader-slot is-filled" data-instagram="@test_user">
        <div class="reader-slot-window">
          <img src="${photoCanvas.toDataURL('image/png')}" alt="" />
        </div>
      </div>`;
    document.body.appendChild(target);

    const strip = await renderRollStripCanvas(target, 'reader');
    const stripCtx = strip.getContext('2d');
    const frameSample = stripCtx.getImageData(0, 0, Math.min(570, strip.width), Math.min(518, strip.height)).data;
    let frameDark = 0;
    let frameWhite = 0;
    for (let i = 0; i < frameSample.length; i += 4) {
      const avg = (frameSample[i] + frameSample[i + 1] + frameSample[i + 2]) / 3;
      if (avg < 30) frameDark += 1;
      if (avg > 245) frameWhite += 1;
    }

    const canvas = await composeBrandedRollCanvas(strip, {
      filmName: 'Fujifilm Superia X-TRA 400',
      authors: ['@test_user'],
      filmThumb: 'img/films/superia400-can.webp',
    });
    const ctx = canvas.getContext('2d');
    const headerSample = ctx.getImageData(canvas.width - 560, 20, 500, 160).data;
    let nonWhite = 0;
    for (let i = 0; i < headerSample.length; i += 4) {
      if (headerSample[i] < 245 || headerSample[i + 1] < 245 || headerSample[i + 2] < 245) nonWhite += 1;
    }
    target.remove();
    return { frameDark, frameWhite, nonWhite };
  });

  expect(result.frameDark).toBeGreaterThan(20000);
  expect(result.frameWhite).toBeGreaterThan(1500);
  expect(result.nonWhite).toBeGreaterThan(1000);
});

test('짧은 필름 링크에서도 저장 캔버스 asset을 루트에서 불러온다', async ({ page }) => {
  await page.goto('/film/superia400');
  const result = await page.evaluate(async () => {
    const target = document.createElement('div');
    target.innerHTML = Array.from({ length: 2 }, (_, idx) => {
      const photoCanvas = document.createElement('canvas');
      photoCanvas.width = 160;
      photoCanvas.height = 110;
      const photoCtx = photoCanvas.getContext('2d');
      photoCtx.fillStyle = idx ? '#f4d13d' : '#2367e8';
      photoCtx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
      return `
        <div class="reader-slot is-filled" data-instagram="@short_route_${idx}">
          <div class="reader-slot-window">
            <img src="${photoCanvas.toDataURL('image/png')}" alt="" />
          </div>
        </div>`;
    }).join('');
    document.body.appendChild(target);

    const strip = await renderRollStripCanvas(target, 'reader');
    const canvas = await composeBrandedRollCanvas(strip, {
      filmName: 'Fujifilm Superia X-TRA 400',
      authors: ['@short_route'],
      filmThumb: 'img/films/superia400-can.webp',
    });
    const ctx = canvas.getContext('2d');
    const frameSample = ctx.getImageData(10, 160, 560, 220).data;
    const thumbSample = ctx.getImageData(canvas.width - 360, 15, 300, 120).data;
    let darkFrame = 0;
    let coloredThumb = 0;
    for (let i = 0; i < frameSample.length; i += 4) {
      const avg = (frameSample[i] + frameSample[i + 1] + frameSample[i + 2]) / 3;
      if (avg < 35) darkFrame += 1;
    }
    for (let i = 0; i < thumbSample.length; i += 4) {
      const r = thumbSample[i];
      const g = thumbSample[i + 1];
      const b = thumbSample[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35 && (r < 245 || g < 245 || b < 245)) coloredThumb += 1;
    }
    target.remove();
    return { darkFrame, coloredThumb };
  });

  expect(result.darkFrame).toBeGreaterThan(20000);
  expect(result.coloredThumb).toBeGreaterThan(1200);
});

test('필름스트립 저장 캔버스는 행 사이 흰 간격 없이 붙어서 그린다', async ({ page }) => {
  await page.goto('/films.html');
  const result = await page.evaluate(async () => {
    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = 160;
    photoCanvas.height = 110;
    const photoCtx = photoCanvas.getContext('2d');
    photoCtx.fillStyle = '#2457d6';
    photoCtx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);

    const src = photoCanvas.toDataURL('image/png');
    const target = document.createElement('div');
    target.innerHTML = Array.from({ length: 7 }, (_, idx) => `
      <div class="reader-slot is-filled" data-instagram="@test_user_${idx}">
        <div class="reader-slot-window">
          <img src="${src}" alt="" />
        </div>
      </div>`).join('');
    document.body.appendChild(target);

    const strip = await renderRollStripCanvas(target, 'reader');
    const ctx = strip.getContext('2d');
    const seamY = Math.round(345 * 1.5) + 8;
    const sample = ctx.getImageData(0, seamY, 48, 24).data;
    let darkPixels = 0;
    let whitePixels = 0;
    for (let i = 0; i < sample.length; i += 4) {
      const avg = (sample[i] + sample[i + 1] + sample[i + 2]) / 3;
      if (avg < 45) darkPixels += 1;
      if (avg > 245) whitePixels += 1;
    }
    target.remove();
    return { height: strip.height, darkPixels, whitePixels };
  });

  expect(result.height).toBe(1035);
  expect(result.darkPixels).toBeGreaterThan(700);
  expect(result.whitePixels).toBeLessThan(120);
});

test('공유 링크는 파일 확장자와 query 대신 짧은 경로를 사용한다', async ({ page }) => {
  await page.goto('/');
  const urls = await page.evaluate(() => ({
    origin: location.origin,
    story: window.prettyShareUrl(`${location.origin}/stories/film-flea-market-s6.html`),
    film: window.prettyShareUrl(`${location.origin}/films.html?film=portra400`),
    camera: window.prettyShareUrl(`${location.origin}/films.html?camera=Leica%20M6`),
    contributor: window.prettyShareUrl(`${location.origin}/films.html?contributor=__botong`),
    market: window.prettyShareUrl(`${location.origin}/market.html?id=abc-123`),
  }));

  expect(urls.story).toBe(`${urls.origin}/stories/film-flea-market-s6`);
  expect(urls.film).toBe(`${urls.origin}/film/portra400`);
  expect(urls.camera).toBe(`${urls.origin}/camera/Leica%20M6`);
  expect(urls.contributor).toBe(`${urls.origin}/contributor/__botong`);
  expect(urls.market).toBe(`${urls.origin}/market/abc-123`);
});

test('마켓 등록 저장이 지연되면 에러를 보여주고 버튼을 복구한다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('**/js/image-processor.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.processImageForUpload = async () => ({
        blob: new Blob(['ok'], { type: 'image/jpeg' }),
        width: 1200,
        height: 800
      });
    `,
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.__MARKET_TIMEOUTS = { imageProcess: 80, auth: 80, upload: 80, write: 80, cleanup: 80 };
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        getUser: async () => { throw new Error('getUser should not be called for market upload'); },
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      notifications: {
        unreadCount: async () => 0,
        list: async () => [],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
      market: {
        list: async () => [],
        publicUrl: path => path,
        uploadPhoto: async () => ({ error: null }),
        removePhotos: async () => ({ error: null }),
        create: async () => new Promise(() => {}),
      },
    };
  });

  await page.goto('/market.html');
  await page.evaluate(() => {
    window.__reportedClientErrors = [];
    window.reportClientError = payload => window.__reportedClientErrors.push(payload);
  });
  await page.locator('#marketNewBtn').click();
  await expect(page.locator('#mktForm')).toBeVisible({ timeout: 5000 });
  await page.locator('#mktForm input[type="file"]').first().setInputFiles({
    name: 'market.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  await expect(page.locator('#mktPhotoRow img')).toHaveCount(1);
  await expect(page.locator('#mktUploadStatus')).toContainText('사진 준비 완료');
  await page.locator('input[name="title"]').fill('테스트 카메라');
  await page.locator('input[name="price"]').fill('10만원');
  await page.locator('select[name="category"]').selectOption('camera');
  await page.locator('input[name="location"]').fill('서울');
  await page.locator('select[name="delivery_method"]').selectOption('courier');
  await page.locator('input[name="seller_name"]').fill('테스트');
  await page.locator('input[name="phone"]').fill('010-1234-5678');
  await page.locator('textarea[name="contact"]').fill('DM');
  await page.locator('input[name="safety_agree"]').check();
  await page.locator('#mktFormSubmit').click();

  await expect(page.locator('#mktFormError')).toContainText('매물 등록 시간 초과', { timeout: 3000 });
  await expect(page.locator('#mktUploadStatus')).toContainText('저장이 중단됐어요');
  await expect(page.locator('#mktFormSubmit')).toBeEnabled();
  await expect(page.locator('#mktFormSubmit')).toHaveText('올리기');
  const reports = await page.evaluate(() => window.__reportedClientErrors);
  expect(reports).toHaveLength(1);
  expect(reports[0].message).toContain('[market-upload:write]');
  expect(reports[0].source).toBe('market-page:write');
});

test('picture WebP 로드 실패 시 원본 이미지로 복구한다', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fallback = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const picture = document.createElement('picture');
    picture.innerHTML = `
      <source srcset="/missing-webp-fallback-test.webp" type="image/webp">
      <img src="${fallback}" alt="fallback test">
    `;
    document.body.appendChild(picture);
    const img = picture.querySelector('img');
    await new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      window.setTimeout(resolve, 3000);
    });
    return {
      complete: img.complete,
      width: img.naturalWidth,
      sourceCount: picture.querySelectorAll('source').length,
      currentSrc: img.currentSrc || img.src,
    };
  });
  expect(result.complete).toBe(true);
  expect(result.width).toBeGreaterThan(0);
  expect(result.sourceCount).toBe(0);
  expect(result.currentSrc).toContain('data:image/gif');
});

test('홈과 Stories 카드 썸네일은 깨진 이미지 없이 로드된다', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#storyList img', { timeout: 8000 });
  const homeBroken = await page.locator('#storyList img').evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).length);
  expect(homeBroken).toBe(0);
  const homePolicyGaps = await page.locator('#storyList .post-img img').evaluateAll(imgs => imgs.filter(img => {
    const src = img.getAttribute('src') || '';
    if (!/\.(jpe?g|png)$/i.test(src)) return false;
    return !img.closest('picture')?.querySelector('source[type="image/webp"]');
  }).length);
  expect(homePolicyGaps).toBe(0);

  await page.goto('/stories.html');
  await page.waitForSelector('#articlesGrid img', { timeout: 8000 });
  const storiesBroken = await page.locator('#articlesGrid img').evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).length);
  expect(storiesBroken).toBe(0);
  const storiesPolicyGaps = await page.locator('#articlesGrid .article-img img').evaluateAll(imgs => imgs.filter(img => {
    const src = img.getAttribute('src') || '';
    if (!/\.(jpe?g|png)$/i.test(src)) return false;
    return !img.closest('picture')?.querySelector('source[type="image/webp"]');
  }).length);
  expect(storiesPolicyGaps).toBe(0);
});

test('개별 글 관련 카드 썸네일도 WebP 원본 fallback 정책을 따른다', async ({ page }) => {
  await page.goto('/stories/17.html');
  await page.waitForSelector('#relatedGrid img', { timeout: 8000 });
  await page.locator('#relatedGrid').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('#relatedGrid img'));
    return imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0);
  }, null, { timeout: 8000 });
  const result = await page.locator('#relatedGrid img').evaluateAll(imgs => ({
    broken: imgs.filter(img => !img.complete || img.naturalWidth === 0).length,
    policyGaps: imgs.filter(img => {
      const src = img.getAttribute('src') || '';
      if (!/\.(jpe?g|png)$/i.test(src)) return false;
      return !img.closest('picture')?.querySelector('source[type="image/webp"]');
    }).length,
  }));
  expect(result.broken).toBe(0);
  expect(result.policyGaps).toBe(0);
});

test('메인 Photo는 라이브 독자 사진 응답이 느려도 먼저 렌더된다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.MagDB = {
        isReady: () => true,
        auth: { getSession: async () => null, onChange: () => {} },
        profiles: { getMine: async () => null },
        notifications: { unreadCount: async () => 0, list: async () => [], markAllRead: async () => ({ error: null }) },
        realtime: { subscribeNotifications: async () => null },
        favorites: { idsForType: async () => new Set(), toggle: async () => ({ error: null }) },
      };
    `,
  }));
  await page.route('**/js/reader-submissions.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      window.fetchApprovedSubmissions = async () => new Promise(resolve => setTimeout(() => resolve([]), 10000));
    `,
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.goto('/');
  await expect(page.locator('#photoGrid .disc-cell').first()).toBeVisible({ timeout: 4200 });
  await expect(page.locator('#photoGrid .disc-cell')).not.toHaveCount(0);
});

test('모바일 홈은 Articles와 Photo 노출을 짧게 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await page.goto('/');
  await page.waitForSelector('#storyList .post-item', { timeout: 8000 });
  await page.waitForSelector('#photoGrid .disc-cell', { timeout: 8000 });

  await expect(page.locator('#storyList .post-item')).toHaveCount(5);
  await expect(page.locator('#photoGrid .disc-cell')).toHaveCount(10);
});

test('사진 업로드 폼이 단계별 진행 상태를 보여준다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('**/js/image-processor.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.processImageForUpload = async (_file, opts = {}) => {
      opts.onProgress?.({ stage: 'decode' });
      await new Promise(r => setTimeout(r, 20));
      opts.onProgress?.({ stage: 'resize', width: 1200, height: 800 });
      await new Promise(r => setTimeout(r, 20));
      opts.onProgress?.({ stage: 'encode', width: 1200, height: 800 });
      await new Promise(r => setTimeout(r, 20));
      return { blob: new Blob(['ok'], { type: 'image/jpeg' }), width: 1200, height: 800 };
    };
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        getUser: async () => ({ id: 'user-1' }),
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      submissions: {
        uploadPhoto: async () => {
          await new Promise(r => setTimeout(r, 50));
          return { error: null };
        },
        create: async () => ({ error: null }),
        removePhoto: async () => {},
        listApproved: async () => [],
      },
      notifications: {
        unreadCount: async () => 0,
        list: async () => [],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
      cameraOverrides: {
        list: async () => new Map(),
      },
    };
  });

  await page.goto('/');
  await page.locator('.rs-trigger').first().click();
  await expect(page.locator('#rs-form')).toBeVisible({ timeout: 5000 });

  await page.locator('input[name="photo"]').setInputFiles({
    name: 'sample.jpg',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  await page.locator('input[name="submitter_name"]').fill('테스트');
  await page.locator('#rs-film-trigger').click();
  await page.locator('.rs-film-option').first().click();
  await page.locator('input[name="consent"]').check();
  await page.locator('#rs-form button[type="submit"]').click();

  await expect(page.locator('#rs-upload-status')).toBeVisible();
  await expect(page.locator('#rs-upload-status')).toContainText(/사진을 읽는 중|사진 크기 줄이는 중|사진을 압축하는 중|사진 업로드 중|제출 기록 저장 중/);
  await expect(page.locator('#rs-modal-title')).toHaveText(/제출 완료/, { timeout: 5000 });
});

test('사진 업로드 실패는 실패 단계를 운영 오류 로그로 남긴다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('**/js/image-processor.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.processImageForUpload = async (_file, opts = {}) => {
      opts.onProgress?.({ stage: 'decode' });
      opts.onProgress?.({ stage: 'resize', width: 1200, height: 800 });
      opts.onProgress?.({ stage: 'encode', width: 1200, height: 800 });
      return { blob: new Blob(['ok'], { type: 'image/jpeg' }), width: 1200, height: 800 };
    };
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        getUser: async () => ({ id: 'user-1' }),
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      submissions: {
        uploadPhoto: async () => ({ error: { message: 'storage down' } }),
        create: async () => ({ error: null }),
        removePhoto: async () => {},
        listApproved: async () => [],
      },
      notifications: {
        unreadCount: async () => 0,
        list: async () => [],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
      cameraOverrides: {
        list: async () => new Map(),
      },
    };
  });

  await page.goto('/');
  await page.evaluate(() => {
    window.__reportedClientErrors = [];
    window.reportClientError = payload => window.__reportedClientErrors.push(payload);
  });
  await page.locator('.rs-trigger').first().click();
  await expect(page.locator('#rs-form')).toBeVisible({ timeout: 5000 });

  await page.locator('input[name="photo"]').setInputFiles({
    name: 'sample.jpg',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  await page.locator('input[name="submitter_name"]').fill('테스트');
  await page.locator('#rs-film-trigger').click();
  await page.locator('.rs-film-option').first().click();
  await page.locator('input[name="consent"]').check();
  await page.locator('#rs-form button[type="submit"]').click();

  await expect(page.locator('#rs-upload-status')).toContainText('제출이 중단됐어요', { timeout: 5000 });
  const reports = await page.evaluate(() => window.__reportedClientErrors);
  expect(reports).toHaveLength(1);
  expect(reports[0].message).toContain('[reader-upload:storage]');
  expect(reports[0].source).toBe('reader-submissions:storage');
  expect(reports[0].stack).toContain('input_bytes=');
  expect(reports[0].stack).toContain('upload_bytes=');
});

test('로그인 복귀 후 사진 업로드 폼을 자동으로 다시 연다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    const payload = JSON.stringify({ value: '1', ts: Date.now() });
    sessionStorage.setItem('5ft_pending_submission_open', payload);
    localStorage.setItem('5ft_pending_submission_open_fallback', payload);
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        getUser: async () => ({ id: 'user-1' }),
        onChange: cb => {
          setTimeout(() => cb('SIGNED_IN', { user: { id: 'user-1' } }), 20);
          return { unsubscribe() {} };
        },
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      submissions: {
        listApproved: async () => [],
      },
      notifications: {
        unreadCount: async () => 0,
        list: async () => [],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
      cameraOverrides: {
        list: async () => new Map(),
      },
    };
  });

  await page.goto('/films.html');
  await expect(page.locator('#rs-form')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#rs-modal-title')).toHaveText('사진 올리기');
  const pending = await page.evaluate(() => ({
    session: sessionStorage.getItem('5ft_pending_submission_open'),
    local: localStorage.getItem('5ft_pending_submission_open_fallback'),
  }));
  expect(pending).toEqual({ session: null, local: null });
});

test('Reader Roll 지난 롤 탐색은 숫자만 압축해 보여준다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.__listApprovedLimits = [];
    const rows = Array.from({ length: 73 }, (_, i) => ({
      id: `sub-${i + 1}`,
      image: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#${i}`,
      storage_path: `test/${i}.jpg`,
      author: i % 2 ? '@roll_user' : '@another_user',
      submitterName: i % 2 ? 'roll_user' : 'another_user',
      instagram: i % 2 ? '@roll_user' : '@another_user',
      film: 'Kodak UltraMax 400',
      camera: 'Leica M6',
      caption: '',
      created_at: new Date(2026, 0, i + 1).toISOString(),
      createdAt: new Date(2026, 0, i + 1).toISOString(),
      published: true,
    }));
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'user-1' } }),
        onChange: () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: false }),
      },
      submissions: {
        listApproved: async (limit) => {
          window.__listApprovedLimits.push(limit);
          return rows;
        },
      },
      notifications: {
        unreadCount: async () => 0,
        list: async () => [],
        markAllRead: async () => ({ error: null }),
      },
      realtime: {
        subscribeNotifications: async () => null,
      },
      favorites: {
        idsForType: async () => new Set(),
        toggle: async () => ({ error: null }),
      },
      cameraOverrides: {
        list: async () => new Map(),
      },
    };
  });

  await page.goto('/films.html');
  await page.locator('.film-card[data-film="ultramax"]').first().click();
  await expect.poll(async () => page.evaluate(() => window.__listApprovedLimits.length), { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.evaluate(() => window.__listApprovedLimits[0])).resolves.toBeNull();
  await expect(page.locator('#readerRollCounter-ultramax')).toContainText('1 / 36 · 3롤', { timeout: 5000 });
  await expect(page.locator('#readerRollSwitcher-ultramax .reader-roll-numbers')).toBeHidden();

  await page.locator('#readerRollSwitcher-ultramax .reader-roll-toggle').click();
  await expect(page.locator('#readerRollSwitcher-ultramax .reader-roll-number')).toHaveText(['2', '1']);
  await expect(page.locator('#readerRollSwitcher-ultramax .reader-roll-toggle')).toHaveAttribute('aria-expanded', 'true');

  await page.locator('#readerRollSwitcher-ultramax .reader-roll-number[data-roll-number="1"]').click();
  await expect(page.locator('#readerRollCounter-ultramax')).toContainText('36 / 36 · 1롤');
  await expect(page.locator('.reader-roll-intro')).toContainText('1번째 지난 롤');
});

test('Reader Roll 계산 모듈은 36컷 단위로 현재 롤을 나눈다', async ({ page }) => {
  await page.goto('/films.html');
  const result = await page.evaluate(() => {
    const rows = Array.from({ length: 72 }, (_, i) => ({
      id: `r-${String(72 - i).padStart(2, '0')}`,
      createdAt: new Date(2026, 0, 72 - i).toISOString(),
    }));
    const exact = window.ReaderRoll.buildState(rows, 36);
    const next = window.ReaderRoll.buildState(rows.concat({
      id: 'r-73',
      createdAt: new Date(2026, 0, 73).toISOString(),
    }), 36);
    return {
      exactCurrent: exact.currentNumber,
      exactCurrentRows: exact.currentRows.length,
      exactPast: exact.pastRolls.length,
      nextCurrent: next.currentNumber,
      nextCurrentRows: next.currentRows.length,
      firstSortedId: window.ReaderRoll.sortSubmissionsOldestFirst(rows)[0].id,
    };
  });

  expect(result).toEqual({
    exactCurrent: 2,
    exactCurrentRows: 36,
    exactPast: 1,
    nextCurrent: 3,
    nextCurrentRows: 1,
    firstSortedId: 'r-01',
  });
});

test('모바일 Films Library는 초기 노출을 줄이고 더 보기로 확장한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await page.goto('/films.html');
  await page.waitForSelector('#filmsGridLibrary .film-card');

  const initial = await page.locator('#filmsGridLibrary .film-card:visible').count();
  expect(initial).toBeLessThanOrEqual(30);
  await expect(page.locator('#libraryMoreWrap')).toBeVisible();

  await page.locator('#libraryMoreBtn').click();
  const expanded = await page.locator('#filmsGridLibrary .film-card:visible').count();
  expect(expanded).toBeGreaterThan(initial);

  await page.locator('#librarySearch').fill('kodak');
  await expect(page.locator('#libraryMoreWrap')).toBeHidden();
  const searched = await page.locator('#filmsGridLibrary .film-card:visible').count();
  expect(searched).toBeGreaterThan(0);
});

test('관리 통계 화면은 새 업로드를 운영 알림으로 감지한다', async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('**/js/site-common.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    window.__ops = {
      totalUploads: 12,
      todayUploads: 1,
      pendingUploads: 2,
      pendingReports: 1,
      notices: [],
    };
    window.notify = (msg, type) => window.__ops.notices.push({ msg, type });
    const rows = Array.from({ length: 7 }, (_, i) => ({
      day: `2026-05-${String(13 + i).padStart(2, '0')}`,
      views: i + 1,
      sessions: i + 1,
      uploads: i === 6 ? window.__ops.todayUploads : 0,
      approved: 0,
    }));
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => ({ user: { id: 'editor-1', email: 'editor@5ftmag.com' } }),
        signOut: async () => {},
      },
      profiles: {
        getMine: async () => ({ is_editor: true, display_name: '편집자' }),
      },
      analytics: {
        summary: async () => ({
          views_today: 10,
          views_yesterday: 8,
          views_last_7d: 70,
          views_last_30d: 300,
          sessions_last_30d: 120,
          total_views: 1000,
          total_sessions: 400,
        }),
        daily: async () => rows,
        topPaths: async () => [],
        referrers: async () => [],
        regions: async () => [],
        languages: async () => [],
        sessionStats: async () => ({ sessions: 10, avg_pages: 1.5, avg_duration_ms: 30000, bounce_rate: 0.2 }),
        dwellSummary: async () => ({ avg_ms: 25000, samples: 4 }),
        dwellByPath: async () => [],
        uploadsSummary: async () => ({
          total_uploads: window.__ops.totalUploads,
          total_approved: 8,
          total_pending: window.__ops.pendingUploads,
          total_rejected: 2,
          uploads_today: window.__ops.todayUploads,
          uploads_last_7d: 4,
          uploads_last_30d: 12,
          active_contributors_30d: 3,
          unique_contributors: 5,
        }),
        uploadsDaily: async () => rows,
        uploadsTopContributors: async () => [],
        uploadsTopFilms: async () => [{ film: 'Kodak Portra 400', uploads: 3, approved: 2 }],
        uploadsTopFilmsAll: async () => [{ film: 'Kodak Portra 400', uploads: 3, approved: 2 }],
        uploadsTopCameras: async () => [{ camera: 'Leica M6', uploads: 2, approved: 2 }],
        uploadsTopCamerasAll: async () => [{ camera: 'Leica M6', uploads: 2, approved: 2 }],
        uploadsThemeRatio: async () => ({ theme_count: 1, general_count: 3, total: 4, theme_ratio: 0.25 }),
        clientErrorsRecent: async () => [{
          message: '[reader-upload:storage] 사진 업로드가 완료되지 않았어요. (storage down)',
          source: 'reader-submissions:storage',
          path: '/films.html',
          ts: new Date().toISOString(),
          occurrences: 2,
        }, {
          message: '[market-upload:write] 매물 등록 시간 초과 (25초)',
          source: 'market-page:write',
          path: '/market.html',
          ts: new Date().toISOString(),
          occurrences: 1,
        }],
      },
      market: {
        adminReportCount: async () => window.__ops.pendingReports,
      },
    };
  });

  await page.goto('/admin/analytics.html');
  await expect(page.locator('#opsTotalUploads')).toHaveText('12');
  await expect(page.locator('#opsPendingUploads')).toHaveText('2');
  await expect(page.locator('#opsPendingReports')).toHaveText('1');
  await expect(page.locator('#opsClientErrors')).toHaveText('3');
  await expect(page.locator('#opsClientErrorsSub')).toHaveText('Reader 업로드 · 사진 업로드 2건 외');
  await expect(page.locator('#clientErrorCount')).toContainText('업로드 실패 3건');
  await expect(page.locator('#clientErrorStageSummary')).toContainText('Reader 업로드 · 사진 업로드 2건');
  await expect(page.locator('#clientErrorStageSummary')).toContainText('Market 업로드 · 기록 저장 1건');
  await expect(page.locator('#clientErrorList')).toContainText('Reader 업로드 · 사진 업로드');
  await expect(page.locator('#clientErrorList')).toContainText('Market 업로드 · 기록 저장');
  await expect(page.locator('#clientErrorList')).toContainText('사진 업로드가 완료되지 않았어요.');
  await expect(page.locator('#opsHealth')).toHaveText('확인 필요');
  await expect(page.locator('#topFilms')).toContainText('Kodak Portra 400');
  await expect(page.locator('#topCameras')).toContainText('Leica M6');

  await page.evaluate(() => {
    window.__ops.totalUploads += 2;
    window.__ops.todayUploads += 2;
    window.__ops.pendingUploads += 2;
  });
  await page.locator('#opsRefresh').click();
  await page.waitForFunction(() => window.__ops.notices.length === 1);

  const notice = await page.evaluate(() => window.__ops.notices[0]);
  expect(notice).toEqual({ msg: '새 사진 업로드 2건이 들어왔어요.', type: 'info' });
  await expect(page.locator('#opsTotalUploads')).toHaveText('14');
  await expect(page.locator('#up-today')).toHaveText('3');
});
