# 2026-10-03 운영 증거 기록

> 아래 표는 최초 읽기 전용 점검 당시의 기록이다. 같은 날 후속 작업에서 Photo Art
> 원출처 누락 9건을 확인하여 원장과 KO/EN/JA 캡션에 연결했다. 현재 URL 누락은
> 0건이고, 사용 근거 미확인 11건은 그대로다. 실제 복구와 첫 cron 성공은 아직
> 검증하지 않았으며, 최초 기록의 미검증 상태를 소급하여 완료로 바꾸지 않는다.

이 기록은 메타데이터 읽기와 문서 개선 결과다. 복구 훈련·배포·운영 승인 기록이 아니다.
운영 ref는 `pucpqsfwqouqohwsvmnd`, Supabase CLI는 `2.108.0`, 확인 시점 HEAD는
`28cc3c5ecf9308af5a412fcf7b12210cae0016e2`다. 작업 중인 변경은 이 SHA에 포함되지 않는다.
담당자·승인자·복구 목표·훈련 일정은 미지정이며 완료로 표시하지 않는다.

## 백업 목록

확인 시각: **2026-10-03T07:15:13.092Z**(16:15:13.092 KST).
이미 인증된 CLI의 `backups list --project-ref pucpqsfwqouqohwsvmnd --output json
--log-level error` 응답에서 아래 필드만 기록했다.

| 백업 ID | 목록의 inserted_at (UTC) | 종류 | 상태 |
|---|---|---|---|
| 1849215959 | 2026-10-02T16:33:34.939Z | physical | COMPLETED |
| 1839706059 | 2026-10-01T16:35:25.786Z | physical | COMPLETED |
| 1830170819 | 2026-09-30T16:33:42.021Z | physical | COMPLETED |
| 1820653223 | 2026-09-29T16:33:47.309Z | physical | COMPLETED |
| 1811154676 | 2026-09-28T16:34:08.686Z | physical | COMPLETED |
| 1801675058 | 2026-09-27T16:34:06.392Z | physical | COMPLETED |
| 1792231665 | 2026-09-26T16:33:33.640Z | physical | COMPLETED |

7건 모두 완료 상태이고 `pitr_enabled=false`다. 최신 목록 시각은 KST로
10월 3일 01:33:34.939다. `inserted_at`은 관측된 필드 그대로이며 완료 시각이나
정확한 복구 가능 시각으로 단정하지 않는다. 날짜별 7개 항목은 요금제·보관 정책의
보장이 아니다. 백업 다운로드, Auth 데이터 포함 범위, 복원 권한·실제 복구는 미검증이다.

## Cron 메타데이터

DB 응답 확인 시각: **2026-10-03T07:13:36.653Z**. 기존 CLI 연결 ref를 먼저 대조하고
`db query --linked`로 `BEGIN READ ONLY`, 10초 LOCAL statement timeout, SELECT,
`ROLLBACK`을 사용했다. 업무 데이터와 cron `return_message`는 읽지 않았다.

| 항목 | 관측 결과 |
|---|---|
| 연결 DB / 조회 역할 | postgres / postgres |
| pg_cron | 1.6.4 설치 |
| R12 적용 이력 | 20261003000003 존재 (함께 조회한 20261003000002도 존재) |
| 작업명 / jobid | 5ftmag-operational-retention-daily / 1 |
| 일정 / timezone | 17 3 * * * / GMT |
| 활성 / DB / 소유자 | true / postgres / postgres |
| 명령 | 문서의 timeout 5분·lock timeout 5초·보존 함수 명령과 일치 |
| 실행 이력 | 0건, 최근 status/start/end 없음 |

후속 메타데이터 질의에서 `cron.launch_active_jobs=on`, `cron.log_run=on`을 확인했다.
기존 health SELECT 조건을 별도 read-only 질의로 재사용한 결과는 다음과 같다.

- `2026-10-03T07:14:32.887Z` CLI 응답 수신: `cron_installed=true`, `function_secure=true`.
  이는 `CORE_SQL`의 postgres 소유권·SECURITY DEFINER·빈 search_path·lock timeout·
  스키마 접근/실행 ACL 조건 통과이며 전체 RLS나 실제 삭제 동작 시험이 아니다.
- `2026-10-03T07:14:35.803Z` CLI 응답 수신: 같은 이름 `count=1`, `full_visibility=true`,
  `matches=true`, `utc=true`, `launcher_enabled=true`.

