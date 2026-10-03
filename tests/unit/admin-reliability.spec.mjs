import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const pages = Object.fromEntries(['index', 'articles', 'article-editor'].map((name) => [
  name, readFileSync(`admin/${name}.html`, 'utf8'),
]));
const scripts = Object.fromEntries(['home', 'articles', 'article-editor'].map((name) => [
  name, readFileSync(`js/admin-${name}-page.js`, 'utf8'),
]));
let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function page(name, query = '') {
  dom = new JSDOM(pages[name], {
    url: `https://5ftmag.com/admin/${name}.html${query}`, runScripts: 'outside-only',
  });
  dom.window.console.warn = vi.fn();
  dom.window.console.error = vi.fn();
  return dom.window;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function dashboard({ allowed = true } = {}) {
  const window = page('index');
  const calls = {
    Pending: vi.fn().mockResolvedValue({ total_pending: 0 }),
    Reports: vi.fn().mockResolvedValue(0),
    Messages: vi.fn().mockResolvedValue(0),
    Proposals: vi.fn().mockResolvedValue([]),
    Errors: vi.fn().mockResolvedValue([]),
    Views: vi.fn().mockResolvedValue({ views_today: 0, views_yesterday: 0 }),
  };
  window.MagDB = {
    analytics: { uploadsSummary: calls.Pending, summary: calls.Views, clientErrorsRecent: calls.Errors },
    market: { adminReportCount: calls.Reports },
    messages: { unreadCountForAdmin: calls.Messages },
    filmProposals: { listForReview: calls.Proposals },
  };
  window.AdminGuard = { requireEditor: vi.fn().mockResolvedValue(allowed) };
  const el = (id) => window.document.getElementById(id);
  const start = () => window.eval(scripts.home);
  const settled = () => vi.waitFor(() => expect(el('homeRefresh').disabled).toBe(false));
  return { window, calls, el, start, settled };
}

describe('administrator dashboard behavior', () => {
  it('shows genuine zero and calls every helper in strict mode', async () => {
    const { calls, el, start, settled } = dashboard();
    start();
    await tick();
    await settled();
    for (const key of Object.keys(calls)) {
      expect(el('v' + key).textContent).toBe('0');
      expect(el('status' + key).textContent).toContain('마지막 성공');
      expect(el('retry' + key).hidden).toBe(true);
      expect(el('card' + key).classList.contains('is-alert')).toBe(false);
    }
    expect(calls.Pending).toHaveBeenCalledWith({ strict: true });
    expect(calls.Reports).toHaveBeenCalledWith('pending', { strict: true });
    expect(calls.Messages).toHaveBeenCalledWith({ strict: true });
    expect(calls.Proposals).toHaveBeenCalledWith({ status: 'pending', strict: true });
    expect(calls.Errors).toHaveBeenCalledWith(24, 50, { strict: true });
    expect(calls.Views).toHaveBeenCalledWith({ strict: true });
  });

  it.each(['Pending', 'Reports', 'Messages', 'Proposals', 'Errors', 'Views'])(
    'marks failed %s unavailable while other widgets succeed', async (failed) => {
      const { calls, el, start, settled } = dashboard();
      calls[failed].mockRejectedValue(new Error('network unavailable'));
      start();
      await tick();
      await settled();
      expect(el('v' + failed).textContent).toBe('확인 불가');
      expect(el('status' + failed).textContent).not.toContain('마지막 성공');
      expect(el('retry' + failed).hidden).toBe(false);
      for (const key of Object.keys(calls).filter((key) => key !== failed)) {
        expect(el('v' + key).textContent).toBe('0');
      }
    },
  );

  it('keeps stale counts, alert and last-success timestamp; retry updates only its widget', async () => {
    const { calls, el, start, settled } = dashboard();
    calls.Reports.mockResolvedValueOnce(7).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(0);
    start();
    await tick();
    await settled();
    const lastSuccess = el('statusReports').dataset.lastSuccess;
    el('homeRefresh').click();
    await settled();
    expect(el('vReports').textContent).toBe('7');
    expect(el('statusReports').textContent).toContain('확인 불가');
    expect(el('statusReports').textContent).toContain('이전 값');
    expect(el('statusReports').dataset.lastSuccess).toBe(lastSuccess);
    expect(el('cardReports').classList.contains('is-alert')).toBe(true);
    expect(el('retryReports').closest('a')).toBeNull();
    el('retryReports').click();
    await settled();
    expect(el('vReports').textContent).toBe('0');
    expect(el('statusReports').textContent).not.toContain('이전 값');
    expect(el('cardReports').classList.contains('is-alert')).toBe(false);
    expect(calls.Reports).toHaveBeenCalledTimes(3);
    expect(calls.Pending).toHaveBeenCalledTimes(2);
  });

  it('does not coerce missing or malformed counts into zero', async () => {
    const { calls, el, start, settled } = dashboard();
    calls.Pending.mockResolvedValue(null);
    calls.Reports.mockResolvedValue(undefined);
    calls.Messages.mockResolvedValue('');
    calls.Proposals.mockResolvedValue({ error: 'query failed' });
    calls.Errors.mockResolvedValue(null);
    calls.Views.mockResolvedValue({ views_today: 0 });
    start();
    await tick();
    await settled();
    for (const key of Object.keys(calls)) expect(el('v' + key).textContent).toBe('확인 불가');
  });

  it('shows capped counts and retains stale pageview comparison', async () => {
    const { calls, el, start, settled } = dashboard();
    calls.Proposals.mockResolvedValue(Array(100).fill({}));
    calls.Errors.mockResolvedValue(Array(50).fill({}));
    calls.Views.mockResolvedValueOnce({ views_today: 150, views_yesterday: 100 }).mockRejectedValue(new Error('offline'));
    start();
    await tick();
    await settled();
    expect(el('vProposals').textContent).toBe('100+');
    expect(el('vErrors').textContent).toBe('50+');
    expect(el('vViewsSub').textContent).toContain('50%');
    el('homeRefresh').click();
    await settled();
    expect(el('vViews').textContent).toBe('150');
    expect(el('vViewsSub').textContent).toContain('50%');
    expect(el('statusViews').textContent).toContain('이전 값');
  });

  it('times out a hanging widget without hiding other results, and ignores a late result', async () => {
    vi.useFakeTimers();
    const { calls, el, start } = dashboard();
    let resolveReport;
    calls.Reports.mockReturnValue(new Promise((resolve) => { resolveReport = resolve; }));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('vMessages').textContent).toBe('0');
    expect(el('homeRefresh').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(el('vReports').textContent).toBe('확인 불가');
    expect(el('homeRefresh').disabled).toBe(false);
    calls.Reports.mockResolvedValue(2);
    el('retryReports').click();
    await vi.advanceTimersByTimeAsync(0);
    resolveReport(99);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('vReports').textContent).toBe('2');
  });

  it('does not request data before the editor access gate allows it', async () => {
    const { calls, el, start } = dashboard({ allowed: false });
    start();
    await tick();
    expect(el('app').hidden).toBe(true);
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });
});

