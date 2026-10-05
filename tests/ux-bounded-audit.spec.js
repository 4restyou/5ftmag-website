import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    window.MagDB = {
      isReady: () => true,
      auth: {
        getSession: async () => null,
        onChange: callback => {
          (window.auditAuthCallbacks ||= []).push(callback);
          window.auditAuthChange = async (...args) => {
            for (const listener of window.auditAuthCallbacks) await listener(...args);
          };
        },
      },
      favorites: { idsForType: async () => new Set() },
      webzine: {
        publicUrl: path => path,
        listPublished: async () => Array.from({ length: 12 }, (_, i) => ({
          id: `issue-${i}`, slug: `issue-${i}`, title: `Book ${i}`, author: `Author ${i}`,
          created_at: `2026-09-${String(28 - i).padStart(2, '0')}`, pdf_path: '/sample.pdf',
          description: 'A published book description. '.repeat(30),
        })),
      },
      ebooks: { listPublished: async () => [], myEntitlementIds: async () => new Set() },
      announcements: {
        current: async () => ({ data: {
          id: 'readability-test',
          body: '**공지** 긴 공지 내용을 읽을 수 있습니다. '.repeat(20),
          body_en: '**Notice** The full announcement stays readable. '.repeat(20),
          body_ja: '**お知らせ** 長いお知らせの全文を読めます。'.repeat(20),
        } }),
      },
    };
  });
});

