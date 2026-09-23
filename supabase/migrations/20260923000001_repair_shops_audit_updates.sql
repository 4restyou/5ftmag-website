-- 2026-09-23 수리점 전수조사 1차 반영.
--
-- 첨부 CSV 의 조사 칸은 비어 있었기 때문에, 웹에서 주소·연락처를 다시 확인한
-- 곳만 고친다. 검색 결과가 약하거나 서로 엇갈리는 곳은 그대로 둔다. 작은
-- 수리점은 온라인 흔적이 적을 수 있어, 확인불가를 폐업으로 처리하지 않는다.

-- ── 1. 삼성사: 지역·주소·연락처 추가 ──
-- 공개 수리점 목록에서 필삼사빌딩 302호와 대표번호를 확인했다.
update public.repair_shops
   set region = '서울',
       address = '서울 중구 퇴계로31길 13 필삼사빌딩 302호',
       contact = '02-2266-8162'
 where name = '삼성사' and (region is null or region = '서울');

-- ── 2. 소니 신용산 서비스센터: 공식 서비스센터 정보로 정정 ──
-- 소니 공식 A/S 센터 페이지 기준. 미놀타 계보 설명은 확인된 현재 접수 품목과
-- 섞이지 않도록 완화한다.
update public.repair_shops
   set address = '서울 용산구 한강대로 95 래미안 용산더센트럴 B동 409호',
       specialty = '소니 카메라 서비스',
       description = '신용산역 앞 공식 소니 서비스센터. 렌즈교환식 카메라(A/E Mount), 디지털 카메라, 캠코더와 시네마라인 일부(FX2·FX3·FX30)를 맡길 수 있다. 미놀타 계보 카메라는 방문 전 접수 가능 여부를 확인하는 편이 낫다.',
       contact = '02-318-5640',
       url = 'https://www.sony.co.kr/scs/handler/Map-ViewMap?dealerascId=309'
 where name = '소니 신용산 서비스센터' and region = '서울';

-- ── 3. 부산 신카메라: 주소·연락처 추가 ──
-- 지역 기사와 공개 수리점 목록을 대조했다. 가격은 조사 대상이 아니어서 넣지 않는다.
update public.repair_shops
   set address = '부산광역시 중구 남포동2가 남포길 47',
       description = '남포동의 오래된 카메라 수리점. 필름카메라를 중심으로 올림푸스 PEN F·FT, 콘탁스 케이블 같은 오래된 기종 수리 이력이 알려져 있다. 방문 전 문자나 전화로 수리 가능 여부와 보증 조건을 확인하는 편이 낫다.',
       contact = '051-246-0360'
 where name = '부산 신카메라' and region = '부산';

-- ── 4. 권카메라: 유선번호 보강 ──
-- 기존 공개 연결번호를 지우지 않고 포항 매장 번호를 앞에 더한다.
update public.repair_shops
   set contact = '054-242-1882 · 010-9750-5171 · 0504-4642-6931'
 where name = '권카메라' and region = '경북';

-- ── 5. 유성카메라: 유선번호 보강 ──
-- 기존 네이버 연결번호를 지우지 않고 대구 매장 번호를 앞에 더한다.
update public.repair_shops
   set contact = '053-428-2848 · 0507-1475-2848'
 where name = '유성카메라' and region = '대구';
