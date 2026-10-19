// 회원 스스로 탈퇴. 런타임 의존(service role 클라이언트)을 주입받아 Deno 없이 vitest 로 시험한다.
// deno-lint-ignore-file no-explicit-any
//
// 순서: 본인 확인(getUser) → 확인 문구 → 편집부 차단 → 스토리지 파일 → 남길 행 익명화
//       → 지울 행 삭제 → auth 사용자 삭제.
// 각 단계는 다시 돌려도 안전하다(이미 지운 것은 0건으로 지나간다). 중간에 실패하면
// 어느 단계인지(step)와 오류 코드(code)를 500 으로 돌려준다. 로그에는 단계와 코드만 남긴다
// (user id·이름·본문 같은 개인정보는 남기지 않는다).

export const CONFIRM_WORD = '탈퇴';

// 회원 폴더(<uid>/...)를 쓰는 공개 버킷. 정책이 모두 (storage.foldername(name))[1] = auth.uid() 다.
export const USER_BUCKETS = ['reader-submissions', 'market-listings', 'user-avatars'];

// 남기되 회원과의 연결·개인정보를 끊는 행.
//   comments: 본문은 두고 작성자만 끊는다 → 화면에 「탈퇴한 회원」.
//   ebook_entitlements: 구매 기록 5년 보존. 수동 부여의 order_ref 는 입금자명 메모라 비운다.
//     자동 결제(portone·smartstore)의 order_ref 는 결제 ID·주문번호라 남긴다(같은 결제 재사용 차단 인덱스).
//     user_id 는 auth 삭제 때 외래키(ON DELETE SET NULL)가 비운다.
//   ebook_checkout_orders.buyer_id 도 외래키가 비운다(장부라 직접 고칠 수 없다).
export const ANONYMIZE_STEPS: Array<{ table: string; column: string; patch: Record<string, unknown>; manualOnly?: boolean }> = [
  { table: 'comments', column: 'user_id', patch: { user_id: null } },
  { table: 'ebook_entitlements', column: 'user_id', patch: { order_ref: '' }, manualOnly: true },
];

// 지우는 행. 순서가 의미 있다.
//   reader_submissions 를 지우면 삭제 알림 트리거가 user_notifications 에 한 줄을 넣으므로
//   알림은 투고·매물 뒤에 지운다. profiles 는 마지막(편집부 검사·표시 이름이 그 전까지 필요).
//   외래키가 없는 기록(market_contact_reveals·reader_auto_*·ebook_redeem_attempts)은 auth 삭제로
//   함께 사라지지 않아 반드시 여기서 지운다. 나머지도 운영 DB 의 외래키 차이에 기대지 않게 직접 지운다.
export const DELETE_STEPS: Array<{ table: string; column: string }> = [
  { table: 'likes', column: 'user_id' },
  { table: 'user_favorites', column: 'user_id' },
  { table: 'user_recent_films', column: 'user_id' },
  { table: 'user_fav_brands', column: 'user_id' },
  { table: 'market_contact_reveals', column: 'user_id' },
  { table: 'market_reports', column: 'reporter_id' },
  { table: 'market_listings', column: 'user_id' },
  { table: 'reader_auto_approvals', column: 'user_id' },
  { table: 'reader_auto_approve_revoked', column: 'user_id' },
  { table: 'reader_submissions', column: 'user_id' },
  { table: 'film_proposals', column: 'user_id' },
  { table: 'ebook_redeem_attempts', column: 'user_id' },
  { table: 'messages', column: 'user_id' },
  { table: 'push_subscriptions', column: 'user_id' },
  { table: 'user_notifications', column: 'user_id' },
  { table: 'profiles', column: 'user_id' },
];

const LIST_PAGE = 100;
const REMOVE_CHUNK = 100;

function cors(origin: string | null): Record<string, string> {
  const allowed = origin === 'https://www.5ftmag.com' || origin === 'https://5ftmag.com'
    || /^https:\/\/([a-z0-9]+(-[a-z0-9]+)*--)?5ftmag\.netlify\.app$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : 'https://www.5ftmag.com',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

class StepError extends Error {
  step: string;
  code: string;
  constructor(step: string, code: string, message: string) {
    super(message);
    this.step = step;
    this.code = code;
  }
}

function fail(step: string, code: string, error: any): never {
  throw new StepError(step, code, String(error?.message || error || code));
}

// <uid>/ 아래 파일 경로를 끝까지 모은다. list 는 한 단계만 보여 주고 폴더는 id 가 null 이다.
async function listAll(bucket: any, prefix: string, step: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) fail(step, 'storage_list_failed', error);
    const items = data || [];
    for (const item of items) {
      const path = `${prefix}/${item.name}`;
      if (item.id == null) paths.push(...await listAll(bucket, path, step));
      else paths.push(path);
    }
    if (items.length < LIST_PAGE) break;
  }
  return paths;
}

async function removeUserFiles(admin: any, uid: string) {
  const removed: Record<string, number> = {};
  for (const name of USER_BUCKETS) {
    const step = `storage:${name}`;
    const bucket = admin.storage.from(name);
    const paths = await listAll(bucket, uid, step);
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const { error } = await bucket.remove(paths.slice(i, i + REMOVE_CHUNK));
      if (error) fail(step, 'storage_remove_failed', error);
    }
    removed[name] = paths.length;
  }
  return removed;
}

export function createAccountDeleteHandler({ admin }: { admin: any }) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin');
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(origin) },
    });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (req.method !== 'POST') return json({ error: 'method not allowed', code: 'method' }, 405);

    const auth = req.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json({ error: 'login required', code: 'login_required' }, 401);
    let user: any = null;
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (!error) user = data?.user || null;
    } catch (_) { /* 아래에서 401 */ }
    if (!user?.id) return json({ error: 'login required', code: 'login_required' }, 401);
    const uid = String(user.id);

    let body: any = null;
    try { body = await req.json(); } catch (_) { /* 아래에서 400 */ }
    if (body?.confirm !== CONFIRM_WORD) {
      return json({ error: `confirm must be "${CONFIRM_WORD}"`, code: 'confirm_required' }, 400);
    }

    try {
      const { data: profile, error: profileError } = await admin.from('profiles')
        .select('is_editor').eq('user_id', uid).maybeSingle();
      if (profileError) fail('profile', 'profile_lookup_failed', profileError);
      if (profile?.is_editor) {
        return json({ error: '편집부 계정은 운영자가 직접 처리합니다', code: 'editor_account' }, 409);
      }

      const files = await removeUserFiles(admin, uid);

      for (const { table, column, patch, manualOnly } of ANONYMIZE_STEPS) {
        let query = admin.from(table).update(patch).eq(column, uid);
        if (manualOnly) query = query.not('source', 'in', '(portone,smartstore)');
        const { error } = await query;
        if (error) fail(`anonymize:${table}`, 'anonymize_failed', error);
      }

      for (const { table, column } of DELETE_STEPS) {
        const { error } = await admin.from(table).delete().eq(column, uid);
        if (error) fail(`delete:${table}`, 'delete_failed', error);
      }

      const { error: authError } = await admin.auth.admin.deleteUser(uid);
      if (authError && authError.status !== 404) fail('auth', 'auth_delete_failed', authError);

      return json({ ok: true, files });
    } catch (e) {
      const err = e instanceof StepError ? e : new StepError('unknown', 'unexpected', (e as Error)?.message || 'unexpected');
      console.error('[account-delete] failed', err.step, err.code);
      return json({ error: err.message, code: err.code, step: err.step }, 500);
    }
  };
}