// 공지 배너: 늘 한 줄로 흐르고 배너는 얇다. 움직임 줄이기 설정이면 흐르지 않고 줄바꿈해 전부 보인다(운영자 결정, 2026-10-05).
for (const prefix of ['', 'en/', 'ja/']) {
  test(`global notice scrolls in a thin bar and persists dismissal: ${prefix || 'ko'}`, async ({ page }) => {
    await page.goto(`/${prefix}about.html`);
    const bar = page.locator('.announcement-bar');
    const body = bar.locator('.announcement-bar-text');
    await expect(body).toBeVisible();
    expect(await body.evaluate(el => getComputedStyle(el).animationName)).toBe('announcement-marquee');
    expect((await bar.boundingBox()).height).toBeLessThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await bar.locator('.announcement-bar-close').click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await expect(bar).toHaveCount(0);
  });

  test(`global notice stops and wraps under reduced motion: ${prefix || 'ko'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${prefix}about.html`);
    const body = page.locator('.announcement-bar-text');
    await expect(body).toBeVisible();
    expect(await body.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    // 줄바꿈해 트랙 안에 전부 들어온다(옆으로 잘리지 않는다)
    expect(await body.evaluate(el => el.scrollWidth <= el.parentElement.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('visual bookshelf preserves marker navigation, keyboard access and detail return focus', async ({ page }, testInfo) => {
  await page.goto('/books.html');
  await expect(page.locator('.wz-row')).toHaveCount(12);
  await expect(page.locator('#wzBookSelect, #wzSelectedBook, .wz-selection')).toHaveCount(0);
  const row = page.locator('.wz-row').nth(9);
  if ((page.viewportSize()?.width || 0) > 700) {
    await page.locator('.wz-mark').nth(9).click();
  } else {
    // The original mobile shelf hides desktop markers; browsing uses the book stack.
    await row.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  }
  await expect.poll(async () => row.evaluate(el => {
    const r = el.getBoundingClientRect();
    const intro = document.querySelector('.wz-intro').getBoundingClientRect();
    return r.top >= intro.bottom && r.bottom <= innerHeight;
  })).toBe(true);
  await expect(row.locator('.wz-hit')).toHaveAttribute('tabindex', '0');
  const hit = page.locator('.wz-row').nth(9).locator('.wz-hit');
  await hit.evaluate(el => el.focus({ preventScroll: true }));
  await expect(hit).toBeFocused();
  await page.keyboard.press('Enter');
  const active = page.locator('.wz-dpage.on');
  await expect(active).toHaveCount(1);
  await expect(active.locator('h2')).toHaveText('Book 9');
  await expect(page.locator('#wzBack')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(active.locator('.wz-share')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#wzBack')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('book-detail.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#wzDetail')).not.toHaveClass(/\bon\b/);
  await expect(hit).toBeFocused();
  await expect(hit).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#wzDetail')).toHaveAttribute('inert', '');
  // Resize the shelf and select its last book, exercising rebuilt observer margins.
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('.wz-row').nth(11).evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
  await page.locator('.wz-row').nth(11).locator('.wz-hit').click();
  await expect(active.locator('h2')).toHaveText('Book 11');
  await expect(active).toHaveCount(1);
});

test('book motion follows scroll, reverses exactly, and leaves the description in normal flow', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/books.html?issue=issue-0');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 0');
  expect(await page.evaluate(() => CSS.supports('animation-timeline: view()'))).toBe(true);
  const next = page.locator('.wz-dpage').nth(1);
  const geometry = await next.evaluate(el => ({ top: el.offsetTop, height: el.offsetHeight, viewport: document.querySelector('#wzDetail').clientHeight }));
  const travel = Math.min(geometry.height, geometry.viewport);
  async function sample(visible) {
    const scroll = geometry.top - geometry.viewport + travel * visible;
    await page.locator('#wzDetail').evaluate((el, top) => { el.scrollTop = top; }, scroll);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return next.evaluate(el => {
      const stage = el.querySelector('.wz-stage3d');
      const meta = el.querySelector('.wz-meta');
      const book = el.querySelector('.wz-sbook');
      const pose = new DOMMatrixReadOnly(getComputedStyle(book).transform);
      const move = new DOMMatrixReadOnly(getComputedStyle(stage).transform);
      return {
        pose: Array.from(pose.toFloat64Array()), travel: move.m42,
        metaTop: meta.getBoundingClientRect().top - el.getBoundingClientRect().top,
        metaTransform: getComputedStyle(meta).transform,
        transition: getComputedStyle(book).transitionDuration,
        timeline: getComputedStyle(book).animationTimeline,
      };
    });
  }
  const early = await sample(.25);
  const middle = await sample(.5);
  const later = await sample(.75);
  expect(early.timeline).toBe('--wz-book');
  expect(early.transition).toBe('0s');
  expect(early.pose).not.toEqual(middle.pose);
  expect(middle.pose).not.toEqual(later.pose);
  expect(early.pose[5]).toBeLessThan(middle.pose[5]);
  expect(middle.pose[5]).toBeLessThan(later.pose[5]);
  expect(middle.metaTop).toBeCloseTo(early.metaTop, 1);
  expect(later.metaTop).toBeCloseTo(early.metaTop, 1);
  expect(middle.metaTransform).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('book-scroll-entry.png') });
  const reversed = await sample(.5);
  reversed.pose.forEach((value, i) => expect(value).toBeCloseTo(middle.pose[i], 3));
  await page.waitForTimeout(150);
  const stopped = await next.locator('.wz-sbook').evaluate(el => Array.from(new DOMMatrixReadOnly(getComputedStyle(el).transform).toFloat64Array()));
  stopped.forEach((value, i) => expect(value).toBeCloseTo(middle.pose[i], 3));
  const upright = await sample(1);
  expect(upright.pose[5]).toBeCloseTo(1, 3);
  expect(upright.travel).toBeCloseTo(0, 2);
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 1');
  const animatedBooks = await page.locator('.wz-sbook').evaluateAll(books => books.filter(book => getComputedStyle(book).animationName === 'wzBookScrollPose').length);
  expect(animatedBooks).toBeLessThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath('book-scroll-reading.png') });
  const stageImage = await next.locator('.wz-stage3d').screenshot();
  const colorCount = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    return colors.size;
  }, stageImage.toString('base64'));
  expect(colorCount).toBeGreaterThan(15);
  await page.evaluate(() => {
    window.auditReading = false;
    window.WebzineReader.open = async (_url, _title, options) => { await options.onReady(); window.auditReading = true; window.auditCloseReading = options.onClose; };
  });
  await next.locator('.wz-act').first().click();
  await expect.poll(() => page.evaluate(() => window.auditReading)).toBe(true);
  expect(await next.locator('.wz-sbook').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(() => window.auditCloseReading());
  expect(await next.locator('.wz-sbook').evaluate(el => getComputedStyle(el).animationName)).toBe('wzBookScrollPose');
  await page.locator('#wzDetail').evaluate((el, top) => { el.scrollTop = top; }, geometry.top + geometry.height - travel * .5);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const leaving = await next.evaluate(el => ({
    pose: Array.from(new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.wz-sbook')).transform).toFloat64Array()),
    travel: new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.wz-stage3d')).transform).m42,
  }));
  expect(leaving.pose[5]).toBeLessThan(.9);
  expect(leaving.pose[13]).toBeCloseTo(0, 3);
  expect(leaving.travel).toBeCloseTo(0, 3);
  await page.screenshot({ path: testInfo.outputPath('book-scroll-exit.png') });
});

