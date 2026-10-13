-- 현상소 추가: 서울 헤르츠삼오 홍대점, 이스트만랩, 스페이스셀 (독자 제보, 2026-10-13).
--
-- 운영자가 네이버 지도 장소 화면과 매장 가격표(헤르츠삼오), 인스타그램 프로필과 소개(이스트만랩),
-- 웹사이트 요금표(스페이스셀)를 캡처해 주었다. 주소와 요금은 그 화면에 적힌 그대로 옮긴다.
-- 전화번호는 넣지 않는다(add-lab 규칙). 모르는 값은 추정하지 않고 비운다.
--  - 헤르츠삼오: 카드 노출값은 135 의 Low 를 basic, High 를 high 에 둔다. 흑백·E-6·ECN-2 는 형식 구분이
--    없어 135 에만 넣는다. Mid·TIFF·증감·인화 요금은 features 에 적는다.
--  - 이스트만랩: 성북동 위켄드 필름(20261013000002 에서 숨김)이 옮겨 온 곳. 요금표를 받지 못해 비운다.
--  - 스페이스셀: Super 8mm·16mm 영화 필름이라 135 칸에 맞지 않아 prices 는 비우고 features 에 적는다.
-- 이름과 주소를 함께 봐서 중복을 막는다. 재실행 안전.

insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order,
                         name_en, address_en, features_en, name_ja, address_ja, features_ja)
select '헤르츠삼오 홍대점', '서울', '서울 마포구 동교로 223 1층', '6000*4000',
  '필름 현상·스캔. 컬러 135 은 Low(1000×1500) 5,500원, Mid(2000×3000) 7,000원, High(6000×4000) 9,000원, TIFF 13,000원. 120 은 Low 5,500원, High 10,000원, TIFF 13,000원. 흑백 10,000원(High 12,000원), E-6 15,000원(High 17,000원), ECN-2 10,000원. 증감 현상은 컬러 1,500원, 그 밖에 2,500원 추가. 인화 3.5×5·4×6 인치 600원(High 900원). 평일 13:30~20:30, 주말 12:00~20:30. 홍대입구역 3번 출구에서 245m. 요금은 2026년 10월 매장 가격표 기준.',
  'https://www.instagram.com/hertz.film.lab',
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', 5500, 'high', 9000), '120', jsonb_build_object('basic', 5500, 'high', 10000)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', 10000, 'high', 12000), '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', 15000, 'high', 17000), '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', 10000, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs),
  'Hertz35 Hongdae', '1F, 223 Donggyo-ro, Mapo-gu, Seoul',
  'Film development and scanning. Color 135: Low (1000×1500) 5,500 won, Mid (2000×3000) 7,000 won, High (6000×4000) 9,000 won, TIFF 13,000 won. 120: Low 5,500 won, High 10,000 won, TIFF 13,000 won. B&W 10,000 won (High 12,000 won), E-6 15,000 won (High 17,000 won), ECN-2 10,000 won. Push processing adds 1,500 won for color and 2,500 won for other films. Prints in 3.5×5 and 4×6 inch 600 won (High 900 won). Weekdays 13:30 to 20:30, weekends 12:00 to 20:30. 245 m from Hongik Univ. Station Exit 3. Prices from the in-store price list, October 2026.',
  'ヘルツサモ 弘大店', 'ソウル特別市 麻浦区 東橋路 223 1階',
  'フィルム現像・スキャン。カラー135はLow（1000×1500）5,500ウォン、Mid（2000×3000）7,000ウォン、High（6000×4000）9,000ウォン、TIFF 13,000ウォン。120はLow 5,500ウォン、High 10,000ウォン、TIFF 13,000ウォン。モノクロ10,000ウォン（High 12,000ウォン）、E-6 15,000ウォン（High 17,000ウォン）、ECN-2 10,000ウォン。増感現像はカラー1,500ウォン、そのほか2,500ウォン追加。プリントは3.5×5・4×6インチ600ウォン（High 900ウォン）。平日13:30〜20:30、週末12:00〜20:30。弘大入口駅3番出口から245m。料金は2026年10月の店頭料金表による。'
where not exists (
  select 1 from public.labs x where x.name = '헤르츠삼오 홍대점' and x.address = '서울 마포구 동교로 223 1층'
);

insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order,
                         name_en, address_en, features_en, name_ja, address_ja, features_ja)
select '이스트만랩', '서울', '서울 종로구 종로44길 26 2층', null,
  '성북동에서 문을 열었던 위켄드 필름 현상소가 옮겨 온 새 공간. 롤 필름 현상·스캔을 맡기면서 빈티지 오디오로 음악을 듣고 싱글 오리진 필터 커피를 마실 수 있다. 좌석은 많지 않다. 12:00~19:00, 월요일 휴무(바뀔 수 있음). 요금은 인스타그램 @eastman_lab 에서 확인한다.',
  'https://www.instagram.com/eastman_lab/',
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs),
  'Eastman Film Lab', '2F, 24 Jong-ro 44-gil, Jongno-gu, Seoul',
  'The new home of Weekend Film Lab, which used to be in Seongbuk-dong. You can drop off roll film for development and scanning while listening to music on a vintage audio system over single-origin filter coffee. Seating is limited. Open 12:00 to 19:00, closed Mondays (subject to change). See Instagram @eastman_lab for prices.',
  'イーストマンラボ', 'ソウル特別市 鍾路区 鍾路44ギル 26 2階',
  '城北洞にあったウィークエンドフィルム現像所が移った新しい空間。ロールフィルムの現像・スキャンを頼みながら、ヴィンテージオーディオで音楽を聴き、シングルオリジンのフィルターコーヒーを飲める。席は多くない。12:00〜19:00、月曜定休（変更あり）。料金はInstagram @eastman_lab で確認できる。'
where not exists (
  select 1 from public.labs x where x.name = '이스트만랩' and x.address = '서울 종로구 종로44길 26 2층'
);

insert into public.labs (name, region, address, scan_res, features, url, prices, sort_order,
                         name_en, address_en, features_en, name_ja, address_ja, features_ja)
select '스페이스셀', '서울', '서울 종로구 평창문화로 6-1 1층', null,
  'Super 8mm·16mm 영화 필름 현상소. 직접 만든 자동 현상기로 흑백 네거티브와 컬러 네거티브(ECN-2)를 현상한다. 현상은 Super 8mm 50ft 50,000원, 16mm 100ft 60,000원. Retroscan 으로 최대 4K 스캔도 하며 요금은 현상과 같다. 35mm 사진 필름 현상은 준비 중이라 요금이 아직 정해지지 않았다. 수~일 13:00~19:00. 요금은 2026년 10월 웹사이트 기준.',
  'https://www.spacecellfilm.com',
  jsonb_build_object(
    'color',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'bw',     jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'slide',  jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null), '120', jsonb_build_object('basic', null, 'high', null)),
    'cinema', jsonb_build_object('135', jsonb_build_object('basic', null, 'high', null)),
    'etc',    jsonb_build_object('110', null, 'aps', null)
  ),
  (select coalesce(max(sort_order), 0) + 1 from public.labs),
  'Space Cell', '1F, 6-1 Pyeongchangmunhwa-ro, Jongno-gu, Seoul',
  'A lab for Super 8mm and 16mm motion picture film. It develops B&W negative and color negative (ECN-2) on an automatic processor it built itself. Development: Super 8mm 50 ft 50,000 won, 16mm 100 ft 60,000 won. It also scans up to 4K on a Retroscan at the same prices. 35mm still film development is in preparation, and prices have not been set yet. Open Wednesday to Sunday, 13:00 to 19:00. Prices from the website, October 2026.',
  'スペースセル', 'ソウル特別市 鍾路区 平倉文化路 6-1 1階',
  'Super 8mm・16mm映画フィルムの現像所。自作の自動現像機でモノクロネガとカラーネガ（ECN-2）を現像する。現像はSuper 8mm 50ftで50,000ウォン、16mm 100ftで60,000ウォン。Retroscanで最大4Kのスキャンも行い、料金は現像と同じ。35mm写真フィルムの現像は準備中で、料金はまだ決まっていない。水〜日13:00〜19:00。料金は2026年10月のウェブサイトによる。'
where not exists (
  select 1 from public.labs x where x.name = '스페이스셀' and x.address = '서울 종로구 평창문화로 6-1 1층'
);

NOTIFY pgrst, 'reload schema';
