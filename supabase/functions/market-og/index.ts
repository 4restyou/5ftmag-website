// 5ft.mag — 마켓 매물 소셜 미리보기(OG) stub.
//
// 매물은 사용자가 실시간으로 등록해서 필름처럼 정적 stub 을 미리 만들 수 없다.
// netlify.toml 이 /market/:id 를 이 함수로 200 프록시하면, 카카오/페북/트위터
// 크롤러는 매물 제목·가격·첫 사진이 담긴 OG 태그를 받고, 일반 방문자는
// meta refresh + JS 로 즉시 /market.html?id=<id> 로 이동한다.
// (/film/<slug> 정적 stub 과 같은 패턴의 동적 버전)
//
// 읽는 데이터는 market_listings_public 뷰(연락처 마스킹, anon 공개)뿐 — PII 없음.
// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ORIGIN = 'https://www.5ftmag.com';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;
const SITE_NAME = '5ft magazine';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stub({ title, desc, image, url, redirect }: { title: string; desc: string; image: string; url: string; redirect: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="noindex, follow">
<meta http-equiv="refresh" content="0; url=${esc(redirect)}">
<script>location.replace(${JSON.stringify(redirect)});</script>
</head>
<body><a href="${esc(redirect)}">${esc(title)}</a></body>
</html>`;
}

function html(body: string, cacheSeconds: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

const fallback = () => html(stub({
  title: `Market | ${SITE_NAME}`,
  desc: '필름 카메라·장비 중고 장터',
  image: FALLBACK_OG,
  url: `${ORIGIN}/market`,
  redirect: '/market.html',
}), 60);

Deno.serve(async (req) => {
  const id = (new URL(req.url).searchParams.get('id') || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
  if (!id) return fallback();

  let row: any = null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/market_listings_public?id=eq.${id}&select=id,title,price,description,storage_paths&limit=1`,
      { headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` } },
    );
    if (res.ok) row = (await res.json())?.[0] || null;
  } catch (_) { /* fallback */ }
  if (!row) return fallback();

  const first = Array.isArray(row.storage_paths) ? row.storage_paths[0] : null;
  const path = typeof first === 'string' ? first : (first?.path || first?.src || '');
  const image = path ? `${ORIGIN}/i/market/${path}` : FALLBACK_OG;
  const price = Number(row.price) > 0 ? `${Number(row.price).toLocaleString('ko-KR')}원` : '';
  const title = [row.title, price].filter(Boolean).join(' · ') + ` | ${SITE_NAME} Market`;
  const desc = String(row.description || '필름 카메라·장비 중고 장터').replace(/\s+/g, ' ').trim().slice(0, 120);

  return html(stub({
    title,
    desc,
    image,
    url: `${ORIGIN}/market/${row.id}`,
    redirect: `/market.html?id=${encodeURIComponent(row.id)}`,
  }), 300);
});
