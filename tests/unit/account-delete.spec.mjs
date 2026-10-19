// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createAccountDeleteHandler, DELETE_STEPS, USER_BUCKETS,
} from '../../supabase/functions/account-delete/handler.ts';

const UID = '00000000-0000-4000-8000-0000000000aa';

// 호출 순서를 한 줄씩 남기는 service role 대역. storage 는 폴더(id null)와 페이지 넘김을 흉내 낸다.
function setup({ editor = false, files = {}, fail = null, authDeleteError = null } = {}) {
  const calls = [];
  const store = Object.fromEntries(USER_BUCKETS.map(b => [b, new Set(files[b] || [])]));
  const listCalls = [];
  const from = vi.fn((table) => {
    const filters = [];
    let op = 'select';
    let patch = null;
    const result = () => {
      if (fail === `${op}:${table}`) return { data: null, error: { message: `${table} boom`, code: 'XX000' } };
      return { data: table === 'profiles' && op === 'select' ? { is_editor: editor } : null, error: null };
    };
    const q = {
      select: () => q,
      update: (p) => { op = 'update'; patch = p; return q; },
      delete: () => { op = 'delete'; return q; },
      eq: (k, v) => { filters.push(['eq', k, v]); return q; },
      not: (k, o, v) => { filters.push(['not', k, o, v]); return q; },
      maybeSingle: async () => { calls.push({ op, table, filters }); return result(); },
      then: (resolve, reject) => {
        calls.push({ op, table, filters, patch });
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return q;
  });
  const storage = {
    from: (bucket) => ({
      async list(prefix, { limit, offset }) {
        listCalls.push({ bucket, prefix, limit, offset });
        if (fail === `list:${bucket}`) return { data: null, error: { message: 'list boom' } };
        const names = new Map();
        for (const path of store[bucket]) {
          if (!path.startsWith(prefix + '/')) continue;
          const rest = path.slice(prefix.length + 1);
          const [head, ...tail] = rest.split('/');
          names.set(head, tail.length ? null : 'file-id');
        }
        const items = [...names].sort(([a], [b]) => a.localeCompare(b))
          .map(([name, id]) => ({ name, id }));
        return { data: items.slice(offset, offset + limit), error: null };
      },
      async remove(paths) {
        calls.push({ op: 'remove', table: bucket, paths });
        if (fail === `remove:${bucket}`) return { data: null, error: { message: 'remove boom' } };
        for (const p of paths) store[bucket].delete(p);
        return { data: [], error: null };
      },
    }),
  };
  const getUser = vi.fn(async token => ({ data: { user: token === 'good' ? { id: UID } : null }, error: null }));
  const deleteUser = vi.fn(async (id) => { calls.push({ op: 'auth.deleteUser', table: id }); return { error: authDeleteError }; });
  const handler = createAccountDeleteHandler({ admin: { from, storage, auth: { getUser, admin: { deleteUser } } } });
  async function request(body = { confirm: '탈퇴' }, token = 'good', init = {}) {
    const headers = { 'content-type': 'application/json', origin: 'https://www.5ftmag.com' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handler(new Request('https://x.test/account-delete', {
      method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body), ...init,
    }));
    return { status: res.status, body: await res.json().catch(() => null), res };
  }
  return { calls, store, listCalls, from, getUser, deleteUser, request };
}

describe('account-delete 요청 검사', () => {
  it('토큰이 없거나 틀리면 401, 아무것도 지우지 않는다', async () => {
    const s = setup();
    expect((await s.request(undefined, null)).status).toBe(401);
    expect((await s.request(undefined, 'bad')).status).toBe(401);
    expect(s.calls).toEqual([]);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it('확인 문구가 「탈퇴」가 아니면 400', async () => {
    const s = setup();
    for (const body of [{}, { confirm: 'delete' }, { confirm: ' 탈퇴' }, 'not json']) {
      const r = await s.request(body);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('confirm_required');
    }
    expect(s.calls).toEqual([]);
  });

  it('편집부 계정은 409, 파일·행·계정 모두 그대로', async () => {
    const s = setup({ editor: true, files: { 'user-avatars': [`${UID}/a.jpg`] } });
    const r = await s.request();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('편집부 계정은 운영자가 직접 처리합니다');
    expect(s.calls.map(c => c.op)).toEqual(['select']);
    expect(s.store['user-avatars'].size).toBe(1);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it('POST 만 받고 CORS 는 5ftmag 도메인·Netlify 미리보기만 돌려준다', async () => {
    const s = setup();
    const get = await s.request(undefined, 'good', { method: 'GET', body: undefined });
    expect(get.status).toBe(405);
    const r = await s.request();
    expect(r.res.headers.get('access-control-allow-origin')).toBe('https://www.5ftmag.com');
  });
});

describe('account-delete 정상 흐름', () => {
  it('파일 → 익명화 → 행 삭제 → auth 삭제 순서로 진행한다', async () => {
    const s = setup({ files: {
      'reader-submissions': [`${UID}/p1.jpg`, `${UID}/sub/p2.jpg`, 'someone-else/p.jpg'],
      'market-listings': [`${UID}/m1.jpg`],
      'user-avatars': [`${UID}/avatar-1.webp`],
    } });
    const r = await s.request();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, files: { 'reader-submissions': 2, 'market-listings': 1, 'user-avatars': 1 } });
    expect([...s.store['reader-submissions']]).toEqual(['someone-else/p.jpg']);
    expect(s.store['market-listings'].size).toBe(0);

    const seq = s.calls.map(c => `${c.op}:${c.table}`);
    expect(seq).toEqual([
      'select:profiles',
      'remove:reader-submissions', 'remove:market-listings', 'remove:user-avatars',
      'update:comments', 'update:ebook_entitlements',
      ...DELETE_STEPS.map(d => `delete:${d.table}`),
      `auth.deleteUser:${UID}`,
    ]);
    // 알림은 투고 뒤(투고 삭제 트리거가 알림을 넣는다), 프로필은 행 삭제의 마지막
    expect(seq.indexOf('delete:user_notifications')).toBeGreaterThan(seq.indexOf('delete:reader_submissions'));
    expect(seq.at(-2)).toBe('delete:profiles');

    const comments = s.calls.find(c => c.op === 'update' && c.table === 'comments');
    expect(comments.patch).toEqual({ user_id: null });
    expect(comments.filters).toEqual([['eq', 'user_id', UID]]);
    const ent = s.calls.find(c => c.op === 'update' && c.table === 'ebook_entitlements');
    expect(ent.patch).toEqual({ order_ref: '' });
    expect(ent.filters).toEqual([['eq', 'user_id', UID], ['not', 'source', 'in', '(portone,smartstore)']]);
    for (const c of s.calls.filter(c => c.op === 'delete')) {
      expect(c.filters).toHaveLength(1);
      expect(c.filters[0][2]).toBe(UID);
    }
    expect(s.calls.find(c => c.table === 'market_reports').filters[0][1]).toBe('reporter_id');
  });

  it('스토리지 목록을 페이지로 끝까지 받아 지운다(100개씩)', async () => {
    const many = Array.from({ length: 230 }, (_, i) => `${UID}/f${String(i).padStart(3, '0')}.jpg`);
    const s = setup({ files: { 'reader-submissions': many } });
    const r = await s.request();
    expect(r.status).toBe(200);
    expect(r.body.files['reader-submissions']).toBe(230);
    expect(s.store['reader-submissions'].size).toBe(0);
    const offsets = s.listCalls.filter(c => c.bucket === 'reader-submissions' && c.prefix === UID).map(c => c.offset);
    expect(offsets).toEqual([0, 100, 200]);
    const removes = s.calls.filter(c => c.op === 'remove' && c.table === 'reader-submissions');
    expect(removes.map(c => c.paths.length)).toEqual([100, 100, 30]);
  });

  it('중간 실패는 단계·코드와 함께 500, 그 뒤 단계는 하지 않는다. 다시 부르면 끝까지 간다', async () => {
    const s = setup({ files: { 'user-avatars': [`${UID}/a.jpg`] }, fail: 'delete:messages' });
    const r = await s.request();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ code: 'delete_failed', step: 'delete:messages', error: 'messages boom' });
    expect(s.deleteUser).not.toHaveBeenCalled();
    expect(s.calls.some(c => c.table === 'profiles' && c.op === 'delete')).toBe(false);

    const retry = setup({ files: { 'user-avatars': [] } });
    const again = await retry.request();
    expect(again.status).toBe(200);
    expect(again.body.files['user-avatars']).toBe(0);
    expect(retry.deleteUser).toHaveBeenCalledWith(UID);
  });

  it('스토리지·auth 실패도 단계를 알려 준다. auth 404 는 이미 지운 것으로 본다', async () => {
    const list = await setup({ fail: 'list:market-listings' }).request();
    expect(list.body).toMatchObject({ code: 'storage_list_failed', step: 'storage:market-listings' });
    const rm = await setup({ files: { 'user-avatars': [`${UID}/a.jpg`] }, fail: 'remove:user-avatars' }).request();
    expect(rm.body).toMatchObject({ code: 'storage_remove_failed', step: 'storage:user-avatars' });
    const authFail = await setup({ authDeleteError: { message: 'Database error deleting user', status: 500 } }).request();
    expect(authFail.status).toBe(500);
    expect(authFail.body).toMatchObject({ code: 'auth_delete_failed', step: 'auth' });
    const gone = await setup({ authDeleteError: { message: 'User not found', status: 404 } }).request();
    expect(gone.status).toBe(200);
  });

  it('로그에 user id·오류 본문을 남기지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setup({ fail: 'delete:likes' }).request();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(UID);
    expect(logged).not.toContain('boom');
    spy.mockRestore();
    const src = readFileSync('supabase/functions/account-delete/handler.ts', 'utf8');
    expect(src.match(/console\.\w+\(/g)).toHaveLength(1);
  });

  it('index.ts 는 service role 키를 환경변수로만 읽는다', () => {
    const src = readFileSync('supabase/functions/account-delete/index.ts', 'utf8');
    expect(src).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});
