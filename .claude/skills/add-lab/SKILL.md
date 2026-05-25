---
name: add-lab
description: 5ft.mag 필름 현상소(labs) 데이터를 관리. 사용자가 현상소 정보나 네이버 지도 캡처를 주며 "현상소 추가 / 업데이트 / 가격 갱신 / 중복 정리"를 요청할 때 사용. 원본은 Supabase labs 테이블이며 admin/labs.html 에서 편집한다.
---

# 현상소(labs) 데이터 관리

## 아키텍처 (중요)
- **원본 = Supabase `public.labs` 테이블.** 편집은 **`admin/labs.html`** (편집부 로그인) 에서 추가·수정·숨김·삭제.
- `data/labs.json` 은 빌드 때 `scripts/build-labs.mjs` 가 테이블에서 **자동 생성**한다 → **직접 손으로 고치지 말 것**(다음 빌드에 덮어써짐).
- 공개 `labs.html` 은 `data/labs.json` 을 읽어 목록을 그리고, **지도는 주소를 브라우저에서 즉석 변환**(네이버 SDK + geocoder, localStorage 캐시)해 마커를 찍는다. → **좌표(lat/lng) 데이터는 없음.** 주소만 정확하면 지도에 뜬다.

## 편집 방법
- 일반 추가/수정: `admin/labs.html` 폼 사용(이름·지역·주소·스캔화질·홈페이지·설명·가격). 저장 → 다음 빌드(Netlify "Trigger deploy")에서 `data/labs.json` 동기화 → 사이트 반영.
- 대량/일괄: Supabase 테이블에 직접 쓰거나 마이그레이션(`supabase/migrations/`)으로. labs.json 을 직접 편집하지 말 것.

## 데이터 shape (테이블 컬럼 / 폼 필드)
- `name`(필수), `region`, `address`, `scan_res`, `features`, `url`, `prices`(jsonb), `is_hidden`, `sort_order`.
- 전화번호 필드는 없음(넣지 말 것).
- `prices` 중첩(값 없으면 null): `color`/`bw`/`slide` = `{ "120": {basic,high}, "135": {basic,high} }`, `cinema`(영화용) = `{ "135": {basic,high} }`, `etc` = `{ "110", "aps" }`.

## 가격 매핑 규칙
- 카드 노출값은 종류별 **`135.basic` 한 줄**(컬러/흑백/슬라이드/영화용). 대표가가 거기 들어가게.
- 화질: `basic`=일반/기본, `high`=고해상(중간화질 칸 없음).
- 종류: C-41=`color`, 흑백(D-76)=`bw`, 슬라이드(E-6)=`slide`, 영화용(ECN-2)=`cinema`(135만), APS/110=`etc`.
- "현상+스캔" 대표가를 우선, 단일가면 basic 에만. 숫자는 콤마 없이.

## 중복·동명 주의
- `필름로그`(드롭포인트 여러 곳)·`포토닉스`(중복) 같은 사례는 주소로 구분. 진짜 중복은 admin 에서 한 건만 남기고 삭제.

## features 문체
- 20년차 편집부 보고서체로 **간결**. 구어체·내부 메모·불확실 표현("정보 부족","확인 불가","~것 같음") 금지.
- 구분자 `//`·`+` → 쉼표·가운뎃점·마침표. em-dash(—) 금지.

## 코드 변경이 필요할 때 (드묾)
- 빌드 스크립트/도메인/UI 변경은 `claude/<slug>` 브랜치 → 커밋 → PR → CI(`validate`) 통과 → squash 머지(제목 + ` (#NN)`). main 직접 커밋 금지.
- `supabase/migrations/**` 변경은 머지 시 `db-deploy.yml` 로 운영 DB 에 자동 반영되니 신중히.
