-- 2026-09-23 수리점 전수조사 2차 반영.
--
-- 공식 페이지나 공개 목록에서 확인한 주소·연락처만 보강한다. 주소가 모호한
-- 곳은 추측해서 채우지 않는다. 기존 편집부 설명은 틀렸다는 근거가 없으면
-- 유지하고, 최신 접수 여부만 조심스럽게 덧붙인다.

-- ── 우선 1 ──

update public.repair_shops
   set region = '경기',
       description = '대기 길고 비용 높은 편. 퀄리티는 월드클래스로 통한다. 경기도 동탄 개인 작업실 기반이라 방문 접수는 받지 않고 택배 접수를 원칙으로 한다.',
       url = 'https://gigantoptik.com'
 where name = '거인광학'
   and region is null
   and address is null;

update public.repair_shops
   set region = '충남',
       address = '충남 홍성군 홍성읍 조양로 7'
 where name = '홍성중앙카메라'
   and region is null
   and address is null;

update public.repair_shops
   set region = '서울',
       address = '서울 중구 수표로6길 10 유진빌딩 201호',
       contact = '02-2263-7583'
 where name = '충일카메라'
   and region is null
   and address is null
   and contact is null;

update public.repair_shops
   set address = '부산 중구 남포길 47',
       description = '남포동의 오래된 카메라 수리점. 올림푸스 PEN F·FT, 콘탁스 케이블 등 수리 이력이 알려져 있다. 2년 AS 보장, 문자 상담, 택배 접수, 카드결제 안내가 전해진다. 접수 전 현재 조건을 전화로 확인하세요.'
 where name = '부산 신카메라'
   and region = '부산'
   and address = '부산 중구 남포동2가 남포길 47';

-- ── 우선 2 ──

update public.repair_shops
   set address = '서울 중구 퇴계로27길 25 청림빌딩 3층'
 where name = '카메라닥터'
   and region = '서울'
   and address is null;

update public.repair_shops
   set address = '서울 중구 수표로 13',
       contact = '02-778-1908',
       url = 'http://fixclub.co.kr'
 where name = '충무로카메라AS'
   and region = '서울'
   and address is null
   and contact is null;

update public.repair_shops
   set address = '서울 중구 남대문로 2-1 3층 301호',
       contact = '0507-1427-2284 · 010-3515-7664'
 where name = '남대문 스피드'
   and region = '서울'
   and address is null
   and contact is null;

update public.repair_shops
   set address = '서울 중구 남대문로 10-1 3층 302호',
       contact = '02-779-4305 · 010-5246-4305'
 where name = '남대문 디포커스'
   and region = '서울'
   and address is null
   and contact is null;

update public.repair_shops
   set address = '서울 종로구 인의동 112-2 세운스퀘어 테크노관 148호',
       contact = '02-2267-0607'
 where name = '작은풍경'
   and region = '서울'
   and address is null
   and contact is null;

update public.repair_shops
   set address = '서울 마포구 어울마당로 39 3층',
       description = '홍대. 폴라로이드 카메라 전문. 클래식 폴라로이드 사용 가능 테스트와 수리를 함께 안내한다.',
       contact = '02-2285-5639',
       url = 'https://polazone.com'
 where name = '폴라존'
   and region = '서울'
   and address is null
   and contact is null;

update public.repair_shops
   set description = '과거 한국카메라AS에서 이어진 핫셀블라드 수리처로 알려졌지만, 최근 접수 여부는 확인이 필요하다.'
 where name = '한국카메라AS'
   and region = '경기'
   and address is null
   and description = '폐업 후 일산에서 소규모로 다시 시작. 핫셀블라드 전문.';