test('reduced motion keeps the book upright without scroll animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/books.html?issue=issue-1');
  const active = page.locator('.wz-dpage.on');
  await expect(active.locator('h2')).toHaveText('Book 1');
  expect(await active.locator('.wz-sbook').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  expect(await active.locator('.wz-meta').evaluate(el => getComputedStyle(el).transform)).toBe('none');
});

test('catalog requests overlap and a delayed favorites response does not block a linked book', async ({ page }) => {
  await page.addInitScript(() => {
    const catalog = window.MagDB.webzine.listPublished;
    window.auditCatalog = [];
    window.MagDB.webzine.listPublished = () => new Promise(resolve => {
      window.auditCatalog.push('webzine');
      window.auditFinishCatalog = async () => resolve(await catalog());
    });
    window.MagDB.ebooks.listPublished = async () => { window.auditCatalog.push('ebooks'); return []; };
    window.MagDB.favorites.idsForType = () => new Promise(() => {});
  });
  await page.goto('/books.html?issue=issue-8');
  await expect.poll(() => page.evaluate(() => window.auditCatalog)).toEqual(['webzine', 'ebooks']);
  await page.evaluate(() => window.auditFinishCatalog());
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 8');
  await expect(page.locator('.wz-dpage.on .wz-meta')).toBeVisible();
});

for (const failing of ['webzine', 'ebooks']) {
  test(`catalog failure preserves the other published source: ${failing}`, async ({ page }) => {
    await page.addInitScript(source => {
      window.MagDB.ebooks.listPublished = async () => [{ id: 'paid', slug: 'paid', title: 'Paid book', price: 4000 }];
      window.MagDB[source].listPublished = () => { throw new Error('Catalog offline'); };
    }, failing);
    await page.goto('/books.html');
    await expect(page.locator('.wz-row')).toHaveCount(failing === 'webzine' ? 1 : 12);
    await expect(page.locator('[data-state-action="retry-books"]')).toHaveCount(0);
  });
}

test('failed catalog sources show a retry instead of leaving an empty loading screen', async ({ page }) => {
  await page.addInitScript(() => {
    window.MagDB.webzine.listPublished = window.MagDB.ebooks.listPublished = () => { throw new Error('Catalog offline'); };
  });
  await page.goto('/books.html');
  await expect(page.locator('[data-state-action="retry-books"]')).toBeVisible();
  await expect(page.locator('.wz-row')).toHaveCount(0);
});

