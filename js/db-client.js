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
  let _resumeInstalled = false;

  // /admin/ 페이지 여부. 관리 화면은 토큰 유효시간 내의 짧은 편집 세션이라
  // 자동 갱신이 필요 없고, 자동 갱신을 끄면 아래 데드락 자체가 사라진다.
  const IS_ADMIN_PAGE = /\/admin\//.test(location.pathname);

  // 인증 토큰 접근 직렬화 락. supabase 기본값(navigator.locks)이 iOS 인앱
  // 브라우저 등에서 두 번째 인증 요청을 데드락시키는 사례가 있어(=저장 한 번
  // 뒤 다음 저장이 멈춤), 메모리 프라미스 체인으로 직렬화하는 락으로 대체한다.
  // 추가로, fn 이 (멈춘 네트워크 refresh 등으로) 영영 끝나지 않아도 다음 대기자가
  // 영구히 막히지 않도록 일정 시간 뒤 체인을 강제로 진행시키는 self-heal 을 둔다.
  let _authLockChain = Promise.resolve();
  function authLock(_name, _acquireTimeout, fn) {
    const run = _authLockChain.then(() => fn(), () => fn());
    _authLockChain = new Promise((resolve) => {
      const timer = setTimeout(resolve, 12000);
      const release = () => { clearTimeout(timer); resolve(); };
      run.then(release, release);
    });
    return run;
  }

  function client() {
    if (_client) return _client;
    if (!window.supabase) return null;
    _client = window.supabase.createClient(URL_, ANON_, {
      auth: {
        persistSession: true,
        // 관리 화면에서는 자동 토큰 갱신 타이머를 끈다. iOS/인앱 등에서 백그라운드
        // refresh 요청이 멈추면 gotrue 내부 인증 락이 영구 점유돼(첫 저장 뒤
        // 다음 저장이 멈춤) 이후 쓰기가 모두 막히기 때문. 공개 페이지는 유지.
        autoRefreshToken: !IS_ADMIN_PAGE,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: window.localStorage,
        lock: authLock,
      },
    });
    installOriginRestore();
    installVisibilityResume();
    return _client;
  }

  // iOS/모바일에서 다른 앱·탭에 다녀온 뒤 돌아오면, 백그라운드 동안 멈췄던
  // 인증 요청·타이머가 클라이언트를 wedge 시켜 이후 저장·로드가 모두 멈추는
  // 사례가 있다. 복귀 시점에 인증 락 체인을 풀고(다음 호출이 막히지 않게)
  // 자동 갱신을 다시 돌리며 토큰을 미리 갱신해, 다음 사용자 동작이 깨끗한
  // 상태에서 시작하도록 한다.
  function installVisibilityResume() {
    if (_resumeInstalled) return;
    _resumeInstalled = true;
    const onShow = () => {
      _authLockChain = Promise.resolve();
      if (!IS_ADMIN_PAGE) { try { _client?.auth?.startAutoRefresh?.(); } catch (_) {} }
      // 네트워크가 살아있는 지금 토큰을 선갱신(가드 포함, 결과 무시).
      try { withTimeout(_client.auth.getSession(), 7000, 'resume').catch(() => {}); } catch (_) {}
    };
    const onHide = () => {
      if (!IS_ADMIN_PAGE) { try { _client?.auth?.stopAutoRefresh?.(); } catch (_) {} }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onShow(); else onHide();
    });
    // iOS bfcache 복귀 (visibilitychange 가 안 오는 경우 대비)
    window.addEventListener('pageshow', (e) => { if (e.persisted) onShow(); });
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

  // 인증 네트워크 호출이 (백그라운드 복귀 등으로) 영영 안 끝날 때를 대비한 가드.
  // ms 안에 안 끝나면 거부해 상위에서 빠르게 재시도/에러표시 할 수 있게 한다.
  function withTimeout(promise, ms, label) {
    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error((label || 'auth') + ' timeout')), ms);
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
  }

  async function session() {
    const c = client(); if (!c) return null;
    for (let i = 0; i < 24; i++) {
      let data;
      try {
        ({ data } = await withTimeout(c.auth.getSession(), 7000, 'getSession'));
      } catch (_) {
        // 멈춘 인증 호출 — 무한 대기 대신 빠르게 포기 (resume 복구 + 재시도로 회복)
        return null;
      }
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
      try {
        const { data } = await withTimeout(c.auth.getUser(), 7000, 'getUser');
        return data.user;
      } catch (_) {
        return null;
      }
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
      // select('*') — bio 컬럼 마이그레이션이 배포보다 늦게 적용돼도 에러 없이
      // 있는 컬럼만 돌려받게 한다(뷰는 안전 컬럼만 노출). getMine 은 헤더 이름에도
      // 쓰이므로 특정 컬럼 결합으로 깨지면 안 됨.
      const { data } = await c.from('profiles_public')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();
      return data || null;
    },
    // 본인 프로필 수정 (표시 이름 · 아바타 URL · 자기소개).
    // RLS profiles_update_own 이 본인 행만 통과시키고, is_editor/user_id 는
    // profiles_privilege_guard 트리거가 막으므로 안전한 컬럼만 넘긴다.
    async updateMine(patch = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'not-signed-in' } };
      const fields = {};
      if (typeof patch.display_name === 'string') fields.display_name = patch.display_name.trim();
      if (typeof patch.bio === 'string')          fields.bio = patch.bio.trim();
      if (typeof patch.avatar_url === 'string')   fields.avatar_url = patch.avatar_url;
      if (Object.keys(fields).length === 0) return { error: { message: 'no-fields' } };
      fields.updated_at = new Date().toISOString();
      return c.from('profiles').update(fields).eq('user_id', uid);
    },
    // 아바타 이미지를 avatars 버킷의 본인 폴더에 올리고 public URL 을 돌려준다.
    async uploadAvatar(blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'not-signed-in' } };
      const ext = (blob.type && blob.type.includes('png')) ? 'png'
        : (blob.type && blob.type.includes('webp')) ? 'webp' : 'jpg';
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const up = await c.storage.from('user-avatars').upload(path, blob, {
        contentType: blob.type || 'image/jpeg', upsert: false,
      });
      if (up.error) return { error: up.error };
      const { data } = c.storage.from('user-avatars').getPublicUrl(path);
      return { url: data?.publicUrl || null, path };
    },
    // 이전 아바타 파일 정리(본인 폴더). 실패해도 무시.
    async removeAvatarByUrl(url) {
      const c = client(); if (!c || !url) return;
      const marker = '/user-avatars/';
      const i = url.indexOf(marker);
      if (i === -1) return;
      const path = url.slice(i + marker.length).split('?')[0];
      try { const { error } = await c.storage.from('user-avatars').remove([path]); if (error) console.warn('[storage.remove] user-avatars', error.message || error); } catch (e) { console.warn('[storage.remove] user-avatars', e); }
    },
  };

  // ─── 댓글 (read via view, write via base table) ───
  const comments = {
    // 상한을 둔다 — 인기 글의 댓글은 무한히 쌓일 수 있고, 전량 로드는 페이로드와
    // 렌더 비용이 선형으로 증가한다. 넘치면 limit 을 올려 호출한다.
    async list(pageId, { limit = 300 } = {}) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('comments_with_meta')
        .select('*').eq('page_id', pageId)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) return [];
      return data || [];
    },
    async insert({ pageId, body, parentId }) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('comments').insert({
        page_id: pageId,
        user_id: uid,
        parent_id: parentId || null,
        body: String(body || '').trim(),
      });
    },
    // 본인이 쓴 댓글 목록(삭제 안 된 것). 마이페이지의 "내 댓글" 탭에서 사용.
    async listByUser({ limit = 50 } = {}) {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('comments').select('*')
        .eq('user_id', uid)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return [];
      return data || [];
    },
    async update(id, body) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('comments').update({
        body: String(body || '').trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    },
    async softDelete(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('likes').insert({ comment_id: commentId, user_id: uid });
    },
    async remove(commentId) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('likes').delete().eq('comment_id', commentId).eq('user_id', uid);
    },
  };

  // ─── 뉴스레터 구독 (이메일만 수집) ───
  const newsletter = {
    async subscribe(email) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const clean = String(email || '').trim().toLowerCase();
      if (!clean || clean.length > 200) return { error: { message: 'invalid email' } };
      // 직접 INSERT 는 막혀 있다(20261002000004). 정의자 권한 RPC 가 형식을 검사하고 중복이어도 같은 결과를 돌려준다.
      const { error } = await c.rpc('newsletter_subscribe', { p_email: clean });
      return { error: error || null };
    },
    // 토큰으로 해지. 운영자가 새 이슈 메일에 unsubscribe.html?token=... 형태로 박는다.
    // SECURITY DEFINER 함수가 RLS 를 우회하며 정확히 일치하는 row 하나만 삭제.
    async unsubscribe(token) {
      const c = client(); if (!c) return { ok: false, error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const t = String(token || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
        return { ok: false, error: { message: 'invalid token' } };
      }
      const { data, error } = await c.rpc('newsletter_unsubscribe', { p_token: t });
      if (error) return { ok: false, error };
      return { ok: !!data };
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
      featuredAt: r.featured_at || '',
      featuredNote: r.featured_note || '',
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

  // 오류 객체에는 화면이 문구를 고를 수 있게 짧은 code 를 붙인다(AUTH_EXPIRED·NETWORK·RLS_DENIED 등).
  // 문구는 js/util.js 의 MagUtil.errorMessage 가 언어별로 고른다. message 는 원문(한국어 기본값·서버 응답).
  function codeForStatus(status) {
    if (status === 401) return 'AUTH_EXPIRED';
    if (status === 403) return 'RLS_DENIED';
    if (status === 413) return 'FILE_TOO_LARGE';
    if (status === 415) return 'UNSUPPORTED_TYPE';
    if (status >= 500) return 'UNAVAILABLE';
    return undefined;
  }

  // storage-js의 upload 옵션은 AbortSignal을 전달하지 않아 이 경로만 fetch를 사용한다.
  async function readerStorageRequest(method, path, blob, opts) {
    const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
    try {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { data } = await withTimeout(c.auth.getSession(), 7000, 'getSession');
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const session = data?.session;
      if (!session?.access_token || !path.startsWith(session.user.id + '/')) {
        return { error: { message: '로그인이 만료되었어요. 다시 로그인한 뒤 시도해 주세요.', status: 401, code: 'AUTH_EXPIRED' } };
      }
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      let body;
      if (blob) {
        body = new FormData();
        body.append('cacheControl', '3600');
        body.append('', blob);
      }
      const response = await fetch(`${URL_}/storage/v1/object/${method === 'HEAD' ? 'authenticated/' : ''}${BUCKET}/${encoded}`, {
        method,
        signal: opts.signal,
        cache: 'no-store',
        headers: { apikey: ANON_, authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
        ...(body ? { body } : {}),
      });
      if (!response.ok) {
        const detail = method === 'HEAD' ? {} : await response.json().catch(() => ({}));
        const status = Number(detail.statusCode) || response.status;
        return { error: { message: detail.message || detail.error || `HTTP ${response.status}`, status, code: codeForStatus(status) } };
      }
      const length = response.headers.get('content-length');
      return { error: null, bytes: length == null ? null : Number(length) };
    } catch (error) {
      return { error: { message: error.message, code: error.name === 'AbortError' ? 'ABORTED' : 'NETWORK' } };
    }
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
    // 이주의 사진 — 오늘 기준으로 가장 최근에 선정된 사진 하나.
    // "이번 주에 올라온" 이 아니라 "이번 주에 선정된" 이라, created_at 이 아니라
    // featured_at 으로 찾는다. 미래 날짜로 예약해 둔 것은 그 날이 되어야 걸린다.
    async featuredCurrent() {
      const c = client(); if (!c) return null;
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await c.from('reader_submissions_approved')
        .select('*')
        .not('featured_at', 'is', null)
        .lte('featured_at', today)
        .order('featured_at', { ascending: false })
        .limit(1);
      if (error || !data?.length) return null;
      return mapApprovedSubmission(data[0]);
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
    async findOwn(record, opts = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      let query = c.from('reader_submissions').select('id')
        .eq('id', record.id).eq('user_id', record.user_id).eq('storage_path', record.storage_path).maybeSingle();
      if (opts.signal) query = query.abortSignal(opts.signal);
      return query;
    },
    async create(record, opts = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      if (record.id) {
        const existing = await submissions.findOwn(record, opts);
        if (existing.error || existing.data) return existing;
      }
      let query = c.from('reader_submissions').insert(record);
      if (opts.signal) query = query.abortSignal(opts.signal);
      const result = await query;
      if (result.error?.code === '23505' && record.id && !opts.signal?.aborted) {
        const existing = await submissions.findOwn(record, opts);
        if (existing.data && !existing.error) return existing;
      }
      return result;
    },
    async uploadPhoto(path, blob, opts = {}) {
      return readerStorageRequest('POST', path, blob, opts);
    },
    async photoExists(path, bytes, opts = {}) {
      const result = await readerStorageRequest('HEAD', path, null, opts);
      // 고유 UUID 경로의 HEAD 성공 자체가 저장 완료 증거다. 브라우저 CORS가
      // Content-Length를 숨긴 경우에는 크기 비교 없이 복구한다.
      return { exists: !result.error && (result.bytes == null || result.bytes === bytes), error: result.error };
    },
    // TUS resumable 업로드. 약한 모바일 네트워크에서 서버가 받은 위치부터
    // 이어 보낼 수 있어 단일 POST보다 복구가 쉽다. tus-js-client가 로드되어
    // window.tus.Upload 로 접근 가능해야 함.
    async uploadPhotoResumable(path, blob, opts = {}) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      if (!window.tus || typeof window.tus.Upload !== 'function') {
        return { error: { message: 'TUS 클라이언트가 로드되지 않았어요. 페이지를 새로고침해 주세요.', code: 'UPLOAD_TOOL' } };
      }
      let accessToken = null;
      try {
        const { data } = await withTimeout(c.auth.getSession(), 7000, 'getSession');
        accessToken = data?.session?.access_token || null;
      } catch (_) {}
      if (!accessToken) return { error: { message: '로그인이 만료되었어요. 다시 로그인한 뒤 시도해 주세요.', code: 'AUTH_EXPIRED' } };
      if (opts.signal?.aborted) return { error: { message: '업로드가 중단되었어요.', code: 'ABORTED' } };

      return new Promise((resolve) => {
        let settled = false;
        let onAbort;
        const finish = (result) => {
          if (!settled) {
            settled = true;
            if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
            resolve(result);
          }
        };
        const upload = new window.tus.Upload(blob, {
          endpoint: `${URL_}/storage/v1/upload/resumable`,
          retryDelays: [0, 1500, 3500, 8000, 15000],
          onShouldRetry(err) {
            const status = err?.originalResponse?.getStatus?.() || 0;
            return !opts.signal?.aborted && (!status || status === 408 || status === 429 || status >= 500);
          },
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
          fingerprint: async () => `reader:${BUCKET}:${path}:${blob.size}`,
          onError(err) {
            const message = err?.message || String(err || '업로드 실패');
            const status = err?.originalResponse?.getStatus?.();
            finish({ error: { message: String(message).slice(0, 300), status, code: status ? codeForStatus(status) : 'NETWORK' } });
          },
          onProgress(bytesSent, bytesTotal) {
            if (!settled && !opts.signal?.aborted) { try { opts.onProgress?.(bytesSent, bytesTotal); } catch (_) {} }
          },
          onSuccess() { finish({ error: null }); },
        });
        if (opts.signal) {
          onAbort = () => {
            // 네트워크 DELETE 완료를 기다리지 않고 로컬 전송/재시도부터 중단한다.
            try { Promise.resolve(upload.abort()).catch(() => {}); } catch (_) {}
            finish({ error: { message: '업로드가 중단되었어요.', code: 'ABORTED' } });
          };
          if (opts.signal.aborted) { onAbort(); return; }
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        Promise.resolve(upload.findPreviousUploads()).then((prev) => {
          if (settled || opts.signal?.aborted) return;
          if (prev && prev.length) upload.resumeFromPreviousUpload(prev[0]);
          upload.start();
        }).catch(() => { if (!settled && !opts.signal?.aborted) upload.start(); });
      });
    },
    async removePhoto(path) {
      const c = client(); if (!c) return;
      try { const { error } = await c.storage.from(BUCKET).remove([path]); if (error) console.warn('[storage.remove]', BUCKET, error.message || error); } catch (e) { console.warn('[storage.remove]', BUCKET, e); }
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      // 본인 row 만 매칭 — RLS 가 한 번 더 가드, trigger 가 핵심 컬럼 보호
      return c.from('reader_submissions').update(patch).eq('id', id).eq('user_id', uid);
    },
    async deleteMine(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      // .select() 를 체이닝해서 실제로 삭제된 row 가 반환되도록 함.
      // 안 그러면 RLS 가 silently 차단해도 data:null/error:null 로 통과되어
      // storage 파일만 지워지고 DB row 가 남는 orphan(=깨진 썸네일) 발생.
      return c.from('reader_submissions').delete().eq('id', id).eq('user_id', uid).select('id');
    },
  };

  // ─── 편집부 검토 — RLS 가 권한 검증 ───
  const review = {
    async patch(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('reader_submissions').update(patch).eq('id', id);
    },
    // ── 이주의 사진 (편집부) ──
    // 선정은 승인된 사진이면 무엇이든 가능하다. 좋아요 수는 고를 때 참고하는
    // 값일 뿐 조건이 아니다. 좋아요를 안 누르는 독자가 많아서, 좋아요가 적다고
    // 좋은 사진이 아닌 것은 아니다.
    async setFeatured(id, dateStr, note) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
        return { error: { message: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' } };
      }
      return c.from('reader_submissions').update({
        featured_at: dateStr,
        featured_note: (note || '').trim().slice(0, 300) || null,
      }).eq('id', id).select('id');
    },
    // 선정 알림 — 뽑힌 사람에게 알린다. 이 한 줄이 벨 알림과 Web Push 를
    // 함께 띄운다 (user_notifications INSERT 트리거).
    //
    // 게재일이 아니라 선정한 순간에 보낸다. 예약분은 아직 홈에 없으므로
    // "걸렸어요" 라고 하면 거짓이 된다. 그래서 문구를 나눈다.
    async notifyFeatured(row, dateStr) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      if (!row?.user_id) return { error: { message: '제출자를 찾을 수 없습니다' } };

      const today = new Date().toISOString().slice(0, 10);
      const live  = String(dateStr) <= today;
      const [, mm, dd] = String(dateStr).split('-');
      const when = `${Number(mm)}월 ${Number(dd)}일`;

      return c.from('user_notifications').insert({
        user_id: row.user_id,
        type: 'submission_featured',
        related_id: row.id,
        title: live ? '사진이 홈에 걸렸어요' : '이주의 사진으로 뽑혔어요',
        body: live
          ? `보내주신 사진이 5ft.mag 홈 첫 화면에 걸렸어요.${row.film ? ` (${row.film})` : ''}`
          : `보내주신 사진이 ${when}부터 홈 첫 화면에 걸립니다.${row.film ? ` (${row.film})` : ''}`,
        link: '/',
        meta: { film: row.film || null, date: dateStr, live },
      });
    },
    // 선정 저장과 알림을 한 번에. 관리 화면과 사진 라이트박스가 함께 쓴다.
    //
    // 호출자가 user_id 를 몰라도 되게 여기서 행을 읽는다. 공개 뷰
    // (reader_submissions_approved)에는 user_id 가 없고, 베이스 테이블은
    // 편집부만 읽을 수 있다("editors read all"). 그래서 이 함수는 편집부
    // 세션에서만 끝까지 통과한다.
    async feature(id, dateStr, note) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
        return { error: { message: '날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)' } };
      }
      const { data: row, error: readErr } = await c.from('reader_submissions')
        .select('id, user_id, film, featured_at, status').eq('id', id).maybeSingle();
      if (readErr) return { error: readErr };
      if (!row) return { error: { message: '사진을 찾을 수 없습니다 (편집부 계정인지 확인해 주세요)' } };
      if (row.status !== 'approved') return { error: { message: '승인된 사진만 걸 수 있습니다' } };

      const wasFeatured = Boolean(row.featured_at);
      const { error } = await this.setFeatured(id, dateStr, note);
      if (error) return { error };

      // 처음 걸 때만 알린다. 날짜만 고칠 때도 보내면 한 사람의 폰이 여러 번 울린다.
      if (wasFeatured) return { notified: false };
      const { error: nErr } = await this.notifyFeatured(row, dateStr);
      return { notified: !nErr, notifyError: nErr || null };
    },
    // 선정 목록 — 예약분까지 포함해 편집부가 일정을 본다 (미래 날짜 포함).
    async listFeatured() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('reader_submissions')
        .select('id, storage_path, submitter_name, instagram, film, featured_at, featured_note')
        .not('featured_at', 'is', null)
        .order('featured_at', { ascending: false });
      if (error) return [];
      return data || [];
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('market_listings').insert({ ...record, user_id: uid, status: 'available' });
    },
    async updateMine(id, patch) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      // .select() — RLS silent block 가드 (submissions.deleteMine 와 동일)
      return c.from('market_listings').delete().eq('id', id).eq('user_id', uid).select('id');
    },
    async uploadPhoto(path, blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.storage.from(MARKET_BUCKET).upload(path, blob, {
        contentType: 'image/jpeg', upsert: false,
      });
    },
    async removePhotos(paths) {
      const c = client(); if (!c || !paths?.length) return;
      try { const { error } = await c.storage.from(MARKET_BUCKET).remove(paths); if (error) console.warn('[storage.remove]', MARKET_BUCKET, error.message || error); } catch (e) { console.warn('[storage.remove]', MARKET_BUCKET, e); }
    },
    async report(listingId, reason) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      // PK conflict 무시 — 이미 좋아요한 항목 재클릭도 멱등하게 통과
      return c.from('user_favorites')
        .upsert({ user_id: uid, target_type: targetType, target_id: targetId },
                { onConflict: 'user_id,target_type,target_id', ignoreDuplicates: true });
    },
    async remove(targetType, targetId) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('user_favorites').delete()
        .eq('user_id', uid).eq('target_type', targetType).eq('target_id', targetId);
    },
    async toggle(targetType, targetId, currentlyFav) {
      return currentlyFav
        ? this.remove(targetType, targetId)
        : this.add(targetType, targetId);
    },
  };

  // ─── Web Push 구독 ───
  // VAPID 공개키 — 사용자 식별이 아니라 송신자(이 사이트) 식별용. 공개해도 안전.
  // 비밀키는 Supabase Edge Function 의 VAPID_PRIVATE_KEY 시크릿으로 보관.
  const VAPID_PUBLIC_KEY = 'BLhU0vgtc4j93HL00029ljw7XmaZR_eyZdQRcmJ-srWdBr2SC9zB1MAYB7CpoJHgdAWZ0fATvDYRsJm9qvl6lRI';

  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  const push = {
    isSupported() {
      return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },
    async getSubscription() {
      if (!this.isSupported()) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;
      return reg.pushManager.getSubscription();
    },
    async subscribe() {
      // 실패는 항상 { error: { message, code } } 형태로 반환 (await throw 로 침묵 안 함).
      // - prod: 사용자 친화 메시지만
      // - dev: 단계 라벨 + 원본 메시지 추가 (콘솔에 자세 로깅)
      const isDev = location.hostname === 'localhost' || /\.netlify\.app$/.test(location.hostname);
      const fail = (code, friendly, raw) => {
        if (raw) try { console.warn('[push.subscribe]', code, raw); } catch (_) {}
        return { error: { code, message: isDev && raw ? `${friendly} (${code}: ${raw.message || raw})` : friendly } };
      };
      try {
        if (!this.isSupported()) return fail('unsupported', '이 브라우저는 푸시 알림을 지원하지 않아요.');
        const c = client(); if (!c) return fail('db_unavailable', '지금 서버와 연결을 만들지 못했어요. 잠시 후 다시 시도해주세요.');
        const uid = await userId();
        if (!uid) return fail('login_required', '로그인이 필요해요.');

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return fail('permission_' + perm, '알림 권한이 허용되지 않았어요. 브라우저 설정에서 5ft 알림을 허용해주세요.');

        // SW 가 페이지 컨트롤할 때까지 대기. iOS PWA 에서 5초 안에 안 되면 사용자 안내.
        let reg;
        try {
          reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error('SW ready timeout (5s)')), 5000)),
          ]);
        } catch (e) {
          return fail('sw_not_ready', '앱이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.', e);
        }

        let sub;
        try { sub = await reg.pushManager.getSubscription(); }
        catch (e) { return fail('get_subscription', '구독 정보를 읽지 못했어요.', e); }

        if (!sub) {
          try {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
          } catch (e) {
            return fail('push_subscribe', '푸시 구독을 만들지 못했어요. 브라우저 알림 설정을 확인해주세요.', e);
          }
        }

        const json = sub.toJSON();
        const p256dh = json.keys?.p256dh || bufToBase64(sub.getKey('p256dh'));
        const auth = json.keys?.auth || bufToBase64(sub.getKey('auth'));

        const { error: dbErr } = await c.from('push_subscriptions').upsert({
          user_id: uid,
          endpoint: sub.endpoint,
          p256dh,
          auth,
          ua: (navigator.userAgent || '').slice(0, 500),
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'endpoint' });
        if (dbErr) return fail('db_insert', '서버에 구독을 저장하지 못했어요. 잠시 후 다시 시도해주세요.', dbErr);

        try { window.trackEvent?.('push_subscribed'); } catch (_) {}
        return { data: { endpoint: sub.endpoint } };
      } catch (e) {
        return fail('unexpected', '예상치 못한 오류가 발생했어요. 잠시 후 다시 시도해주세요.', e);
      }
    },
    async unsubscribe() {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const sub = await this.getSubscription();
      if (sub) {
        try { await c.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (_) {}
        try { await sub.unsubscribe(); } catch (_) {}
      }
      return { error: null };
    },
    async isActive() {
      if (!this.isSupported()) return false;
      if (Notification.permission !== 'granted') return false;
      const sub = await this.getSubscription();
      return !!sub;
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
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', uid)
        .is('read_at', null);
    },
    async markAllRead() {
      const c = client(); if (!c) return { error: null };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      return c.from('user_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', uid)
        .is('read_at', null);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
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
          (payload) => onChange(payload.new, 'INSERT'))
        // 읽음 처리(read_at 갱신)도 반영 — 관리 페이지에서 요청을 처리하면
        // 트리거가 검토 알림을 자동 읽음 처리하고, 그 변화로 뱃지를 즉시 갱신한다.
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${uid}` },
          (payload) => onChange(payload.new, 'UPDATE'))
        .subscribe();
    },
  };

  // ─── 필름 카탈로그 (films 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE
  // JSONB 필드(aliases / photographers / photos) 는 JS 객체 그대로.
  const films = {
    async list() {
      const c = client(); if (!c) throw new Error('Film catalog unavailable');
      // 공개 카탈로그용 — is_hidden = true 는 제외
      const { data, error } = await c.from('films')
        .select('*')
        .eq('is_hidden', false)
        .order('brand', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Invalid film catalog');
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
        if (r.description_en)       entry.descEn = r.description_en;
        if (r.description_ja)       entry.descJa = r.description_ja;
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
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
      // 영문판 소개글. 넘긴 경우에만 쓴다(다른 호출부가 모르고 지우지 않게)
      const descEn = record.descriptionEn !== undefined ? record.descriptionEn : record.description_en;
      if (descEn !== undefined) payload.description_en = descEn || null;
      const descJa = record.descriptionJa !== undefined ? record.descriptionJa : record.description_ja;
      if (descJa !== undefined) payload.description_ja = descJa || null;
      return c.from('films').upsert(payload, { onConflict: 'slug' });
    },
    async setHidden(slug, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('films').update({ is_hidden: !!hidden }).eq('slug', slug);
    },
    async remove(slug) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('films').delete().eq('slug', slug);
    },
    // 캔(필름통) 썸네일 업로드 — 편집부만(Storage RLS).
    // 반환: { url, error }. url 은 public Storage URL (그대로 can_thumbnail 컬럼에 저장).
    async uploadCanThumbnail(slug, file) {
      const c = client(); if (!c) return { url: null, error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const cleanSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!cleanSlug) return { url: null, error: { message: 'invalid slug' } };
      if (!file || !file.size) return { url: null, error: { message: 'no file' } };
      // 확장자 보존(웹 호환 webp/png/jpg 우선).
      const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.webp'])[0].toLowerCase();
      const path = `${cleanSlug}-can${ext}`;
      const up = await c.storage.from('film-thumbnails').upload(path, file, {
        contentType: file.type || 'image/webp',
        upsert: true,
        cacheControl: '3600',
      });
      if (up.error) return { url: null, error: up.error };
      const { data: pub } = c.storage.from('film-thumbnails').getPublicUrl(path);
      return { url: pub?.publicUrl || null, error: null };
    },
  };

  // ─── 현상소 카탈로그 (labs 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE. prices 는 JSONB(객체 그대로).
  const labs = {
    async list({ strict = false } = {}) {
      const c = client(); if (!c) { if (strict) throw new Error('Lab catalog unavailable'); return []; }
      const { data, error } = await c.from('labs')
        .select('*').eq('is_hidden', false)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { if (strict) throw error; console.warn('[labs.list]', error.message); return []; }
      if (strict && !Array.isArray(data)) throw new Error('Invalid lab catalog');
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
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
      // 영문판 표시값. 넘긴 경우에만 쓴다. 지역·이름 원문은 지도 검색·슬러그 키라 그대로 둔다
      for (const k of ['name_en', 'address_en', 'features_en', 'name_ja', 'address_ja', 'features_ja']) {
        if (record[k] !== undefined) payload[k] = record[k] || null;
      }
      if (record.id) payload.id = record.id;
      if (record.sort_order != null) payload.sort_order = record.sort_order;
      return c.from('labs').upsert(payload);
    },
    async setHidden(id, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('labs').update({ is_hidden: !!hidden }).eq('id', id);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('labs').delete().eq('id', id);
    },
  };

  // ─── 수리실 (repair_shops 테이블) ───
  // public 은 SELECT, editor 만 INSERT/UPDATE/DELETE. 좌표 미저장(주소 지오코딩).
  const repairs = {
    async list({ strict = false } = {}) {
      const c = client(); if (!c) { if (strict) throw new Error('Repair catalog unavailable'); return []; }
      const { data, error } = await c.from('repair_shops')
        .select('*').eq('is_hidden', false)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) { if (strict) throw error; console.warn('[repairs.list]', error.message); return []; }
      if (strict && !Array.isArray(data)) throw new Error('Invalid repair catalog');
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
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
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
      for (const k of ['name_en', 'address_en', 'specialty_en', 'description_en',
                       'name_ja', 'address_ja', 'specialty_ja', 'description_ja']) {
        if (record[k] !== undefined) payload[k] = record[k] || null;
      }
      if (record.id) payload.id = record.id;
      if (record.sort_order != null) payload.sort_order = record.sort_order;
      return c.from('repair_shops').upsert(payload);
    },
    async setHidden(id, hidden) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('repair_shops').update({ is_hidden: !!hidden }).eq('id', id);
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('repair_shops').delete().eq('id', id);
    },
  };

  const WEBZINE_BUCKET = 'webzine';
  const webzine = {
    // strict: 실패하면 [] 대신 던진다. 책장이 "불러오지 못함" 과 "0건" 을 가르는 데 쓴다
    async listPublished({ strict = false } = {}) {
      const c = client(); if (!c) { if (strict) throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' }); return []; }
      const { data, error } = await c.from('webzine_issues')
        .select('*').eq('published', true)
        .order('sort_order', { ascending: false }).order('created_at', { ascending: false });
      if (error) { console.warn('[webzine.listPublished]', error.message); if (strict) throw error; return []; }
      return data || [];
    },
    async listAll() {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('webzine_issues')
        .select('*').order('sort_order', { ascending: false }).order('created_at', { ascending: false });
      if (error) { console.warn('[webzine.listAll]', error.message); return []; }
      return data || [];
    },
    async getBySlug(slug) {
      const c = client(); if (!c) return null;
      const { data, error } = await c.from('webzine_issues')
        .select('*').eq('slug', slug).eq('published', true).maybeSingle();
      if (error) { console.warn('[webzine.getBySlug]', error.message); return null; }
      return data || null;
    },
    async upsert(record) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('webzine_issues').upsert(record).select().maybeSingle();
    },
    async remove(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.from('webzine_issues').delete().eq('id', id);
    },
    async uploadFile(path, file) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.storage.from(WEBZINE_BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream', upsert: true,
      });
    },
    publicUrl(path) { return `${URL_}/storage/v1/object/public/${WEBZINE_BUCKET}/${path}`; },
  };

  // ─── 필름 신청 (film_proposals) ───
  // 구독자가 라이브러리에 없는 필름을 신청하면 편집부가 검토 후 승인 시
  // films 테이블로 promote. 본인 신청만 SELECT, 편집부는 전체 권한(RLS).
  const filmProposals = {
    async create(rec) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      const payload = {
        user_id: uid,
        brand: String(rec.brand || '').trim(),
        name:  String(rec.name  || '').trim(),
        display_name: rec.displayName ? String(rec.displayName).trim() : null,
        iso:    rec.iso    ? String(rec.iso).trim()    : null,
        type:   rec.type   ? String(rec.type).trim()   : null,
        format: rec.format ? String(rec.format).trim() : null,
        description: rec.description ? String(rec.description).trim() : null,
        aliases: Array.isArray(rec.aliases) ? rec.aliases : [],
        status: 'pending',
      };
      if (!payload.brand || !payload.name) {
        return { error: { message: 'brand 와 name 은 필수예요.' } };
      }
      return c.from('film_proposals').insert(payload).select().maybeSingle();
    },
    async listMine() {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('film_proposals')
        .select('*').eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
  };

  const announcements = {
    // 현재 활성(시간 범위 내) 공지 1개 — 가장 최근 created_at.
    // RLS 가 비편집부 사용자에겐 시간 범위만 노출하지만, 편집부 사용자에겐
    // 편집부 정책이 OR 로 묶여 모든 행이 보인다 — 그래서 편집부가 사이트
    // 헤더에서 만료된 배너를 계속 보게 된다. 클라이언트에서도 한 번 더
    // 명시적으로 starts_at / ends_at / is_active 를 거른다.
    async current() {
      const c = client(); if (!c) return { data: null, error: null };
      const nowIso = new Date().toISOString();
      const { data, error } = await c
        .from('announcements')
        .select('id, body, body_en, body_ja, starts_at, ends_at')
        .eq('is_active', true)
        .lte('starts_at', nowIso)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { data: data || null, error };
    },
  };

  // ── Article drafts (편집부 에디터 저장소) ──
  const ARTICLE_MEDIA_BUCKET = 'article-media';
  const articles = {
    // ── 글 공개/비공개 ──
    // data/stories.json 의 published 가 기본값이고, story_visibility 에 행이 있으면
    // 그것이 이긴다. 목록 화면은 js/util.js 의 loadStories() 가 합쳐서 준다.
    async visibility({ strict = false } = {}) {
      const c = client(); if (!c) { if (strict) throw new Error('Story visibility unavailable'); return []; }
      const { data, error } = await c.from('story_visibility').select('story_id, published');
      if (error) { if (strict) throw error; console.warn('[articles.visibility]', error.message); return []; }
      if (strict && (!Array.isArray(data) || data.some(row => !row || row.story_id == null || typeof row.published !== 'boolean'))) throw new Error('Invalid story visibility');
      return data || [];
    },
    // 기본값과 같아지면 행을 지운다. 그래야 원본이 둘로 갈라지지 않고
    // 이 테이블에는 "기본값에서 벗어난 글" 만 남는다.
    async setPublished(storyId, published, defaultPublished) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const id = String(storyId || '').trim();
      if (!id) return { error: { message: '글 id 가 없습니다' } };

      if (published === (defaultPublished !== false)) {
        const { error } = await c.from('story_visibility').delete().eq('story_id', id);
        return { error: error || null, cleared: true };
      }
      const { error } = await c.from('story_visibility')
        .upsert({ story_id: id, published: !!published }, { onConflict: 'story_id' });
      return { error: error || null, cleared: false };
    },
    async listDrafts(limit = 50) {
      const c = client(); if (!c) return [];
      const { data, error } = await c.from('article_drafts')
        .select('id, slug, title, status, updated_at, hero_image, category_label')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('[articles.listDrafts]', error.message); return []; }
      return data || [];
    },
    async getDraft(idOrSlug) {
      const c = client(); if (!c) return null;
      const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
      const q = c.from('article_drafts').select('*');
      const { data, error } = await (isUuid ? q.eq('id', idOrSlug) : q.eq('slug', idOrSlug)).maybeSingle();
      if (error) { console.warn('[articles.getDraft]', error.message); return null; }
      return data;
    },
    async upsertDraft(row) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const payload = { ...row };
      if (!payload.created_by) {
        try { payload.created_by = await userId(); } catch (_) {}
      }
      const onConflict = payload.id ? undefined : 'slug';
      const { data, error } = await c.from('article_drafts')
        .upsert(payload, { onConflict })
        .select('id, slug, updated_at')
        .single();
      if (error) return { error };
      return { data };
    },
    async removeDraft(id) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const { error } = await c.from('article_drafts').delete().eq('id', id);
      return { error };
    },
    async uploadMedia(path, blob) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      return c.storage.from(ARTICLE_MEDIA_BUCKET).upload(path, blob, {
        cacheControl: '31536000', upsert: false, contentType: blob.type || 'application/octet-stream',
      });
    },
    publicUrl(path) {
      const c = client(); if (!c) return '';
      const { data } = c.storage.from(ARTICLE_MEDIA_BUCKET).getPublicUrl(path);
      return data?.publicUrl || '';
    },
  };

  // ─── 개인화 동기화 (최근 본 필름 + 좋아요 한 브랜드) ───
  // 로그인 사용자만 동기. 비로그인은 클라이언트의 localStorage 만 사용.
  const personalization = {
    async listRecentFilms(limit = 20) {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('user_recent_films')
        .select('film_slug, viewed_at')
        .eq('user_id', uid)
        .order('viewed_at', { ascending: false })
        .limit(Math.max(1, Math.min(50, limit)));
      if (error) return [];
      return (data || []).map(r => ({ slug: r.film_slug, viewedAt: r.viewed_at }));
    },
    async pushRecentFilm(slug) {
      const c = client(); if (!c) return { error: null };
      const uid = await userId();
      if (!uid) return { error: null };
      const s = String(slug || '').trim();
      if (!s) return { error: null };
      return c.from('user_recent_films').upsert({
        user_id: uid, film_slug: s, viewed_at: new Date().toISOString(),
      }, { onConflict: 'user_id,film_slug' });
    },
    async listFavBrands() {
      const c = client(); if (!c) return [];
      const uid = await userId();
      if (!uid) return [];
      const { data, error } = await c.from('user_fav_brands')
        .select('brand').eq('user_id', uid);
      if (error) return [];
      return (data || []).map(r => r.brand);
    },
    async addFavBrand(brand) {
      const c = client(); if (!c) return { error: null };
      const uid = await userId();
      if (!uid) return { error: null };
      const b = String(brand || '').trim();
      if (!b) return { error: null };
      return c.from('user_fav_brands').upsert({
        user_id: uid, brand: b,
      }, { onConflict: 'user_id,brand' });
    },
    async removeFavBrand(brand) {
      const c = client(); if (!c) return { error: null };
      const uid = await userId();
      if (!uid) return { error: null };
      const b = String(brand || '').trim();
      if (!b) return { error: null };
      return c.from('user_fav_brands').delete().eq('user_id', uid).eq('brand', b);
    },
  };

  // ─── 메시지 (회원 ↔ 편집부 양방향) ───
  // 회원: 자기 스레드만 보고 쓸 수 있음. from_editor 는 항상 false.
  // 편집부: 모든 스레드 보고 쓸 수 있음. from_editor 는 항상 true.
  const messages = {
    // 회원이 자기 스레드의 메시지 시간순으로 가져옴 (admin 도 같은 호출 가능, p_user_id 명시)
    async list(targetUserId, { limit = 200 } = {}) {
      const c = client(); if (!c) return [];
      const uid = targetUserId || (await userId());
      if (!uid) return [];
      const { data, error } = await c.from('messages').select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) { console.warn('[messages.list]', error.message); return []; }
      return data || [];
    },
    // 회원이 보냄
    async send(body) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const uid = await userId();
      if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
      const text = String(body || '').trim();
      if (!text) return { error: { message: 'empty' } };
      if (text.length > 2000) return { error: { message: 'too long' } };
      return c.from('messages').insert({ user_id: uid, from_editor: false, body: text });
    },
    // 회원: 자기 받은 메시지 (편집부가 보낸 것) 읽음 처리.
    // 편집부: targetUserId 의 회원이 보낸 메시지 읽음 처리.
    async markRead(targetUserId) {
      const c = client(); if (!c) return 0;
      const uid = targetUserId || (await userId());
      if (!uid) return 0;
      const { data, error } = await c.rpc('mark_messages_read', { p_user_id: uid });
      if (error) { console.warn('[messages.markRead]', error.message); return 0; }
      return data || 0;
    },
    // 회원: 자기 안읽음 카운트 (편집부가 보낸 것 중)
    async unreadCount() {
      const c = client(); if (!c) return 0;
      const uid = await userId();
      if (!uid) return 0;
      const { count } = await c.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('from_editor', true)
        .is('read_at', null);
      return count || 0;
    },
    // 편집부 인박스: 회원이 보낸 메시지 중 전체 안읽음 카운트 (헤더 배지용)
    async unreadCountForAdmin({ strict = false } = {}) {
      const c = client(); if (!c) { if (strict) throw new Error('Message count unavailable'); return 0; }
      const { count, error } = await c.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('from_editor', false)
        .is('read_at', null);
      if (error) { if (strict) throw error; console.warn('[messages.unreadCountForAdmin]', error.message); }
      if (strict && (!Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid message count');
      return count || 0;
    },
    // 본인 메시지 수정 (회원: 자기 발신, 편집부: 편집부 발신)
    async edit(id, body) {
      const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
      const text = String(body || '').trim();
      if (!text) return { error: { message: 'empty' } };
      if (text.length > 2000) return { error: { message: 'too long' } };
      const { error } = await c.rpc('edit_message', { p_id: id, p_body: text });
      return { error };
    },
  };

  // commerce.js 를 싣지 않는 페이지(필자 페이지 등)에서도 MagDB 가 만들어지게 한다.
  const { shop, ebooks } = window.MagDBCommerce
    ? window.MagDBCommerce.create({ client, session, url: URL_, webzine })
    : { shop: {}, ebooks: {} };

  // 편집부 전용 함수(응모 검토·장터 신고·통계·공지/메시지 관리 등)는 js/db/admin.js 에 있다.
  // 관리 화면(admin/*.html)만 그 파일을 이 파일 앞에 싣고, 여기서 같은 이름으로 붙인다.
  // 공개 화면이 편집부에게만 보여 주는 기능(이주의 사진 선정·필름명 수정·메시지 배지)은 여기 남긴다.
  const admin = window.MagDBAdmin ? window.MagDBAdmin.create({ client, userId, MARKET_BUCKET }) : {};
  Object.assign(profiles, admin.profiles);
  Object.assign(comments, admin.comments);
  Object.assign(review, admin.review);
  Object.assign(market, admin.market);
  Object.assign(cameraOverrides, admin.cameraOverrides);
  Object.assign(filmProposals, admin.filmProposals);
  Object.assign(announcements, admin.announcements);
  Object.assign(messages, admin.messages);
  const { commentFilterTerms, analytics } = admin;

  window.MagDB = {
    isReady() { return !!_client; },
    storageBaseUrl: `/i/reader/`,
    auth, profiles, comments, commentFilterTerms, likes, submissions, review, market, favorites, notifications, push, personalization, cameraOverrides, analytics, realtime, films, filmProposals, labs, repairs, newsletter, webzine, announcements, articles, messages, shop, ebooks,
  };
})();
