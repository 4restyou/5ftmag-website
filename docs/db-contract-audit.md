# DB 계약 감사

생성: 2026-07-12 · `node scripts/db-audit.mjs --md`

클라이언트 참조: 테이블/뷰 29, RPC 25. 기준 스키마·마이그레이션 정의 102.

## 결과

클라이언트가 참조하는 모든 테이블·뷰·RPC가 `db/*-schema.sql` 또는
`supabase/migrations`에서 추적된다. 초기 수동 스키마의 복구 순서는
`db/baseline-manifest.json`에 정의되어 있다.