test('only nearby covers load and a direct jump prepares the destination without fetching every cover', async ({ page }) => {
  const requested = new Set();
  await page.route('**/audit-covers/*', async route => {
    requested.add(new URL(route.request().url()).pathname);
    await route.fulfill({ path: 'img/favicon/icon-192.png', contentType: 'image/png' });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    const catalog = window.MagDB.webzine.listPublished;
    window.MagDB.webzine.listPublished = async () => (await catalog()).map((it, i) => ({ ...it, cover_url: '/audit-covers/' + i + '.png' }));
  });
  await page.goto('/books.html?issue=issue-8');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 8');
  await expect.poll(() => page.locator('.wz-dpage.on img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  expect(requested.size).toBeLessThanOrEqual(3);
  expect(requested.has('/audit-covers/8.png')).toBe(true);
  expect(requested.has('/audit-covers/0.png')).toBe(false);
  await expect(page.locator('.wz-dpage').nth(8).locator('img')).toHaveAttribute('fetchpriority', 'high');
  await page.locator('#wzDetail').evaluate(el => { el.scrollTop = el.querySelectorAll('.wz-dpage')[2].offsetTop; });
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 2');
  await expect.poll(() => page.locator('.wz-dpage.on img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  expect(requested.has('/audit-covers/2.png')).toBe(true);
  expect(requested.size).toBeLessThanOrEqual(6);
  expect(await page.locator('.wz-sbook').evaluateAll(books => books.filter(book => getComputedStyle(book).animationName === 'wzBookScrollPose').length)).toBeLessThanOrEqual(4);
});

test('background cover warming is sequential and a distant destination takes priority', async ({ page }) => {
  const requested = new Set();
  let finishBackground, finishDestination;
  await page.route('**/audit-covers/*', async route => {
    const path = new URL(route.request().url()).pathname;
    requested.add(path);
    if (path === '/audit-covers/2.png') await new Promise(resolve => { finishBackground = resolve; });
    if (path === '/audit-covers/9.png') await new Promise(resolve => { finishDestination = resolve; });
    await route.fulfill({ path: 'img/favicon/icon-192.png', contentType: 'image/png' });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: false, effectiveType: '4g' }, configurable: true });
    const catalog = window.MagDB.webzine.listPublished;
    window.MagDB.webzine.listPublished = async () => (await catalog()).map((it, i) => ({ ...it, cover_url: '/audit-covers/' + i + '.png' }));
  });
  await page.goto('/books.html?issue=issue-0');
  await expect(page.locator('.wz-dpage.on')).toHaveClass(/cover-ready/);
  await expect.poll(() => Boolean(finishBackground)).toBe(true);
  expect(requested.size).toBe(3);
  await page.waitForTimeout(200);
  expect(requested.has('/audit-covers/3.png')).toBe(false);
  await page.locator('#wzDetail').evaluate(el => { el.scrollTop = el.querySelectorAll('.wz-dpage')[9].offsetTop; });
  const destination = page.locator('.wz-dpage').nth(9);
  await expect(destination).toHaveClass(/\bon\b/);
  await expect.poll(() => Boolean(finishDestination)).toBe(true);
  await expect(destination.locator('img')).toHaveAttribute('fetchpriority', 'high');
  await expect(destination.locator('.wz-cover-fallback')).toBeVisible();
  await expect(destination.locator('img')).toHaveCSS('opacity', '0');
  const before = await destination.locator('.wz-meta').boundingBox();
  finishDestination();
  await expect(destination).toHaveClass(/cover-ready/);
  await expect(destination.locator('.wz-cover-fallback')).toBeHidden();
  await expect(destination.locator('img')).toHaveCSS('opacity', '1');
  const after = await destination.locator('.wz-meta').boundingBox();
  expect(after.y).toBeCloseTo(before.y, 1);
  expect(await page.locator('.wz-sbook').evaluateAll(books => books.filter(book => getComputedStyle(book).animationName === 'wzBookScrollPose').length)).toBeLessThanOrEqual(4);
  finishBackground();
});

test('rapid browsing postpones background covers and records frame timing with bounded motion', async ({ page }, testInfo) => {
  await page.route('**/audit-covers/*', route => route.fulfill({ path: 'img/favicon/icon-192.png', contentType: 'image/png' }));
  await page.addInitScript(() => {
    const catalog = window.MagDB.webzine.listPublished;
    window.MagDB.webzine.listPublished = async () => (await catalog()).map((it, i) => ({ ...it, cover_url: '/audit-covers/' + i + '.png' }));
  });
  await page.goto('/books.html?issue=issue-0');
  await expect(page.locator('.wz-dpage.on')).toHaveClass(/cover-ready/);
  const timing = await page.evaluate(async () => {
    const frames = [], longTasks = [];
    let done = false, previous = performance.now(), observer;
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({ type: 'longtask' });
    }
    function sample(now) { frames.push(now - previous); previous = now; if (!done) requestAnimationFrame(sample); }
    requestAnimationFrame(sample);
    const detail = document.querySelector('#wzDetail'), pages = detail.querySelectorAll('.wz-dpage');
    for (let i = 1; i <= 9; i++) {
      detail.scrollTop = pages[i].offsetTop;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    done = true; observer?.disconnect();
    const sorted = frames.slice(1).sort((a, b) => a - b);
    return { samples: sorted.length, medianFrameMs: sorted[Math.floor(sorted.length / 2)], longestFrameMs: sorted.at(-1), longTasksMs: longTasks };
  });
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 9');
  await expect(page.locator('.wz-dpage.on')).toHaveClass(/cover-ready/);
  await expect(page.locator('.wz-dpage').nth(11).locator('img')).not.toHaveAttribute('src');
  expect(await page.locator('.wz-sbook').evaluateAll(books => books.filter(book => getComputedStyle(book).animationName === 'wzBookScrollPose').length)).toBeLessThanOrEqual(4);
  await testInfo.attach('rapid-browsing-timing', { body: JSON.stringify(timing, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('book-rapid-browsing.png') });
});

test('first page preparation preserves the cover, supports cancellation, and reveals only rendered content', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const catalog = window.MagDB.webzine.listPublished;
    window.MagDB.webzine.listPublished = async () => (await catalog()).map(it => ({ ...it, description: 'A published book description. '.repeat(150) }));
    window.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument: () => ({
        destroy: () => { window.auditPdfCancelled = true; },
        promise: Promise.resolve({ numPages: 1, getPage: async () => ({
          getViewport: ({ scale = 1 } = {}) => ({ width: 400 * scale, height: 600 * scale }),
          render: ({ canvasContext, viewport }) => ({ promise: new Promise(resolve => {
            window.auditFinishPage = () => { canvasContext.fillStyle = '#ffe500'; canvasContext.fillRect(0, 0, viewport.width, viewport.height); resolve(); };
          }) }),
        }) }),
      }),
    };
    window.St = { PageFlip: class {
      constructor(book, options) {
        book.style.width = options.width + 'px'; book.style.height = options.height + 'px';
        this.book = book; this.options = options;
      }
      loadFromHTML(pages) { pages.forEach(p => { p.style.width = this.options.width + 'px'; p.style.height = this.options.height + 'px'; }); }
      on() {} getCurrentPageIndex() { return 0; } getOrientation() { return 'portrait'; } destroy() {}
    } };
  });
  await page.goto('/books.html?issue=issue-0');
  const active = page.locator('.wz-dpage.on');
  await expect(active.locator('h2')).toHaveText('Book 0');
  await active.locator('.wz-read').click();
  await expect(active.locator('.wz-opening-status')).toBeVisible();
  await expect(page.locator('.wz-reader')).toHaveClass(/is-preparing/);
  await expect(page.locator('.wz-reader')).toHaveCSS('visibility', 'hidden');
  await expect(active).not.toHaveClass(/\bopening\b/);
  await expect(active.locator('.wz-meta')).toHaveCSS('opacity', '1');
  await expect(active.locator('.wz-meta')).toHaveCSS('transform', 'none');
  await page.waitForTimeout(8100);
  await expect(active.locator('.wz-opening-hint')).toBeVisible();
  expect(await active.locator('.wz-cancel-read').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('book-preparation.png') });
  await active.locator('.wz-cancel-read').click();
  await expect(page.locator('.wz-reader')).toHaveCount(0);
  await expect(active.locator('.wz-opening-status')).toBeHidden();
  expect(await page.evaluate(() => window.auditPdfCancelled)).toBe(true);
  await page.evaluate(() => window.auditFinishPage());
  await expect(page.locator('.wz-reader')).toHaveCount(0);
  await active.locator('.wz-more').click();
  await page.locator('#wzDetail').evaluate(el => { el.scrollTop = 0; });
  await active.locator('.wz-stage3d').click();
  await expect(page.locator('.wz-reader')).toHaveClass(/is-preparing/);
  await expect(active.locator('.wz-opening-status')).toHaveClass(/is-floating/);
  expect(await active.locator('.wz-opening-status').evaluate(el => {
    const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('book-preparation-floating.png') });
  await page.evaluate(() => window.auditFinishPage());
  await expect(page.locator('.wz-reader')).not.toHaveClass(/is-preparing/);
  await expect(page.locator('.wz-reader canvas')).toBeVisible();
  const pixel = await page.locator('.wz-reader canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data));
  expect(pixel).toEqual([255, 229, 0, 255]);
  await page.screenshot({ path: testInfo.outputPath('book-prepared-reader.png') });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(active.locator('.wz-read')).toBeFocused();
  await expect(active.locator('.wz-opening-status')).toBeHidden();
});

