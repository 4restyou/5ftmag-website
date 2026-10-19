// 조회 실패를 「0건/없음」으로 바꾸지 않는지, 로그아웃 방문자가 세션 대기로 늦지 않는지,
// 서비스 워커 캐시가 쿼리마다 쌓이거나 옛 ?v= 를 지우지 않는지 확인한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());

function query(result) {
  const q = {
    select() { return q; }, eq() { return q; }, order() { return q; }, range() { return q; },
    maybeSingle() { return q; }, not() { return q; }, lte() { return q; }, limit() { return q; },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
  };
  return q;
}

function setupDb({ url = 'https://5ftmag.com/', getSession, fromResult, commerce = false, before } = {}) {
  dom = new JSDOM('', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const auth = {
    getSession: vi.fn(getSession || (async () => ({ data: { session: null } }))),
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  };
  const c = { auth, from: () => query(fromResult || (() => ({ data: [], error: null }))) };
  w.supabase = { createClient: () => c };
  before?.(w);
  if (commerce) w.eval(readFileSync('js/db/commerce.js', 'utf8'));
  else w.MagDBCommerce = { create: () => ({}) };
  w.eval(readFileSync('js/db-client.js', 'utf8'));
  return { w, auth };
}

describe('session() 대기', () => {
  it('평소(로그아웃 방문자)엔 getSession 을 한 번만 읽는다', async () => {
    const { w, auth } = setupDb();
    const started = Date.now();
    expect(await w.MagDB.auth.getSession()).toBeNull();
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('OAuth 복귀(?code=)면 세션이 생길 때까지 다시 읽는다', async () => {
    let n = 0;
    const { w, auth } = setupDb({
      url: 'https://5ftmag.com/me.html?code=abc',
      getSession: async () => ({ data: { session: ++n >= 3 ? { user: { id: 'u1' } } : null } }),
    });
    expect((await w.MagDB.auth.getSession())?.user?.id).toBe('u1');
    expect(auth.getSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('로그인 시작 때 남긴 복귀 표시가 있어도 기다린다', async () => {
    let n = 0;
    const { w } = setupDb({
      before: (win) => win.sessionStorage.setItem('5ft_login_origin', JSON.stringify({ url: 'https://5ftmag.com/', ts: Date.now() })),
      getSession: async () => ({ data: { session: ++n >= 2 ? { user: { id: 'u2' } } : null } }),
    });
    expect((await w.MagDB.auth.getSession())?.user?.id).toBe('u2');
  });
});

describe('조회 실패를 빈 결과로 바꾸지 않는다', () => {
  it('listApproved 는 오류를 던지고, 정상 빈 응답은 [] 로 둔다', async () => {
    const failing = setupDb({ fromResult: () => ({ data: null, error: { message: 'permission denied' } }) });
    await expect(failing.w.MagDB.submissions.listApproved(10)).rejects.toThrow('permission denied');
    const empty = setupDb();
    await expect(empty.w.MagDB.submissions.listApproved(10)).resolves.toEqual([]);
  });

  it('ownerOfSubmission 은 조회 실패를 던지고, 없는 행은 null', async () => {
    const failing = setupDb({ fromResult: () => ({ data: null, error: { message: 'timeout' } }) });
    await expect(failing.w.MagDB.messages.ownerOfSubmission('s1')).rejects.toThrow('timeout');
    const missing = setupDb({ fromResult: () => ({ data: null, error: null }) });
    await expect(missing.w.MagDB.messages.ownerOfSubmission('s1')).resolves.toBeNull();
  });

  it('ebooks.get·myEntitlementIds 는 strict 일 때만 던진다', async () => {
    const session = async () => ({ data: { session: { user: { id: 'u1' } } } });
    const failing = setupDb({ commerce: true, getSession: session, fromResult: () => ({ data: null, error: { message: 'boom' } }) });
    await expect(failing.w.MagDB.ebooks.get('issue-1', { strict: true })).rejects.toMatchObject({ message: 'boom' });
    await expect(failing.w.MagDB.ebooks.get('issue-1')).resolves.toBeNull();
    await expect(failing.w.MagDB.ebooks.myEntitlementIds({ strict: true })).rejects.toMatchObject({ message: 'boom' });
    expect((await failing.w.MagDB.ebooks.myEntitlementIds()).size).toBe(0);
    const missing = setupDb({ commerce: true, getSession: session, fromResult: () => ({ data: null, error: null }) });
    await expect(missing.w.MagDB.ebooks.get('nope', { strict: true })).resolves.toBeNull();
  });

  it('fetchApprovedSubmissions 는 DB 실패를 삼키지 않는다', async () => {
    dom = new JSDOM('', { url: 'https://5ftmag.com/films.html', runScripts: 'outside-only' });
    const w = dom.window;
    w.i18n = { t: (ko) => ko, url: (u) => u, isEn: false, lang: 'ko' };
    w.MagDB = { isReady: () => true, submissions: { listApproved: async () => { throw new Error('db down'); } } };
    w.eval(readFileSync('js/reader-upload-loader.js', 'utf8'));
    await expect(w.fetchApprovedSubmissions(10)).rejects.toThrow('db down');
    w.MagDB.submissions.listApproved = async () => [];
    await expect(w.fetchApprovedSubmissions(10)).resolves.toEqual([]);
  });
});

describe('films 「등록순」 날짜', () => {
  it('UTC 자정 직후 등록(한국 오전)은 한국 날짜로 묶는다', () => {
    dom = new JSDOM('', { url: 'https://5ftmag.com/films.html', runScripts: 'outside-only' });
    const w = dom.window;
    w.i18n = { t: (ko) => ko, url: (u) => u, lang: 'ko', isEn: false };
    w.eval(readFileSync('js/util.js', 'utf8'));
    w.eval(readFileSync('js/films-library-filters.js', 'utf8'));
    const { sortLibrary } = w.FilmsLibraryFilters.create({
      filmsGridLibrary: w.document.createElement('div'), escapeAttr: String, escapeHtml: String,
      filterCategoryOf: () => 'color', isMobileFilms: () => false,
    });
    // b 는 UTC 로 6/1 이지만 한국 시간 6/2 08:30, a 는 한국 6/2 10:00 → 같은 날이라 브랜드순(b 가 앞).
    // UTC 앞 10자로 자르면 a(6/2)가 b(6/1)보다 앞선다.
    const entries = [
      ['b', { brand: 'A', name: 'Bee', createdAt: '2026-06-01T23:30:00Z' }],
      ['a', { brand: 'B', name: 'Ace', createdAt: '2026-06-02T01:00:00Z' }],
      ['c', { brand: 'C', name: 'Old', createdAt: '2026-05-01T01:00:00Z' }],
    ];
    const out = sortLibrary(entries, new Set(), { mode: 'added' }).map(([slug]) => slug);
    expect(out).toEqual(['b', 'a', 'c']);
  });
});

// ── 서비스 워커 ──
const SW_CACHE = readFileSync('sw.js', 'utf8').match(/const CACHE = '([^']+)'/)[1];
function fakeCaches() {
  const store = new Map(); // name → Map(url → body)
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    const keyOf = (k) => (typeof k === 'string' ? k : k.url);
    return {
      async put(k, res) { m.delete(keyOf(k)); m.set(keyOf(k), res); },
      async match(k) { return m.get(keyOf(k)); },
      async keys() { return [...m.keys()].map((url) => ({ url })); },
      async delete(k) { return m.delete(keyOf(k)); },
      async addAll() {},
    };
  };
  return {
    store,
    open,
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
    async match(k) {
      for (const m of store.values()) { const hit = m.get(typeof k === 'string' ? k : k.url); if (hit) return hit; }
      return undefined;
    },
  };
}

function loadWorker({ fetchImpl } = {}) {
  const listeners = {};
  const caches = fakeCaches();
  const self = {
    location: { origin: 'https://5ftmag.com' },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() {}, clients: { claim() {} },
  };
  const fetch = vi.fn(fetchImpl || (async (req) => ({ ok: true, type: 'basic', url: req.url, clone() { return { body: req.url }; }, headers: { get: () => 'text/html' } })));
  new Function('self', 'caches', 'fetch', readFileSync('sw.js', 'utf8'))(self, caches, fetch);
  async function dispatchFetch(url, accept = '') {
    const waits = [];
    let response;
    listeners.fetch({
      request: { method: 'GET', url, destination: '', headers: { get: (h) => (h === 'accept' ? accept : null) } },
      respondWith(p) { response = p; },
      waitUntil(p) { waits.push(p); },
    });
    const res = await response;
    await Promise.all(waits);
    return { res, waits };
  }
  return { caches, dispatchFetch, fetch };
}

describe('sw.js 캐시', () => {
  it('HTML 은 쿼리를 뗀 주소로 담고, 담는 작업을 waitUntil 로 묶는다', async () => {
    const { caches, dispatchFetch } = loadWorker();
    const { waits } = await dispatchFetch('https://5ftmag.com/search.html?q=portra&utm_source=x', 'text/html');
    expect(waits.length).toBeGreaterThan(0);
    const [name] = await caches.keys();
    const urls = [...caches.store.get(name).keys()];
    expect(urls).toEqual(['https://5ftmag.com/search.html']);
  });

  it('같은 경로의 옛 ?v= 항목을 지우지 않는다', async () => {
    const { caches, dispatchFetch } = loadWorker();
    await dispatchFetch('https://5ftmag.com/js/a.js?v=1');
    await dispatchFetch('https://5ftmag.com/js/a.js?v=2');
    const [name] = await caches.keys();
    expect([...caches.store.get(name).keys()]).toEqual(['https://5ftmag.com/js/a.js?v=1', 'https://5ftmag.com/js/a.js?v=2']);
  });

  it('항목 수 상한(250)을 넘으면 오래된 것부터 지우고 CORE 는 남긴다', async () => {
    const { caches, dispatchFetch } = loadWorker();
    const c = await caches.open(SW_CACHE);
    await c.put('https://5ftmag.com/css/tokens.css', { core: true });
    for (let i = 0; i < 260; i++) await dispatchFetch(`https://5ftmag.com/data/x.json?n=${i}`);
    const urls = [...caches.store.get(SW_CACHE).keys()];
    expect(urls.length).toBe(250);
    expect(urls).toContain('https://5ftmag.com/css/tokens.css');
    expect(urls).not.toContain('https://5ftmag.com/data/x.json?n=0');
    expect(urls).toContain('https://5ftmag.com/data/x.json?n=259');
  });
});
