-- 현상소 추가: 강원권 세 곳 (춘천 라이트사, 춘천 준포토, 강릉 동인스튜디오).
--
-- 독자 제보(인스타그램 DM, 2026-09-22). 그때까지 강원권에는 필름로그 강릉
-- 드롭포인트 하나뿐이었다. 지방 현상소는 검색에 잘 안 잡혀서 이런 제보가
-- 사실상 유일한 경로다.
--
-- 라이트사 주소는 제보자가 도로명까지 적어 주었다. 준포토와 동인스튜디오는
-- 제보자가 네이버 지도 링크를 주었고, 운영자가 그 링크를 열어 주소와 요금을
-- 옮겨 주었다.
-- labs 에는 전화번호 칸이 없으므로 넣지 않는다(add-lab 스킬 규칙).
--
-- prices 는 운영자가 확인해 준 금액으로 채운다. 카드에는 add-lab 규칙대로
-- 135 의 현상+스캔 묶음가를 basic 에 넣고, 낱개 요금은 features 에 풀어 적는다.
-- 준포토의 120 은 현상 10,000원만 알고 스캔이 같은 값인지 몰라 basic 을 비우고
-- features 에만 적는다. 모르는 값을 추정해 넣지 않는다(20260912000001 원칙).
--
-- 이름과 지역·주소를 함께 봐서 중복을 막는다. 이름만 보고 걸렀다가 다른
-- 지역의 같은 이름에 막혔던 일(20260909000001)을 되풀이하지 않기 위해서다.

-- ── 춘천 라이트사 ──
insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order)
select
  '라이트사', '강원',
  '강원 춘천시 서부대성로44번길 25-2',
  null,
  '필름 현상을 받는다. 컬러 현상 9,000원, 스캔 4,000원. 명동 인성병원 인근 골목 초입에 있다. 요금은 2026년 9월 기준.',
  null,
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', 13000, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs)
where not exists (
  select 1 from public.labs l
  where l.name = '라이트사' and l.address = '강원 춘천시 서부대성로44번길 25-2'
);

-- ── 춘천 준포토 ──
-- 월요일과 목요일에만 현상 작업을 한다. 이것이 이 곳의 핵심 정보라 features 맨 앞에 둔다.
insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order)
select
  '준포토', '강원',
  '강원 춘천시 중앙로 86-1',
  null,
  '필름 현상은 월요일과 목요일에만 작업한다. 현상 컬러 9,000원, 흑백 12,000원, 120 은 10,000원. 스캔 4,000원, 하프프레임 스캔 5,000원. 요금은 2026년 9월 기준.',
  null,
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', 13000, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', 16000, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs)
where not exists (
  select 1 from public.labs l
  where l.name = '준포토' and l.address = '강원 춘천시 중앙로 86-1'
);

-- ── 강릉 동인스튜디오 ──
insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order)
select
  '동인스튜디오', '강원',
  '강원 강릉시 하평3길 37 일송아파트',
  null,
  '1995년부터 이어 온 사진관. 필름 현상과 인화, 대형 인화, 액자 제작을 함께 한다. 컬러 현상 5,000원, 스캔 5,000원. 요금은 2026년 9월 기준.',
  null,
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', 10000, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs)
where not exists (
  select 1 from public.labs l
  where l.name = '동인스튜디오' and l.address = '강원 강릉시 하평3길 37 일송아파트'
);
