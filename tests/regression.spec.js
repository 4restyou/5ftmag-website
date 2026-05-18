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
