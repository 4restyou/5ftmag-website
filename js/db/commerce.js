// 5ft.mag Shop·유료 이북 DB 도메인
(function () {
  'use strict';
  function create({ client, session, url, webzine }) {
  // ════════════════════════════════════════
  // shop_products — 자체 상품 카탈로그 (Smart Store deep link 매핑)
  // ════════════════════════════════════════
  const shop = {
    // 발행된 상품만 (공개 화면용). 정적 data/shop.json 으로 빌드되므로
    // 일반적으로 직접 호출은 admin 미리보기 / 운영 진단 정도.
    async listPublished() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('shop_products')
        .select('*')
        .eq('published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) { console.warn('[shop.listPublished]', error.message); return []; }
      return data || [];
    },
    // 편집부 — 전체 (미발행 포함)
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('shop_products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) { console.warn('[shop.listAll]', error.message); return []; }
      return data || [];
    },
    async get(slug) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('shop_products')
        .select('*').eq('slug', slug).maybeSingle();
      if (error) { console.warn('[shop.get]', error.message); return null; }
      return data;
    },
    async upsert(row) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const onConflict = row.id ? undefined : 'slug';
      const { data, error } = await c.from('shop_products')
        .upsert(row, { onConflict })
        .select('id, slug')
        .single();
      if (error) return { error };
      return { data };
    },
    async remove(slug) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.from('shop_products').delete().eq('slug', slug);
      return { error };
    },
    // 순서 batch 변경 — updates: [{ slug, sort_order }, ...]
    async updateSortOrder(updates) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const results = await Promise.all(updates.map(u =>
        c.from('shop_products').update({ sort_order: u.sort_order }).eq('slug', u.slug)
      ));
      const err = results.map(r => r.error).filter(Boolean)[0];
      return err ? { error: err } : { data: results.length };
    },
  };

  // ── 유료 이북 (SPC 사진첩 완판분 / 5ft 이월호) ──
  // 카탈로그 + 열람권(entitlement). 페이지 이미지는 Edge Function 이 보호.
  const ebooks = {
    // 공개 — 발행된 이북 목록 (Books 페이지용)
    async listPublished() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('ebook_products')
        .select('*')
        .eq('published', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) { console.warn('[ebooks.listPublished]', error.message); return []; }
      return data || [];
    },
    // 편집부 — 전체 (미발행 포함)
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('ebook_products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) { console.warn('[ebooks.listAll]', error.message); return []; }
      return data || [];
    },
    async get(slug) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('ebook_products')
        .select('*').eq('slug', slug).maybeSingle();
      if (error) { console.warn('[ebooks.get]', error.message); return null; }
      return data;
    },
    async upsert(row) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const onConflict = row.id ? undefined : 'slug';
      const { data, error } = await c.from('ebook_products')
        .upsert(row, { onConflict })
        .select('id, slug')
        .single();
      if (error) return { error };
      return { data };
    },
    async remove(slug) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.from('ebook_products').delete().eq('slug', slug);
      return { error };
    },

    // ── 열람권 ──
    // 현재 로그인 사용자가 열람권을 가진 product_id 집합 (Set)
    async myEntitlementIds() {
      const c = client(); if (!c) return new Set();
      const uid = await userId();
      if (!uid) return new Set();
      const { data, error } = await c.from('ebook_entitlements')
        .select('product_id').eq('user_id', uid);
      if (error) { console.warn('[ebooks.myEntitlementIds]', error.message); return new Set(); }
      return new Set((data || []).map(r => r.product_id));
    },
    async hasAccess(productId) {
      if (!productId) return false;
      const ids = await this.myEntitlementIds();
      return ids.has(productId);
    },
    // 편집부 — 특정 이북의 열람권 보유자 목록
    async listEntitlements(productId) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('ebook_entitlements')
        .select('id, user_id, source, order_ref, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
      if (error) { console.warn('[ebooks.listEntitlements]', error.message); return []; }
      return data || [];
    },
    // 편집부 — 이북별 판매(열람권 발급) 집계. { [product_id]: { total, portone, smartstore, manual } }
    // 편집부 RLS 로 전체 열람권 조회 가능. 소규모라 클라이언트 집계.
    async salesByProduct() {
      const c = client(); if (!c) return {};
      const { data, error } = await c.from('ebook_entitlements').select('product_id, source');
      if (error) { console.warn('[ebooks.salesByProduct]', error.message); return {}; }
      const map = {};
      for (const r of (data || [])) {
        const pid = r.product_id; if (!pid) continue;
        const m = map[pid] || (map[pid] = { total: 0, portone: 0, smartstore: 0, manual: 0 });
        m.total += 1;
        if (r.source === 'portone') m.portone += 1;
        else if (r.source === 'smartstore') m.smartstore += 1;
        else m.manual += 1;
      }
      return map;
    },
    // 편집부 — 수동 부여 (무통장입금 확인 후). 중복이면 무시.
    async grant(userId_, productId, { source = 'manual', orderRef = '' } = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const grantedBy = await userId();
      const { error } = await c.from('ebook_entitlements')
        .upsert(
          { user_id: userId_, product_id: productId, source, order_ref: orderRef, granted_by: grantedBy },
          { onConflict: 'user_id,product_id', ignoreDuplicates: true }
        );
      return { error };
    },
    // 편집부 — 회수
    async revoke(userId_, productId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.from('ebook_entitlements')
        .delete().eq('user_id', userId_).eq('product_id', productId);
      return { error };
    },

    // ── PDF (비공개 버킷, 편집부 업로드용) ──
    // full.pdf(전체) + preview.pdf(앞 1/3)를 {pagesPath}/ 에 둔다.
    async uploadPdf(pagesPath, fileName, blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.storage.from('ebook-pages')
        .upload(`${pagesPath}/${fileName}`, blob, { upsert: true, contentType: 'application/pdf' });
      return { error };
    },
    async clearPdfs(pagesPath) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.storage.from('ebook-pages')
        .remove([`${pagesPath}/full.pdf`, `${pagesPath}/preview.pdf`]);
      return { error };
    },
    async hasPdf(pagesPath) {
      const c = client(); if (!c) return false;
      const { data } = await c.storage.from('ebook-pages').list(pagesPath, { limit: 100 });
      return (data || []).some(o => o.name === 'full.pdf');
    },
    // 표지 — 웹진과 같은 공개 버킷에 ebooks/ 경로로 업로드. 공개 URL 반환.
    // 기존 webzine 네임스페이스(uploadFile/publicUrl)를 재사용한다.
    async uploadCover(slug, file) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const ext = ((file.name && file.name.split('.').pop()) || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `ebooks/${slug}-cover.${ext}`;
      const { error } = await webzine.uploadFile(path, file);
      if (error) return { error };
      return { url: `${webzine.publicUrl(path)}?t=${Date.now()}` };
    },
    // 페이지 수만 안전하게 갱신 (upsert 는 누락 컬럼을 날리므로 targeted update)
    async setPageCount(id, count) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { error } = await c.from('ebook_products')
        .update({ page_count: count }).eq('id', id);
      return { error };
    },
    // 뷰어용 — Edge Function(ebook-page)에서 서명된 PDF URL 을 받는다.
    // { url, entitled, page_count, free_pages } 또는 실패 시 null.
    async getAccess(slug) {
      const c = client(); if (!c) return null;
      const headers = {};
      try {
        const s = await session();
        if (s?.access_token) headers.Authorization = `Bearer ${s.access_token}`;
      } catch (_) {}
      const u = `${url}/functions/v1/ebook-page?slug=${encodeURIComponent(slug)}`;
      try {
        const res = await fetch(u, { headers });
        const data = await res.json().catch(() => null);
        if (!res.ok) return data || null;
        return data;
      } catch (_) { return null; }
    },
    // 결제 검증 — PortOne 결제 후 paymentId 를 Edge Function(ebook-purchase)에 보내
    // 위변조 확인 + 열람권 부여. { ok:true } 또는 { error }.
    async purchaseVerify(slug, paymentId) {
      const c = client(); if (!c) return { error: 'unavailable' };
      const headers = { 'content-type': 'application/json' };
      try {
        const s = await session();
        if (s?.access_token) headers.Authorization = `Bearer ${s.access_token}`;
      } catch (_) {}
      const u = `${url}/functions/v1/ebook-purchase`;
      try {
        const res = await fetch(u, { method: 'POST', headers, body: JSON.stringify({ slug, paymentId }) });
        const data = await res.json().catch(() => null);
        if (!res.ok) return data || { error: 'verify failed' };
        return data;
      } catch (_) { return { error: 'network' }; }
    },
    // 스마트스토어 주문번호 인증 — Edge Function(ebook-redeem)이 커머스 API 로
    // 주문을 확인하고 열람권 부여. { ok:true } 또는 { error, detail }.
    async redeemOrder(slug, orderNo, buyerName, buyerPhone) {
      const c = client(); if (!c) return { error: 'unavailable' };
      const headers = { 'content-type': 'application/json' };
      try {
        const s = await session();
        if (s?.access_token) headers.Authorization = `Bearer ${s.access_token}`;
      } catch (_) {}
      const u = `${url}/functions/v1/ebook-redeem`;
      try {
        const res = await fetch(u, { method: 'POST', headers, body: JSON.stringify({ slug, orderNo, buyerName, buyerPhone }) });
        const data = await res.json().catch(() => null);
        if (!res.ok) return data || { error: 'redeem failed' };
        return data;
      } catch (_) { return { error: 'network' }; }
    },
  };


    return { shop, ebooks };
  }
  window.MagDBCommerce = { create };
})();
