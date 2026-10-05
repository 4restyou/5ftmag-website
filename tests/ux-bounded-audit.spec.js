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

for (const prefix of ['', 'en/', 'ja/']) {
  test(`global notice expands, wraps and persists dismissal: ${prefix || 'ko'}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${prefix}about.html`);
    const bar = page.locator('.announcement-bar');
    const body = bar.locator('.announcement-bar-text');
    const expand = bar.locator('.announcement-bar-expand');
    await expect(expand).toBeVisible();
    const collapsed = await body.boundingBox();
    expect(await body.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect((await body.boundingBox()).height).toBeGreaterThan(collapsed.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await bar.locator('.announcement-bar-close').click();
    await expect(bar).toHaveCount(0);
    await page.reload();
    await expect(bar).toHaveCount(0);
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
