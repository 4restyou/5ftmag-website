-- 독자 사진 기사 「5천 컷 사이에서 꺼낸 열두 장」에 사진이 실린 열두 명에게 알린다 (운영자 요청, 2026-10-24).
--
-- user_notifications 에 넣으면 기존 dispatch 트리거가 벨 알림과 Web Push 를 함께 보낸다.
-- 알림 종류 'submission_in_story' 를 새로 둔다. 다음 기사에도 쓸 수 있게 기사 제목은 meta(title_en·title_ja)에 넣고,
-- 화면은 type + meta 로 세 언어 문구를 만든다(site-common.js).
-- 사진은 storage_path 로 찾고, 지금도 승인 상태인 투고만 대상으로 한다(그사이 회수한 사진은 건너뛴다).
-- 같은 사람·같은 기사 알림이 이미 있으면 다시 넣지 않으므로 재실행 안전.

-- 1) type CHECK 에 'submission_in_story' 추가. 지금까지 쓴 모든 타입의 상위집합.
ALTER TABLE public.user_notifications
  DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE public.user_notifications
  ADD  CONSTRAINT user_notifications_type_check
       CHECK (type IN (
         'submission_approved',
         'submission_rejected',
         'submission_deleted',
         'submission_pending_editor',
         'submission_auto_approved_editor',
         'submission_featured',
         'submission_in_story',
         'listing_hidden',
         'listing_restored',
         'comment_reply',
         'proposal_approved',
         'proposal_rejected',
         'market_report_editor',
         'debug_test',
         'ebook_sold'
       ));

-- 2) 기사에 실린 열두 장(storage_path 기준)
INSERT INTO public.user_notifications (user_id, type, related_id, title, body, link, meta)
SELECT DISTINCT ON (s.user_id)
       s.user_id,
       'submission_in_story',
       s.id,
       '기사에 사진이 실렸어요',
       '보내주신 사진이 「5천 컷 사이에서 꺼낸 열두 장」에 실렸어요. 고맙습니다.',
       '/stories/readers-5000.html',
       jsonb_build_object('story', 'readers-5000', 'film', s.film,
                          'title_en', 'Twelve Frames from 5,000', 'title_ja', '5,000コマから選んだ12枚')
  FROM public.reader_submissions s
 WHERE s.status = 'approved'
   AND s.user_id IS NOT NULL
   AND s.storage_path IN (
     'b8196d89-308b-4cdf-903b-9c6a33a0d70b/1789540921540-11d65f25-e604-4d95-b4ce-0d20ab6eb206.jpg',
     '04d84746-8682-44a1-ba4d-87a93968c31f/1792472264750-2163c522-77d0-43cb-a8f0-2f606ae03179.jpg',
     'b785a4a1-98cb-42e1-ae07-35ab1f1393bd/1792484399993-556130e7-8602-4b9f-bd27-792bc081dc49.jpg',
     'cc799788-56bb-4cdc-8aa5-fb34765b0bc2/1788545576677-941d15ae-3d08-4e77-b6f1-432c1488c525.jpg',
     '34624f57-b862-45c3-b679-5a3738daf94a/1792477488589-58ef8861-3205-47ad-8d1f-9ec008c8fff3.jpg',
     'cb66d557-a5ac-46f6-be89-430e41ad25d9/1788488192883-b1df1148-fb75-4278-87e7-57003a29943d.jpg',
     '4654726e-50f3-41dc-a155-497eecd43b8c/1792770231208-6cfcf65c-dec1-452a-8abf-a1200db5b27f.jpg',
     '9497d64a-f09f-4244-bfbb-81f922f8e89b/1792579042402-4f76bb9b-7f2a-4f2d-a68e-a582eb01aa31.jpg',
     '9b65bf32-4a7f-43c7-b2cc-3193519462e7/1790500224978-dbaabdbc-9f1f-4647-bf4e-faf6193761b5.jpg',
     'efa509c1-f4dc-4737-837f-1b11addd8064/1784626834900-5cd4ffe3-17a0-4edc-b1cc-5f2e16d88c02.jpg',
     '33361f3c-e8b6-4172-ac42-13314742b79f/1778861438588-99105516-fa8d-43c8-991e-621827ebeec2.jpg',
     '27b9b3ef-0659-4bd9-a296-6a7fa2f45173/1778594591864-ff5ad96e-0439-437d-82ae-7111e8250eab.jpg'
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.user_notifications n
      WHERE n.user_id = s.user_id
        AND n.type = 'submission_in_story'
        AND n.link = '/stories/readers-5000.html'
   )
 ORDER BY s.user_id, s.created_at;

NOTIFY pgrst, 'reload schema';
