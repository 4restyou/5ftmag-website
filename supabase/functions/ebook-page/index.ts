// 5ft.mag — 이북 접근 (PDF 서명 URL 발급, 프리미엄 게이트).
//
// 페이지를 한 장씩 주던 방식 대신, PDF 한 개를 비공개 버킷에 두고
// 호출 1회로 짧은 TTL 서명 URL 을 발급한다. pdf.js(WebzineReader)가 그걸 렌더.
//   - 열람권 보유: full.pdf
//   - 비보유/비로그인: preview.pdf (앞 1/3, admin 업로드 시 자동 생성)
//
// 호출(브라우저 fetch):
//   GET /functions/v1/ebook-page?slug=<slug>
//   유료(full)면 Authorization: Bearer <user access_token> 로 열람권 확인.
// 응답: { url, entitled, page_count, free_pages }
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'ebook-pages';
const TTL = 600; // 서명 URL 유효 10분

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function allowOrigin(origin: string | null): string {
  const o = origin || '';
  if (o === 'https://www.5ftmag.com' || o === 'https://5ftmag.com') return o;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(o)) return o;
  return 'https://www.5ftmag.com';
}
function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'GET') return json({ error: 'method' }, 405, origin);

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug required' }, 400, origin);

  const { data: product, error: prodErr } = await admin
    .from('ebook_products')
    .select('id, pages_path, page_count, published')
    .eq('slug', slug)
    .maybeSingle();
  if (prodErr || !product || !product.published) return json({ error: 'not found' }, 404, origin);

  const pagesPath = (product.pages_path || slug).replace(/\/+$/, '');
  const total = product.page_count || 0;
  const freeLimit = Math.max(1, Math.ceil(total / 3));

  // 열람권 확인 (토큰 있으면)
  let entitled = false;
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    const { data: userData } = await admin.auth.getUser(token);
    if (userData?.user) {
      const { data: ent } = await admin
        .from('ebook_entitlements')
        .select('id').eq('user_id', userData.user.id).eq('product_id', product.id).maybeSingle();
      entitled = !!ent;
    }
  }

  const file = entitled ? 'full.pdf' : 'preview.pdf';
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET).createSignedUrl(`${pagesPath}/${file}`, TTL);
  if (signErr || !signed?.signedUrl) {
    // preview 가 없으면(구버전) full 시도 불가 — 안내
    return json({ error: 'file unavailable', entitled, page_count: total, free_pages: freeLimit }, 404, origin);
  }

  return json({
    url: signed.signedUrl,
    entitled,
    page_count: total,
    free_pages: freeLimit,
  }, 200, origin);
});
