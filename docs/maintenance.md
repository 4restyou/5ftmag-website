# 유지보수 / 정리 계획

2026-07-12 갱신. 메시지 시스템 작업 중 드러난 구조적 위험과 처리 상태를 정리한다.
체크박스가 빈 항목은 아직 안 된 것, 우선순위 순.

## 2026-07-12 처리 현황

- 프로덕션은 `profiles.user_id + is_editor` 구조와 `profiles_public` 뷰를 사용함을 확인했다.
- `SUPABASE_ACCESS_TOKEN`을 교체했고 DB·Edge Function 배포가 정상 동작한다.
- 메시지·Push 보안 마이그레이션 적용을 확인했다.
- 초기 수동 스키마를 `db/baseline.sql`로 재현하고 DB 계약 drift를 0건으로 정리했다.
- `site-common.js`에서 텔레메트리·PWA를, `db-client.js`에서 Shop·이북을 분리했다.
- 공통 내비게이션·푸터는 `data/site-shell.json`을 단일 원본으로 사용한다.

아래 1~7번은 당시 진단 기록으로 보존한다. 현재 운영 판단은 위 현황과
`docs/database-recovery.md`, `docs/editorial-operations.md`를 우선한다.

## 한 줄 진단

구조(정적 HTML + vanilla JS + Supabase)는 단순한데 도메인이 빠르게 늘어
곳곳에 잠재 사고가 쌓이는 단계. 새 기능 전에 안전망부터 한 번 정리하면
다음 6개월 안정성이 크게 올라간다.

---

## 🔴 사람(운영자)이 직접 해야 하는 것

코드로 자동화 못 하거나, 잘못 건드리면 라이브가 깨지는 항목.

### 0. feeds-sync 가 main 에 푸시하지 못한다 (2026-09-12 확인)

`.github/workflows/feeds-sync.yml` 은 관리 페이지의 공개/비공개 토글이 `data/stories.json`
하나만 커밋했을 때 `rss.xml`·`sitemap.xml` 을 재생성해 뒤따라 커밋하려고 만든 것이다.
그런데 지금까지 한 번도 성공한 적이 없다. 5회 실행이 전부 실패했다.

실패 로그는 이렇다.

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Required status check "validate" is expected.
```

main 브랜치 보호 규칙이 `validate` 체크를 필수로 두고 있어서, github-actions 봇의 직접
푸시가 거부된다. 워크플로우 코드로는 풀 수 없다.

원인이 하나 더 있었고 그것은 고쳤다. `rss.xml` 의 `lastBuildDate` 에 빌드 시각이 들어가서
재생성할 때마다 반드시 달라졌다. 드리프트 판정에서 이 줄을 빼는 수정을 넣었으므로, 발행
PR 에 두 파일을 함께 커밋해 두면 feeds-sync 는 "드리프트 없음" 으로 깨끗하게 끝난다.
남은 것은 토글 시나리오뿐이다.

**운영자가 고를 것**

1. GitHub → Settings → Branches → main 규칙에서 GitHub Actions 를 우회 대상으로 추가한다.
   워크플로우 수정 없이 끝나지만 봇이 main 에 직접 쓰는 것을 허용하게 된다.
2. 워크플로우가 직접 푸시하는 대신 PR 을 자동으로 만들게 바꾼다. 보호 규칙은 그대로
   두지만 토글할 때마다 PR 이 하나씩 쌓이고 누군가 머지해야 한다.

그때까지는 발행 작업에서 `npm run build:rss && npm run build:sitemap` 을 돌려 두 파일을
PR 에 함께 커밋하는 기존 방식을 유지한다. 실제로 그렇게 하고 있어서 라이브 피드는 정상이다.

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

**8. 정책 페이지 중복 생성 (#588 → #593 교정)**
- 증상: 푸터에 약관·개인정보 링크가 이중 노출, sitemap 에서 실존 legal 페이지 이탈.
- 원인: 정책 페이지 유무를 루트만 조사(`ls *.html`)해 `legal/` 의 기존 3페이지와 site-common 동적 주입을 놓치고 루트에 새로 만듦.
- 수정: 루트 중복 삭제, 기존 legal/ 증보(사업자 정보·유료 열람권·환불), legal/refund 신설, 주입 링크 일원화.
- 재발방지: 페이지 유무 조사는 `find . -name` 또는 `grep -rl` 로 전체 트리를 본다. 같은 기능(푸터 링크)이 이미 JS 주입으로 존재하는지 site-common.js 를 먼저 확인.

## 현상소·수리점 확인 대기 목록 (2026-09-12 전수조사)

폐업 근거가 모자라 손대지 않은 항목이다. 다음 점검 때 여기부터 본다.
**검색에 안 잡히는 것과 문을 닫은 것은 다르다.** 작은 가게는 원래 검색에
약해서, 그것을 폐업으로 읽으면 영업 중인 가게를 지우게 된다. 근거가 약하면
그대로 둔다.

| 업체 | 확인할 것 | 단서 |
|---|---|---|
| 청계사진관 | 3,000원에 적용되는 스캔 화질 | 스캔화질에 1512×1002 가 적혀 있는데 설명에는 그 등급을 제외한다고 되어 있다. 둘 중 하나가 틀렸다 |
| 픽커서울 | 강남 매장 종료 후 다시 열었는지 | 공식 채널에 강남 영업 종료와 새 장소 준비 안내가 있으나 오래된 공지다. 주소가 KJ타워 지하 2층 그대로다 |
| 공단 칼라 | 폐업 여부 | 이용자 제보와 폐업 표시 기업정보가 있으나 주소·사업자 동일성과 점주 공지를 확보하지 못했다 |
| 베르베르스튜디오 (매직포토) | 필름 현상 서비스가 끝났는지 | 2026년 7월 이용자 글에 현상 종료 언급이 있다. 사진관 폐업과는 다른 이야기다 |
| 연남 필름 | 2026-07-10 부터 바뀐 현상·스캔 가격 | 가격이 바뀐 것은 공지로 확인됐다. 금액을 몰라 기존 값을 비워 두었다 |
| 책방무사 | 서울 신촌에서도 필름 접수를 받는지 | 제주 종료와 서울 이전은 확인됐다. 접수 서비스가 함께 옮겼는지는 확인되지 않아 설명에서 연계 표현을 뺐다 |
| 권카메라 | 010-9750-5171 이 아직 살아 있는지 | 공개 연결번호 0504-4642-6931 를 함께 적어 두었다 |

수리점 목록은 마이그레이션만으로 전량을 복원할 수 없다. 관리 화면에서 직접
추가·수정한 항목이 파일에 없기 때문이다. 전수조사용 자료를 다시 만들 때는
`admin/repairs.html` 을 기준으로 삼는다.
