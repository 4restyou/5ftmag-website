-- 2026-09-12 전수조사 반영. 확인된 것만 고친다.
--
-- 조사에서 "확인불가" 로 남은 곳은 영업 상태를 건드리지 않는다. 검색에 안
-- 잡히는 것과 문을 닫은 것은 다르고, 작은 가게는 원래 검색에 약하다. 영업
-- 중인 가게를 목록에서 지우는 쪽이 더 큰 손해다.
--
-- 이름과 주소를 함께 봐서 동명이인을 건드리지 않는다. 필름로그처럼 같은
-- 이름이 여러 지점에 있기 때문이다.

-- ── 1. 필름로그 서울: 이전 ──
-- 공식 홈페이지(filmlog.co.kr)에서 새 주소와 운영시간을 확인했다.
update public.labs
   set address = '서울 중구 퇴계로68길 10 1층'
 where name = '필름로그 서울' and address = '서울 중구 퇴계로53길 6-17 1층';

-- ── 2. 포토피아: 번지 정정 ──
-- 공식 홈페이지(photopia.co.kr) 표기 기준. 영업 여부는 확인하지 못해 그대로 둔다.
update public.labs
   set address = '서울 중구 수표로6길 9'
 where name = '포토피아' and address = '서울 중구 수표로6길 10';

-- ── 3. 카메라 사진관: 주소 정정 ──
-- 공식 Contact 정보와 사업자 주소를 대조했다(choi10studio.com).
update public.labs
   set address = '인천 남동구 성말로44번길 11-13 상상빌딩 B동 2층'
 where name = '카메라 사진관' and address like '인천 남동구 문화서로3번길 23%';

-- ── 4. 책방무사: 제주에서 서울로 이전 ──
-- 제주 매장은 운영을 종료했고 서울 신촌으로 옮긴 것이 확인된다.
-- 다만 필름 접수 서비스가 함께 옮겼는지는 확인하지 못했다. 그래서 설명에서
-- "필름로그 연계 현상소" 표현을 빼고 옮겼다는 사실만 남긴다. 확인되지 않은
-- 것을 적어 두면 독자가 헛걸음한다.
update public.labs
   set region  = '서울',
       address = '서울 마포구 서강로 121 맹그로브 신촌 1층 106호',
       features = '제주에서 서울 신촌으로 옮겼다. 스캐너 선택 가능.'
 where name = '책방무사' and address like '제주%';

-- ── 5. 연남 필름: 가격을 비운다 ──
-- 2026년 7월 10일부터 현상·스캔 가격이 바뀌었다는 공지가 공식 게시판에 있다.
-- 바뀐 금액을 확인하지 못했으므로 옛 값을 지운다. 틀린 가격을 보여 주는 것이
-- 가격을 안 보여 주는 것보다 나쁘다. 확인되면 admin 에서 다시 넣는다.
update public.labs
   set prices = jsonb_set(
         jsonb_set(
           jsonb_set(prices, '{color,135,basic}', 'null'::jsonb),
           '{bw,135,basic}', 'null'::jsonb),
         '{slide,135,basic}', 'null'::jsonb),
       features = '2026년 7월 10일 가격이 바뀌었다. 방문 전에 홈페이지에서 확인하는 편이 낫다.'
 where name = '연남 필름';

-- ── 6. 한국펜탁스(수리점): 주소와 연락처 추가 ──
-- 공식 홈페이지(asahipentax.co.kr)와 2026년 9월 A/S 게시판 활동을 확인했다.
update public.repair_shops
   set address = '서울 중구 수표로 45 을지비즈센터 203호',
       contact = '02-2268-7767'
 where name = '한국펜탁스' and region = '서울';

-- ── 7. 권카메라(수리점): 공개 연결번호 추가 ──
-- 기존 번호를 지우지 않고 함께 적는다. 어느 쪽이 살아 있는지 확인되지 않았다.
update public.repair_shops
   set contact = '010-9750-5171 · 0504-4642-6931'
 where name = '권카메라' and region = '경북';
