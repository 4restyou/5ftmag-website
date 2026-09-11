-- 현상소 추가: STRIPE (서울 중구 장충단로). 흑백 전용 필름 랩.
--
-- 운영자가 매장 사진, 명함, 메뉴표를 보내 주었다. 명함의 영문 주소
-- "103, 20, Jangchungdan-ro 10-gil, Jung-gu, Seoul" 를 국문으로 옮겼다.
-- labs 에는 전화번호 칸이 없으므로 넣지 않는다(add-lab 스킬 규칙).
--
-- prices 는 흑백만 채운다. 현상이 10,000원이고 스캔은 셀프로 롤당 3,000원이
-- 따로 붙는 구조라, 묶음가가 아니어서 현상값만 135.basic 에 넣고 나머지는
-- 비운다. 120 은 스캔만 되는지 현상도 같은 값인지 메뉴에 없어 비워 둔다.
--
-- scan_res 는 해상도를 적는 칸인데 여기는 셀프 스캔이라 이용자가 정한다. 그래서 비운다.
--
-- features 는 다른 현상소와 길이를 맞춘다(중앙값 31자, 최대 87자). 확대기 기종이나
-- 커피 판매 같은 것까지 넣으면 카드 하나만 네 배로 길어져 목록이 무너진다.
-- 자세한 것은 가게 인스타그램 메뉴에 있고 url 로 이어 둔다.
--
-- 이름과 주소를 함께 봐서 중복을 막는다. 이름만 보고 걸렀다가 다른 지역의
-- 같은 이름에 막혔던 일(20260909000001)을 되풀이하지 않기 위해서다.

insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order)
select
  'STRIPE', '서울',
  '서울 중구 장충단로10길 20, 103호',
  null,
  '흑백 전용. 현상 10,000원(로디날), 셀프 스캔 롤당 3,000원. 35mm·120·4×5 를 TIFF 로 받는다. '
  || '암실 렌탈은 반일 60,000원, 종일 110,000원. 운영자 인화는 RC 8×10 5,000원, FB 9,000원부터. '
  || '일포드 필름과 약품, 인화지를 판다. 평일 11시부터 18시까지, 예약제. 요금은 2025년 7월 기준.',
  'https://www.instagram.com/stripe_79',
  jsonb_build_object(
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', 10000, 'high', null),
                                 '120', jsonb_build_object('basic', null,  'high', null)),
    'color',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs)
where not exists (
  select 1 from public.labs l
  where l.name = 'STRIPE' and l.address = '서울 중구 장충단로10길 20, 103호'
);