**예약 설정은 확인했으나 첫 실행 성공은 미검증이다.** 다음 예정 시각은
`2026-10-04T03:17:00Z`(10월 4일 12:17 KST)이며 실제 실행 시각이나 성공 약속이 아니다.
그 뒤 status/end_time과 최근 성공을 읽기만 하여 확인한다. 이력이 비었거나 실패하면
기록/launcher 설정과 지연 원인을 조사하며 purge 호출·예약 변경은 하지 않는다.
전체 `ops-health.mjs`는 실행하지 않았고 HTTP·psql/TLS 경로와 health 종료 코드도 미검증이다.

## 영역별 판정

| 영역 | 확인/시험한 것 | 아직 미검증 |
|---|---|---|
| DB | 백업 목록/상태/PITR, 보존 함수 권한·예약·적용 이력 메타데이터 | 첫 cron 성공, 데이터 복원·집계·무결성·전체 RLS/뷰/RPC, RPO/RTO |
| Auth | 이번 점검에서 시험한 항목 없음 | 백업 포함 범위·사용자/identity 연결·테스트 로그인/갱신·접근 거부 |
| Storage | 이번 점검에서 시험한 항목 없음 | 별도 파일 백업 존재·manifest·SHA-256·접근 권한·사진/PDF 복원·버킷 권한 |
| HTTP | 이번 점검에서 시험한 항목 없음 | 배포 origin의 헤더/차단 경로·전체 health |
| 이미지 사용 근거 | 원장 집계와 기존 정적 검사 | 원출처 9건, 11개 묶음의 사용 허락·범위·제작자/전달 경위 |

이미지 원장 집계 시각은 `2026-10-03T07:13:51.381Z`다. 11개 묶음·22개 경로 중
11개 모두 `unknown`, `source.url=null`은 9개다. 원장은 변경하지 않았다.
`node scripts/check-editorial-content.mjs`는 exit 0, 3개 언어 기사·11개 묶음·22개 파일,
오류 0·후속 경고 11을 반환했다. 성공 코드는 사용 허락을 뜻하지 않는다.

## 로컬 문서 검증

최종 문서/원장 확인 시각: `2026-10-03T07:19:13Z`.

- `node scripts/validate-assets.mjs`: exit 0. HTML 928개·JSON 5개·CSS 24개,
  참조 49,856개가 정상이다. 배포된 화면이나 운영 DB를 시험한 결과는 아니다.
- 범위 내 Markdown 링크 검사: 4개 문서의 로컬 링크 7개가 모두 존재한다.
- 원장 재대조: `unknown` 11개·원출처 URL 누락 9개가 그대로다.
- 변경 문서 공백 검사: `git diff --check` 통과. 새 증거 파일의 별도 공백 검사도 통과했다.

## 남은 조치와 경계

- [ ] 담당 운영자 지정 후 다음 cron 자동 실행의 성공/실패와 UTC 완료 시각을 기록한다.
- [ ] 담당 운영자가 백업 보관 정책·복원 접근 권한을 확인한다. 복원은 별도 승인 전까지 수행하지 않는다.
- [ ] [Storage 명세](database-recovery.md)에 맞춰 범위·상한·off-repo 저장소·접근 권한·보관 정책을 승인한다.
- [ ] DB/Auth/Storage 각각의 격리 훈련 담당자·승인자·일정을 지정한다.
- [ ] [이미지 후속 확인](editorial-operations.md)에 따라 11개 묶음 담당자·기한을 배정하고 출처와 허락을 분리해 확인한다.

이번 점검은 시크릿·Keychain·`.env`를 읽거나 인증값을 출력하지 않았다. 객체/개인 파일
다운로드, 운영 SQL 쓰기·purge·restore·cron 변경, 새 프로젝트 생성, 결제·PortOne 작업은
수행하지 않았다. Git commit/push, 버전 변경, 범위 밖 소스 수정도 수행하지 않았다.
문서의 승인/구현 전 명세는 실행 허가가 아니다.

백업 범위의 서비스 기준은 [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups),
예약 이력 확인 기준은 [Supabase Cron 문서](https://supabase.com/docs/guides/cron/quickstart)를
참고했다. DB 백업이 Storage 실제 객체를 포함하지 않는다는 기준을 별도 파일 백업 명세에 반영했다.
