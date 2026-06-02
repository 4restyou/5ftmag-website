// 5ft.mag — Playwright 스모크 테스트 설정
//   로컬 정적 서버를 띄워 핵심 페이지가 200 OK + 큰 깨짐 없이 렌더되는지만 확인.
//   로그인·DB·OAuth 흐름은 외부 의존이라 별도 환경에서 통합 테스트로 분리.

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4399);

export default defineConfig({
  testDir: './tests',
  // tests/unit/** 은 Vitest 영역. Playwright 가 가져가서 실행하지 않도록 제외.
  testIgnore: ['**/unit/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile',  use: { ...devices['iPhone 14'], browserName: 'chromium' } },
  ],
  webServer: {
    command: `node scripts/static-server.mjs ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