test('a delayed preview keeps the description visible, warms reading and shows loading feedback', async ({ page }) => {
  await page.addInitScript(() => {
    window.MagDB.webzine.listPublished = async () => [];
    window.MagDB.ebooks.listPublished = async () => [{ id: 'paid', slug: 'paid', title: 'Paid book', price: 4000, description: 'The description stays here.' }];
    window.MagDB.ebooks.getAccess = () => new Promise(resolve => { window.auditFinishAccess = resolve; });
  });
  await page.goto('/books.html?issue=paid');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Paid book');
  await page.evaluate(() => {
    window.WebzineReader.prepare = () => { window.auditReaderWarm = true; };
    window.WebzineReader.open = async (_url, _title, options) => { await options.onReady(); window.auditPreviewOpened = true; window.auditClosePreview = options.onClose; };
  });
  await page.locator('.wz-preview').click();
  expect(await page.evaluate(() => window.auditReaderWarm)).toBe(true);
  await expect(page.locator('.wz-opening-status')).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.locator('.wz-meta')).toHaveCSS('opacity', '1');
  await expect(page.locator('.wz-meta')).toHaveCSS('transform', 'none');
  await expect(page.locator('.wz-acts')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.wz-dpage')).not.toHaveClass(/\bopening\b/);
  await expect(page.getByRole('status').filter({ hasText: '책을 여는 중입니다' })).toBeVisible();
  await page.evaluate(() => window.auditFinishAccess({ url: '/preview.pdf', entitled: false }));
  await expect.poll(() => page.evaluate(() => window.auditPreviewOpened)).toBe(true);
  await page.evaluate(() => window.auditClosePreview());
  await expect(page.locator('.wz-opening-status')).toBeHidden();
  await expect(page.locator('.wz-acts')).not.toHaveAttribute('aria-busy');
  await page.evaluate(() => { window.auditPreviewOpened = false; });
  await page.locator('.wz-preview').click();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: '목록으로 돌아가기', exact: true }).click();
  await page.evaluate(() => window.auditFinishAccess({ url: '/preview.pdf', entitled: false }));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.auditPreviewOpened)).toBe(false);
  await expect(page.locator('.wz-opening-status')).toBeHidden();
});

