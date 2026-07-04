# 유지보수 / 정리 계획

2026-06-20 기준. 메시지 시스템 작업 중 드러난 구조적 위험을 정리한다.
체크박스가 빈 항목은 아직 안 된 것, 우선순위 순.

## 한 줄 진단

구조(정적 HTML + vanilla JS + Supabase)는 단순한데 도메인이 빠르게 늘어
곳곳에 잠재 사고가 쌓이는 단계. 새 기능 전에 안전망부터 한 번 정리하면
다음 6개월 안정성이 크게 올라간다.

---

## 🔴 사람(운영자)이 직접 해야 하는 것

코드로 자동화 못 하거나, 잘못 건드리면 라이브가 깨지는 항목.

### 1. prod ↔ workroom 스키마 불일치 확인  ⬅ 가장 위험

메시지 작업 중 발견: Supabase 의 두 워크스페이스 스키마가 다르다.

- **workroom**: `profiles_public` 뷰 + `profiles.is_editor` 컬럼 + `profiles` PK 가 `user_id`
- **production**: `profiles` 테이블에 `id`(PK) / `email` / `role`('admin'|'user') / `full_name` … `is_editor` 없음, `profiles_public` 없음

그런데 클라이언트(`js/db-client.js`)는 `profiles_public.is_editor` 를 본다.
즉 **prod 에서 편집부 권한 체크가 의도대로 동작하는지 불확실**하다.

확인 방법 (Supabase Studio, production 워크스페이스 SQL Editor):
```sql
-- profiles_public 뷰가 prod 에 있는가? is_editor 컬럼이 있는가?
select table_name, table_type from information_schema.tables where table_name = 'profiles_public';
select column_name from information_schema.columns where table_name = 'profiles_public';
```
- 있으면 → 클라이언트 코드는 맞음. workroom 만 청소하면 됨.
- 없으면 → prod 에 `profiles_public` 뷰를 만들거나(`role='admin' as is_editor` 매핑),
  클라이언트를 `profiles.role` 기준으로 통일해야 함 (아래 5번과 연결).

### 2. SUPABASE_ACCESS_TOKEN 시크릿 갱신

`.github/workflows/db-deploy.yml` 의 자동 마이그레이션이 토큰 만료로
며칠간 조용히 죽어 있었음 (`Unauthorized`). 그래서 `messages` 등
마이그레이션을 Studio 에서 손으로 적용해야 했다.

- https://supabase.com/dashboard/account/tokens 에서 새 PAT 발급
- GitHub repo → Settings → Secrets and variables → Actions → `SUPABASE_ACCESS_TOKEN` 갱신
- 갱신 후 빈 커밋이나 마이그레이션 PR 로 `db-deploy` 정상 동작 확인

### 3. 미적용 마이그레이션 prod 반영 확인

토큰이 죽어 있던 동안 머지된 마이그레이션이 prod 에 다 들어갔는지 점검:
- `20260619000001_messages.sql`
- `20260619000002_messages_edit_delete.sql` (수정/삭제 RPC — 이거 없으면 메시지 수정·삭제만 실패)
- `20260620000001_push_dispatch_harden.sql`

`select proname from pg_proc where proname in ('edit_message','delete_message','mark_messages_read');`
세 개 다 나오면 OK.

---

## 🟡 코드 정리 (다음 세션에 묶어서)

런타임이 깨질 수 있어 자동 무인 진행은 피한 항목. 브라우저 확인하며 진행.

### 4. `js/db-client.js` 모듈 분할 (1800줄)
auth / comments / market / push / messages … 한 파일에 전부. 도메인별
(`js/db/*.js`)로 쪼개고 `MagDB` 는 얇은 합치는 레이어로. 한 도메인이
깨져도 전체가 안 죽게.

### 5. 편집부 권한 체크 통일
`is_editor` 컬럼 패턴과 `role='admin'` 패턴이 RLS·RPC·클라이언트에 혼재.
prod 스키마 확정(1번) 후 `public.is_editor()` SQL 함수 하나로 모으고
모든 정책이 그것만 호출. 클라이언트도 한 경로로.

### 6. `js/site-common.js` 모듈 분할 (1750줄)
종/알림 패널/푸시/FAB/배너 분리.

