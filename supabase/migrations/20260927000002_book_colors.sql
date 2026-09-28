-- ════════════════════════════════════════════════════════════════════
-- 책장 색 직접 지정 (2026-09-27)
--
-- Magazine 책장은 표지 이미지에서 책등·배경 색(spine_color)과 박 색(foil_color)을
-- 자동으로 뽑는다. 표지에 따라 엉뚱한 색이 나올 수 있어 편집부가 관리 화면에서
-- 스포이드로 직접 정할 수 있게 두 컬럼을 더한다. 비어 있으면 자동 추출 그대로.
-- 값은 '#rrggbb' 문자열. replay-safe.
-- ════════════════════════════════════════════════════════════════════

alter table public.ebook_products add column if not exists spine_color text not null default '';
alter table public.ebook_products add column if not exists foil_color  text not null default '';

alter table public.webzine_issues add column if not exists spine_color text;
alter table public.webzine_issues add column if not exists foil_color  text;
