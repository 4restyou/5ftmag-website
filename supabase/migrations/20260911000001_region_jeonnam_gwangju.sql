-- 2026-07-01 전남광주통합특별시 출범. 광주광역시와 전라남도가 하나가 됐다.
-- 「전남광주통합특별시 설치를 위한 특별법」이 정한 공식 명칭은 전남이 앞에 온다.
--
-- 사이트의 지역 표기는 다른 지역과 길이를 맞춰 「전남광주」로 줄여 쓴다
-- (js/labs-page.js 의 REGION_ORDER, scripts/build-lab-pages.mjs 의 REGIONS).
-- 여기서는 DB 에 남아 있는 옛 값을 새 값으로 옮긴다.
--
-- 이미 옮겨진 행은 조건에 걸리지 않으므로 재적용(replay)에 안전하다.

update public.labs
   set region = '전남광주'
 where region in ('광주', '전남');

update public.repair_shops
   set region = '전남광주'
 where region in ('광주', '전남');
