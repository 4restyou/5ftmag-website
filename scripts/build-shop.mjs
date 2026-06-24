// Supabase public.shop_products → data/shop.json 생성
//
// admin/shop 페이지에서 등록한 상품이 Netlify 빌드 시점에 정적 data/shop.json
// 으로 dump 된다. shop-page.js 는 data/shop.json 을 fetch 해서 렌더링.
//
// 환경:
//   SUPABASE_URL        (선택, 기본값: 운영 프로젝트)
//   SUPABASE_ANON_KEY   (선택, 기본값: 운영 anon — db-client.js 와 동일)
//
// fetch 실패하면 기존 data/shop.json 유지 + warn (빌드는 통과).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'data/shop.json');

const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

export function rowToJson(r) {
  return {
    slug: r.slug,
    title: r.title || '',
    category: r.category || 'goods',
    price: Number(r.price) || 0,
    originalPrice: r.original_price ?? null,
    excerpt: r.excerpt || '',
    description: r.description || '',
    images: Array.isArray(r.images) ? r.images : [],
    smartStoreUrl: r.smart_store_url || '',
    available: r.available !== false,
    sortOrder: Number(r.sort_order) || 0,
    updatedAt: r.updated_at || null,
  };
}

async function main() {
  const url = new URL('/rest/v1/shop_products', SUPABASE_URL);
  url.searchParams.set('select', '*');
  url.searchParams.set('published', 'eq.true');
  url.searchParams.set('order', 'sort_order.asc,created_at.desc');

  let rows;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      // 테이블이 아직 prod 에 없거나 RLS 차단된 경우 — 조용히 패스 (빌드 통과)
      if (res.status === 404 || res.status === 400) {
        console.warn(`⚠ shop_products 테이블 없음 (HTTP ${res.status}). data/shop.json 유지.`);
        process.exit(0);
      }
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('expected array');
  } catch (err) {
    console.warn('⚠ Supabase shop_products fetch 실패. data/shop.json 유지:', err.message);
    process.exit(0);
  }

  const out = rows.map(rowToJson);
  await fs.writeFile(TARGET, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`✓ data/shop.json — ${out.length} 상품`);
}

main().catch(err => {
  console.error('✗ build-shop 실패:', err);
  process.exit(1);
});
