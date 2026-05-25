-- repair_shops 테이블: 카메라 수리실 (Labs 안 '수리실' 탭)
-- labs 패턴과 동일: public 은 SELECT, editor 만 INSERT/UPDATE/DELETE.
-- 좌표는 저장하지 않고 공개 페이지에서 address 를 즉석 지오코딩한다(labs 와 동일).

create table if not exists public.repair_shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  region      text,
  address     text,
  specialty   text,            -- 전문 분야 (예: 라이카·수동 RF)
  description text,            -- 설명/메모
  url         text,
  is_hidden   boolean not null default false,
  sort_order  int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists repair_shops_region_idx on public.repair_shops (region);
create index if not exists repair_shops_sort_idx   on public.repair_shops (sort_order);

create or replace function public._repair_shops_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists repair_shops_touch_updated_at on public.repair_shops;
create trigger repair_shops_touch_updated_at
  before update on public.repair_shops
  for each row execute function public._repair_shops_touch_updated_at();

alter table public.repair_shops enable row level security;

drop policy if exists "repair_shops_public_select" on public.repair_shops;
create policy "repair_shops_public_select" on public.repair_shops for select using (true);

drop policy if exists "repair_shops_editor_insert" on public.repair_shops;
create policy "repair_shops_editor_insert" on public.repair_shops for insert to authenticated
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true));

drop policy if exists "repair_shops_editor_update" on public.repair_shops;
create policy "repair_shops_editor_update" on public.repair_shops for update to authenticated
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true))
  with check (exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true));

drop policy if exists "repair_shops_editor_delete" on public.repair_shops;
create policy "repair_shops_editor_delete" on public.repair_shops for delete to authenticated
  using (exists (select 1 from public.profiles where user_id = auth.uid() and is_editor = true));

-- 시드: 5ft.mag 정리본 (가게만, 개인 장인 제외). 주소는 admin 에서 채운다.
insert into public.repair_shops (name, region, address, specialty, description, sort_order)
select * from (values
  ('카메라닥터', '서울', null, '라이카·수동 RF', '반도 김진철 실장이 독립해 충무로 사진집 건물에 오픈. 독립 후 더 저렴하고 빨라졌다.', 0),
  ('홍성중앙카메라', null, null, '라이카·수동 RF', '대기와 비용이 있는 편이지만 퀄리티는 최상급이다.', 1),
  ('거인광학', null, null, '라이카·수동 RF', '대기 길고 비용 높은 편. 퀄리티는 월드클래스로 통한다.', 2),
  ('빛그림 수리실', '서울', null, '올드카메라', '충무로. 1940년대 이전 올드카메라라면 첫손에 꼽힌다.', 3),
  ('삼성사', null, null, '펜탁스·콘탁스', '부품 보유량이 압도적이라 콘탁스 문제 시 1순위. 다만 일부 기종(S2·S2B·TVS)은 부품 재고가 줄고 있다.', 4),
  ('한국펜탁스', '서울', null, '펜탁스', '을지로. 과잉진료 없이 담백하고 깔끔한 수리가 장점.', 5),
  ('충일카메라', null, null, '캐논·니콘 SLR·RF·핫셀블라드', '컴팩트는 받지 않음. SLR·RF 수동기 전천후에 계측기기도 잘 갖췄고, 핫셀블라드 수리도 가능하다.', 6),
  ('한국카메라AS', '경기', null, '핫셀블라드', '폐업 후 일산에서 소규모로 다시 시작. 핫셀블라드 전문.', 7),
  ('충무로카메라AS', '서울', null, '컴팩트 자동카메라', '까다로운 컴팩트 자동 수리에 강하고 친절하다. 비용은 조금 높은 편.', 8),
  ('남대문 스피드', '서울', null, '컴팩트 자동카메라', '친절하고 가격 좋고 꼼꼼하다. 다만 최근 작업 적체가 있는 편.', 9),
  ('남대문 디포커스', '서울', null, '렌즈 클리닝·복잡 수리', '렌즈 헤이즈·발삼·핀교정, 대구경 렌즈 클리닝, 플래시·전자회로 등 까다로운 수리. 선반·밀링으로 부품을 직접 깎기도 한다.', 10),
  ('작은풍경', '서울', null, '간단 정비·클리닝', '세운상가 1층. 클리닝·부품교체 같은 가벼운 정비에 단골 삼기 좋다. 친절하고 빠르다.', 11),
  ('소니 신용산 서비스센터', '서울', null, '미놀타', '미놀타 AS 계보(남대문에서 신용산으로 이전). TC-1은 이곳에서 수리할 수 있다.', 12),
  ('부산 신카메라', '부산', null, '니콘·올림푸스·콘탁스', '올림푸스 PEN F·FT, 콘탁스 케이블 등 수리. 2년 AS 보장에 문자 상담과 택배 접수, 카드결제도 가능하다.', 13),
  ('폴라존', '서울', null, '폴라로이드', '홍대. 폴라로이드 카메라 전문.', 14)
) as v(name, region, address, specialty, description, sort_order);