### 7. admin 공통 CSS shared 화
`admin/*.html` 14개가 각자 inline `<style>` 로 admin-header/subnav/gate
중복 보유 → `css/admin-shell.css` 로 흡수. (#519 inline override 사고 재발 방지.)

---

## 🟢 천천히

### 8. GitHub PAT 의존 제거
admin 글쓰기/토글이 사용자 localStorage 의 PAT 으로 GitHub API 직접 호출.
누설 시 main 임의 커밋 가능. 정공법: Supabase Edge Function 이 서버
토큰으로 대행. 차선: GitHub App OAuth.

### 9. 마이그레이션 baseline 압축 (80개)
debug RPC v1/v2/v3, noop_retrigger, recovery_debug 등 노이즈 정리.
prod schema dump 떠서 1년 단위 baseline 재설정.

### 10. 추적 안 된 DB 객체를 마이그레이션에 역수입
`docs/db-contract-audit.md` 의 9개(comments, likes, market_listings,
profiles_public 등)는 prod 에 있으나 레포에 정의가 없다. 레포만으로
DB 재현이 안 된다는 뜻. prod dump 에서 정의를 떠와 마이그레이션으로 편입.

---

## 도구

- `node scripts/db-audit.mjs` — 클라이언트 참조 vs 마이그레이션 정의 대조.
  신규 drift 가 생기면 표시 (CI 는 안 깸). `--md` 로 마크다운 표.
  결과 스냅샷: `docs/db-contract-audit.md`.

---

## 사건 로그 (postmortem)

반복 사고를 막기 위한 축적. 새 사고가 나면 4줄 형식(증상/원인/수정/재발방지)으로 여기에 추가한다.

### 2026-06 이북 결제 스트림 (#557~#591)

**1. auto-merge 조기 발사 (3회: #557/558, #563/565, #572/573)**
- 증상: 후속 커밋을 푸시하기 전에 auto-merge 가 첫 커밋만 머지 → 누락분 복구 PR 필요.
- 원인: 커밋 완료 전 auto-merge 활성화.
- 수정: auto-merge 대신 CI 성공 확인 후 직접 squash 머지하는 루프로 전환.
- 재발방지: CLAUDE.md "배포 루프" — auto-merge 금지.

**2. 결제창 3연속 실패 (CSP)**
- 증상: 구매 버튼 → 아무것도 안 뜸 / "Failed to fetch" / "Load failed".
- 원인: ① 모달 z-index 가 리더(2200)보다 낮음 ② connect-src 에 카카오·네이버 누락 ③ 포트원이 옛 도메인 `*.iamport.co` 로 통신하는데 CSP 에 없음.
- 수정: #578(z-index), #580(connect-src), #581(iamport.co). 콘솔 캡처로 ③ 확정.
- 재발방지: CLAUDE.md "외부 서비스 연동 체크리스트" + "디버깅 프로토콜".

**3. 클라이언트 rowToJson 필드 누락 (#585)**
- 증상: shop 품절 상품의 "이북으로 보기" 링크가 안 뜸.
- 원인: `ebook_slug` 를 build-shop.mjs 매핑에만 추가하고, DB 우선 로드하는 shop-page.js 의 rowToJson 에는 누락.
- 수정: 클라이언트 매핑에 필드 추가.
- 재발방지: CLAUDE.md "필드 추가 3곳 동기화".

**4. functions-deploy 가 이북 함수를 조용히 누락**
- 증상: 엣지 함수를 머지해도 CI 는 send-push 만 재배포. 수동 배포 의존.
- 원인: 워크플로우에 함수명 하드코딩.
- 수정: #589 에서 4개 함수 루프 배포로 변경.
- 재발방지: 함수 추가 시 워크플로우 갱신 (디렉토리 스캔화 예정).

**5. order_ref 유니크 인덱스 prod 충돌 (#590)**
- 증상: db-deploy 실패 `SQLSTATE 23505, Key (order_ref)=(studio 4rest) is duplicated`.
- 원인: 수동 부여 열람권들이 order_ref 에 같은 입금자명 메모 사용. 기존 데이터 미확인 상태로 전체 유니크 추가.
- 수정: `source in ('portone','smartstore')` 부분 인덱스로 축소, 같은 파일 수정 재적용.
- 재발방지: CLAUDE.md "제약 추가 전 prod 데이터 확인".

**6. validate `no merge base` 플레이크**
- 증상: 직전에 다른 PR 이 squash 머지된 직후, PR 의 validate 가 23초 만에 실패.
- 원인: 얕은 fetch 에서 `origin/main...HEAD` 공통 조상 없음.
- 수정: 브랜치에 main 머지 후 재푸시.
- 재발방지: CLAUDE.md "배포 루프" 4항.

**7. tokens.css 버전 4갈래 분열**
- 증상: authors 페이지 11개가 5월 버전 tokens.css 에 고착, 페이지 이동 시 재다운로드.
- 원인: 캐시버스트를 수동 sed 로 일부 페이지만 적용.
- 수정: (예정) 전 페이지 단일 버전으로 통일.
- 재발방지: CLAUDE.md "캐시 버스트" 단일 버전 규칙 + validate 단일 버전 가드(예정).
