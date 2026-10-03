import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let dom;
afterEach(() => dom?.window.close());
function clientSetup(result, signedIn = true) {
  dom = new JSDOM('', { url: 'https://5ftmag.com/', runScripts: 'outside-only' });
  const w = dom.window;
  const q = {
    update: vi.fn(() => q), eq: vi.fn(() => q),
    select: vi.fn(async () => result),
  };
  const auth = { getSession: vi.fn(async () => ({ data: { session: signedIn ? { user: { id: 'owner' } } : null } })), onAuthStateChange() {} };
  w.supabase = { createClient: () => ({ auth, from: () => q }) };
  w.MagDBCommerce = { create: () => ({}) };
  w.eval(readFileSync('js/db-client.js', 'utf8'));
  return { api: w.MagDB.submissions, q };
}

describe('reader update confirmation', () => {
  it('confirms the actual updated ID and constrains the query to its owner', async () => {
    const { api, q } = clientSetup({ data: [{ id: 'photo' }], error: null });
    expect((await api.updateMine('photo', { caption: 'Note' })).error).toBeNull();
    expect(q.eq.mock.calls).toEqual([['id', 'photo'], ['user_id', 'owner']]);
    expect(q.select).toHaveBeenCalledWith('id');
  });
  it.each([[[]], [null], [[{ id: 'different-photo' }]]])('rejects unconfirmed data %j', async data => {
    expect((await clientSetup({ data, error: null }).api.updateMine('photo', { caption: 'Note' })).error.code).toBe('RLS_DENIED');
  });
  it('preserves the server error', async () => {
    const error = { code: '42501', message: 'denied' };
    expect((await clientSetup({ data: null, error }).api.updateMine('photo', {})).error).toEqual(error);
  });
  it('does not attempt a write while signed out', async () => {
    const { api, q } = clientSetup({}, false);
    expect((await api.updateMine('photo', {})).error.code).toBe('AUTH_REQUIRED');
    expect(q.update).not.toHaveBeenCalled();
  });
});

function uiSetup(update) {
  dom = new JSDOM(readFileSync('me.html', 'utf8'), { url: 'https://5ftmag.com/me.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.document.body.insertAdjacentHTML('beforeend', '<div data-id="photo"><textarea data-edit="caption">My note</textarea><button data-action="save">Save</button></div>');
  w.i18n = { t: ko => ko, isEn: false };
  w.eval(readFileSync('js/util.js', 'utf8'));
  w.notify = vi.fn();
  const reload = vi.fn(async () => []);
  w.MagDB = { isReady: () => true, auth: { getSession: () => new Promise(() => {}) }, submissions: { updateMine: update, listMine: reload } };
  w.eval(readFileSync('js/me-page.js', 'utf8') + '\nwindow.readerEditAudit = { savePhotoEdits };');
  return { w, card: w.document.querySelector('[data-id]'), reload };
}

describe('photo edit UI retains unsaved input', () => {
  it.each(['empty', 'throw', 'error'])('keeps the edit form available after %s', async kind => {
    const update = vi.fn(async () => {
      if (kind === 'throw') throw new Error('offline');
      return kind === 'error' ? { error: { message: 'denied' } } : { error: null, data: [] };
    });
    const { w, card, reload } = uiSetup(update);
    await w.readerEditAudit.savePhotoEdits(card);
    expect(reload).not.toHaveBeenCalled();
    expect(card.querySelector('textarea').value).toBe('My note');
    expect(card.querySelector('button').disabled).toBe(false);
    expect(w.notify).toHaveBeenCalledWith(expect.any(String), 'danger');
  });
  it('reloads only after a confirmed successful save', async () => {
    const { w, card, reload } = uiSetup(vi.fn(async () => ({ data: [{ id: 'photo' }], error: null })));
    await w.readerEditAudit.savePhotoEdits(card);
    expect(reload).toHaveBeenCalledOnce();
    expect(w.notify).not.toHaveBeenCalled();
  });
});
