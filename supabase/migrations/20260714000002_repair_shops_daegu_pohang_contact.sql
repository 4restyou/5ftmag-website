-- repair_shops: 대구·경북(포항) 3곳 주소·연락처 보완.
-- address 는 공개 페이지에서 좌표 지오코딩(지도 핀)에 쓰이고,
-- contact 는 전화 등 자유 형식이다. 이름으로 갱신해 재적용(replay) 안전.

update public.repair_shops
   set address = '경북 포항시 북구 용당로 127-1', contact = '010-9750-5171'
 where name = '권카메라';

update public.repair_shops
   set address = '대구 북구 유통단지로 45 전자관 1층 299호', contact = '0507-1313-4049'
 where name = '명문카메라';

update public.repair_shops
   set address = '대구 중구 국채보상로 580 대현프리몰 E-31', contact = '0507-1475-2848'
 where name = '유성카메라';
