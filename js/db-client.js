// 5ft.mag DB 클라이언트
// supabase-js 인스턴스를 클로저에 감싸서 외부에는 도메인 함수만 노출.
// 외부 사용은 window.MagDB.* 만 — 임의 from/select/update 호출 불가.

(function () {
  'use strict';

  const URL_  = 'https://pucpqsfwqouqohwsvmnd.supabase.co';
  const ANON_ = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';
  const BUCKET = 'reader-submissions';
  const MARKET_BUCKET = 'market-listings';

  const SS_LOGIN_ORIGIN = '5ft_login_origin';
  const LS_LOGIN_ORIGIN = '5ft_login_origin_fallback';

  let _client = null;
  let _originRestoreInstalled = false;
  function client() {
    if (_client) return _client;
    if (!window.supabase) return null;
    _client = window.supabase.createClient(URL_, ANON_, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: window.localStorage,
      },
    });
    installOriginRestore();
    return _client;
  }
  function normalizeReturnUrl(value) {
    try {
      const u = new URL(value || window.location.href.split('#')[0], window.location.origin);
      if (u.origin !== window.location.origin) return window.location.href.split('#')[0];
      u.hash = '';
      return u.href;
    } catch (_) {
      return window.location.href.split('#')[0];
    }
  }

  function saveLoginOrigin(value) {
    const origin = normalizeReturnUrl(value);
    const payload = JSON.stringify({ url: origin, ts: Date.now() });
    try { sessionStorage.setItem(SS_LOGIN_ORIGIN, payload); } catch (_) {}
    // OAuth 제공자/브라우저 조합에 따라 sessionStorage가 사라지는 경우가 있어
    // 같은 origin에서 유지되는 localStorage를 짧은 TTL 백업으로 함께 둔다.
    try { localStorage.setItem(LS_LOGIN_ORIGIN, payload); } catch (_) {}
    return origin;
  }

  function readLoginOrigin() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;
    const read = (storage, key) => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        storage.removeItem(key);
        const parsed = JSON.parse(raw);
        if (!parsed?.url || now - Number(parsed.ts || 0) > maxAge) return null;
        return normalizeReturnUrl(parsed.url);
      } catch (_) {
        return null;
      }
    };
    const fromSession = read(sessionStorage, SS_LOGIN_ORIGIN);
    const fromLocal = read(localStorage, LS_LOGIN_ORIGIN);
    return fromSession || fromLocal;
  }

  // 신규 로그인 콜백을 어디서(예: Supabase Site URL fallback 으로 메인) 받든
  // 사용자가 로그인 시작한 페이지로 자동 복귀.
  function installOriginRestore() {
    if (_originRestoreInstalled || !_client) return;
    _originRestoreInstalled = true;
    _client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN') return;
      const origin = readLoginOrigin();
      if (!origin) return;
      const here = window.location.href.split('#')[0];
      if (origin && origin !== here) {
        window.location.replace(origin);
      }
    });
  }
  client();

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function session() {
    const c = client(); if (!c) return null;
    for (let i = 0; i < 5; i++) {
      const { data } = await c.auth.getSession();
      if (data.session) return data.session;
      if (i < 4) await wait(120);
    }
    return null;
  }
  async function userId() {
    const s = await session();
    return s?.user?.id || null;
  }

  // ─── 인증 ───
  const auth = {
    getSession: session,
    async getUser() {
      const c = client(); if (!c) return null;
      const { data } = await c.auth.getUser();
      return data.user;
    },
    async signInWithGoogle(redirectTo) {
      const c = client(); if (!c) throw new Error('client unavailable');
      // Supabase Redirect URL allowlist가 현재 페이지를 허용하면 바로 복귀하고,
      // Site URL fallback으로 메인에 도착해도 installOriginRestore()가 원래 URL로 돌려보낸다.
      const origin = saveLoginOrigin(redirectTo);
      return c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin } });
    },
    async signOut() {
      const c = client(); if (!c) return;
      return c.auth.signOut();
    },
    onChange(cb) {
      const c = client(); if (!c) return { unsubscribe() {} };
      const { data } = c.auth.onAuthStateChange((event, sess) => cb(event, sess));
      return data?.subscription || { unsubscribe() {} };
    },
  };

  // ─── 프로필 (profiles_public view) ───
  const profiles = {
    async getMine() {
      const c = client(); if (!c) return null;
      const uid = await userId();
      if (!uid) return null;
      const { data } = await c.from('profiles_public')
        .select('display_name, avatar_url, is_editor')
        .eq('user_id', uid)
        .maybeSingle();
      return data || null;
    },
  };

  // ─── 댓글 (read via view, write via base table) ───
  const comments = {
    async list(pageId) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('comments_with_meta')
        .select('*').eq('page_id', pageId).order('created_at', { ascending: true });
      if (error) return [];
      return data || [];
    },
    async insert({ pageId, body, parentId }) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('comments').insert({
        page_id: pageId,
        user_id: uid,
        parent_id: parentId || null,
        body: String(body || '').trim(),
      });
    },
    async update(id, body) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('comments').update({
        body: String(body || '').trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    },
    async softDelete(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    },
  };

  // ─── 좋아요 ───
  const likes = {
    async listMine() {
      const c = client(); if (!c) return new Set();
      const uid = await userId();
      if (!uid) return new Set();
      const { data } = await c.from('likes').select('comment_id').eq('user_id', uid);
      return new Set((data || []).map(r => r.comment_id));
    },
    async add(commentId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('likes').insert({ comment_id: commentId, user_id: uid });
    },
    async remove(commentId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('likes').delete().eq('comment_id', commentId).eq('user_id', uid);
    },
  };

  // ─── 독자 사진 (공개 read view + 본인 INSERT + Storage 업로드) ───
  const submissions = {
    async listApproved(limit = 1000) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('reader_submissions_approved')
        .select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) return [];
      return (data || []).map(r => {
        const sname = r.submitter_name || '';
        const ig    = r.instagram || '';
        const author = sname && ig ? `${sname} (${ig})` : (sname || ig);
        return {
          id: 'sub-' + r.id,
          image: `${URL_}/storage/v1/object/public/${BUCKET}/${r.storage_path}`,
          author,
          submitterName: sname,
          instagram: ig,
          instagramUrl: ig ? `https://instagram.com/${ig.replace(/^@/, '')}` : '',
          film: r.film,
          camera: r.camera,
          caption: r.caption,
          published: true,
          _source: 'submission',
        };
      });
    },
    async create(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('reader_submissions').insert(record);
    },
    async uploadPhoto(path, blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.storage.from(BUCKET).upload(path, blob, {
        contentType: 'image/jpeg', upsert: false,
      });
    },
    async removePhoto(path) {
      const c = client(); if (!c) return;
      try { await c.storage.from(BUCKET).remove([path]); } catch (_) {}
    },
    publicUrl(path) {
      return `${URL_}/storage/v1/object/public/${BUCKET}/${path}`;
    },
    async listMine() {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('reader_submissions')
        .select('*').eq('user_id', uid).order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
    // 승인된 제출 중 주어진 ID 목록만 일괄 조회 (즐겨찾기 사진 뷰용).
    // 공개 view 사용 → 다른 사람의 사진도 같은 RLS 로 안전하게 노출.
    async listByIds(ids) {
      const c = client(); if (!c || !ids?.length) return [];
      const { data, error } = await c.from('reader_submissions_approved')
        .select('*').in('id', ids);
      if (error) return [];
      return data || [];
    },
    async updateMine(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      // 본인 row 만 매칭 — RLS 가 한 번 더 가드, trigger 가 핵심 컬럼 보호
      return c.from('reader_submissions').update(patch).eq('id', id).eq('user_id', uid);
    },
    async deleteMine(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      // .select() 를 체이닝해서 실제로 삭제된 row 가 반환되도록 함.
      // 안 그러면 RLS 가 silently 차단해도 data:null/error:null 로 통과되어
      // storage 파일만 지워지고 DB row 가 남는 orphan(=깨진 썸네일) 발생.
      return c.from('reader_submissions').delete().eq('id', id).eq('user_id', uid).select('id');
    },
  };

  // ─── 편집부 검토 — RLS 가 권한 검증 ───
  const review = {
    async count(status, opts = {}) {
      const c = client(); if (!c) return 0;
      let q = c.from('reader_submissions')
        .select('id', { count: 'exact', head: true }).eq('status', status);
      if (opts.themeOnly) q = q.not('theme_month', 'is', null);
      const { count } = await q;
      return count || 0;
    },
    async list(status, from, to, opts = {}) {
      const c = client(); if (!c) return { data: [], error: { message: 'unavailable' } };
      let q = c.from('reader_submissions').select('*').eq('status', status);
      if (opts.themeOnly) q = q.not('theme_month', 'is', null);
      return q.order('created_at', { ascending: status === 'pending' }).range(from, to);
    },
    async patch(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('reader_submissions').update(patch).eq('id', id);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('reader_submissions').delete().eq('id', id);
    },
  };

  // ─── Market (중고 장터) ───
  const market = {
    storageBaseUrl: `${URL_}/storage/v1/object/public/${MARKET_BUCKET}/`,
    publicUrl(path) {
      return `${URL_}/storage/v1/object/public/${MARKET_BUCKET}/${path}`;
    },
    async list({ category = 'all', limit = 200 } = {}) {
      const c = client(); if (!c) return [];
      let q = c.from('market_listings_public').select('*')
        .order('created_at', { ascending: false }).limit(limit);
      if (category && category !== 'all') q = q.eq('category', category);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    },
    async getOne(id) {
      const c = client(); if (!c) return null;
      const { data } = await c.from('market_listings_public').select('*').eq('id', id).maybeSingle();
      return data || null;
    },
    async listMine() {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('market_listings')
        .select('*').eq('user_id', uid).order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
    async create(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('market_listings').insert({ ...record, user_id: uid, status: 'available' });
    },
    async updateMine(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('market_listings').update(patch).eq('id', id).eq('user_id', uid);
    },
    async cycleStatusMine(id, currentStatus) {
      // available → reserved → sold → available
      const next = currentStatus === 'available' ? 'reserved'
                 : currentStatus === 'reserved' ? 'sold'
                 : 'available';
      const r = await this.updateMine(id, { status: next });
      return { next, error: r.error };
    },
    async deleteMine(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      // .select() — RLS silent block 가드 (submissions.deleteMine 와 동일)
      return c.from('market_listings').delete().eq('id', id).eq('user_id', uid).select('id');
    },
    async uploadPhoto(path, blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.storage.from(MARKET_BUCKET).upload(path, blob, {
        contentType: 'image/jpeg', upsert: false,
      });
    },
    async removePhotos(paths) {
      const c = client(); if (!c || !paths?.length) return;
      try { await c.storage.from(MARKET_BUCKET).remove(paths); } catch (_) {}
    },
    async report(listingId, reason) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('market_reports').insert({
        listing_id: listingId, reporter_id: uid, reason: String(reason || '').trim(),
      });
    },
  };

  // ─── 즐겨찾기 (본인용 · 공개 카운터 없음) ───
  //   target_type: 'submission' (UUID) | 'film' (slug)
  //   target_id  : TEXT — 두 타입 공통 컬럼
  const favorites = {
    async list(targetType) {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      let q = c.from('user_favorites')
        .select('target_type, target_id, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (targetType) q = q.eq('target_type', targetType);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    },
    async idsForType(targetType) {
      const rows = await this.list(targetType);
      return new Set(rows.map(r => r.target_id));
    },
    async add(targetType, targetId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      // PK conflict 무시 — 이미 좋아요한 항목 재클릭도 멱등하게 통과
      return c.from('user_favorites')
        .upsert({ user_id: uid, target_type: targetType, target_id: targetId },
                { onConflict: 'user_id,target_type,target_id', ignoreDuplicates: true });
    },
    async remove(targetType, targetId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('user_favorites').delete()
        .eq('user_id', uid).eq('target_type', targetType).eq('target_id', targetId);
    },
    async toggle(targetType, targetId, currentlyFav) {
      return currentlyFav
        ? this.remove(targetType, targetId)
        : this.add(targetType, targetId);
    },
  };

  // ─── Realtime ───
  const realtime = {
    subscribeComments(pageId, onChange) {
      const c = client(); if (!c) return null;
      return c.channel(`comments-${pageId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'comments', filter: `page_id=eq.${pageId}` },
          () => onChange())
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'likes' },
          () => onChange())
        .subscribe();
    },
  };

  window.MagDB = {
    isReady() { return !!_client; },
    storageBaseUrl: `${URL_}/storage/v1/object/public/${BUCKET}/`,
    auth, profiles, comments, likes, submissions, review, market, favorites, realtime,
  };
})();
