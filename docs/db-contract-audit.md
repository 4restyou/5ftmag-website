# DB 계약 감사

생성: 2026-06-20 · `node scripts/db-audit.mjs --md`

클라이언트 참조: 테이블/뷰 26, RPC 25. 마이그레이션 정의 80.

## 마이그레이션에 정의 없는 클라이언트 참조

| 객체 | 상태 | 참조 위치 |
|---|---|---|
| `comments` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `comments_with_meta` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `likes` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `market_listings` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `market_reports` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `profiles_public` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `reader_submissions` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `reader_submissions_approved` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |
| `webzine_issues` | 추적 안 됨 (prod 존재 확인) | js/db-client.js |

