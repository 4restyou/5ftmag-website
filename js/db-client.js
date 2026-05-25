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

  function readLoginOrigin({ remove = true } = {}) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;
    const read = (storage, key) => {
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        if (remove) storage.removeItem(key);
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

  function clearLoginOrigin() {
    try { sessionStorage.removeItem(SS_LOGIN_ORIGIN); } catch (_) {}
    try { localStorage.removeItem(LS_LOGIN_ORIGIN); } catch (_) {}
  }

  // 신규 로그인 콜백을 어디서(예: Supabase Site URL fallback 으로 메인) 받든
  // 사용자가 로그인 시작한 페이지로 자동 복귀.
  function installOriginRestore() {
    if (_originRestoreInstalled || !_client) return;
    _originRestoreInstalled = true;
    async function restoreIfNeeded(event) {
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
      const origin = readLoginOrigin({ remove: false });
      if (!origin) return;
      const here = window.location.href.split('#')[0];
      if (origin && origin !== here) {
        window.location.replace(origin);
        return;
      }
      clearLoginOrigin();
    }
    _client.auth.onAuthStateChange((event) => {
      restoreIfNeeded(event);
    });
    setTimeout(async () => {
      const origin = readLoginOrigin({ remove: false });
      if (!origin) return;
      try {
        const { data } = await _client.auth.getSession();
        if (data?.session) restoreIfNeeded('SIGNED_IN');
      } catch (_) {}
    }, 250);
  }
  client();

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function session() {
    const c = client(); if (!c) return null;
    for (let i = 0; i < 24; i++) {
      const { data } = await c.auth.getSession();
      if (data.session) return data.session;
      if (i < 23) await wait(150);
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
    // ─ 모더레이션(편집부) ─ 페이지 구분 없이 전체 댓글을 최신순으로.
    async adminListAll({ limit = 500 } = {}) {
      const c = client(); if (!c) return { data: [], error: null };
      const { data, error } = await c.from('comments_with_meta')
        .select('*').order('created_at', { ascending: false }).limit(limit);
      return { data: data || [], error };
    },
    async adminRestore(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('comments').update({ deleted_at: null }).eq('id', id);
    },
  };

  // ─── 금칙어(편집부 관리) ───
  const commentFilterTerms = {
    async list() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('comment_filter_terms').select('*').order('term', { ascending: true });
      if (error) return [];
      return data || [];
    },
    async add(term) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      return c.from('comment_filter_terms').insert({ term: String(term || '').trim(), created_by: uid });
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('comment_filter_terms').delete().eq('id', id);
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

  // ─── 뉴스레터 구독 (이메일만 수집) ───
  const newsletter = {
    async subscribe(email) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const clean = String(email || '').trim().toLowerCase();
      if (!clean || clean.length > 200) return { error: { message: 'invalid email' } };
      const { error } = await c.from('newsletter_subscribers').insert({ email: clean, source: 'home' });
      // 23505 = unique_violation → 이미 구독한 이메일. 사용자에겐 성공으로 처리.
      if (error && error.code !== '23505') return { error };
      return { error: null };
    },
  };

  function mapApprovedSubmission(r) {
    const sname = r.submitter_name || '';
    const ig    = r.instagram || '';
    const author = sname && ig ? `${sname} (${ig})` : (sname || ig);
    return {
      id: 'sub-' + r.id,
      image: `/i/reader/${r.storage_path}`,
      author,
      submitterName: sname,
      instagram: ig,
      instagramUrl: ig ? `https://instagram.com/${ig.replace(/^@/, '')}` : '',
      film: r.film,
      camera: r.camera,
      caption: r.caption,
      createdAt: r.created_at,
      created_at: r.created_at,
      published: true,
      _source: 'submission',
    };
  }

  function cleanFilmNames(filmNames) {
    return Array.from(new Set((Array.isArray(filmNames) ? filmNames : [filmNames])
      .map(name => String(name || '').trim())
      .filter(Boolean)))
      .slice(0, 40);
  }

  // ─── 독자 사진 (공개 read view + 본인 INSERT + Storage 업로드) ───
  const submissions = {
    async listApproved(limit = null) {
      const c = client(); if (!c) return [];
      const pageSize = 1000;
      const numericLimit = Number(limit);
      const hasLimit = Number.isFinite(numericLimit) && numericLimit > 0;
      const max = hasLimit ? Math.floor(numericLimit) : Number.POSITIVE_INFINITY;
      const rows = [];
      for (let from = 0; from < max; from += pageSize) {
        const to = Math.min(from + pageSize, max) - 1;
        const { data, error } = await c.from('reader_submissions_approved')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, to);
        if (error) return rows;
        const page = data || [];
        rows.push(...page);
        if (page.length < (to - from + 1)) break;
      }
      return rows.map(mapApprovedSubmission);
    },
    async countApprovedByFilms(filmNames) {
      const c = client(); if (!c) return 0;
      const names = cleanFilmNames(filmNames);
      if (!names.length) return 0;
      const { count, error } = await c.from('reader_submissions_approved')
        .select('id', { count: 'exact', head: true })
        .in('film', names);
      if (error) return 0;
      return Number(count) || 0;
    },
    async listApprovedByFilms(filmNames, opts = {}) {
      const c = client(); if (!c) return [];
      const names = cleanFilmNames(filmNames);
      if (!names.length) return [];
      const from = Math.max(0, Math.floor(Number(opts.from) || 0));
      const to = Math.max(from, Math.floor(Number(opts.to) || from));
      const ascending = opts.ascending !== false;
      const { data, error } = await c.from('reader_submissions_approved')
        .select('*')
        .in('film', names)
        .order('created_at', { ascending })
        .range(from, to);
      if (error) return [];
      return (data || []).map(mapApprovedSubmission);
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
    // TUS resumable 업로드. 약한 모바일 네트워크에서 청크 단위로 전송하고
    // 중간 끊김 시 같은 청크부터 재개 → 90초 timeout 으로 처음부터 다시
    // 올리는 단일 POST 보다 통과율이 훨씬 높음. tus-js-client 가 로드되어
    // window.tus.Upload 로 접근 가능해야 함.
    async uploadPhotoResumable(path, blob, opts = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      if (!window.tus || typeof window.tus.Upload !== 'function') {
        return { error: { message: 'TUS 클라이언트가 로드되지 않았어요. 페이지를 새로고침해 주세요.' } };
      }
      let accessToken = null;
      try {
        const { data } = await c.auth.getSession();
        accessToken = data?.session?.access_token || null;
      } catch (_) {}
      if (!accessToken) return { error: { message: '로그인이 만료되었어요. 다시 로그인한 뒤 시도해 주세요.' } };

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
        const upload = new window.tus.Upload(blob, {
          endpoint: `${URL_}/storage/v1/upload/resumable`,
          retryDelays: [0, 1500, 3500, 8000, 15000],
          headers: {
            authorization: `Bearer ${accessToken}`,
            'x-upsert': 'false',
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024,
          metadata: {
            bucketName: BUCKET,
            objectName: path,
            contentType: blob.type || 'image/jpeg',
            cacheControl: '3600',
          },
          onError(err) {
            const message = err?.message || String(err || '업로드 실패');
            finish({ error: { message: String(message).slice(0, 300) } });
          },
          onProgress(bytesSent, bytesTotal) {
            try { opts.onProgress?.(bytesSent, bytesTotal); } catch (_) {}
          },
          onSuccess() { finish({ error: null }); },
        });
        if (opts.signal) {
          const onAbort = () => {
            try { upload.abort(true); } catch (_) {}
            finish({ error: { message: '업로드가 중단되었어요.' } });
          };
          if (opts.signal.aborted) { onAbort(); return; }
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        Promise.resolve(upload.findPreviousUploads()).then((prev) => {
          if (prev && prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        }).catch(() => upload.start());
      });
    },
    async removePhoto(path) {
      const c = client(); if (!c) return;
      try { await c.storage.from(BUCKET).remove([path]); } catch (_) {}
    },
    publicUrl(path) {
      return `/i/reader/${path}`;
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
    // 편집부 전용 — 사진 좋아요 수 집계 (개인정보 노출 X)
    // RPC SECURITY DEFINER 함수가 caller 의 is_editor 검사
    async adminLikeCounts() {
      const c = client(); if (!c) return new Map();
      const { data, error } = await c.rpc('admin_submission_like_counts');
      if (error) {
        console.warn('[admin] like counts:', error.message);
        return new Map();
      }
      return new Map((data || []).map(r => [String(r.target_id), Number(r.like_count) || 0]));
    },
    // 좋아요 순 정렬용 — 페이지네이션 무시하고 status 안의 모든 row 일괄 조회
    //   (5ft.mag 규모에서 approved 가 10k 넘어가기 전엔 한 페이지로 충분)
    async listAll(status, opts = {}) {
      const c = client(); if (!c) return { data: [], error: { message: 'unavailable' } };
      let q = c.from('reader_submissions').select('*').eq('status', status);
      if (opts.themeOnly) q = q.not('theme_month', 'is', null);
      return q.order('created_at', { ascending: false }).limit(2000);
    },
  };

  // ─── Market (중고 장터) ───
  const market = {
    storageBaseUrl: `/i/market/`,
    publicUrl(path) {
      return `/i/market/${path}`;
    },
    async list({ category = 'all', limit = 200 } = {}) {
      const c = client(); if (!c) return [];
      let q = c.from('market_listings_public').select('*')
        .order('created_at', { ascending: false }).limit(limit);
      if (category && category !== 'all') q = q.eq('category', category);
      const { data, error } = await q;
      if (error) { console.warn('[market.list]', error.message); return []; }
      return data || [];
    },
    async getOne(id) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('market_listings_public').select('*').eq('id', id).maybeSingle();
      if (error) console.warn('[market.getOne]', error.message);
      if (!data) return null;
      // 로그인 상태면 판매자 연락정보 RPC 로 보강
      const uid = await userId();
      if (uid) {
        const { data: pii } = await c.rpc('market_listing_contact', { p_listing_id: id });
        if (pii && pii.length) {
          data.seller_name = pii[0].seller_name;
          data.phone       = pii[0].phone;
          data.contact     = pii[0].contact;
        }
      }
      return data;
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

    // ─── 편집부 전용 — RLS 가 권한 가드 ───
    async adminGetListing(id) {
      // base 테이블에서 직접 조회 — hidden 포함, RLS 가 편집부만 허용
      const c = client(); if (!c) return null;
      const { data } = await c.from('market_listings').select('*').eq('id', id).maybeSingle();
      if (!data) return null;
      // profiles 조인 (display_name 보강) — 간단히 별도 조회
      const { data: prof } = await c.from('profiles_public').select('display_name')
        .eq('user_id', data.user_id).maybeSingle();
      return { ...data, display_name: prof?.display_name || null };
    },
    async adminReportCount(status = 'pending') {
      const c = client(); if (!c) return 0;
      const { count } = await c.from('market_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      return count || 0;
    },
    async adminListReports(status, from, to) {
      const c = client(); if (!c) return { data: [], error: { message: 'unavailable' } };
      let q = c.from('market_reports')
        .select('id, listing_id, reporter_id, reason, status, resolved_at, resolved_by, resolver_note, created_at');
      if (status) q = q.eq('status', status);
      return q.order('created_at', { ascending: false }).range(from, to);
    },
    async adminPatchReport(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      const merged = { ...patch };
      if (patch.status && patch.status !== 'pending') {
        merged.resolved_at = new Date().toISOString();
        merged.resolved_by = uid;
      } else if (patch.status === 'pending') {
        merged.resolved_at = null;
        merged.resolved_by = null;
      }
      return c.from('market_reports').update(merged).eq('id', id).select('id');
    },
    async adminHideListing(listingId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('market_listings').update({ status: 'hidden' }).eq('id', listingId).select('id');
    },
    async adminUnhideListing(listingId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('market_listings').update({ status: 'available' }).eq('id', listingId).select('id');
    },
    async adminDeleteListing(listingId) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      // 매물 row 조회 → storage_paths 회수 → DB 삭제 → storage 삭제
      const { data: row } = await c.from('market_listings').select('storage_paths').eq('id', listingId).maybeSingle();
      const { data, error } = await c.from('market_listings').delete().eq('id', listingId).select('id');
      if (error || !data?.length) return { error: error || { message: '삭제 거부됨 (편집부 권한 확인)' } };
      if (row?.storage_paths?.length) {
        try { await c.storage.from(MARKET_BUCKET).remove(row.storage_paths); } catch (_) {}
      }
      return { data };
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

  // ─── 사용자 알림 (in-app) ───
  const notifications = {
    async list({ limit = 30, unreadOnly = false } = {}) {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      let q = c.from('user_notifications').select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (unreadOnly) q = q.is('read_at', null);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    },
    async unreadCount() {
      const c = client(); if (!c) return 0;
      const uid = await userId();
      if (!uid) return 0;
      const { count } = await c.from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .is('read_at', null);
      return count || 0;
    },
    async markRead(ids) {
      const c = client(); if (!c || !ids?.length) return { error: null };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', uid)
        .is('read_at', null);
    },
    async markAllRead() {
      const c = client(); if (!c) return { error: null };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', uid)
        .is('read_at', null);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('user_notifications').delete().eq('id', id).eq('user_id', uid);
    },
  };

  // ─── 카메라 브랜드 오버라이드 (편집부가 사이트에서 직접 보강) ───
  const cameraOverrides = {
    async list() {
      const c = client(); if (!c) return new Map();
      const { data, error } = await c.from('camera_brand_overrides').select('*');
      if (error) { console.warn('[cameraOverrides.list]', error.message); return new Map(); }
      const map = new Map();
      for (const row of (data || [])) {
        map.set(row.model_key, {
          brand: row.brand,
          display: row.display,
          note: row.note,
          alias_of: row.alias_of || null,
        });
      }
      return map;
    },
    async upsert({ model_key, brand, display, note, alias_of }) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required' } };
      return c.from('camera_brand_overrides').upsert({
        model_key: String(model_key || '').trim(),
        brand: String(brand || '').trim(),
        display: display ? String(display).trim() : null,
        note: note ? String(note).trim() : null,
        alias_of: alias_of ? String(alias_of).trim() : null,
        created_by: uid,
      });
    },
    async remove(modelKey) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('camera_brand_overrides').delete().eq('model_key', modelKey);
    },
  };

  // ─── 통계 (편집부 전용 — 모든 RPC 내부에서 is_editor 검사) ───
  async function fallbackUploadsTop(field, { days = null, limit = 10 } = {}) {
    const c = client(); if (!c) return [];
    const col = field === 'camera' ? 'camera' : 'film';
    const since = days ? new Date(Date.now() - Number(days) * 86400000).toISOString() : null;
    let rows = [];

    let q = c.from('reader_submissions')
      .select(`${col}, status, created_at`)
      .not(col, 'is', null)
      .limit(5000);
    if (since) q = q.gte('created_at', since);
    const primary = await q;

    if (primary.error) {
      let publicQ = c.from('reader_submissions_approved')
        .select(`${col}, created_at`)
        .not(col, 'is', null)
        .limit(5000);
      if (since) publicQ = publicQ.gte('created_at', since);
      const fallback = await publicQ;
      if (fallback.error) {
        console.warn(`[analytics.fallbackUploadsTop.${col}]`, fallback.error.message);
        return [];
      }
      rows = (fallback.data || []).map(r => ({ ...r, status: 'approved' }));
    } else {
      rows = primary.data || [];
    }

    const grouped = new Map();
    for (const row of rows) {
      const key = String(row[col] || '').trim();
      if (!key) continue;
      const cur = grouped.get(key) || { [col]: key, uploads: 0, approved: 0 };
      cur.uploads += 1;
      if (row.status === 'approved') cur.approved += 1;
      grouped.set(key, cur);
    }
    return [...grouped.values()]
      .sort((a, b) => (b.uploads - a.uploads) || (b.approved - a.approved) || String(a[col]).localeCompare(String(b[col]), 'ko'))
      .slice(0, limit);
  }

  const analytics = {
    async summary() {
      const c = client(); if (!c) return null;
      const { data, error } = await c.rpc('admin_analytics_summary');
      if (error) { console.warn('[analytics.summary]', error.message); return null; }
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    async daily(days = 30) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_daily', { p_days: days });
      if (error) { console.warn('[analytics.daily]', error.message); return []; }
      return data || [];
    },
    async topPaths(days = 7, limit = 20) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_top_paths', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.topPaths]', error.message); return []; }
      return data || [];
    },
    async referrers(days = 7, limit = 20) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_referrers', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.referrers]', error.message); return []; }
      return data || [];
    },
    async regions(days = 7, limit = 20) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_regions', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.regions]', error.message); return []; }
      return data || [];
    },
    async languages(days = 7, limit = 20) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_languages', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.languages]', error.message); return []; }
      return data || [];
    },
    async dwellSummary(days = 30) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.rpc('admin_analytics_dwell_summary', { p_days: days });
      if (error) { console.warn('[analytics.dwellSummary]', error.message); return null; }
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    async dwellByPath(days = 7, limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_analytics_dwell_by_path', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.dwellByPath]', error.message); return []; }
      return data || [];
    },
    async sessionStats(days = 30) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.rpc('admin_analytics_session_stats', { p_days: days });
      if (error) { console.warn('[analytics.sessionStats]', error.message); return null; }
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    async uploadsSummary() {
      const c = client(); if (!c) return null;
      const { data, error } = await c.rpc('admin_uploads_summary');
      if (error) { console.warn('[analytics.uploadsSummary]', error.message); return null; }
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    async uploadsDaily(days = 30) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_daily', { p_days: days });
      if (error) { console.warn('[analytics.uploadsDaily]', error.message); return []; }
      return data || [];
    },
    async uploadsTopContributors(days = 30, limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_top_contributors', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.uploadsTopContributors]', error.message); return []; }
      return data || [];
    },
    async uploadsTopFilms(days = 30, limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_top_films', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.uploadsTopFilms]', error.message); return fallbackUploadsTop('film', { days, limit }); }
      return data?.length ? data : fallbackUploadsTop('film', { days, limit });
    },
    async uploadsTopFilmsAll(limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_top_films_all', { p_limit: limit });
      if (error) { console.warn('[analytics.uploadsTopFilmsAll]', error.message); return fallbackUploadsTop('film', { limit }); }
      return data?.length ? data : fallbackUploadsTop('film', { limit });
    },
    async uploadsTopCameras(days = 30, limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_top_cameras', { p_days: days, p_limit: limit });
      if (error) { console.warn('[analytics.uploadsTopCameras]', error.message); return fallbackUploadsTop('camera', { days, limit }); }
      return data?.length ? data : fallbackUploadsTop('camera', { days, limit });
    },
    async uploadsTopCamerasAll(limit = 10) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_uploads_top_cameras_all', { p_limit: limit });
      if (error) { console.warn('[analytics.uploadsTopCamerasAll]', error.message); return fallbackUploadsTop('camera', { limit }); }
      return data?.length ? data : fallbackUploadsTop('camera', { limit });
    },
    async uploadsThemeRatio(days = 30) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.rpc('admin_uploads_theme_ratio', { p_days: days });
      if (error) { console.warn('[analytics.uploadsThemeRatio]', error.message); return null; }
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    async clientErrorsRecent(hours = 24, limit = 20) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.rpc('admin_client_errors_recent', { p_hours: hours, p_limit: limit });
      if (error) { console.warn('[analytics.clientErrorsRecent]', error.message); return []; }
      return data || [];
    },
    async clientErrorsPurge(keepDays = 30) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const { data, error } = await c.rpc('admin_client_errors_purge', { p_keep_days: keepDays });
      if (error) { console.warn('[analytics.clientErrorsPurge]', error.message); return { error }; }
      return { deleted: Number(data) || 0 };
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
    async subscribeNotifications(onChange) {
      const c = client(); if (!c) return null;
      const uid = await userId();
      if (!uid) return null;
      return c.channel(`user-notifications-${uid}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${uid}` },
          (payload) => onChange(payload.new))
        .subscribe();
    },
  };

  // ─── 필름 카탈로그 (films 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE
  // JSONB 필드(aliases / photographers / photos) 는 JS 객체 그대로.
  const films = {
    async list() {
      const c = client(); if (!c) return [];
      // 공개 카탈로그용 — is_hidden = true 는 제외
      const { data, error } = await c.from('films')
        .select('*')
        .eq('is_hidden', false)
        .order('brand', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[films.list]', error.message); return []; }
      return data || [];
    },
    // admin 용 — 숨김 포함 전체. listAsObject 와 같이 키 변환 안 함.
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('films')
        .select('*')
        .order('brand', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[films.listAll]', error.message); return []; }
      return data || [];
    },
    // 기존 films.json 형태 (key=slug 인 object) 로 변환해서 반환.
    // films-page.js 등 기존 코드가 그대로 사용 가능.
    async listAsObject() {
      const rows = await this.list();
      const out = {};
      for (const r of rows) {
        if (!r.slug) continue;
        const entry = {
          slug: r.slug,
          tier: r.tier || 'library',
          brand: r.brand || '',
          name: r.name || '',
          displayName: r.display_name || `${r.brand || ''} ${r.name || ''}`.trim(),
          aliases: Array.isArray(r.aliases) ? r.aliases : [],
          desc: r.description || '',
          iso: r.iso || '',
          type: r.type || '',
          format: r.format || '',
          photographers: Array.isArray(r.photographers) ? r.photographers : [],
          photos: Array.isArray(r.photos) ? r.photos : [],
        };
        if (r.issue)                entry.issue = r.issue;
        if (r.box_thumbnail)        entry.boxThumbnail = r.box_thumbnail;
        if (r.box_thumbnail_status) entry.boxThumbnailStatus = r.box_thumbnail_status;
        if (r.can_thumbnail)        entry.canThumbnail = r.can_thumbnail;
        if (r.can_thumbnail_status) entry.canThumbnailStatus = r.can_thumbnail_status;
        out[r.slug] = entry;
      }
      return out;
    },
    async get(slug) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('films')
        .select('*').eq('slug', slug).maybeSingle();
      if (error) { console.warn('[films.get]', error.message); return null; }
      return data || null;
    },
    async upsert(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const payload = {
        slug:                  record.slug,
        tier:                  record.tier || 'library',
        brand:                 record.brand || '',
        name:                  record.name || '',
        display_name:          record.display_name || record.displayName || null,
        aliases:               record.aliases || [],
        description:           record.description ?? record.desc ?? null,
        iso:                   record.iso || null,
        type:                  record.type || null,
        format:                record.format || null,
        issue:                 record.issue || null,
        photographers:         record.photographers || [],
        photos:                record.photos || [],
        box_thumbnail:         record.box_thumbnail || record.boxThumbnail || null,
        box_thumbnail_status:  record.box_thumbnail_status || record.boxThumbnailStatus || 'pending',
        can_thumbnail:         record.can_thumbnail || record.canThumbnail || null,
        can_thumbnail_status:  record.can_thumbnail_status || record.canThumbnailStatus || 'pending',
        is_hidden:             typeof record.is_hidden === 'boolean' ? record.is_hidden
                                : (typeof record.isHidden === 'boolean' ? record.isHidden : false),
      };
      return c.from('films').upsert(payload, { onConflict: 'slug' });
    },
    async setHidden(slug, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('films').update({ is_hidden: !!hidden }).eq('slug', slug);
    },
    async remove(slug) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('films').delete().eq('slug', slug);
    },
  };

  // ─── 현상소 카탈로그 (labs 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE. prices 는 JSONB(객체 그대로).
  const labs = {
    async list() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('labs')
        .select('*').eq('is_hidden', false)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[labs.list]', error.message); return []; }
      return data || [];
    },
    // admin 용 — 숨김 포함 전체
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('labs')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[labs.listAll]', error.message); return []; }
      return data || [];
    },
    async get(id) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('labs').select('*').eq('id', id).maybeSingle();
      if (error) { console.warn('[labs.get]', error.message); return null; }
      return data || null;
    },
    async upsert(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const payload = {
        name:      (record.name || '').trim(),
        region:    record.region ?? null,
        address:   record.address ?? null,
        lat:       record.lat ?? null,
        lng:       record.lng ?? null,
        scan_res:  record.scan_res ?? record.scanRes ?? null,
        features:  record.features ?? null,
        url:       record.url ?? null,
        prices:    record.prices || {},
        is_hidden: typeof record.is_hidden === 'boolean' ? record.is_hidden
                    : (typeof record.isHidden === 'boolean' ? record.isHidden : false),
      };
      if (record.id) payload.id = record.id;
      if (record.sort_order != null) payload.sort_order = record.sort_order;
      return c.from('labs').upsert(payload);
    },
    async setHidden(id, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('labs').update({ is_hidden: !!hidden }).eq('id', id);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('labs').delete().eq('id', id);
    },
  };

  // ─── 수리실 (repair_shops 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE. 좌표 미저장(주소 지오코딩).
  const repairs = {
    async list() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('repair_shops')
        .select('*').eq('is_hidden', false)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[repairs.list]', error.message); return []; }
      return data || [];
    },
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('repair_shops')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { console.warn('[repairs.listAll]', error.message); return []; }
      return data || [];
    },
    async upsert(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      const payload = {
        name:        (record.name || '').trim(),
        region:      record.region ?? null,
        address:     record.address ?? null,
        specialty:   record.specialty ?? null,
        description: record.description ?? null,
        url:         record.url ?? null,
        contact:     record.contact ?? null,
        is_hidden:   typeof record.is_hidden === 'boolean' ? record.is_hidden : false,
      };
      if (record.id) payload.id = record.id;
      if (record.sort_order != null) payload.sort_order = record.sort_order;
      return c.from('repair_shops').upsert(payload);
    },
    async setHidden(id, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('repair_shops').update({ is_hidden: !!hidden }).eq('id', id);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable' } };
      return c.from('repair_shops').delete().eq('id', id);
    },
  };

  window.MagDB = {
    isReady() { return !!_client; },
    storageBaseUrl: `/i/reader/`,
    auth, profiles, comments, commentFilterTerms, likes, submissions, review, market, favorites, notifications, cameraOverrides, analytics, realtime, films, labs, repairs, newsletter,
  };
})();