for (const [prefix, access, preview, purchase, read, purchased] of [
  ['', '전자책 열람권', '미리보기', '구매하기', '전체 읽기', '구매함'],
  ['en/', 'Ebook reading access', 'Preview', 'Purchase', 'Read the whole book', 'Purchased'],
  ['ja/', '電子書籍の閲覧権', 'プレビュー', '購入する', '全編を読む', '購入済み'],
]) {
  for (const owned of [false, true]) {
    test(`paid book detail keeps its price visible regardless of ownership: ${prefix || 'ko'} / ${owned}`, async ({ page }, testInfo) => {
      await page.addInitScript(ownsBook => {
        window.MagDB.ebooks.listPublished = async () => [{
          id: 'paid-book', slug: 'paid-book', title: 'Paid photobook', price: 4000,
          description: 'A paid ebook description.', created_at: '2026-10-05',
        }];
        window.auditBookOwned = ownsBook;
        window.MagDB.ebooks.myEntitlementIds = async () => new Set(window.auditBookOwned ? ['paid-book'] : []);
      }, owned);
      await page.goto(`/${prefix}books.html?issue=paid-book`);
      const active = page.locator('.wz-dpage.on');
      await expect(active.locator('h2')).toHaveText('Paid photobook');
      const price = active.locator('.wz-price');
      await expect(price).toBeVisible();
      await expect(price).toContainText(access);
      await expect(price).toContainText('4,000');
      await expect(active.locator(owned ? '.wz-own' : '.wz-buy')).toHaveCount(1);
      await expect(active.locator(owned ? '.wz-buy' : '.wz-own')).toHaveCount(0);
      await expect(active.locator('.wz-act:not([hidden])')).toHaveCount(owned ? 1 : 2);
      if (owned) {
        await expect(active.getByRole('link', { name: new RegExp('^' + preview) })).toHaveCount(0);
        await expect(active.locator('.wz-own')).toHaveText(new RegExp(read));
        await expect(price.locator('.wz-owned')).toBeVisible();
        await expect(price.locator('.wz-owned')).toHaveText(purchased);
        await expect(active.locator('.wz-stage3d')).toHaveAttribute('aria-label', `Paid photobook ${read}`);
      } else {
        await expect(active.getByRole('link', { name: new RegExp('^' + preview) })).toBeVisible();
        await expect(active.getByRole('link', { name: new RegExp('^' + purchase) })).toBeVisible();
        await expect(price.locator('.wz-owned')).toBeHidden();
      }
      expect(await price.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth;
      })).toBe(true);
      await expect(active).toHaveClass(/\bsettled\b/);
      await page.screenshot({ path: testInfo.outputPath('paid-book-detail.png') });
      if (owned) {
        await page.evaluate(() => {
          window.MagDB.ebooks.getAccess = async slug => { window.auditAccessSlug = slug; return { url: '/owned.pdf', entitled: true }; };
          window.WebzineReader.open = async (_url, _title, options) => {
            window.auditOwnedOptions = { deferred: options.deferReveal, cta: options.cta };
            await options.onReady(); window.auditOwnedReady = true; window.auditCloseOwned = options.onClose;
          };
        });
        await active.locator('.wz-own').click();
        await expect.poll(() => page.evaluate(() => window.auditOwnedReady)).toBe(true);
        expect(await page.evaluate(() => window.auditAccessSlug)).toBe('paid-book');
        expect(await page.evaluate(() => window.auditOwnedOptions)).toEqual({ deferred: true, cta: null });
        await page.evaluate(() => window.auditCloseOwned());
        await expect(active.locator('.wz-opening-status')).toBeHidden();
        await expect(active.locator('.wz-own')).toBeFocused();
      }
      await page.evaluate(() => window.auditAuthChange('SIGNED_OUT', null));
      await expect(active.locator('.wz-own')).toHaveCount(0);
      await expect(active.getByRole('link', { name: new RegExp('^' + preview) })).toBeVisible();
      await expect(active.getByRole('link', { name: new RegExp('^' + purchase) })).toBeVisible();
      await expect(price.locator('.wz-owned')).toBeHidden();
      await page.evaluate(() => { window.auditBookOwned = true; return window.auditAuthChange('SIGNED_IN', {user:{id:'book-reader'}}); });
      await expect(active.locator('.wz-act:not([hidden])')).toHaveCount(1);
      await expect(active.getByRole('link', { name: new RegExp('^' + preview) })).toHaveCount(0);
      await expect(price.locator('.wz-owned')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('.wz-row').filter({ hasText: 'Book 0' }).locator('.wz-hit').click();
      await expect(active.locator('h2')).toHaveText('Book 0');
      await expect(active.locator('.wz-price')).toHaveCount(0);
    });
  }
}

