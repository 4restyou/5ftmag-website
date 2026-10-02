// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { withDbVisibility } from '../../scripts/story-visibility.mjs';

const code = await fs.readFile('js/util.js', 'utf8');
const stories = [{ id: 'hidden', published: true }, { id: 'visible', published: true }];
const rows = [{ story_id: 'hidden', published: false }];

function browserUtil(fetch, cached = null) {
  const storage = new Map(cached ? [['5ft-story-visibility-v1', JSON.stringify(cached)]] : []);
  const window = {};
  const context = {
    window, document: { documentElement: { lang: 'ko' } }, fetch, console, setTimeout, clearTimeout, AbortController,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    Intl, URLSearchParams,
  };
  vm.runInNewContext(code, context);
  return window.MagUtil;
}

describe('visibility failure preserves known hidden stories', () => {
  it('browser uses a build snapshot when the database fails', async () => {
    const util = browserUtil(async url => {
      if (url.includes('/rest/')) throw new Error('offline');
      return { ok: true, json: async () => url.endsWith('stories.json') ? stories : { checkedAt: '2026-10-02T10:00:00Z', rows } };
    });
    expect((await util.loadStories()).find(story => story.id === 'hidden').published).toBe(false);
  });

  it('uses a newer successful session state and allows a valid empty live override', async () => {
    const fallbackFetch = async url => {
      if (url.includes('/rest/')) return { ok: false, status: 503 };
      return { ok: true, json: async () => url.endsWith('stories.json') ? stories : { checkedAt: '2026-10-01T10:00:00Z', rows: [] } };
    };
    const cachedUtil = browserUtil(fallbackFetch, { checkedAt: '2026-10-02T10:00:00Z', rows });
    expect((await cachedUtil.loadStories())[0].published).toBe(false);
    const liveUtil = browserUtil(async url => ({ ok: true, json: async () => url.includes('/rest/') ? [] : stories }), { checkedAt: '2026-10-02T10:00:00Z', rows });
    expect((await liveUtil.loadStories())[0].published).toBe(true);
  });

  it('does not publish default-public stories when no valid visibility state exists', async () => {
    const util = browserUtil(async url => {
      if (url.endsWith('stories.json')) return { ok: true, json: async () => stories };
      throw new Error('offline');
    });
    expect(await util.loadStories()).toEqual([]);
  });

  it('build retains a successful snapshot on a later outage and fails without one', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), '5ft-visibility-'));
    const snapshotPath = path.join(dir, 'visibility.json');
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => rows }));
      expect((await withDbVisibility(stories, { snapshotPath }))[0].published).toBe(false);
      globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
      expect((await withDbVisibility(stories, { snapshotPath }))[0].published).toBe(false);
      await fs.rm(snapshotPath);
      await expect(withDbVisibility(stories, { snapshotPath })).rejects.toThrow('no valid snapshot');
    } finally {
      globalThis.fetch = realFetch;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
