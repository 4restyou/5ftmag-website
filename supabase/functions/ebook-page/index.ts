// 5ft.mag — 이북 페이지 서버 워터마크 전송 (Phase 1 'B' 보호).
//
// 흐름: 로그인 사용자(JWT) → 열람권 확인 → 비공개 버킷 페이지 다운로드 →
//       구매자 식별자(이메일·uid·날짜)를 이미지에 직접 새겨(burn) 바이트로 반환.
// 클린 원본은 절대 클라이언트로 나가지 않는다. 유출돼도 누구 것인지 박혀 있음.
//
// 호출(브라우저 fetch):
//   GET /functions/v1/ebook-page?slug=<slug>&page=<1-based>
//   Authorization: Bearer <user access_token>
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';
import { FONT_B64 } from './font.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'ebook-pages';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FONT = Uint8Array.from(atob(FONT_B64), (c) => c.charCodeAt(0));

function allowOrigin(origin: string | null): string {
  const o = origin || '';
  if (o === 'https://www.5ftmag.com' || o === 'https://5ftmag.com') return o;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(o)) return o; // deploy preview
  return 'https://www.5ftmag.com';
}
function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowOrigin(origin),
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}
function err(status: number, msg: string, origin: string | null) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

// 페이지 파일명 자연 정렬 (p1, p2 … p10)
function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== 'GET') return err(405, 'method', origin);

  // 1) 인증 — Authorization: Bearer <jwt>
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return err(401, 'auth required', origin);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return err(401, 'invalid token', origin);
  const user = userData.user;

  // 2) 입력
  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  const pageNum = parseInt(url.searchParams.get('page') || '', 10);
  if (!slug || !Number.isFinite(pageNum) || pageNum < 1) return err(400, 'slug & page required', origin);

  // 3) 상품 조회
  const { data: product, error: prodErr } = await admin
    .from('ebook_products')
    .select('id, pages_path, ebook_on_sale, published')
    .eq('slug', slug)
    .maybeSingle();
  if (prodErr || !product) return err(404, 'not found', origin);

  // 4) 열람권 확인
  const { data: ent } = await admin
    .from('ebook_entitlements')
    .select('id')
    .eq('user_id', user.id)
    .eq('product_id', product.id)
    .maybeSingle();
  if (!ent) return err(403, 'no entitlement', origin);

  // 5) 페이지 파일 결정
  const pagesPath = (product.pages_path || slug).replace(/\/+$/, '');
  const { data: listing, error: listErr } = await admin.storage.from(BUCKET).list(pagesPath, { limit: 2000 });
  if (listErr) return err(500, 'list failed', origin);
  const names = (listing || [])
    .map((o: any) => o.name)
    .filter((n: string) => /\.(jpe?g|png|webp)$/i.test(n))
    .sort(naturalSort);
  if (pageNum > names.length) return err(404, 'page out of range', origin);
  const fileName = names[pageNum - 1];

  // 6) 다운로드
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(`${pagesPath}/${fileName}`);
  if (dlErr || !blob) return err(500, 'download failed', origin);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // 7) 워터마크 burn — 구매자 식별자 대각선 타일
  try {
    const img = await Image.decode(bytes);
    const ident = (user.email || user.id).slice(0, 48);
    const stamp = new Date().toISOString().slice(0, 10);
    const label = `5ft.mag · ${ident} · ${stamp}`;
    // 흰색 약알파 텍스트 → 대각선 회전 → 격자 타일 합성
    const text = await Image.renderText(FONT, Math.max(16, Math.round(img.width / 42)), label, 0xffffff26);
    const tile = text.rotate(330); // -30deg
    const stepX = Math.max(tile.width, Math.round(img.width / 2));
    const stepY = Math.max(tile.height + 40, Math.round(img.height / 6));
    for (let y = -tile.height; y < img.height + tile.height; y += stepY) {
      for (let x = -tile.width; x < img.width + tile.width; x += stepX) {
        img.composite(tile, x, y);
      }
    }
    const out = await img.encodeJPEG(82);
    return new Response(out, {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'private, no-store, max-age=0',
        ...corsHeaders(origin),
      },
    });
  } catch (e) {
    console.error('[ebook-page] watermark failed', (e as Error).message);
    return err(500, 'render failed', origin);
  }
});