for (const [prefix, label] of [['', '좋아한 책 모음'], ['en/', 'Liked books'], ['ja/', 'お気に入りの本']]) {
  test(`liked books collection stays below shelf markers and in the mobile account group: ${prefix || 'ko'}`, async ({ page }, testInfo) => {
    await page.goto(`/${prefix}books.html`);
    await expect(page.locator('.wz-row')).toHaveCount(12);
    await expect(page.locator('.wz-intro a')).toHaveCount(0);
    const library = page.locator('#wzMarks .wz-library-link');
    const href = `/${prefix}me.html#fav-webzine`;
    await expect(library).toHaveAttribute('aria-label', label);
    await expect(library).toHaveAttribute('href', href);
    const mobileLink = page.locator('#mobileNav [data-group="account"] a').filter({ hasText: label });
    await expect(mobileLink).toHaveCount(1);
    await expect(mobileLink).toHaveAttribute('href', href);
    await expect.poll(() => page.evaluate(() => typeof window.auditAuthChange)).toBe('function');
    await page.evaluate(() => window.auditAuthChange('SIGNED_IN', { user: { id: 'reader-test' } }));
    await expect(mobileLink).toHaveCount(1);
    await expect(page.locator('.nav-account-menu a').filter({ hasText: label })).toHaveAttribute('href', href);
    await page.evaluate(() => window.auditAuthChange('SIGNED_OUT', null));
    await expect(mobileLink).toHaveCount(1);
    if (testInfo.project.name.includes('mobile')) {
      await expect(library).toBeHidden();
      await page.locator('#menuBtn').click();
      await expect(mobileLink).toBeVisible();
      await mobileLink.click();
    } else {
      await expect(library).toBeVisible();
      const lastMark = await page.locator('.wz-mark').last().boundingBox();
      const box = await library.boundingBox();
      expect(box.width).toBe(44);
      expect(box.height).toBe(44);
      expect(box.y).toBeGreaterThan(lastMark.y + lastMark.height + 12);
      const tooltip = library.locator('[role="tooltip"]');
      await expect(tooltip).toBeHidden();
      await library.hover();
      await expect(tooltip).toBeVisible();
      await library.focus();
      await expect(tooltip).toBeVisible();
      expect(await library.locator('.wz-library-icon').evaluate(el => getComputedStyle(el).maskImage)).toContain('/img/icons/library-big.svg');
      await library.click();
    }
    await expect(page).toHaveURL(new RegExp(`/${prefix}me\\.html#fav-webzine$`));
  });
}

