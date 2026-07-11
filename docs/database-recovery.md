# 데이터베이스 복구 기준

5ft magazine의 DB는 초기 수동 스키마와 이후 Supabase 마이그레이션으로 구성된다.
새 프로젝트 또는 재해 복구 환경에서는 아래 순서를 사용한다.

## 기준 파일

1. `db/baseline-manifest.json`이 초기 스키마의 유일한 적용 순서를 정의한다.
2. `npm run db:baseline`이 원본 SQL을 `db/baseline.sql`로 합친다.
3. `db/baseline.sql` 적용 후 `supabase/migrations/*.sql`을 파일명 순서로 적용한다.
4. `npm run db:audit`으로 클라이언트가 사용하는 테이블·뷰·RPC가 모두 추적되는지 확인한다.

`db/baseline.sql`은 생성 파일이다. 직접 수정하지 않고 개별 `db/*-schema.sql`을 수정한다.

## 복구 절차

```bash
npm ci
npm run db:baseline:check
npm run db:audit
```

그다음 새 Supabase 프로젝트의 SQL Editor에서 `db/baseline.sql`을 적용하고,
Supabase CLI로 마이그레이션을 적용한다.

```bash
supabase link --project-ref <새 프로젝트 ref>
supabase db push --include-all
```

스토리지의 실제 이미지·PDF 파일과 Auth 사용자는 SQL 스키마에 포함되지 않는다.
운영 백업에서 별도로 복구해야 한다. 복구 후 공개 화면, 로그인, 사진 응모,
장터, Magazine 열람, Shop 연동을 순서대로 스모크 테스트한다.

## 변경 규칙

- 초기 수동 객체를 수정하면 원본 스키마와 baseline을 함께 갱신한다.
- 신규 변경은 항상 `supabase/migrations`에 재실행 안전한 SQL로 추가한다.
- CI는 baseline 동기화와 신규 DB drift를 실패로 처리한다.
- 프로덕션 데이터가 있는 컬럼에 제약을 추가하기 전 실제 위반 데이터를 확인한다.