describe('retired browser article editor', () => {
  it.each(['', '?id=old-draft', '?slug=published-story'])(
    'fails closed for direct route %s without reading tokens or loading a draft', (query) => {
      const window = page('article-editor', query);
      window.localStorage.setItem('5ft-gh-pat', 'old-local-token');
      window.sessionStorage.setItem('5ft-gh-pat', 'old-session-token');
      window.localStorage.setItem('unrelated', 'keep');
      const get = vi.spyOn(window.Storage.prototype, 'getItem');
      const set = vi.spyOn(window.Storage.prototype, 'setItem');
      const remove = vi.spyOn(window.Storage.prototype, 'removeItem');
      const draft = vi.fn().mockResolvedValue({ body_html: '<iframe srcdoc="malicious"></iframe>' });
      window.MagDB = { articles: { getDraft: draft, upsertDraft: vi.fn() } };
      window.fetch = vi.fn();
      window.eval(scripts['article-editor']);
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenNthCalledWith(1, '5ft-gh-pat');
      expect(remove).toHaveBeenNthCalledWith(2, '5ft-gh-pat');
      expect(window.localStorage.getItem('5ft-gh-pat')).toBeNull();
      expect(window.sessionStorage.getItem('5ft-gh-pat')).toBeNull();
      expect(window.localStorage.getItem('unrelated')).toBe('keep');
      expect(draft).not.toHaveBeenCalled();
      expect(window.fetch).not.toHaveBeenCalled();
      expect(window.document.querySelector('[contenteditable], input, textarea, iframe')).toBeNull();
      expect(window.document.querySelector('main').hidden).toBe(false);
      expect(window.document.querySelector('main').textContent).toContain('발행할 수 없습니다');
      expect(window.document.querySelector('main a').getAttribute('href')).toBe('/admin/articles.html#publishing-process');
    },
  );

  it('keeps the retirement notice visible without JavaScript or available storage', () => {
    const window = page('article-editor', '?id=untrusted');
    expect(window.document.querySelector('main').hidden).toBe(false);
    vi.spyOn(window.Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => window.eval(scripts['article-editor'])).not.toThrow();
    expect(window.document.querySelector('main').textContent).toContain('예약');
    expect(window.document.querySelector('main').textContent).toContain('직접 URL');
  });

  it('offers no legacy editor links in the home or article list markup', () => {
    for (const name of ['index', 'articles']) {
      const window = page(name);
      expect(window.document.querySelector('a[href*="article-editor"]')).toBeNull();
      window.close();
    }
  });
});

