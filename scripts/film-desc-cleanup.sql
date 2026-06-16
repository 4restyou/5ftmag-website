-- 필름 소개글 어색한 AI 어투 정리.
-- Supabase Studio SQL Editor 에 통째로 붙여넣고 Run.
-- 적용 후 Netlify 재빌드 트리거 (사소한 커밋 push 또는 Netlify Deploy 버튼) 필요.

BEGIN;

UPDATE public.films SET description = 'Fujifilm 의 데일리 흑백 필름. 곱고 깨끗한 입자가 일본 흑백 사진의 정서를 만든 라인으로, 2013년 단종. Acros II 와 함께 가장 자주 거론되는 일본 흑백 필름이에요.' WHERE slug = 'fujineopan400';
UPDATE public.films SET description = '일본 시장 한정으로 출시되었던 Fujifilm 의 고감도 컬러 필름. 부드러운 피부톤 표현으로 인물 사진에서 두터운 팬층을 만든 라인이라, 단종 후에도 빈티지 시장에서 자주 거론됩니다.' WHERE slug = 'superiavenus800';
UPDATE public.films SET description = 'Kentmere 의 입문용 ISO 100 흑백. Ilford Delta 100/FP4 보다 가격이 낮으면서 곱고 차분한 입자감이라 흑백 풍경·정물 입문용으로 자주 권합니다.' WHERE slug = 'kentmere100';

COMMIT;
