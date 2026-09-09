-- repair_shops 추가: 부산 두 곳.
--
-- 대구·포항을 넣은 20260714000001 과 같은 방식이다. 이름으로 중복을 막아
-- 재적용(replay)에 안전하고, sort_order 는 기존 최대값 뒤에 이어 붙여
-- 관리자가 admin 에서 넣은 항목과 겹치지 않게 한다.
--
-- 중앙카메라는 운영자가 확인해 준 정보다.
-- 찰칵이상자는 공개된 수리점 목록에서 확인한 주소와 연락처만 넣었다.
-- 취급 범위나 영업시간은 확인하지 못했으므로 비워 두고 admin 에서 채운다.

insert into public.repair_shops (name, region, address, specialty, description, contact, sort_order)
select
  v.name, v.region, v.address, v.specialty, v.description, v.contact,
  (select coalesce(max(sort_order), 0) from public.repair_shops) + v.ord
from (values
  ('중앙카메라', '부산',
   '부산 중구 중구로43번길 8, 미진아케이드 안쪽'::text,
   '필름·디지털 카메라 수리'::text,
   '부평깡통시장 미진아케이드 안쪽에 있다. 국제시장 2·3공구 입구 맞은편이다. '
   || '필름카메라와 디지털카메라를 함께 고치고 카메라 소매도 한다. '
   || '공간이 좁고 수리에 집중할 때는 응대가 늦어질 수 있으니 시간을 넉넉히 두고 가는 편이 낫다. '
   || '가기 전에 수리 가능 여부와 부품 재고를 미리 물어보길 권한다.',
   '051-248-2624'::text, 1),
  ('찰칵이상자', '부산',
   '부산 해운대구 재송1로 23 2층'::text,
   null::text,
   '해운대 재송동에 있는 카메라 수리점이다.',
   '010-4582-8958'::text, 2)
) as v(name, region, address, specialty, description, contact, ord)
where not exists (
  select 1 from public.repair_shops r where r.name = v.name
);
