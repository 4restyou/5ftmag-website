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

test('홈과 Stories 카드 썸네일은 깨진 이미지 없이 로드된다', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#storyList img', { timeout: 8000 });
  const homeBroken = await page.locator('#storyList img').evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).length);
  expect(homeBroken).toBe(0);

  await page.goto('/stories.html');
  await page.waitForSelector('#articlesGrid img', { timeout: 8000 });
  const storiesBroken = await page.locator('#articlesGrid img').evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).length);
  expect(storiesBroken).toBe(0);
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
    name: 'sample.png',
    mimeType: 'image/png',
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
        listApproved: async () => rows,
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
        uploadsTopFilms: async () => [],
        uploadsTopFilmsAll: async () => [],
        uploadsTopCameras: async () => [],
        uploadsTopCamerasAll: async () => [],
        uploadsThemeRatio: async () => ({ theme_count: 1, general_count: 3, total: 4, theme_ratio: 0.25 }),
        clientErrorsRecent: async () => [],
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
  await expect(page.locator('#opsClientErrors')).toHaveText('0');
  await expect(page.locator('#opsHealth')).toHaveText('확인 필요');

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