test('detail observer follows DOM scrolling after a long description expands (not a touch gesture)', async ({ page }) => {
  await page.goto('/books.html?issue=issue-7');
  const active = page.locator('.wz-dpage.on');
  await expect(active).toHaveCount(1);
  await expect(active.locator('h2')).toHaveText('Book 7');
  await active.locator('.wz-more').click();
  await expect(active.locator('.wz-desc')).toHaveClass(/is-open/);
  await expect(active.locator('h2')).toHaveText('Book 7');
  // Exercise real scroll/observer updates without relying on wheel support in mobile WebKit.
  const previousScroll = await page.locator('#wzDetail').evaluate(el => el.scrollTop);
  await active.evaluate(el => {
    document.querySelector('#wzDetail').scrollBy({ top: el.getBoundingClientRect().height, behavior: 'instant' });
  });
  await expect.poll(() => page.locator('#wzDetail').evaluate(el => el.scrollTop)).toBeGreaterThan(previousScroll);
  await expect(active).toHaveCount(1);
  await expect(active.locator('h2')).toHaveText('Book 8');
  await expect(page.locator('.wz-row').nth(8).locator('.wz-hit')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#wzDetail')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.wz-row').nth(8).locator('.wz-hit')).toBeFocused();
});

test('a new book opens as soon as close returns focus and survives the old animation callback', async ({ page }) => {
  await page.goto('/books.html?issue=issue-7');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 7');
  await page.keyboard.press('Escape');
  await expect(page.locator('.wz-row').nth(7).locator('.wz-hit')).toBeFocused();
  // Use the restored shelf immediately, without waiting for its trailing animation.
  await page.locator('.wz-row').nth(8).locator('.wz-hit').evaluate(el => el.focus());
  await page.keyboard.press('Enter');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 8');
  await expect(page.locator('#wzBack')).toBeFocused();
  const openedAt = await page.evaluate(() => performance.now());
  // Observe beyond the old close callback's 1050ms deadline, not just first paint.
  await expect.poll(() => page.evaluate(() => performance.now()), { timeout: 3000 }).toBeGreaterThan(openedAt + 1100);
  await expect(page.locator('#wzDetail')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#wzDetail')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.wz-dpage.on h2')).toHaveText('Book 8');
});
