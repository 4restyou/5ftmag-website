-- 부산 중앙카메라가 들어가지 않은 것을 바로잡는다.
--
-- 20260909000001 이 중복을 이름만으로 막았다.
--   where not exists (select 1 from repair_shops r where r.name = v.name)
-- 그런데 이 사이트는 수리점을 이름이 아니라 "이름 + 지역" 으로 구분한다.
-- js/labs-page.js 의 슬러그가 그렇게 만들어지고, 거기 주석에도
-- "같은 이름이 지역 달리 있을 수 있음" 이라고 적혀 있다.
--
-- 그래서 다른 지역에 이미 「중앙카메라」가 있으면 부산 것이 통째로 건너뛰었다.
-- (시드의 「홍성중앙카메라」는 이름이 달라 걸리지 않으므로, admin 에서 따로
--  등록된 항목이 있다는 뜻이다. 그 항목은 건드리지 않는다.)
--
-- 여기서는 지역까지 맞춰 본다. 부산 중앙카메라가 없을 때만 넣으므로
-- 재적용(replay)에도 안전하다.

insert into public.repair_shops (name, region, address, specialty, description, contact, sort_order)
select
  '중앙카메라', '부산',
  '부산 중구 중구로43번길 8, 미진아케이드 안쪽',
  '필름·디지털 카메라 수리',
  '부평깡통시장 미진아케이드 안쪽에 있다. 국제시장 2·3공구 입구 맞은편이다. '
  || '필름카메라와 디지털카메라를 함께 고치고 카메라 소매도 한다. '
  || '공간이 좁고 수리에 집중할 때는 응대가 늦어질 수 있으니 시간을 넉넉히 두고 가는 편이 낫다. '
  || '가기 전에 수리 가능 여부와 부품 재고를 미리 물어보길 권한다.',
  '051-248-2624',
  (select coalesce(max(sort_order), 0) + 1 from public.repair_shops)
where not exists (
  select 1 from public.repair_shops r
  where r.name = '중앙카메라' and r.region = '부산'
);

-- 찰칵이상자도 같은 이유로 빠졌을 수 있으므로 지역까지 맞춰 한 번 더 확인한다.
insert into public.repair_shops (name, region, address, specialty, description, contact, sort_order)
select
  '찰칵이상자', '부산',
  '부산 해운대구 재송1로 23 2층',
  null,
  '해운대 재송동에 있는 카메라 수리점이다.',
  '010-4582-8958',
  (select coalesce(max(sort_order), 0) + 1 from public.repair_shops)
where not exists (
  select 1 from public.repair_shops r
  where r.name = '찰칵이상자' and r.region = '부산'
);
