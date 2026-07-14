-- repair_shops 추가: 대구·경북(포항) 지역 카메라 상점 3곳.
-- 주소는 좌표 지오코딩용인데 정확 주소가 없어 시드와 동일하게 null 로 두고
-- (관례상 admin 에서 채움) 네이버 지도 링크는 url 에 넣는다.
-- sort_order 는 기존 최대값 뒤에 이어 붙여 관리자가 넣은 항목과 겹치지 않게 한다.
-- 이름으로 중복을 막아 재적용(replay) 안전.

insert into public.repair_shops (name, region, address, specialty, description, url, sort_order)
select
  v.name, v.region, v.address, v.specialty, v.description, v.url,
  (select coalesce(max(sort_order), 0) from public.repair_shops) + v.ord
from (values
  ('권카메라', '경북', null::text, '중고 매입·판매'::text,
   '포항의 중고 카메라 상점. 매입과 판매를 함께 한다. 지역에서 급할 때 들르기 좋다.',
   'https://naver.me/GYGgan9L', 1),
  ('명문카메라', '대구', null::text, null::text,
   '대구 전자관 안에 있다. 지역에서 알음알음 찾는 카메라 상점이다.',
   'https://naver.me/GALXqfko', 2),
  ('유성카메라', '대구', null::text, '간단 정비'::text,
   '대구 중앙로 지하상가에 있다. 간단한 정비는 꼼꼼히 봐주고, 대구권에서 이름이 알려진 곳이다.',
   'https://naver.me/FUh2jXG0', 3)
) as v(name, region, address, specialty, description, url, ord)
where not exists (
  select 1 from public.repair_shops r where r.name = v.name
);
