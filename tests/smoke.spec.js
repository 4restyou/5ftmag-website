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

test('짧은 필름 공유 링크에서도 모바일 asset과 이미지가 깨지지 않는다', async ({ page }) => {
  const failed = [];
  page.on('requestfailed', req => failed.push(req.url()));
  page.on('response', res => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/film/superia400', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('Library');
  await expect(page.locator('#filmsGridLibrary .film-card').first()).toBeVisible({ timeout: 8000 });
  const result = await page.evaluate(() => ({
    fontFamily: getComputedStyle(document.body).fontFamily,
    brokenImages: [...document.images]
      .filter(img => {
        if (!(img.currentSrc || img.src)) return false;
        if (img.closest('.lightbox')) return false;
        if (img.complete && img.naturalWidth > 0) return false;
        if (img.loading === 'lazy') {
          const rect = img.getBoundingClientRect();
          const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
          if (!inViewport) return false;
        }
        return true;
      })
      .map(img => img.currentSrc || img.src),
  }));
  expect(result.fontFamily).toContain('Pretendard');
  expect(result.brokenImages).toEqual([]);
  expect(failed.filter(url => !/supabase|cdn\.jsdelivr/i.test(url))).toEqual([]);
});

test('카톡 인앱형 짧은 공유 링크들이 모바일에서 asset을 잃지 않는다', async ({ page }) => {
  const paths = [
    { path: '/film/superia400', must: 'Library', imageScope: '#filmsGridLibrary' },
    { path: '/camera/Leica%20M6', must: 'Library', imageScope: '#filmsGridLibrary' },
    { path: '/contributor/__botong', must: 'Library', imageScope: '#filmsGridLibrary' },
    { path: '/market/test-listing-id', must: '중고 장터', imageScope: 'body' },
    { path: '/stories/film-flea-market-s6', must: '필름카메라 플리마켓', imageScope: 'article' },
    { path: '/authors/5ftmag', must: '5ft.mag 편집부', imageScope: 'body' },
  ];

  for (const target of paths) {
    const failed = [];
    page.removeAllListeners('requestfailed');
    page.removeAllListeners('response');
    page.on('requestfailed', req => failed.push(req.url()));
    page.on('response', res => {
      if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(target.path, { waitUntil: 'networkidle' });
    await expect(page.locator('body'), `${target.path} text`).toContainText(target.must);

    const result = await page.locator(target.imageScope).evaluate(scope => ({
      fontFamily: getComputedStyle(document.body).fontFamily,
      brokenImages: [...scope.querySelectorAll('img')]
        .filter(img => {
          if (!(img.currentSrc || img.src)) return false;
          if (img.closest('.lightbox')) return false;
          if (img.complete && img.naturalWidth > 0) return false;
          if (img.loading === 'lazy') {
            const rect = img.getBoundingClientRect();
            const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
            if (!inViewport) return false;
          }
          return true;
        })
        .map(img => img.currentSrc || img.src),
    }));
    expect(result.fontFamily, `${target.path} font`).toContain('Pretendard');
    expect(result.brokenImages, `${target.path} broken images`).toEqual([]);
    expect(failed.filter(url => !/supabase|cdn\.jsdelivr|favicon/i.test(url)), `${target.path} failed requests`).toEqual([]);
  }
});

test('중첩 짧은 경로의 asset fallback redirect가 동작한다', async ({ request }) => {
  const assets = [
    '/film/img/symbol-b.svg',
    '/camera/css/common.css',
    '/contributor/js/site-common.js',
    '/market/pretendard.css',
    '/stories/img/symbol-b.svg',
    '/stories/css/article.css',
    '/authors/js/site-common.js',
    '/legal/img/favicon/icon.svg',
  ];

  for (const path of assets) {
    const res = await request.get(path);
    expect(res.status(), path).toBeLessThan(400);
  }
});

test('legal 푸터 링크가 동적으로 inject 되는지', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.footer-links a[data-legal]'));
  await expect(page.locator('.footer-links a[data-legal]')).toHaveCount(3);
});
