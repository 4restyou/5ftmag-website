-- repair_shops 에 연락처(contact) 추가. 전화/문자/카톡/인스타 등 자유 형식.
alter table public.repair_shops add column if not exists contact text;
