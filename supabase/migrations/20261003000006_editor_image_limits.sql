-- 현재 운영 객체는 JPEG/WebP이며 최대 150KB 미만임을 사전 확인했다.
-- 파일/공개 여부/정책은 바꾸지 않고 누락된 버킷 업로드 제한만 채운다.
UPDATE storage.buckets
SET file_size_limit = COALESCE(file_size_limit, 10 * 1024 * 1024),
    allowed_mime_types = COALESCE(allowed_mime_types, ARRAY['image/jpeg', 'image/png', 'image/webp'])
WHERE id = 'article-media';

UPDATE storage.buckets
SET file_size_limit = COALESCE(file_size_limit, 5 * 1024 * 1024),
    allowed_mime_types = COALESCE(allowed_mime_types, ARRAY['image/jpeg', 'image/png', 'image/webp'])
WHERE id = 'film-thumbnails';
