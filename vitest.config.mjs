// Vitest 설정 — pure 함수 단위 테스트만 다룬다.
// CRUD 함수는 Supabase 클라이언트에 의존해서 mock 비용이 크니, 단계적 확장 계획.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.{js,mjs}'],
    // tests/regression.spec.js 는 Playwright 의 영역. 충돌 방지 위해 명시적으로 제외.
    exclude: ['tests/regression.spec.js', 'tests/**/node_modules/**'],
    reporters: ['default'],
  },
});
