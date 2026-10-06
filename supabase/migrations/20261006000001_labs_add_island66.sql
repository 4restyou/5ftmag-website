-- 현상소 추가: 서울 명동 아일랜드 66 (흑백 전문 랩).
--
-- 운영자가 네이버 지도 장소 화면을 캡처해 주었다(2026-10-06). 주소와 요금은
-- 그 화면에 적힌 그대로 옮긴다. labs 에는 전화번호 칸이 없으므로 넣지 않는다
-- (add-lab 스킬 규칙).
--
-- 흑백만 받는 곳이라 prices 는 bw 만 채운다. 카드에는 add-lab 규칙대로 135 의
-- 현상+스캔 묶음가를 basic(1000DPI 밀착 7,000원)에, 고해상(2000DPI 10,000원)을
-- high 에 넣는다. 120 요금은 화면에 따로 없어 비운다. 모르는 값을 추정해 넣지
-- 않는다(20260912000001 원칙). 현상 단독·크롭·암실 프로그램 요금은 features 에 적는다.
--
-- 이름과 주소를 함께 봐서 중복을 막는다(20260922000001 과 같다). 재실행 안전.

insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order,
                         name_en, address_en, features_en, name_ja, address_ja, features_ja)
select
  '아일랜드 66', '서울',
  '서울 중구 삼일대로6길 14 현대시트빌딩 5층',
  null,
  '흑백 필름 전문 랩. 흑백 현상 6,000원, 현상과 밀착 스캔 1000DPI 7,000원, 2000DPI 10,000원. 밀착 스캔에서 컷을 따로 크롭하면 한 장에 3,000원이다. 암실 체험(2시간 50,000원부터)과 4~5회 과정의 암실 교육(150,000~300,000원)도 연다. 명동역 10번 출구에서 300m, 오후 1시부터 접수한다. 요금은 2026년 10월 기준.',
  'https://blog.naver.com/island66bw',
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', 7000, 'high', 10000),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null),
                                 '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs),
  'Island 66',
  '5F, 14 Samil-daero 6-gil, Jung-gu, Seoul',
  'A lab dedicated to black-and-white film. B&W development 6,000 won; development with a contact-sheet scan at 1000 DPI 7,000 won, at 2000 DPI 10,000 won. Cropping individual frames from the contact scan costs 3,000 won each. Darkroom sessions (from 50,000 won for 2 hours) and darkroom courses of 4 to 5 classes (150,000 to 300,000 won) are also offered. 300 m from Myeongdong Station Exit 10; orders are taken from 1 PM. Prices as of October 2026.',
  'アイランド66',
  'ソウル特別市 中区 三一大路6ギル 14 5階',
  'モノクロフィルム専門のラボ。モノクロ現像6,000ウォン、現像とベタ焼きスキャン1000DPIで7,000ウォン、2000DPIで10,000ウォン。ベタ焼きスキャンからコマを個別にクロップすると1枚3,000ウォン。暗室体験（2時間50,000ウォンから）と4〜5回コースの暗室講座（150,000〜300,000ウォン）も開いている。明洞駅10番出口から300m、受付は午後1時から。料金は2026年10月時点。'
where not exists (
  select 1 from public.labs l
  where l.name = '아일랜드 66' and l.address = '서울 중구 삼일대로6길 14 현대시트빌딩 5층'
);

NOTIFY pgrst, 'reload schema';
