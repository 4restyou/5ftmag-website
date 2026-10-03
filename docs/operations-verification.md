# 운영 검증

R12의 로그 보존 자동화와 배포 후 읽기 전용 점검 기준이다. 마이그레이션 파일과
단위 테스트가 존재해도 운영에 적용됐다는 뜻은 아니다. 백업·Auth·Storage 복구는
[데이터베이스 복구 기준](database-recovery.md)의 별도 격리 훈련과 기록으로 확인한다.

## 고정 보존 정책

| 대상 | 기준 컬럼 | 보존 기간 | 근거 마이그레이션 |
|---|---|---|---|
| `page_views`, `page_dwells` | `ts` | 365일 | `20260518000004_analytics_retention.sql` |
| `app_events` | `ts` | 90일 | `20260614000003_app_events.sql` |
| `client_error_logs` | `ts` | 30일 | `20260519000002_client_error_logs.sql` |
| `push_subscriptions` | `last_seen_at` | 미갱신 30일 | `20260614000004_push_security_ops.sql` |

컷오프보다 **엄격히 이전**인 행만 삭제한다. 정확히 컷오프 시각의 행은 남긴다.
푸시는 생성일이 아닌 마지막 확인 시각을 사용한다. 정상 발송·재구독 시 갱신하는
기존 경로가 동작하는지도 담당자가 확인한다. 사진·Storage 파일·독자 응모·메시지·
주문·구매 권한 등 업무 데이터는 이 자동화의 삭제 대상이 아니다.

`ops_private.purge_operational_logs()`는 인자 없는 postgres 소유 SECURITY DEFINER
함수다. search_path는 비어 있고 테이블은 스키마를 명시한다. PUBLIC/anon/authenticated
접근을 회수하고 service_role/postgres에만 실행을 허용한다. 기존 편집부용 수동 RPC는
바꾸지 않는다. 함수는 공개 PostgREST 스키마에 넣지 않는다. service_role JWT를
브라우저에 주거나 공개 RPC를 추가해서 검증하지 않는다.

여러 호출의 동시 삭제는 트랜잭션 advisory lock으로 막는다. 한 테이블에서 실패하면
해당 호출의 전체 삭제를 롤백한다. 일일 작업의 statement timeout은 5분, lock timeout은
5초다. 많은 만료 행이 누적되어 제한을 넘으면 실패로 드러나므로 운영자가 잠금·용량을
확인한 뒤 별도 승인된 정리 계획을 세운다. health 스크립트는 정리를 실행하지 않는다.

## Cron 적용과 확인

