import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const adminSource = readFileSync('js/db/admin.js', 'utf8');
const dbSource = readFileSync('js/db-client.js', 'utf8');
let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

function setup({ error = null, available = true, modernError = null, rpcResponses = {}, tableResponses = {} } = {}) {
  dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://5ftmag.com/admin/index.html', runScripts: 'outside-only',
  });
  const window = dom.window;
  window.console.warn = vi.fn();
  const rpc = vi.fn(async (name) => {
    if (Object.hasOwn(rpcResponses, name)) return rpcResponses[name];
    if (name === 'admin_client_errors_recent_v2' && modernError) return { data: null, error: modernError };
    const data = name === 'admin_analytics_summary' ? [{ views_today: 0, views_yesterday: 0 }]
      : name === 'admin_uploads_summary' ? [{ total_pending: 0 }] : [];
    return { data: error ? null : data, error };
  });
  const from = vi.fn((table) => {
    const result = Object.hasOwn(tableResponses, table) ? tableResponses[table]
      : { data: error ? null : [], count: error ? null : 0, error };
    const query = {
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ['select', 'eq', 'is', 'order', 'limit']) query[method] = vi.fn(() => query);
    return query;
  });
  if (available) {
    window.supabase = {
      createClient: () => ({
        rpc, from,
        auth: { onAuthStateChange: vi.fn(), getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
      }),
    };
  }
  window.eval(adminSource);
  window.eval(dbSource);
  return { db: window.MagDB, rpc, from };
}

const reads = [
  ['uploads', (db, strict) => db.analytics.uploadsSummary({ strict }), { total_pending: 0 }],
  ['summary', (db, strict) => db.analytics.summary({ strict }), { views_today: 0, views_yesterday: 0 }],
  ['errors', (db, strict) => db.analytics.clientErrorsRecent(24, 50, { strict }), []],
  ['reports', (db, strict) => db.market.adminReportCount('pending', { strict }), 0],
  ['proposals', (db, strict) => db.filmProposals.listForReview({ status: 'pending', limit: 100, strict }), []],
  ['messages', (db, strict) => db.messages.unreadCountForAdmin({ strict }), 0],
  ['visibility', (db, strict) => db.articles.visibility({ strict }), []],
];

const nullReads = [
  ['uploads', reads[0][1], { rpcResponses: { admin_uploads_summary: { data: null, error: null } } }, null],
  ['summary', reads[1][1], { rpcResponses: { admin_analytics_summary: { data: null, error: null } } }, null],
  ['errors', reads[2][1], { rpcResponses: { admin_client_errors_recent_v2: { data: null, error: null } } }, []],
  ['reports', reads[3][1], { tableResponses: { market_reports: { count: null, error: null } } }, 0],
  ['proposals', reads[4][1], { tableResponses: { film_proposals: { data: null, error: null } } }, []],
  ['messages', reads[5][1], { tableResponses: { messages: { count: null, error: null } } }, 0],
  ['visibility', reads[6][1], { tableResponses: { story_visibility: { data: null, error: null } } }, []],
];

describe('real MagDB administrator strict read contract', () => {
  it.each(reads)('%s propagates a backend error in strict mode', async (_, read) => {
    const error = { message: 'permission denied', code: '42501' };
    const { db } = setup({ error });
    await expect(read(db, true)).rejects.toMatchObject(error);
  });

  it.each(reads)('%s rejects an unavailable SDK instead of returning an empty result', async (_, read) => {
    const { db } = setup({ available: false });
    await expect(read(db, true)).rejects.toThrow(/unavailable/i);
  });

  it.each(reads)('%s preserves successful zero or empty data', async (_, read, expected) => {
    const { db } = setup();
    await expect(read(db, true)).resolves.toEqual(expected);
  });

  it.each(reads)('%s keeps legacy non-strict callers from gaining query-error rejections', async (_, read) => {
    const { db } = setup({ error: { message: 'offline' } });
    await expect(read(db, false)).resolves.not.toBeUndefined();
  });

  it.each(nullReads)('%s rejects a null result even when the backend reports no error', async (_, read, options) => {
    const { db } = setup(options);
    await expect(read(db, true)).rejects.toThrow(/invalid/i);
  });

  it.each(nullReads)('%s retains its legacy null-result fallback outside strict mode', async (_, read, options, fallback) => {
    const { db } = setup(options);
    await expect(read(db, false)).resolves.toEqual(fallback);
  });

  it.each([
    ['uploads empty array', reads[0][1], 'admin_uploads_summary', []],
    ['uploads null row', reads[0][1], 'admin_uploads_summary', [null]],
    ['summary empty array', reads[1][1], 'admin_analytics_summary', []],
    ['summary null row', reads[1][1], 'admin_analytics_summary', [null]],
  ])('%s is rejected instead of becoming a valid summary', async (_, read, rpcName, data) => {
    const { db } = setup({ rpcResponses: { [rpcName]: { data, error: null } } });
    await expect(read(db, true)).rejects.toThrow(/invalid/i);
    await expect(read(db, false)).resolves.toBeNull();
  });

  it.each([null, {}, { story_id: 'one', published: null }])(
    'visibility rejects a null or incomplete row (%j) instead of trusting a static default', async (row) => {
      const { db } = setup({ tableResponses: { story_visibility: { data: [row], error: null } } });
      await expect(db.articles.visibility({ strict: true })).rejects.toThrow(/invalid/i);
      await expect(db.articles.visibility()).resolves.toEqual([row]);
    },
  );

  it('uses a successful legacy error RPC when the modern RPC is unavailable', async () => {
    const { db, rpc } = setup({ modernError: { code: 'PGRST202', message: 'function not found' } });
    await expect(db.analytics.clientErrorsRecent(24, 50, { strict: true })).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('admin_client_errors_recent_v2', { p_hours: 24, p_limit: 50 });
    expect(rpc).toHaveBeenCalledWith('admin_client_errors_recent', { p_hours: 24, p_limit: 50 });
  });

  it('rejects null data from the legacy error RPC after modern RPC failure', async () => {
    const { db, rpc } = setup({
      modernError: { code: 'PGRST202', message: 'function not found' },
      rpcResponses: { admin_client_errors_recent: { data: null, error: null } },
    });
    await expect(db.analytics.clientErrorsRecent(24, 50, { strict: true })).rejects.toThrow(/invalid/i);
    expect(rpc).toHaveBeenCalledWith('admin_client_errors_recent', { p_hours: 24, p_limit: 50 });
    await expect(db.analytics.clientErrorsRecent(24, 50)).resolves.toEqual([]);
  });
});
