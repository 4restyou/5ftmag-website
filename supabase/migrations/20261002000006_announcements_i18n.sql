-- 공지(announcements)에 영문·일문 칸을 더한다 (정비 D2, 2026-10-02).
--
-- 공지는 한국어 한 칸(body)뿐이라 영문·일문판 헤더에도 한국어 공지가 그대로 나갔다.
-- body_en·body_ja 를 더하고, 화면(site-common.js)은 언어판에 맞는 칸이 비어 있으면
-- 영어 → 한국어 순으로 대신 쓴다(필름·현상소의 *_en·*_ja 와 같은 규칙).
-- 공개 읽기 정책은 행 단위라 새 칸도 함께 읽힌다. 재실행 안전.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS body_en TEXT CHECK (body_en IS NULL OR char_length(body_en) <= 500),
  ADD COLUMN IF NOT EXISTS body_ja TEXT CHECK (body_ja IS NULL OR char_length(body_ja) <= 500);

COMMENT ON COLUMN public.announcements.body_en IS '영문판 공지. 비면 한국어 body 가 나간다';
COMMENT ON COLUMN public.announcements.body_ja IS '일문판 공지. 비면 영문 → 한국어 순으로 대신 나간다';

NOTIFY pgrst, 'reload schema';
