import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/js/reader-upload-loader.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.route('**/data/readers.json*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    const types = ['Color Negative', 'Black & White', 'Slide', 'Cinema'];
    const films = Object.fromEntries(types.map((type, i) => [`test-${i}`, {
      tier: 'library', brand: 'Test', name: `Film ${i}`, displayName: `Film ${i}`,
      type, iso: 100, format: '35mm', aliases: [], photos: [],
    }]));
    window.MagDB = {
      isReady: () => true,
      auth: { getSession: async () => window.__librarySession || null, onChange: () => {} },
      favorites: { idsForType: async () => new Set() },
      films: { listAsObject: async () => films },
      announcements: { current: async () => ({ data: null }) },
    };
    window.fetchApprovedSubmissions = async () => types.flatMap((_, i) => [0, 1].map(n => ({
      id: `photo-${i}-${n}`, film: `Film ${i}`, author: `Test photographer ${n}`,
      image: '/img/filmstrip-frame.svg',
    })));
  });
});

async function checkTargets(page, view) {
  // 바로가기 링크는 폰에서 목록 아래(#libraryFoot)로 옮겨 가므로 자리와 상관없이 함께 센다.
  const controls = page.locator('.library-view-btn, .library-toolbar button:visible, .library-toolbar a:visible, .library-toolbar select:visible, .library-foot #libraryQuickLinks > :visible');
  const boxes = await controls.evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect();
    return { name: el.id || el.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  expect(boxes.length).toBeGreaterThanOrEqual(11);
  for (const box of boxes) {
    expect(box.width, box.name).toBeGreaterThanOrEqual(44);
    expect(box.height, box.name).toBeGreaterThanOrEqual(44);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
        && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Scroll clipped chip rows before checking actual hit testing, not just CSS dimensions.
  for (const control of await controls.all()) {
    await control.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    expect(await control.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 2);
      return hit === el || el.contains(hit);
    }), `${view}: ${await control.getAttribute('id') || await control.textContent()}`).toBe(true);
  }
}

async function activateEdge(control, hasTouch) {
  await control.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const position = { x: box.width / 2, y: 2 };
  // This is a real Playwright touch tap on mobile, not the DOM-scroll observer test.
  if (hasTouch) await control.tap({ position });
  else await control.click({ position });
}

for (const prefix of ['', 'en/', 'ja/']) {
  test(`Library toolbar targets and edge activation: ${prefix || 'ko'}`, async ({ page, hasTouch }, testInfo) => {
    await page.goto(`/${prefix}films.html`);
    await expect(page.locator('#libraryFilter .ft-chip')).toHaveCount(5);
    await checkTargets(page, 'films');
    const bw = page.locator('#libraryFilter [data-filter="bw"]');
    await activateEdge(bw, hasTouch);
    await expect(bw).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#filmsGridLibrary .film-card:visible')).toHaveCount(1);
    await page.evaluate(() => { window.__librarySession = { user: { id: 'test-user' } }; });
    await activateEdge(page.locator('#proposeFilmBtn'), hasTouch);
    await expect(page.locator('#proposeModal')).toBeVisible();
    await page.locator('#proposeModalClose').click();
    const photos = page.locator('.library-view-btn[data-view="photos"]');
    await activateEdge(photos, hasTouch);
    await expect(photos).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#libraryPhotosGrid .library-photo-card')).toHaveCount(8);
    await checkTargets(page, 'photos');
    const color = page.locator('#libraryPhotosChips [data-cat="color"]');
    await page.evaluate(() => { Math.random = () => 0.999; });
    await activateEdge(color, hasTouch);
    await expect(color).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#libraryPhotosGrid .library-photo-card')).toHaveCount(2);
    const authors = page.locator('#libraryPhotosGrid .library-photo-author');
    await expect(authors).toHaveText(['Test photographer 0', 'Test photographer 1']);
    await page.evaluate(() => { Math.random = () => 0; });
    await activateEdge(page.locator('#libraryPhotosShuffle'), hasTouch);
    await expect(authors).toHaveText(['Test photographer 1', 'Test photographer 0']);
    await expect(page.locator('#libraryPhotosGrid .library-photo-card')).toHaveCount(2);
    await activateEdge(page.locator('#libraryPhotosSearchBtn'), hasTouch);
    await expect(page.locator('#libraryPhotosSearchBar')).toBeVisible();
    await expect(page.locator('#libraryPhotosSearch')).toBeFocused();
    await page.locator('#libraryPhotosSearchClose').click();
    await page.locator('.library-view-toggle').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('library-photos-toolbar.png') });
  });
}

test('Library toolbar stays within a narrow viewport in both views', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/en/films.html');
  await expect(page.locator('#libraryFilter .ft-chip')).toHaveCount(5);
  await checkTargets(page, 'films');
  await page.locator('.library-view-btn[data-view="photos"]').click();
  await expect(page.locator('#libraryPhotosGrid .library-photo-card')).toHaveCount(8);
  await checkTargets(page, 'photos');
});
