import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/js/db-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    window.MagDB = {
      isReady: () => true,
      auth: { getSession: async () => null, onChange: () => {} },
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

test('book selector preserves keyboard selection and detail return focus', async ({ page }, testInfo) => {
  await page.goto('/books.html');
  await expect(page.locator('.wz-row')).toHaveCount(12);
  const select = page.locator('#wzBookSelect');
  await select.focus();
  await select.selectOption('8');
  await expect(select).toHaveValue('8');
  await expect(page.locator('#wzSelectedBook')).toContainText('Book 8');
  const row = page.locator('.wz-row').nth(8);
  await expect.poll(async () => row.evaluate(el => {
    const r = el.getBoundingClientRect();
    const intro = document.querySelector('.wz-intro').getBoundingClientRect();
    return r.top >= intro.bottom && r.bottom <= innerHeight;
  })).toBe(true);
  await expect(select).toBeFocused();
  await page.keyboard.type('Book 9');
  await expect(select).toHaveValue('9');
  await page.keyboard.press('Tab');
  await expect(page.locator('.wz-selection a')).toBeFocused();
  await page.keyboard.press('Tab');
  const hit = page.locator('.wz-row').nth(9).locator('.wz-hit');
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
  await expect(select).toHaveValue('9');
  await expect(page.locator('#wzDetail')).toHaveAttribute('inert', '');
  // Resize the shelf and select its last book, exercising rebuilt observer margins.
  await page.setViewportSize({ width: 320, height: 740 });
  await select.selectOption('11');
  await expect(select).toHaveValue('11');
  await page.locator('.wz-row').nth(11).locator('.wz-hit').click();
  await expect(active.locator('h2')).toHaveText('Book 11');
  await expect(active).toHaveCount(1);
});

test('detail observer follows scrolling after a long description expands', async ({ page }) => {
  await page.goto('/books.html?issue=issue-7');
  const active = page.locator('.wz-dpage.on');
  await expect(active).toHaveCount(1);
  await expect(active.locator('h2')).toHaveText('Book 7');
  await active.locator('.wz-more').click();
  await expect(active.locator('.wz-desc')).toHaveClass(/is-open/);
  await expect(active.locator('h2')).toHaveText('Book 7');
  const bounds = await active.boundingBox();
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, bounds.height);
  await expect(active).toHaveCount(1);
  await expect(active.locator('h2')).toHaveText('Book 8');
  await expect(page.locator('#wzBookSelect')).toHaveValue('8');
  await page.keyboard.press('Escape');
  await expect(page.locator('#wzDetail')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.wz-row').nth(8).locator('.wz-hit')).toBeFocused();
});
