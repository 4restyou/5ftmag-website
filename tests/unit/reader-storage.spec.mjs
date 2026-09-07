import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());
function setup() {
  dom = new JSDOM('', { url: 'https://5ftmag.com/', runScripts: 'outside-only' });
  const w = dom.window;
  const rows = new Map();
  let inserts = 0;
  const auth = { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token', user: { id: 'owner' } } } }), onAuthStateChange() {} };
  const c = { auth, from() {
    const filters = {};
    let record, signal;
    const q = {
      select() { return q; }, eq(k, v) { filters[k] = v; return q; }, maybeSingle() { return q; },
      insert(value) { record = value; return q; }, abortSignal(value) { signal = value; return q; },
      then(resolve, reject) {
        let result;
        if (signal?.aborted) result = { error: { message: 'aborted' } };
        else if (record) {
          inserts++;
          if (rows.has(record.id)) result = { error: { code: '23505' } };
          else { rows.set(record.id, record); result = { error: null }; }
        } else {
          result = { data: [...rows.values()].find(r => Object.entries(filters).every(([k, v]) => r[k] === v)) || null, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  } };
  w.supabase = { createClient: () => c };
  w.MagDBCommerce = { create: () => ({}) };
  w.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => '5' } });
  w.eval(readFileSync('js/db-client.js', 'utf8'));
  return { w, api: w.MagDB.submissions, rows, auth, inserts: () => inserts };
}
const record = { id: 'request-id', user_id: 'owner', storage_path: 'owner/photo.jpg' };

describe('reader storage and submission identity', () => {
  it('does not insert again when the first response was lost', async () => {
    const { api, inserts } = setup();
    await api.create(record);
    const retry = await api.create(record);
    expect(retry.error).toBeNull();
    expect(inserts()).toBe(1);
  });
  it('does not treat another owner or path as a successful retry', async () => {
    const { api, rows } = setup();
    rows.set(record.id, { ...record, user_id: 'someone-else' });
    expect((await api.create(record)).error.code).toBe('23505');
  });
  it('sends the abort signal to the real upload request', async () => {
    const { w, api } = setup();
    const controller = new w.AbortController();
    await api.uploadPhoto('owner/photo.jpg', new w.Blob(['photo']), { signal: controller.signal });
    expect(w.fetch.mock.calls[0][1].signal).toBe(controller.signal);
    expect(w.fetch.mock.calls[0][1].headers.authorization).toBe('Bearer test-token');
    expect(w.fetch.mock.calls[0][1].headers['x-upsert']).toBe('false');
    expect(w.fetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
    expect(w.fetch.mock.calls[0][1].body).toBeInstanceOf(w.FormData);
    expect(w.fetch.mock.calls[0][1].body.get('cacheControl')).toBe('3600');
    expect(w.fetch.mock.calls[0][1].body.get('')).toBeInstanceOf(w.Blob);
  });
  it('does not start a request after cancellation during session lookup', async () => {
    const { w, api, auth } = setup();
    let release;
    auth.getSession.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new w.AbortController();
    const request = api.uploadPhoto('owner/photo.jpg', new w.Blob(['photo']), { signal: controller.signal });
    controller.abort();
    release({ data: { session: { access_token: 'test', user: { id: 'owner' } } } });
    expect((await request).error.code).toBe('ABORTED');
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it('recovers only matching file sizes and rejects a changed account', async () => {
    const { api, w } = setup();
    expect((await api.photoExists('owner/photo.jpg', 5)).exists).toBe(true);
    expect((await api.photoExists('owner/photo.jpg', 7)).exists).toBe(false);
    expect((await api.uploadPhoto('other/photo.jpg', new w.Blob(['photo']))).error.status).toBe(401);
    expect(w.fetch).toHaveBeenCalledTimes(2);
  });
  it('accepts a successful HEAD when CORS hides Content-Length', async () => {
    const { api, w } = setup();
    w.fetch.mockResolvedValueOnce({ ok: true, headers: { get: () => null } });
    expect((await api.photoExists('owner/photo.jpg', 5)).exists).toBe(true);
  });
  it('never restarts TUS when cancellation races with previous-upload lookup', async () => {
    const { api, w } = setup();
    let release, instance;
    w.tus = { Upload: class {
      constructor(_blob, opts) { instance = this; this.opts = opts; this.start = vi.fn(); this.abort = vi.fn().mockResolvedValue(); }
      findPreviousUploads() { return new Promise(resolve => { release = resolve; }); }
    } };
    const controller = new w.AbortController();
    const request = api.uploadPhotoResumable('owner/photo.jpg', new w.Blob(['photo']), { signal: controller.signal });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    release([]);
    expect((await request).error.code).toBe('ABORTED');
    await Promise.resolve();
    expect(instance.abort).toHaveBeenCalledOnce();
    expect(instance.start).not.toHaveBeenCalled();
    expect(await instance.opts.fingerprint()).toContain('owner/photo.jpg');
  });
});
