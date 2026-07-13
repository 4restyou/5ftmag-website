// 5ft.mag — 마켓 매물 소셜 미리보기(OG) stub. Netlify Edge Function.
//
// 매물은 사용자가 실시간 등록해서 필름(/film/<slug> 정적 stub)처럼 미리 만들 수
// 없다. /market/<id> 로 들어오면 이 함수가 매물 제목·가격·첫 사진이 담긴 OG
// 태그를 실시간 생성한다. 크롤러(카카오·페북·트위터)는 그 태그로 미리보기를
// 만들고, 일반 방문자는 meta refresh + JS 로 즉시 /market.html?id=<id> 로 이동한다.
//
// Supabase 엣지 함수 프록시(초기 구현)는 Netlify 외부 프록시가 함수의
// Content-Type(text/html) 을 브라우저까지 전달하지 못해, 전역 nosniff 와 겹쳐
// HTML 이 소스로 노출되고 한글이 깨졌다. Netlify Edge Function 은 Netlify 가 직접
// 실행·서빙하므로 Content-Type 이 그대로 지켜진다.
//
// 읽는 데이터는 market_listings_public 뷰(연락처 마스킹, anon 공개)뿐 — PII 없음.
// anon 키는 클라이언트 JS 에 이미 공개된 값이라 하드코딩해도 노출 위험이 없다.

const SUPABASE_URL = 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';
const ORIGIN = 'https://www.5ftmag.com';
const FALLBACK_OG = `${ORIGIN}/img/og/5ft-link1.webp`;
const SITE_NAME = '5ft magazine';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stub(o: { title: string; desc: string; image: string; url: string; redirect: string }): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${esc(o.image)}">
<meta name="robots" content="noindex, follow">
<meta http-equiv="refresh" content="0; url=${esc(o.redirect)}">
<script>location.replace(${JSON.stringify(o.redirect)});</script>
</head>
<body><a href="${esc(o.redirect)}">${esc(o.title)}</a></body>
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

export default async (request: Request): Promise<Response> => {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['market', '<id>']
  const id = decodeURIComponent(parts[1] || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
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
};

export const config = { path: '/market/:id' };
