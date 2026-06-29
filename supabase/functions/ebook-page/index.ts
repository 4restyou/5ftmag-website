// 5ft.mag — 이북 페이지 전달 (프리미엄 게이트).
//
// 프리미엄 모델: 앞 1/3(올림) 페이지는 누구나 미리보기, 나머지는 열람권 보유자만.
// 워터마크 없음(유료 퀄리티 유지). 클린 원본은 비공개 버킷에 두고 함수가 게이트.
//
// 호출(브라우저 fetch):
//   GET /functions/v1/ebook-page?slug=<slug>&page=<1-based>
//   유료 페이지면 Authorization: Bearer <user access_token> 필요.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'ebook-pages';

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
function err(status: number, msg: string, origin: string | null) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'content-type': 'application/json', ...cors(origin) },
  });
}
function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
function contentType(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (req.method !== 'GET') return err(405, 'method', origin);

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  const pageNum = parseInt(url.searchParams.get('page') || '', 10);
  if (!slug || !Number.isFinite(pageNum) || pageNum < 1) return err(400, 'slug & page required', origin);

  // 상품 (발행분만)
  const { data: product, error: prodErr } = await admin
    .from('ebook_products')
    .select('id, pages_path, page_count, published')
    .eq('slug', slug)
    .maybeSingle();
  if (prodErr || !product || !product.published) return err(404, 'not found', origin);

  const total = product.page_count || 0;
  if (pageNum > total) return err(404, 'page out of range', origin);
  const freeLimit = Math.max(1, Math.ceil(total / 3)); // 앞 1/3 무료
  const isFree = pageNum <= freeLimit;

  // 유료 페이지 → 인증 + 열람권 확인
  if (!isFree) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token) return err(401, 'auth required', origin);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return err(401, 'invalid token', origin);
    const { data: ent } = await admin
      .from('ebook_entitlements')
      .select('id').eq('user_id', userData.user.id).eq('product_id', product.id).maybeSingle();
    if (!ent) return err(403, 'no entitlement', origin);
  }

  // 페이지 파일
  const pagesPath = (product.pages_path || slug).replace(/\/+$/, '');
  const { data: listing, error: listErr } = await admin.storage.from(BUCKET).list(pagesPath, { limit: 2000 });
  if (listErr) return err(500, 'list failed', origin);
  const names = (listing || [])
    .map((o: any) => o.name)
    .filter((n: string) => /\.(jpe?g|png|webp)$/i.test(n))
    .sort(naturalSort);
  if (pageNum > names.length) return err(404, 'page missing', origin);
  const fileName = names[pageNum - 1];

  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(`${pagesPath}/${fileName}`);
  if (dlErr || !blob) return err(500, 'download failed', origin);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType(fileName),
      // 무료 미리보기는 캐시 허용, 유료는 캐시 금지
      'cache-control': isFree ? 'public, max-age=3600' : 'private, no-store, max-age=0',
      ...cors(origin),
    },
  });
});