const stories = [{ id: 'story-one', title: '첫 기사', published: true, page: 'stories/story-one.html' }];

function articles({ visibility = [], fetchOk = true } = {}) {
  const window = page('articles');
  const readVisibility = vi.fn().mockResolvedValue(visibility);
  const setPublished = vi.fn().mockResolvedValue({ error: null, cleared: false });
  window.MagDB = {
    isReady: () => true,
    auth: { getSession: vi.fn().mockResolvedValue({ user: { email: 'editor@example.com' } }), signOut: vi.fn(), signInWithGoogle: vi.fn() },
    profiles: { getMine: vi.fn().mockResolvedValue({ is_editor: true, display_name: '편집부' }) },
    articles: { visibility: readVisibility, setPublished },
  };
  window.fetch = vi.fn().mockResolvedValue({ ok: fetchOk, status: fetchOk ? 200 : 503, json: async () => stories });
  const el = (id) => window.document.getElementById(id);
  const start = () => window.eval(scripts.articles);
  const settled = () => vi.waitFor(() => expect(el('articlesLoadStatus').textContent).not.toContain('확인 중'));
  const toggle = () => window.document.querySelector('.pub-toggle input');
  return { window, readVisibility, setPublished, el, start, settled, toggle };
}

describe('article list visibility behavior', () => {
  it('uses strict visibility and list-only labels, with no legacy edit link', async () => {
    const { window, readVisibility, el, start, settled, toggle } = articles();
    start();
    await settled();
    expect(readVisibility).toHaveBeenCalledWith({ strict: true });
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(false);
    expect(window.document.querySelector('.pub-toggle-label').textContent).toBe('목록에 표시');
    expect(window.document.querySelector('a[href*="article-editor"]')).toBeNull();
    expect(el('publishing-process').textContent).toContain('직접 URL로는 계속 읽을 수 있습니다');
    expect(el('publishing-process').textContent).toContain('자동 예약 발행은 지원하지 않습니다');
  });

  it('applies a real hidden override instead of the static visible default', async () => {
    const { window, start, settled, toggle } = articles({ visibility: [{ story_id: 'story-one', published: false }] });
    start();
    await settled();
    expect(toggle().checked).toBe(false);
    expect(window.document.querySelector('.pub-toggle-label').textContent).toBe('목록에서 숨김');
  });

  it('does not show a static default as authoritative when visibility fails; retry recovers', async () => {
    const { window, readVisibility, setPublished, el, start, settled, toggle } = articles();
    readVisibility.mockRejectedValueOnce(new Error('permission denied'));
    start();
    await settled();
    expect(el('articlesLoadStatus').textContent).toContain('확인 불가');
    expect(el('articlesLoadStatus').textContent).toContain('permission denied');
    expect(toggle().disabled).toBe(true);
    expect(window.document.querySelector('.pub-toggle-label').textContent).toBe('표시 상태 확인 불가');
    toggle().dispatchEvent(new window.Event('change', { bubbles: true }));
    await tick();
    expect(setPublished).not.toHaveBeenCalled();
    readVisibility.mockResolvedValue([{ story_id: 'story-one', published: false }]);
    el('articlesRetry').click();
    await settled();
    expect(toggle().checked).toBe(false);
    expect(toggle().disabled).toBe(false);
    expect(el('articlesRetry').textContent).toBe('목록 상태 새로고침');
  });

  it('keeps last successful hidden state during a failed reload but disables writes', async () => {
    const { readVisibility, el, start, settled, toggle } = articles({ visibility: [{ story_id: 'story-one', published: false }] });
    start();
    await settled();
    const lastSuccess = el('articlesLoadStatus').dataset.lastSuccess;
    readVisibility.mockRejectedValue(new Error('offline'));
    // Refresh through the page control; a failed read must keep the saved map.
    el('articlesRetry').click();
    await settled();
    expect(toggle().checked).toBe(false);
    expect(toggle().disabled).toBe(true);
    expect(el('articlesLoadStatus').textContent).toContain('이전 상태');
    expect(el('articlesLoadStatus').dataset.lastSuccess).toBe(lastSuccess);
  });

  it.each([null, { error: 'offline' }, [{ story_id: 'story-one' }]])(
    'rejects missing/malformed visibility response %j', async (visibility) => {
      const { el, start, settled, toggle } = articles({ visibility });
      start();
      await settled();
      expect(el('articlesLoadStatus').textContent).toContain('확인 불가');
      expect(toggle().disabled).toBe(true);
    },
  );

  it('shows a failed static article fetch as unavailable, not an empty successful list', async () => {
    const { el, start, settled } = articles({ fetchOk: false });
    start();
    await settled();
    expect(el('articlesCount').textContent).toBe('확인 불가');
    expect(el('articlesList').textContent).toContain('불러오지 못했습니다');
    expect(el('articlesLoadStatus').textContent).toContain('HTTP 503');
  });

  it('writes the existing visibility API and announces list-only effect', async () => {
    const { window, setPublished, el, start, settled, toggle } = articles();
    start();
    await settled();
    toggle().checked = false;
    toggle().dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(window.document.querySelector('.pub-toggle-label').textContent).toBe('목록에서 숨김'));
    expect(setPublished).toHaveBeenCalledWith('story-one', false, true);
    expect(el('toast').textContent).toContain('직접 URL 접근은 그대로');
    expect(toggle().disabled).toBe(false);
  });

  it('rolls back a rejected visibility write instead of claiming success', async () => {
    const { window, setPublished, el, start, settled, toggle } = articles();
    setPublished.mockResolvedValue({ error: { message: 'write denied' } });
    start();
    await settled();
    toggle().checked = false;
    toggle().dispatchEvent(new window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(el('toast').textContent).toContain('토글 실패'));
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(false);
    expect(el('toast').textContent).toContain('write denied');
  });

  it('times out a hanging visibility query and ignores its late result after retry', async () => {
    vi.useFakeTimers();
    const { readVisibility, el, start, toggle } = articles();
    let resolveVisibility;
    readVisibility.mockReturnValueOnce(new Promise((resolve) => { resolveVisibility = resolve; }));
    start();
    await vi.advanceTimersByTimeAsync(15000);
    expect(el('articlesLoadStatus').textContent).toContain('확인 불가');
    expect(toggle().disabled).toBe(true);
    readVisibility.mockResolvedValue([{ story_id: 'story-one', published: false }]);
    el('articlesRetry').click();
    await vi.advanceTimersByTimeAsync(0);
    resolveVisibility([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(toggle().checked).toBe(false);
    expect(toggle().disabled).toBe(false);
  });
});