`20261003000003_log_retention_schedule.sql`은 호스트에서 제공되는 pg_cron을 설치하고
postgres 역할로 아래 이름의 작업을 예약한다. 확장 설치·권한·preload 오류는 숨기지
않고 마이그레이션 실패로 처리한다. 확장 파일이 없는 최소 로컬 DB에서는
`R12 RETENTION NOT SCHEDULED` 경고를 내고 예약만 생략한다. 이것은 **자동 보존 미설정**
상태다. 운영에서는 [Supabase Cron 활성화](https://supabase.com/docs/guides/cron/install)를
확인하고, 승인된 배포 절차로 같은 마이그레이션을 postgres로 재실행한 뒤 다시 검증한다.
이미 기록된 마이그레이션은 CLI가 자동으로 재실행하지 않을 수 있다.

- 이름: `5ftmag-operational-retention-daily`
- 일정: `17 3 * * *` (cron timezone이 GMT/UTC이면 매일 03:17 UTC, 12:17 KST)
- DB/역할: 적용한 DB / `postgres`
- 명령: `SET statement_timeout = '5min'; SET lock_timeout = '5s'; SELECT ops_private.purge_operational_logs();`

같은 이름·소유자의 예약은 갱신되므로 재실행해도 jobid와 이력을 유지하며 중복하지
않는다. 같은 이름의 다른 소유자 예약만 제거하며 다른 작업은 건드리지 않는다.
([Supabase 예약·실행 이력 문서](https://supabase.com/docs/guides/cron/quickstart))

cron timezone은 프로젝트 전체 설정이므로 이 마이그레이션에서 바꾸지 않는다. UTC가
아니면 health 검사가 실패한다. 프로젝트의 다른 예약에 미치는 영향을 확인하고 담당자가
수정 여부를 결정한다. 기존의 다른 이름 수동/자동 purge가 있다면 별도로 조사한다.
cron 실행 이력 자체의 보존 정책은 이 마이그레이션의 대상이 아니다.

## 읽기 전용 Health 검사

Node 18 이상을 사용한다. DB 메타데이터 검사에는 로컬 `psql`과 해당 프로젝트의
카탈로그·`supabase_migrations.schema_migrations`·`cron.job`·`cron.job_run_details` 읽기
권한이 필요하다. PostgREST anon/service_role 키만으로는 cron 메타데이터를 볼 수 없다.
접근 권한을 넓히지 말고 담당자의 승인된 DB 연결을 사용한다. cron의 행 가시성 때문에
postgres 연결을 권장한다. cron RLS가 다른 소유자의 작업을 숨기는 연결은 중복 예약을
확인할 수 없으므로 스크립트가 예약 검증을 `미검증`으로 처리한다.

시크릿 관리자 또는 로컬 환경으로 다음 변수를 설정한다. 값을 채팅·저장소·명령 인자에
적지 않는다. 스크립트는 `.env` 파일을 자동으로 읽거나 생성하지 않는다.

| 환경 변수 | 용도 |
|---|---|
| `OPS_SITE_URL` | HTTPS 사이트 origin. 경로·쿼리·사용자 정보 없이 지정한다. 로컬 loopback만 HTTP 허용 |
| `OPS_DATABASE_URL` | 선택적 Postgres 연결 URI. 비밀번호도 환경으로만 전달한다. 미설정이면 DB는 미검증 |
| `PGSSLMODE` | DB TLS 정책. 미설정 시 `require`. 검증 가능한 CA 환경에서는 `verify-full` 등 승인된 정책 사용 |

변수를 설정한 뒤 한 명령으로 실행한다.

```bash
node scripts/ops-health.mjs
```

GET으로 한국어·영어·일본어·관리 정적 페이지의 응답 상태와 CSP, HSTS, Referrer,
Permissions, X-Content-Type, X-Frame, COOP/CORP의 주요 경계를 검사한다. 내부 문서,
DB baseline, 마이그레이션, 스크립트, 테스트, 설정, Git, node_modules의 알려진 경로가
redirect 없이 404인지 검사한다. redirect를 따라가지 않으므로 canonical HTTPS origin을
설정한다. 응답 본문과 쿠키·인증값은 읽거나 출력하지 않는다. 단순 정적 개발 서버는
Netlify 헤더·차단 규칙을 재현하지 않아 실패할 수 있다.

DB 검사는 `BEGIN READ ONLY` 트랜잭션 안에서 메타데이터만 읽고 ROLLBACK한다. psql
시작 파일을 끄고 비밀번호 입력을 막는다. URL을 argv에 넣지 않으며 stderr와 원본
예외를 출력하지 않는다. 비밀값·업무 행·cron return_message를 조회하거나 출력하지 않는다.
함수 소유권·권한, 적용 이력, 확장 설치, 이름이 같은 작업이 하나인지, 활성 여부,
명령·일정·DB·역할·timezone·launcher, 최근 실행 결과를 확인한다.

| 종료 코드 | 의미 | 다음 조치 |
|---|---|---|
| `0` | 지정한 HTTP/DB 메타데이터 검사가 모두 통과 | 별도 기능·복구 훈련 결과와 함께 기록 |
| `1` | 확인된 실패가 있음 | 헤더/경로 노출, 누락 마이그레이션·확장, 예약 설정, 실행 실패·지연 조사 |
| `2` | 실패는 확인되지 않았지만 미검증 항목이 있음 | 환경 변수·psql·네트워크·읽기 권한·첫 실행 증거 확보 후 재검사 |

확인된 실패와 미검증이 함께 있으면 `1`을 반환한다. 첫 예약 직후 실행 이력이 없으면
`2`이고, 최신 실패 또는 26시간 이내 성공이 없으면 `1`이다. 실행 중인데 10분 이상
지난 경우에도 실패한다. 첫 예약 검증 후 다음 일일 실행 뒤 다시 검사한다. 검사 때문에
운영 purge를 수동 실행하지 않는다. SQL Editor로만 적용하고 CLI 이력에 기록되지
않았으면 적용 이력은 실패 또는 미검증이므로 담당자가 승인된 이력 조정 절차를 확인한다.

`0`은 백업 복구, 결제, 외부 API, RLS 전체, 모든 CSP 공급자/지시어, 모든 민감 경로의
보안을 증명하지 않는다. 상태 코드 검사는 본문 내용 분석이나 전체 노출 탐지가 아니다.
스크립트는 관리 API, 배포, SQL 쓰기, 함수 호출, restore, 파일 백업을 수행하지 않는다.

## CLI 메타데이터 보조 점검

이미 인증된 Supabase CLI를 사용하는 읽기 전용 점검이다. 인증값을 직접 꺼내거나
시크릿·Keychain·`.env`를 읽지 않는다. `--debug`도 사용하지 않는다. 백업 목록은
공개 프로젝트 ref를 명시하고, DB 질의는 기존 연결의 ref가
`pucpqsfwqouqohwsvmnd`인지 비밀이 아닌 프로젝트 연결 메타데이터로 먼저 대조한다.
인증·연결이 없거나 권한이 부족하면 미검증으로 남기고 담당자에게 요청한다.
점검 때문에 `link`, 새 프로젝트 생성, 권한 확대나 자격증명 추출을 하지 않는다.

```bash
supabase backups list --project-ref pucpqsfwqouqohwsvmnd --output json --log-level error
```

DB는 `supabase db query --linked`로 **`BEGIN READ ONLY`와 `ROLLBACK`으로 감싼
SELECT만** 보낸다. `SET LOCAL statement_timeout = '10s'`로 조회 시간을 제한한다.
검사 범위는 확장·마이그레이션 버전·함수 소유권/ACL·예약 설정·이력 집계와
`jobid`, `status`, `start_time`, `end_time`에 한정한다. `return_message`, 업무 행,
Auth 사용자, Storage 키/서명 URL, 토큰, 함수 실행은 대상이 아니다.
기존 `scripts/ops-health.mjs`의 `CORE_SQL`, `JOB_SQL`, `RUN_SQL`도 같은 범위의
SELECT다. CLI 질의는 여러 SELECT 중 마지막 결과만 반환할 수 있으므로 필요한
증거를 한 결과로 묶거나 SELECT별로 질의한다. 원본 경고/에러와 인증 로그 대신
허용된 메타데이터와 실제 확인 시각만 기록한다.

2026-10-03 확인에서는 백업 목록 7건이 모두 완료 상태였고 PITR은 꺼져 있었다.
cron은 `jobid=1`, 활성, `17 3 * * *`, timezone `GMT`, DB/소유자 `postgres`,
기대 명령 일치, 같은 이름 한 건과 전체 행 가시성, launcher·실행 이력 기록 활성화를
확인했다. 보존 함수의 `CORE_SQL` 권한 조건도 통과했고 R12 마이그레이션 이력이
존재했다. **실행 이력은 0건이므로 첫 성공은 미검증**이다.
현재 일정상 다음 예정 시각은 `2026-10-04T03:17:00Z`(10월 4일 12:17 KST)다.
그 뒤 자동 실행의 status·완료 시각을 읽기만 하여 재검사하며, 성공이 없다면
launcher·기록 설정·지연·실패를 조사한다. 검사를 위해 purge를 호출하지 않는다.
이 보조 점검은 전체 `ops-health.mjs` 실행이나 그 종료 코드 0을 의미하지 않는다.
확인 시각과 미검증 항목은 [일자별 증거 기록](ops-verification-20261003.md)에 있다.

## 영역별 완료 체크리스트

한 영역의 통과를 다른 영역의 성공으로 옮기지 않는다. 체크는 각 행의 증거에만 해당한다.

- [x] DB 백업 메타데이터: 2026-10-03 목록·종류·상태·PITR 확인. 실제 복원은 제외한다.
- [x] DB 보존 예약 메타데이터: 확장·적용 이력·함수 권한·단일 활성 예약·일정 확인.
- [ ] DB 보존 첫 실행: 자동 실행의 `succeeded`와 완료 UTC 증거를 확보한다.
- [ ] DB 복원: 승인된 격리 환경에서 집계·무결성·RLS/뷰/RPC를 시험한다.
- [ ] Auth 복원: 사용자/identity 포함 범위, UUID 연결, 테스트 로그인·갱신·타인 접근 거부를 시험한다.
- [ ] Storage 백업: 별도 사본·manifest·객체 수/바이트·SHA-256·접근 권한을 확인한다.
- [ ] Storage 복원: 실제 사진/PDF 바이트와 버킷 공개/열거/쓰기/삭제 권한을 격리 환경에서 시험한다.
- [ ] HTTP/전체 health: 실제 배포 origin과 승인된 연결로 실행하고 종료 코드·미검증을 기록한다.

복원·파일 복사·계정 생성·cron 변경은 각각 별도 승인 대상이다. 결제·PortOne은
보류 상태이며 이 체크리스트의 수행 대상이 아니다.

## 검증 기록

```text
검증 일시(UTC) / 담당자 / 대상 환경(비밀값 제외):
Git SHA / db-deploy 결과 / R12 마이그레이션 적용 증거:
health 종료 코드 / 실패·미검증 항목 / 제한된 증거 위치:
cron 이름 / 활성·timezone·DB·역할 확인 / 최근 성공 시각(UTC):
다음 일일 실행 뒤 재검사 결과:
백업 복구 훈련 ID 또는 미검증(DB/Auth/Storage 각각):
후속 조치 / 담당자 / 기한:
```

운영 백업 상태, 호스트의 확장·preload, cron 실행·로그 기록, 연결·권한·TLS, 배포된
HTTP 헤더·경로, Auth/Storage 복원 환경은 로컬 단위 테스트로 확인할 수 없는 의존성이다.
운영 증거가 없는 항목은 반드시 `미검증`으로 남긴다.
