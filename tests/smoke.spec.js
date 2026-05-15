// 5ft.mag 핵심 페이지 스모크 — 로딩 + 가시 텍스트 + 콘솔 에러 0
import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/',                  must: ['5ft.mag', 'Photo', 'Articles'] },
  { path: '/stories.html',      must: ['Articles', 'All'] },
  { path: '/films.html',        must: ['5ft Issue', 'Library'] },
  { path: '/market.html',       must: ['중고 장터'] },
  { path: '/me.html',           must: ['내 정보'] }, // 로그인 게이트 화면 노출
  { path: '/about.html',        must: ['5ft.mag'] },
  { path: '/legal/terms.html',  must: ['이용약관', '4rest'] },
  { path: '/legal/privacy.html', must: ['개인정보처리방침'] },
  { path: '/legal/copyright.html', must: ['저작권 안내'] },
];

for (const { path, must } of PAGES) {
  test(`load ${path}`, async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // 외부 의존(Supabase, Plausible 미설정 등) 에러는 스모크 범위 밖
        if (/supabase|plausible|sentry-cdn|cdn\.jsdelivr|net::ERR_/i.test(t)) return;
        consoleErrors.push('console: ' + t);
      }
    });
    const res = await page.goto(path, { waitUntil: 'load' });
    expect(res?.status(), `${path} HTTP status`).toBeLessThan(400);
    for (const phrase of must) {
      await expect(page.locator('body'), `${path} must contain "${phrase}"`).toContainText(phrase);
    }
    expect(consoleErrors, `${path} 콘솔 에러`).toEqual([]);
  });
}

test('films 카드 클릭으로 모달 오픈', async ({ page }) => {
  await page.goto('/films.html');
  await page.waitForSelector('.film-card', { timeout: 8000 });
  const firstCard = page.locator('.film-card').first();
  await firstCard.click();
  await expect(page.locator('.modal-overlay.open, #modalOverlay.open')).toBeVisible({ timeout: 4000 });
});

test('legal 푸터 링크가 동적으로 inject 되는지', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.footer-links a[data-legal]'));
  await expect(page.locator('.footer-links a[data-legal]')).toHaveCount(3);
});
