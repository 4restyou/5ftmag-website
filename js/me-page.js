'use strict';

const i18n = window.i18n;
// 이 파일의 상대 링크(films.html 등). 영문판에선 /en/ 쪽으로 보낸다. 한국어 출력은 그대로.
const pageHref = (p) => i18n.isEn ? i18n.url('/' + p) : p;

const STATE = {
  user: null,
  section: 'photos',     // 'photos' | 'market' | 'notifs' | 'my-comments' | 'fav-*'
  // photos
  rows: [],
  filter: 'all',
  // market
  marketRows: [],
  // notifications & 내 댓글
  notifs: null,
  messages: null,
  sendingMessage: false,
  myComments: null,
  myProposals: null,
  myBooks: null,         // 열람권이 있는 이북

  // favorites
  favPhotos: null,       // null = 미로딩, [] = 비어있음
  favFilms:  null,
  favWebzine: null,
  favArticles: null,
  favContributors: null,
  filmsData: null,       // films.json 캐시 (좋아한 필름 렌더용)
  storiesData: null,     // stories.json 캐시 (스크랩한 글 렌더용)
  profile: null,         // 내 프로필 (프로필 편집 폼 prefill)
  profileLoaded: false,
  pendingAvatar: null,   // 저장 전 임시 업로드된 아바타 {url, path}
};

const CAT_LABELS = { film:i18n.t('필름', 'Film', 'フィルム'), camera:i18n.t('카메라', 'Cameras', 'カメラ'), lens:i18n.t('렌즈', 'Lenses', 'レンズ'), accessory:i18n.t('액세서리', 'Accessories', 'アクセサリー'), etc:i18n.t('기타', 'Other', 'その他') };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil.escapeHtml(s); }
function escapeAttr(s) { return window.MagUtil.escapeAttr(s); }
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
// "30000000" → "30,000,000원". 숫자가 아니면 (예: "가격 협의") 원문 그대로.
function fmtPrice(v) { return window.MagUtil.formatPrice(v, { keepText: true }); }
// 검토 상태(사진 투고·필름 제안 등) 이름은 이 한 곳에서 정한다. 탭마다 이름이 달랐던 것을 한 벌로 묶었다
function reviewStatusLabel(s) {
  return ({ pending: i18n.t('대기', 'Pending', '審査中'), approved: i18n.t('공개 중', 'Published', '公開中'), rejected: i18n.t('반려', 'Rejected', '不採用') })[s] || '';
}
function statusLabel(s) {
  return reviewStatusLabel(s) || ({
           available:i18n.t('판매중', 'For sale', '販売中'), reserved:i18n.t('예약중', 'Reserved', '予約中'), sold:i18n.t('판매완료', 'Sold', '売約済み'), hidden:i18n.t('숨김', 'Hidden', '非表示') })[s] || s;
}
function nextStatusOf(s) {
  return s === 'available' ? 'reserved' : s === 'reserved' ? 'sold' : 'available';
}

async function checkAuth() {
  if (!db() || !db().isReady()) {
    showAuthError();
    return false;
  }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;
  const profile = await db().profiles.getMine();
  STATE.profile = profile;
  const name = profile?.display_name || STATE.user.email?.split('@')[0] || i18n.t('사용자', 'User', 'ユーザー');
  $('meUser').innerHTML = `${escapeHtml(name)} · <button id="logout">${i18n.t('로그아웃', 'Sign out', 'ログアウト')}</button>`;
  $('logout').addEventListener('click', async () => {
    await db().auth.signOut();
    location.reload();
  });
  return true;
}

// 인증 모듈을 못 불렀을 때. 헤더·푸터는 두고 본문(#gate 자리)에만 안내를 그린다
function showAuthError() {
  const gate = $('gate');
  $('app').hidden = true;
  gate.innerHTML = `
    <h2>${i18n.t('인증 모듈을 불러오지 못했습니다', 'Couldn\'t load the sign-in module', '認証モジュールを読み込めませんでした')}</h2>
    <p>${i18n.t(`새로고침 후에도 반복되면 편집부에 알려주세요 (${window.MagContact.text()}).`, `If this keeps happening after a refresh, please let the editors know (${window.MagContact.text()}).`, `再読み込みしても続く場合は、編集部にお知らせください（${window.MagContact.text()}）。`)}</p>
    <button type="button" class="gate-btn" id="gateRetry">${i18n.t('다시 시도', 'Try again', 'もう一度試す')}</button>
    <p class="gate-home"><a href="${i18n.url('/')}">${i18n.t('홈으로 가기 →', 'Back to home →', 'ホームへ戻る →')}</a></p>`;
  gate.hidden = false;
  $('gateRetry').addEventListener('click', () => location.reload());
}

function showGate() {
  $('gate').hidden = false;
  $('app').hidden = true;
  $('gateLoginSlot').innerHTML = window.MagAuthUI.loginButton({ label: i18n.t('Google로 로그인', 'Sign in with Google', 'Google でログイン'), className: 'gate-btn', attrs: 'id="gateLogin"' });
  $('gateLogin').addEventListener('click', async () => {
    await db().auth.signInWithGoogle(window.location.href.split('#')[0]);
  });
}

// ═════════════════════════════════════════
// 사진 섹션 (기존)
// ═════════════════════════════════════════
async function loadPhotos() {
  $('list').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.rows = await db().submissions.listMine();
  renderPhotoCounts();
  renderPhotoList();
}

function renderPhotoCounts() {
  const counts = { all: STATE.rows.length, pending: 0, approved: 0, rejected: 0 };
  for (const r of STATE.rows) counts[r.status] = (counts[r.status] || 0) + 1;
  for (const k of ['all', 'pending', 'approved', 'rejected']) {
    const el = $(`cnt-${k}`);
    if (el) el.textContent = counts[k];
  }
}

function renderPhotoList() {
  const rows = STATE.filter === 'all' ? STATE.rows : STATE.rows.filter(r => r.status === STATE.filter);
  if (rows.length === 0) {
    const photoEmpty = STATE.filter === 'all'
      ? i18n.t('아직 올린 사진이 없습니다. 독자 사진 영역에 보낼 사진을 메인에서 제출해 보세요.', 'You haven\'t sent any photos yet. Submit one for the reader photo section from the home page.', 'まだ送った写真はありません。読者写真のコーナーに載せたい写真を、トップページから投稿してみてください。')
      : i18n.t(`${statusLabel(STATE.filter)} 상태의 사진이 없습니다. 다른 분류를 선택해 보세요.`, `No photos marked ${statusLabel(STATE.filter)}. Try another filter.`, `「${statusLabel(STATE.filter)}」の写真はありません。別の分類を選んでみてください。`);
    $('list').innerHTML = `
      <div class="me-empty">
        ${photoEmpty}
        <br /><a class="me-empty-cta" href="${i18n.isEn ? '/' + i18n.lang + '/' : 'index.html'}">${i18n.t('메인에서 사진 올리러 가기 →', 'Submit a photo from the home page →', 'トップページから写真を投稿する →')}</a>
      </div>`;
    return;
  }
  $('list').innerHTML = rows.map(renderPhotoCard).join('');
  bindCardImageFallbacks($('list'));
  bindPhotoCardActions();
}

function renderPhotoCard(r) {
  const url = db().submissions.publicUrl(r.storage_path);
  const igNorm = (r.instagram || '').replace(/^@/, '');
  const deleteLabel = r.status === 'pending' ? i18n.t('제출 취소', 'Withdraw', '投稿を取り消す') : i18n.t('삭제', 'Delete', '削除');
  return `
    <div class="me-card" data-id="${r.id}">
      <div class="me-card-img" data-zoom="${escapeAttr(url)}">
        <img src="${escapeAttr(url)}" alt="" loading="lazy" />
      </div>
      <div class="me-card-meta">
        <div>
          <span class="me-card-status ${escapeAttr(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
          ${r.theme_month ? `<span class="me-card-theme">🎬 ${i18n.t(`${escapeHtml(r.theme_month)} 응모`, `${escapeHtml(r.theme_month)} entry`, `${escapeHtml(r.theme_month)} 応募`)}</span>` : ''}
        </div>
        <div class="me-card-row"><span class="k">${i18n.t('제출', 'Submitted', '投稿日')}</span><span class="v">${fmtDate(r.created_at)}</span></div>
        <div class="me-card-row"><span class="k">${i18n.t('이름', 'Name', '名前')}</span><span class="v" data-field="submitter_name">${escapeHtml(r.submitter_name || '-')}</span></div>
        <div class="me-card-row"><span class="k">${i18n.t('인스타', 'Instagram', 'Instagram')}</span><span class="v" data-field="instagram">${escapeHtml(r.instagram || '-')}</span></div>
        <div class="me-card-row"><span class="k">${i18n.t('필름', 'Film', 'フィルム')}</span><span class="v" data-field="film">${escapeHtml(r.film || '-')}</span></div>
        <div class="me-card-row"><span class="k">${i18n.t('카메라', 'Camera', 'カメラ')}</span><span class="v" data-field="camera">${escapeHtml(r.camera || '-')}</span></div>
        <div class="me-card-row"><span class="k">${i18n.t('메모', 'Note', 'メモ')}</span><span class="v" data-field="caption">${escapeHtml(r.caption || '-')}</span></div>
        ${r.rejection_reason ? `<div class="me-card-row"><span class="k">${i18n.t('반려 사유', 'Reason declined', '不採用の理由')}</span><span class="v">${escapeHtml(r.rejection_reason)}</span></div>` : ''}
        <div class="me-card-actions">
          <button type="button" class="me-btn me-btn-secondary" data-action="edit">${i18n.t('수정', 'Edit', '編集')}</button>
          <button type="button" class="me-btn me-btn-danger" data-action="delete">${escapeHtml(deleteLabel)}</button>
        </div>
      </div>
    </div>`;
}

function enterEditMode(card) {
  const id = card.dataset.id;
  const row = STATE.rows.find(r => r.id === id);
  if (!row) return;
  const fields = ['submitter_name', 'instagram', 'film', 'camera', 'caption'];
  for (const f of fields) {
    const cell = card.querySelector(`[data-field="${f}"]`);
    if (!cell) continue;
    const v = row[f] || '';
    const max = f === 'caption' ? 200 : f === 'film' ? 120 : f === 'instagram' || f === 'camera' ? 80 : 60;
    cell.innerHTML = f === 'caption'
      ? `<textarea data-edit="${f}" maxlength="${max}">${escapeHtml(v)}</textarea>`
      : `<input type="text" data-edit="${f}" maxlength="${max}" value="${escapeAttr(v)}" />`;
  }
  const actions = card.querySelector('.me-card-actions');
  actions.innerHTML = `
    <button type="button" class="me-btn me-btn-primary" data-action="save">${i18n.t('저장', 'Save', '保存')}</button>
    <button type="button" class="me-btn me-btn-secondary" data-action="cancel-edit">${i18n.t('취소', 'Cancel', 'キャンセル')}</button>`;
}

async function savePhotoEdits(card) {
  const id = card.dataset.id;
  const patch = {};
  card.querySelectorAll('[data-edit]').forEach(el => {
    const f = el.dataset.edit;
    const v = el.value.trim();
    patch[f] = v === '' ? null : v;
  });
  if (patch.instagram) patch.instagram = '@' + patch.instagram.replace(/^@/, '');
  const saveBtn = card.querySelector('[data-action="save"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = i18n.t('저장 중…', 'Saving…', '保存中…'); }
  const { error } = await db().submissions.updateMine(id, patch);
  if (error) {
    window.notify?.(i18n.t('수정 내용을 저장하지 못했어요. 새로고침 후 다시 시도해 주세요. (', 'Couldn\'t save your changes. Refresh and try again. (', '変更内容を保存できませんでした。再読み込みしてから、もう一度お試しください。(') + error.message + ')', 'danger');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = i18n.t('저장', 'Save', '保存'); }
    return;
  }
  await loadPhotos();
}

async function deletePhoto(card) {
  if (!confirm(i18n.t('이 사진 제출을 삭제할까요? 저장된 사진 파일도 함께 삭제되어 복구할 수 없습니다.', 'Delete this photo submission? The uploaded file will be deleted too and can\'t be recovered.', 'この写真の投稿を削除しますか？保存された写真ファイルも一緒に削除され、元に戻せません。'))) return;
  const id   = card.dataset.id;
  const row  = STATE.rows.find(r => r.id === id);
  const path = row?.storage_path;
  const btn  = card.querySelector('[data-action="delete"]');
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = i18n.t('삭제 중…', 'Deleting…', '削除中…'); }
  const { data, error } = await db().submissions.deleteMine(id);
  // RLS 가 silently 차단하면 error 없이 data: [] 로 돌아옴 — 반드시 명시 검사.
  // 검사 없이 storage 만 지우면 DB row 남아서 깨진 썸네일이 생김.
  if (error || !data?.length) {
    window.notify?.(i18n.t('사진 제출을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (', 'Couldn\'t delete the photo submission. Check your permissions or connection. (', '写真の投稿を削除できませんでした。権限または通信状況を確認してください。(') + (error?.message || i18n.t(`서버에서 거부했습니다. 편집부에 알려주세요 (${window.MagContact.text()})`, `The server refused the request. Please let the editors know (${window.MagContact.text()})`, `サーバーに拒否されました。編集部にお知らせください（${window.MagContact.text()}）`)) + ')', 'danger');
    if (btn) { btn.disabled = false; btn.textContent = origLabel || i18n.t('삭제', 'Delete', '削除'); }
    return;
  }
  if (path) await db().submissions.removePhoto(path);
  await loadPhotos();
}

function bindPhotoCardActions() {
  // 이벤트 위임 — 카드 자체에 click 한 번만 바인딩.
  // enterEditMode 가 액션 버튼을 새 HTML 로 교체하기 때문에 개별 버튼
  // addEventListener 방식은 새 버튼(저장/취소) 에 핸들러가 안 붙어 동작 X.
  document.querySelectorAll('#section-photos .me-card').forEach(card => {
    if (card.dataset.bound === '1') return;
    card.dataset.bound = '1';
    card.addEventListener('click', (e) => {
      // 사진 영역 클릭 → 라이트박스
      const zoom = e.target.closest('[data-zoom]');
      if (zoom) {
        $('imgZoomTarget').src = zoom.dataset.zoom;
        $('imgZoom').classList.add('open');
        return;
      }
      // 액션 버튼
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'edit')             enterEditMode(card);
      else if (a === 'save')        savePhotoEdits(card);
      else if (a === 'cancel-edit') renderPhotoList();
      else if (a === 'delete')      deletePhoto(card);
    });
  });
}

function markCardImageMissing(img) {
  const holder = img.closest('.me-card-img');
  if (!holder) return;
  holder.classList.add('is-missing');
  holder.removeAttribute('data-zoom');
  img.remove();
}

function bindCardImageFallbacks(scope = document) {
  scope.querySelectorAll('.me-card-img img').forEach(img => {
    if (img.dataset.missingFallbackBound === '1') return;
    img.dataset.missingFallbackBound = '1';
    img.addEventListener('error', () => markCardImageMissing(img), { once: true });
    if (img.complete && img.naturalWidth === 0) markCardImageMissing(img);
  });
}

// ═════════════════════════════════════════
// 매물 섹션
// ═════════════════════════════════════════
async function loadMarket() {
  $('marketList').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.marketRows = await db().market.listMine();
  renderMarketList();
}

function renderMarketList() {
  const rows = STATE.marketRows;
  if (rows.length === 0) {
    $('marketList').innerHTML = `
      <div class="me-empty">
        ${i18n.t('아직 올린 매물이 없습니다. 사용하지 않는 카메라, 렌즈, 필름을 마켓에 등록해 보세요.', 'You haven\'t posted any listings yet. List a camera, lens, or film you no longer use on the market.', 'まだ出品はありません。使わなくなったカメラやレンズ、フィルムをマーケットに出品してみてください。')}
        <br /><a class="me-empty-cta" href="${pageHref('market.html')}#new">${i18n.t('매물 올리러 가기 →', 'Post a listing →', '出品する →')}</a>
      </div>`;
    return;
  }
  $('marketList').innerHTML = rows.map(renderMarketCard).join('');
  bindCardImageFallbacks($('marketList'));
  bindMarketCardActions();
}

function renderMarketCard(r) {
  const firstPath = r.storage_paths?.[0];
  const url = firstPath ? db().market.publicUrl(firstPath) : '';
  const next = nextStatusOf(r.status);
  const canEdit = r.status !== 'hidden';
  return `
    <div class="me-card" data-id="${r.id}" data-status="${escapeAttr(r.status)}">
      <div class="me-card-img" data-zoom="${escapeAttr(url)}">
        ${url ? `<img src="${escapeAttr(url)}" alt="" loading="lazy" />` : ''}
      </div>
      <div class="me-card-meta">
        <div>
          <span class="me-card-status ${escapeAttr(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
        </div>
        <h3 class="me-market-card-title">${escapeHtml(r.title)}</h3>
        <div class="me-market-card-price">${fmtPrice(r.price)}</div>
        <div class="me-market-card-meta">
          <span>${escapeHtml(CAT_LABELS[r.category] || r.category)}</span>
          ${r.location ? `<span>· ${escapeHtml(r.location)}</span>` : ''}
          <span>· ${fmtDateShort(r.created_at)}</span>
          <span>· ${i18n.t(`사진 ${r.storage_paths?.length || 0}장`, `${r.storage_paths?.length || 0} photo${(r.storage_paths?.length || 0) === 1 ? '' : 's'}`, `写真 ${r.storage_paths?.length || 0}枚`)}</span>
        </div>
        <div class="me-card-actions">
          ${canEdit ? `<button type="button" class="me-btn me-btn-secondary" data-action="cycle">${escapeHtml(statusLabel(r.status))} → ${escapeHtml(statusLabel(next))}</button>` : ''}
          ${canEdit ? `<a href="${pageHref('market.html')}?edit=${escapeAttr(r.id)}" class="me-btn me-btn-secondary">${i18n.t('수정', 'Edit', '編集')}</a>` : ''}
          <button type="button" class="me-btn me-btn-danger" data-action="delete">${i18n.t('삭제', 'Delete', '削除')}</button>
        </div>
      </div>
    </div>`;
}

function bindMarketCardActions() {
  document.querySelectorAll('#section-market .me-card').forEach(card => {
    card.querySelector('[data-zoom]')?.addEventListener('click', e => {
      const src = e.currentTarget.dataset.zoom;
      if (!src) return;
      $('imgZoomTarget').src = src;
      $('imgZoom').classList.add('open');
    });
    card.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = card.dataset.id;
        const status = card.dataset.status;
        const a = btn.dataset.action;
        if (a === 'cycle') {
          btn.disabled = true;
          const { error } = await db().market.cycleStatusMine(id, status);
          if (error) { window.notify?.(i18n.t('매물 상태를 변경하지 못했어요. 새로고침 후 다시 시도해 주세요. (', 'Couldn\'t change the listing status. Refresh and try again. (', '出品のステータスを変更できませんでした。再読み込みしてから、もう一度お試しください。(') + error.message + ')', 'danger'); btn.disabled = false; return; }
          await loadMarket();
        } else if (a === 'delete') {
          if (!confirm(i18n.t('이 매물을 삭제할까요? 등록한 사진 파일도 함께 삭제됩니다.', 'Delete this listing? Its photos will be deleted too.', 'この出品を削除しますか？登録した写真ファイルも一緒に削除されます。'))) return;
          btn.disabled = true; btn.textContent = i18n.t('삭제 중…', 'Deleting…', '削除中…');
          const row = STATE.marketRows.find(r => r.id === id);
          const { data, error } = await db().market.deleteMine(id);
          // RLS silent block 가드 — data 비면 storage 건드리지 않고 종료
          if (error || !data?.length) {
            window.notify?.(i18n.t('매물을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (', 'Couldn\'t delete the listing. Check your permissions or connection. (', '出品を削除できませんでした。権限または通信状況を確認してください。(') + (error?.message || i18n.t('서버에서 거부했습니다.', 'The server refused the request.', 'サーバーに拒否されました。')) + ')', 'danger');
            btn.disabled = false; btn.textContent = i18n.t('삭제', 'Delete', '削除');
            return;
          }
          if (row?.storage_paths?.length) await db().market.removePhotos(row.storage_paths);
          await loadMarket();
        }
      });
    });
  });
}

// ═════════════════════════════════════════
// 페이지 탭 전환
// ═════════════════════════════════════════
function switchSection(sec) {
  STATE.section = sec;
  document.querySelectorAll('.me-pagetab').forEach(t => t.classList.toggle('active', t.dataset.section === sec));
  $('section-profile').hidden          = sec !== 'profile';
  $('section-photos').hidden           = sec !== 'photos';
  $('section-market').hidden           = sec !== 'market';
  $('section-notifs').hidden           = sec !== 'notifs';
  $('section-messages').hidden         = sec !== 'messages';
  $('section-my-comments').hidden      = sec !== 'my-comments';
  $('section-my-proposals').hidden     = sec !== 'my-proposals';
  $('section-my-books').hidden         = sec !== 'my-books';
  $('section-fav-photos').hidden       = sec !== 'fav-photos';
  $('section-fav-films').hidden        = sec !== 'fav-films';
  $('section-fav-webzine').hidden      = sec !== 'fav-webzine';
  $('section-fav-contributors').hidden = sec !== 'fav-contributors';
  $('section-fav-articles').hidden     = sec !== 'fav-articles';
  if (sec === 'profile'          && !STATE.profileLoaded) loadProfile();
  if (sec === 'market' && STATE.marketRows.length === 0) loadMarket();
  if (sec === 'notifs'            && STATE.notifs           === null) loadNotifs();
  if (sec === 'messages'          && STATE.messages         === null) loadMessages();
  if (sec === 'my-comments'       && STATE.myComments       === null) loadMyComments();
  if (sec === 'my-proposals'      && STATE.myProposals      === null) loadMyProposals();
  if (sec === 'my-books'          && STATE.myBooks          === null) loadMyBooks();
  if (sec === 'fav-photos'        && STATE.favPhotos        === null) loadFavPhotos();
  if (sec === 'fav-films'         && STATE.favFilms         === null) loadFavFilms();
  if (sec === 'fav-webzine'       && STATE.favWebzine       === null) loadFavWebzine();
  if (sec === 'fav-contributors'  && STATE.favContributors  === null) loadFavContributors();
  if (sec === 'fav-articles'      && STATE.favArticles      === null) loadFavArticles();
  // 알림 탭에 들어왔으면 안 읽은 건 자동으로 읽음 처리(뱃지 즉시 0 으로)
  if (sec === 'notifs') markNotifsRead();
  if (sec === 'messages') markMessagesRead();
  // URL hash 동기화
  try { history.replaceState(null, '', '#' + sec); } catch (_) {}
}

document.querySelectorAll('.me-pagetab').forEach(t => {
  t.addEventListener('click', () => switchSection(t.dataset.section));
});

// ═════════════════════════════════════════
// 프로필 편집 (표시 이름 · 아바타 · 자기소개)
// ═════════════════════════════════════════
const AVATAR_PLACEHOLDER =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
    '<rect width="80" height="80" fill="%23e9e9e9"/>' +
    '<circle cx="40" cy="31" r="15" fill="%23bdbdbd"/>' +
    '<path d="M12 74c0-16 13-25 28-25s28 9 28 25z" fill="%23bdbdbd"/></svg>');

function setAvatarPreview(url) {
  const img = $('profileAvatarPreview');
  if (img) img.src = url || AVATAR_PLACEHOLDER;
}

// 아바타를 정사각 512px 이하 jpeg 로 축소 (업로드 용량·표시 일관성)
function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(512, Math.max(img.naturalWidth, img.naturalHeight));
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode-failed')), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('load-failed'));
    img.src = URL.createObjectURL(file);
  });
}

function loadProfile() {
  STATE.profileLoaded = true;
  const p = STATE.profile || {};
  $('profileName').value = p.display_name || '';
  $('profileBio').value = p.bio || '';
  $('profileBioCount').textContent = String((p.bio || '').length);
  setAvatarPreview(p.avatar_url);

  $('profileBio').addEventListener('input', e => {
    $('profileBioCount').textContent = String(e.target.value.length);
  });

  $('profileAvatarInput').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const status = $('profileStatus');
    status.textContent = i18n.t('사진 올리는 중…', 'Uploading photo…', '写真をアップロード中…');
    try {
      const blob = await resizeAvatar(file);
      const res = await db().profiles.uploadAvatar(blob);
      if (res.error || !res.url) throw new Error(res.error?.message || 'upload-failed');
      STATE.pendingAvatar = res;
      setAvatarPreview(res.url);
      status.textContent = i18n.t('사진 준비됨. 저장을 눌러 반영하세요.', 'Photo ready. Press Save to apply it.', '写真の準備ができました。「保存」を押すと反映されます。');
    } catch (err) {
      status.textContent = i18n.t('사진 업로드 실패: ', 'Photo upload failed: ', '写真のアップロードに失敗しました：') + (err.message || err);
    }
  });

  $('profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const status = $('profileStatus');
    const btn = $('profileSave');
    const patch = {
      display_name: $('profileName').value.trim(),
      bio: $('profileBio').value.trim(),
    };
    if (STATE.pendingAvatar) patch.avatar_url = STATE.pendingAvatar.url;
    if (!patch.display_name) { status.textContent = i18n.t('표시 이름을 입력해 주세요.', 'Please enter a display name.', '表示名を入力してください。'); return; }

    btn.disabled = true;
    status.textContent = i18n.t('저장 중…', 'Saving…', '保存中…');
    const res = await db().profiles.updateMine(patch);
    btn.disabled = false;
    if (res.error) { status.textContent = i18n.t('저장 실패: ', 'Save failed: ', '保存に失敗しました：') + res.error.message; return; }

    // 이전 아바타 정리(우리 버킷 파일일 때만)
    if (STATE.pendingAvatar && STATE.profile?.avatar_url) {
      db().profiles.removeAvatarByUrl(STATE.profile.avatar_url);
    }
    STATE.profile = { ...(STATE.profile || {}), ...patch };
    STATE.pendingAvatar = null;
    // 헤더 이름도 갱신
    $('meUser').innerHTML =
      `${escapeHtml(patch.display_name)} · <button id="logout">${i18n.t('로그아웃', 'Sign out', 'ログアウト')}</button>`;
    $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
    status.textContent = i18n.t('저장했어요.', 'Saved.', '保存しました。');
  });
}

// ═════════════════════════════════════════
// 좋아한 사진 (reader_submissions 중 본인이 ♡ 한 것)
// ═════════════════════════════════════════
async function loadFavPhotos() {
  $('favPhotosGrid').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  const favs = await db().favorites.list('submission');
  if (favs.length === 0) {
    STATE.favPhotos = [];
    $('favPhotosGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 사진이 없어요.', 'You haven\'t liked any photos yet.', 'まだ ♡ を押した写真はありません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름 페이지에서 사진 보러 가기 →', 'Browse photos on the Films page →', 'フィルムのページで写真を見る →')}</a></div>`;
    return;
  }
  const ids = favs.map(f => f.target_id);
  // 승인된 사진만 노출 (반려/대기로 바뀌었거나 삭제된 경우 자동 숨김 — 공개 view 가 status='approved' 만)
  const rows = await db().submissions.listByIds(ids);
  // 좋아요 시점 순서 (favs 의 created_at DESC) 로 정렬
  const byId = new Map(rows.map(r => [r.id, r]));
  STATE.favPhotos = favs.map(f => byId.get(f.target_id)).filter(Boolean);
  renderFavPhotos();
}

function renderFavPhotos() {
  const rows = STATE.favPhotos || [];
  if (rows.length === 0) {
    $('favPhotosGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 사진이 없어요.', 'You haven\'t liked any photos yet.', 'まだ ♡ を押した写真はありません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름 페이지에서 사진 보러 가기 →', 'Browse photos on the Films page →', 'フィルムのページで写真を見る →')}</a></div>`;
    return;
  }
  $('favPhotosGrid').innerHTML = rows.map(r => {
    const url = db().submissions.publicUrl(r.storage_path);
    const author = r.submitter_name || (r.instagram || '').replace(/^@/, '') || '';
    const film = r.film || '';
    return `
      <div class="me-fav-photo" data-id="${escapeAttr(r.id)}" data-zoom="${escapeAttr(url)}">
        <img src="${escapeAttr(url)}" alt="" loading="lazy" />
        <button type="button" class="me-fav-unbtn" data-action="unfav-photo" data-id="${escapeAttr(r.id)}" aria-label="${i18n.t('즐겨찾기 해제', 'Remove from favorites', 'お気に入りから外す')}" title="${i18n.t('즐겨찾기 해제', 'Remove from favorites', 'お気に入りから外す')}">♥</button>
        <span class="me-fav-meta">
          ${author ? `<span class="author">${escapeHtml(author)}</span>` : ''}
          ${film ? `<span class="film">${escapeHtml(film)}</span>` : ''}
        </span>
      </div>`;
  }).join('');
  // 클릭 위임
  $('favPhotosGrid').querySelectorAll('.me-fav-photo').forEach(card => {
    card.addEventListener('click', async (e) => {
      const unbtn = e.target.closest('[data-action="unfav-photo"]');
      if (unbtn) {
        e.stopPropagation();
        const id = unbtn.dataset.id;
        const { error } = await db().favorites.remove('submission', id);
        if (error) { window.notify?.(i18n.t('해제 실패: ', 'Couldn\'t remove: ', '解除に失敗しました：') + error.message, 'danger'); return; }
        STATE.favPhotos = STATE.favPhotos.filter(r => r.id !== id);
        renderFavPhotos();
        return;
      }
      const zoom = card.dataset.zoom;
      if (zoom) {
        $('imgZoomTarget').src = zoom;
        $('imgZoom').classList.add('open');
      }
    });
  });
}

// ═════════════════════════════════════════
// 좋아한 필름 (films.json 중 본인이 ♡ 한 것)
// ═════════════════════════════════════════
async function loadFavFilms() {
  $('favFilmsGrid').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  const favs = await db().favorites.list('film');
  if (favs.length === 0) {
    STATE.favFilms = [];
    $('favFilmsGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 필름이 없어요.', 'You haven\'t liked any films yet.', 'まだ ♡ を押したフィルムはありません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름 라이브러리 둘러보기 →', 'Browse the film library →', 'フィルムライブラリーを見る →')}</a></div>`;
    return;
  }
  if (!STATE.filmsData) {
    try {
      // Supabase 우선 (admin/films 변경 즉시 반영), fallback 정적 JSON
      if (db() && db().isReady()) {
        STATE.filmsData = await db().films.listAsObject();
      }
      if (!STATE.filmsData) {
        const res = await fetch('data/films.json');
        STATE.filmsData = await res.json();
      }
    } catch (_) {
      STATE.filmsData = {};
    }
  }
  STATE.favFilms = favs
    .map(f => ({ slug: f.target_id, film: STATE.filmsData[f.target_id] }))
    .filter(x => x.film);
  renderFavFilms();
}

function renderFavFilms() {
  const items = STATE.favFilms || [];
  if (items.length === 0) {
    $('favFilmsGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 필름이 없어요.', 'You haven\'t liked any films yet.', 'まだ ♡ を押したフィルムはありません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름 라이브러리 둘러보기 →', 'Browse the film library →', 'フィルムライブラリーを見る →')}</a></div>`;
    return;
  }
  $('favFilmsGrid').innerHTML = items.map(({ slug, film }) => {
    const thumb = film.canThumbnail || '';
    const thumbHtml = thumb
      ? `<img src="${escapeAttr(thumb)}" alt="${escapeAttr(film.displayName || film.name)}" loading="lazy" />`
      : `<span style="color:var(--text-muted); font-size:12px;">${escapeHtml(film.name || '')}</span>`;
    return `
      <div class="me-fav-film-card" data-slug="${escapeAttr(slug)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-film" data-slug="${escapeAttr(slug)}" aria-label="${i18n.t('즐겨찾기 해제', 'Remove from favorites', 'お気に入りから外す')}" title="${i18n.t('즐겨찾기 해제', 'Remove from favorites', 'お気に入りから外す')}">♥</button>
        <a href="${pageHref('films.html')}#${encodeURIComponent(slug)}">
          <div class="me-fav-film-img">${thumbHtml}</div>
          <span class="me-fav-film-brand">${escapeHtml(film.brand || '')}</span>
          <h3 class="me-fav-film-name">${escapeHtml(film.name || '')}</h3>
          <p class="me-fav-film-spec">ISO ${escapeHtml(film.iso || '')} · ${escapeHtml(film.type || '')} · ${escapeHtml(film.format || '')}</p>
        </a>
      </div>`;
  }).join('');
  $('favFilmsGrid').querySelectorAll('[data-action="unfav-film"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slug = btn.dataset.slug;
      const { error } = await db().favorites.remove('film', slug);
      if (error) { window.notify?.(i18n.t('해제 실패: ', 'Couldn\'t remove: ', '解除に失敗しました：') + error.message, 'danger'); return; }
      STATE.favFilms = STATE.favFilms.filter(x => x.slug !== slug);
      renderFavFilms();
    });
  });
}

// ═════════════════════════════════════════
// 좋아한 웹진 (webzine_issues 중 본인이 ♡ 한 것)
// ═════════════════════════════════════════
async function loadFavWebzine() {
  $('favWebzineGrid').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  const favs = await db().favorites.list('webzine');
  if (favs.length === 0) {
    STATE.favWebzine = [];
    $('favWebzineGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 책이 없어요.', 'You haven\'t liked any books yet.', 'まだ ♡ を押した本はありません。')}<br /><a class="me-empty-cta" href="${pageHref('books.html')}">${i18n.t('책 보러 가기 →', 'Browse books →', '本を見る →')}</a></div>`;
    return;
  }
  let list = [];
  try { list = await db().webzine.listPublished(); } catch (_) { list = []; }
  const byId = new Map(list.map(it => [it.id, it]));
  STATE.favWebzine = favs.map(f => byId.get(f.target_id)).filter(Boolean);
  renderFavWebzine();
}

function renderFavWebzine() {
  const items = STATE.favWebzine || [];
  if (items.length === 0) {
    $('favWebzineGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 책이 없어요.', 'You haven\'t liked any books yet.', 'まだ ♡ を押した本はありません。')}<br /><a class="me-empty-cta" href="${pageHref('books.html')}">${i18n.t('책 보러 가기 →', 'Browse books →', '本を見る →')}</a></div>`;
    return;
  }
  $('favWebzineGrid').innerHTML = items.map(it => {
    const cover = it.cover_path ? db().webzine.publicUrl(it.cover_path) : '';
    const thumb = cover
      ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(it.title || '')}" loading="lazy" />`
      : `<span style="color:var(--text-muted); font-size:12px;">${escapeHtml(it.title || '')}</span>`;
    return `
      <div class="me-fav-film-card" data-id="${escapeAttr(it.id)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-webzine" data-id="${escapeAttr(it.id)}" aria-label="${i18n.t('좋아요 해제', 'Unlike', 'いいねを取り消す')}" title="${i18n.t('좋아요 해제', 'Unlike', 'いいねを取り消す')}">♥</button>
        <a href="webzine.html?issue=${encodeURIComponent(it.slug)}">
          <div class="me-fav-film-img">${thumb}</div>
          <span class="me-fav-film-brand">${escapeHtml(it.issue_label || it.category || '')}</span>
          <p class="me-fav-film-spec">${escapeHtml(it.title || '')}</p>
        </a>
      </div>`;
  }).join('');
  $('favWebzineGrid').querySelectorAll('[data-action="unfav-webzine"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const { error } = await db().favorites.remove('webzine', id);
      if (error) { window.notify?.(i18n.t('해제 실패: ', 'Couldn\'t remove: ', '解除に失敗しました：') + error.message, 'danger'); return; }
      STATE.favWebzine = STATE.favWebzine.filter(x => x.id !== id);
      renderFavWebzine();
    });
  });
}

// ═════════════════════════════════════════
// 좋아한 작가 (Reader's Roll contributor 별 ♡)
// ═════════════════════════════════════════
function normalizeContributorKey(s) {
  return String(s ?? '').trim().replace(/^@/, '').toLowerCase();
}

async function loadFavContributors() {
  $('favContributorsGrid').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  const favs = await db().favorites.list('contributor');
  if (favs.length === 0) {
    STATE.favContributors = [];
    $('favContributorsGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 작가가 없어요.', 'You haven\'t liked any contributors yet.', 'まだ ♡ を押した写真家はいません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름별 작가 보러 가기 →', 'Find contributors by film →', 'フィルム別に写真家を見る →')}</a></div>`;
    return;
  }
  // 모든 승인된 사진을 한 번 fetch 해서 키별 그룹
  let submissions = [];
  try { submissions = await db().submissions.listApproved(2000); }
  catch (_) { submissions = []; }
  const byKey = new Map();
  submissions.forEach(sub => {
    const key = normalizeContributorKey(sub.instagram || sub.submitterName || sub.author || '');
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(sub);
  });
  STATE.favContributors = favs
    .map(f => ({ key: f.target_id, photos: byKey.get(f.target_id) || [] }))
    .map(({ key, photos }) => {
      const first = photos[0];
      const label = first ? (first.submitterName || first.author || first.instagram || key) : key;
      const instagram = first?.instagram || '';
      const instagramUrl = first?.instagramUrl
        || (instagram ? `https://instagram.com/${String(instagram).replace(/^@/, '')}` : '');
      return { key, label, instagram, instagramUrl, photos };
    });
  renderFavContributors();
}

function renderFavContributors() {
  const items = STATE.favContributors || [];
  if (items.length === 0) {
    $('favContributorsGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 ♡ 누른 작가가 없어요.', 'You haven\'t liked any contributors yet.', 'まだ ♡ を押した写真家はいません。')}<br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름별 작가 보러 가기 →', 'Find contributors by film →', 'フィルム別に写真家を見る →')}</a></div>`;
    return;
  }
  $('favContributorsGrid').innerHTML = items.map(({ key, label, instagram, instagramUrl, photos }) => {
    const thumbs = photos.slice(0, 3).map(p => {
      const src = p.image || p.thumbnail || '';
      return src ? `<div class="me-fav-contrib-thumb"><img src="${escapeAttr(src)}" alt="" loading="lazy" /></div>` : '';
    }).join('');
    const filmsCount = new Set(photos.map(p => p.film || '').filter(Boolean)).size;
    const meta = i18n.t(`${photos.length}컷${filmsCount ? ` · ${filmsCount}개 필름` : ''}`,
      `${photos.length} shot${photos.length === 1 ? '' : 's'}${filmsCount ? ` · ${filmsCount} film${filmsCount === 1 ? '' : 's'}` : ''}`, `${photos.length}カット${filmsCount ? ` · フィルム${filmsCount}本` : ''}`);
    const collectionHref = `contributor/${encodeURIComponent(key)}`;
    const igLine = instagram
      ? `<a class="me-fav-contrib-ig" href="${escapeAttr(instagramUrl)}" target="_blank" rel="noopener">Instagram ↗</a>`
      : '';
    return `
      <div class="me-fav-contrib-card" data-key="${escapeAttr(key)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-contributor" data-key="${escapeAttr(key)}" aria-label="${i18n.t('작가 즐겨찾기 해제', 'Remove contributor from favorites', '写真家をお気に入りから外す')}" title="${i18n.t('작가 즐겨찾기 해제', 'Remove contributor from favorites', '写真家をお気に入りから外す')}">♥</button>
        <a class="me-fav-contrib-main" href="${escapeAttr(collectionHref)}" aria-label="${escapeAttr(i18n.t(`${label} 사진 모아 보기`, `See all photos by ${label}`, `${label}の写真をまとめて見る`))}">
          <div class="me-fav-contrib-thumbs">${thumbs || '<div class="me-fav-contrib-thumb empty"></div>'}</div>
          <div class="me-fav-contrib-info">
            <h3 class="me-fav-contrib-name">${escapeHtml(label)}</h3>
            <p class="me-fav-contrib-meta">${escapeHtml(meta)}</p>
            <span class="me-fav-contrib-cta">${i18n.t('사진 모아 보기 →', 'See all photos →', '写真をまとめて見る →')}</span>
          </div>
        </a>
        ${igLine ? `<div class="me-fav-contrib-footer">${igLine}</div>` : ''}
      </div>`;
  }).join('');
  $('favContributorsGrid').querySelectorAll('[data-action="unfav-contributor"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.key;
      const { error } = await db().favorites.remove('contributor', key);
      if (error) { window.notify?.(i18n.t('해제 실패: ', 'Couldn\'t remove: ', '解除に失敗しました：') + error.message, 'danger'); return; }
      STATE.favContributors = STATE.favContributors.filter(x => x.key !== key);
      renderFavContributors();
    });
  });
}

// ═════════════════════════════════════════
// 스크랩한 글 (stories.json 중 본인이 🔖 한 것)
// ═════════════════════════════════════════
async function loadFavArticles() {
  $('favArticlesList').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  const favs = await db().favorites.list('article');
  if (favs.length === 0) {
    STATE.favArticles = [];
    $('favArticlesList').innerHTML = `<div class="me-empty">${i18n.t('아직 스크랩한 글이 없어요.', 'You haven\'t saved any articles yet.', 'まだスクラップした記事はありません。')}<br /><a class="me-empty-cta" href="${pageHref('stories.html')}">${i18n.t('Articles 둘러보기 →', 'Browse Articles →', 'Articles を見る →')}</a></div>`;
    return;
  }
  if (!STATE.storiesData) {
    try {
      STATE.storiesData = await window.MagUtil.loadStories();
    } catch (_) {
      STATE.storiesData = [];
    }
  }
  const byId = new Map((STATE.storiesData || []).map(s => [s.id, s]));
  STATE.favArticles = favs
    .map(f => ({ id: f.target_id, story: byId.get(f.target_id) }))
    .filter(x => window.MagUtil.isPublishedContent(x.story));
  renderFavArticles();
}

function renderFavArticles() {
  const items = STATE.favArticles || [];
  if (items.length === 0) {
    $('favArticlesList').innerHTML = `<div class="me-empty">${i18n.t('아직 스크랩한 글이 없어요.', 'You haven\'t saved any articles yet.', 'まだスクラップした記事はありません。')}<br /><a class="me-empty-cta" href="${pageHref('stories.html')}">${i18n.t('Articles 둘러보기 →', 'Browse Articles →', 'Articles を見る →')}</a></div>`;
    return;
  }
  $('favArticlesList').innerHTML = items.map(({ id, story }) => {
    const page = story.page || `stories/${id}.html`;
    const thumb = story.thumbnail || '';
    const thumbHtml = thumb
      ? `<img src="${escapeAttr(thumb)}" alt="${escapeAttr(story.title)}" loading="lazy" />`
      : '';
    const cat = story.categoryLabel || story.category || '';
    const issue = story.issue || '';
    return `
      <div class="me-fav-article" data-id="${escapeAttr(id)}">
        <a href="${escapeAttr(page)}" class="me-fav-article-link">
          <div class="me-fav-article-thumb${thumbHtml ? '' : ' is-empty'}">${thumbHtml}</div>
          <div class="me-fav-article-meta">
            <span class="me-fav-article-cat">${escapeHtml(cat.toString().toUpperCase())}${issue ? ` · ${escapeHtml(issue)}` : ''}</span>
            <h3 class="me-fav-article-title">${escapeHtml(story.title)}</h3>
            <p class="me-fav-article-excerpt">${escapeHtml(story.excerpt || '')}</p>
          </div>
        </a>
        <button type="button" class="me-fav-unbtn" data-action="unfav-article" data-id="${escapeAttr(id)}" aria-label="${i18n.t('스크랩 해제', 'Remove from saved', 'スクラップを解除')}" title="${i18n.t('스크랩 해제', 'Remove from saved', 'スクラップを解除')}">♥</button>
      </div>`;
  }).join('');
  $('favArticlesList').querySelectorAll('[data-action="unfav-article"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const { error } = await db().favorites.remove('article', id);
      if (error) { window.notify?.(i18n.t('해제 실패: ', 'Couldn\'t remove: ', '解除に失敗しました：') + error.message, 'danger'); return; }
      STATE.favArticles = STATE.favArticles.filter(x => x.id !== id);
      renderFavArticles();
    });
  });
}

document.querySelectorAll('.me-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.me-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    STATE.filter = tab.dataset.status;
    renderPhotoList();
  });
});

$('imgZoom').addEventListener('click', () => {
  $('imgZoom').classList.remove('open');
  $('imgZoomTarget').src = '';
});

// ═════════════════════════════════════════
// 알림 (user_notifications)
// ═════════════════════════════════════════
async function loadNotifs() {
  $('notifsList').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.notifs = await db().notifications.list({ limit: 50 });
  renderNotifs();
}

// 알림 링크는 같은 사이트 안의 경로만 연다(javascript:·외부 주소는 버린다). site-common.js 의 헤더 알림 패널과 같은 규칙.
function safeInternalHref(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return '#';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '#';
    return `${url.pathname}${url.search}${url.hash}` || '#';
  } catch (_) {
    return '#';
  }
}

function renderNotifs() {
  const rows = STATE.notifs || [];
  const markBtn = $('notifsMarkAll');
  const anyUnread = rows.some(r => !r.read_at);
  if (markBtn) markBtn.hidden = !anyUnread;
  if (rows.length === 0) {
    $('notifsList').innerHTML = `<div class="me-empty">${i18n.t('아직 알림이 없어요.', 'No notifications yet.', 'まだお知らせはありません。')}</div>`;
    return;
  }
  const notifText = window.MagNotifText || ((n) => ({ title: n.title || '', body: n.body || '' }));
  $('notifsList').innerHTML = rows.map(r => {
    const text = notifText(r);
    return `
    <div class="me-notif${r.read_at ? '' : ' is-unread'}" data-id="${escapeAttr(r.id)}">
      <span class="me-notif-dot" aria-hidden="true"></span>
      <div class="me-notif-body">
        <div class="me-notif-title">${escapeHtml(text.title)}</div>
        ${text.body ? `<div class="me-notif-text">${escapeHtml(text.body)}</div>` : ''}
        <div class="me-notif-meta">${fmtDate(r.created_at)}${safeInternalHref(r.link) !== '#' ? ` · <a href="${escapeAttr(i18n.url(safeInternalHref(r.link)))}">${i18n.t('바로가기 →', 'Open →', '開く →')}</a>` : ''}</div>
      </div>
    </div>`;
  }).join('');
}

async function markNotifsRead() {
  if (!STATE.notifs || STATE.notifs.length === 0) return;
  const unread = STATE.notifs.filter(n => !n.read_at).map(n => n.id);
  if (unread.length === 0) return;
  await db().notifications.markRead(unread);
  // 로컬 state 갱신 + 뱃지 갱신
  STATE.notifs = STATE.notifs.map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() });
  await refreshNotifsBadge();
  renderNotifs();
}

async function refreshNotifsBadge() {
  const badge = $('notifsBadge');
  if (!badge) return;
  let unread = 0;
  try { unread = await db().notifications.unreadCount(); } catch (_) {}
  if (unread > 0) {
    badge.textContent = String(unread);
    badge.hidden = false;
  } else {
    badge.textContent = '';
    badge.hidden = true;
  }
}

$('notifsMarkAll')?.addEventListener('click', async () => {
  await db().notifications.markAllRead();
  STATE.notifs = (STATE.notifs || []).map(n => n.read_at ? n : { ...n, read_at: new Date().toISOString() });
  await refreshNotifsBadge();
  renderNotifs();
});

// ═════════════════════════════════════════
// 메시지 (회원 ↔ 편집부)
// ═════════════════════════════════════════
async function loadMessages() {
  $('messagesList').innerHTML = `<div class="me-msg-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.messages = await db().messages.list();
  renderMessages();
  startMessagesPolling();
}

// 같은 분 안에 보낸 같은 발신자 메시지는 시간 라벨을 첫 버블에만 표시.
function fmtTimeShort(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const isYest = d.getFullYear() === yest.getFullYear()
    && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  if (isYest)  return i18n.t(`어제 ${hh}:${mm}`, `Yesterday ${hh}:${mm}`, `昨日 ${hh}:${mm}`);
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function bucketKey(iso, fromEditor) {
  const d = new Date(iso);
  return `${fromEditor ? 'e' : 'u'}-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

function renderMessages() {
  const list = STATE.messages || [];
  if (!list.length) {
    $('messagesList').innerHTML = `<div class="me-msg-empty">${i18n.t('아직 주고받은 메시지가 없습니다. 편집부에 처음 인사를 보내보세요.', 'No messages yet. Say hello to the editors.', 'まだメッセージのやりとりはありません。編集部に最初のあいさつを送ってみてください。')}</div>`;
    return;
  }
  let lastKey = null;
  const html = list.map((m, i) => {
    const mine = !m.from_editor;
    const side = mine ? 'me-msg-bubble-mine' : 'me-msg-bubble-theirs';
    const key = bucketKey(m.created_at, m.from_editor);
    const showTime = key !== lastKey || (i === list.length - 1);
    lastKey = key;
    if (m.deleted_at) {
      return `
        <div class="me-msg-row ${mine ? 'is-mine' : 'is-theirs'}">
          <div class="me-msg-bubble me-msg-bubble-deleted">${i18n.t('삭제된 메시지입니다.', 'This message was deleted.', 'このメッセージは削除されました。')}</div>
        </div>
      `;
    }
    const editedMark = m.edited_at ? `<span class="me-msg-edited">${i18n.t('수정됨', 'Edited', '編集済み')}</span>` : '';
    const readMark = mine && m.read_at ? `<span class="me-msg-read">${i18n.t('읽음', 'Read', '既読')}</span>` : '';
    const senderLabel = mine ? '' : `<span class="me-msg-sender">${i18n.t('편집부', 'Editors', '編集部')}</span>`;
    const timeStamp = showTime
      ? `<span class="me-msg-time">${escapeHtml(fmtTimeShort(m.created_at))}</span>`
      : '';
    return `
      <div class="me-msg-row ${mine ? 'is-mine' : 'is-theirs'}" data-msg-id="${escapeAttr(m.id)}">
        ${senderLabel}
        <div class="me-msg-bubble ${side}" data-body="${escapeAttr(m.body)}">${escapeHtml(m.body)}</div>
        <div class="me-msg-foot">
          ${timeStamp}
          ${editedMark}
          ${readMark}
          ${mine ? `<button type="button" class="me-msg-action" data-action="edit-msg">${i18n.t('수정', 'Edit', '編集')}</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  $('messagesList').innerHTML = html;
  $('messagesList').scrollTop = $('messagesList').scrollHeight;
  document.querySelectorAll('#messagesList [data-action="edit-msg"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const row = btn.closest('.me-msg-row');
      if (row) startEditMessage(row.dataset.msgId);
    });
  });
}

let pollTimerMessages = null;
function startMessagesPolling() {
  if (pollTimerMessages) clearInterval(pollTimerMessages);
  pollTimerMessages = setInterval(async () => {
    if (document.hidden || STATE.section !== 'messages') return;
    const fresh = await db().messages.list();
    // 변화 있을 때만 재렌더
    const prev = STATE.messages || [];
    if (fresh.length !== prev.length || JSON.stringify(fresh.map(x => [x.id, x.body, x.read_at, x.edited_at, x.deleted_at])) !== JSON.stringify(prev.map(x => [x.id, x.body, x.read_at, x.edited_at, x.deleted_at]))) {
      STATE.messages = fresh;
      renderMessages();
      await markMessagesRead();
    }
  }, 15000);
}

function startEditMessage(messageId) {
  const row = document.querySelector(`.me-msg-row[data-msg-id="${cssEscape(messageId)}"]`);
  if (!row) return;
  const bubble = row.querySelector('.me-msg-bubble');
  const current = bubble.dataset.body || bubble.textContent;
  const inputId = `editInput-${messageId}`;
  bubble.innerHTML = `
    <textarea id="${inputId}" class="me-msg-edit-input" maxlength="2000">${escapeHtml(current)}</textarea>
    <div class="me-msg-edit-actions">
      <button type="button" class="me-msg-action" data-action="cancel-edit">${i18n.t('취소', 'Cancel', 'キャンセル')}</button>
      <button type="button" class="me-msg-action me-msg-action-primary" data-action="save-edit">${i18n.t('저장', 'Save', '保存')}</button>
    </div>
  `;
  const input = document.getElementById(inputId);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  bubble.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => loadMessages());
  bubble.querySelector('[data-action="save-edit"]').addEventListener('click', async () => {
    const next = input.value.trim();
    if (!next) return;
    const res = await db().messages.edit(messageId, next);
    if (res?.error) { alert(i18n.t('수정 실패: ', 'Edit failed: ', '編集に失敗しました：') + res.error.message); return; }
    await loadMessages();
  });
}

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

async function markMessagesRead() {
  if (!STATE.messages || STATE.messages.length === 0) return;
  const hasUnread = STATE.messages.some(m => m.from_editor && !m.read_at);
  if (!hasUnread) return;
  const marked = await db().messages.markRead();
  if (marked > 0) {
    STATE.messages = STATE.messages.map(m => (m.from_editor && !m.read_at) ? { ...m, read_at: new Date().toISOString() } : m);
    await refreshMessagesBadge();
  }
}

async function refreshMessagesBadge() {
  const badge = $('messagesBadge');
  if (!badge) return;
  let unread = 0;
  try { unread = await db().messages.unreadCount(); } catch (_) {}
  if (unread > 0) {
    badge.textContent = String(unread);
    badge.hidden = false;
  } else {
    badge.textContent = '';
    badge.hidden = true;
  }
}

async function sendMessage() {
  if (STATE.sendingMessage) return;
  const body = $('messageBody').value.trim();
  if (!body) return;
  STATE.sendingMessage = true;
  $('messageSend').disabled = true;
  try {
    const res = await db().messages.send(body);
    if (res.error) throw new Error(res.error.message || 'send failed');
    $('messageBody').value = '';
    $('messageCount').textContent = '0';
    STATE.messages = await db().messages.list();
    renderMessages();
  } catch (err) {
    console.error(err);
    alert(i18n.t('전송 실패: ', 'Send failed: ', '送信に失敗しました：') + (err.message || i18n.t('알 수 없는 오류', 'Unknown error', '不明なエラー')));
  } finally {
    STATE.sendingMessage = false;
    $('messageSend').disabled = false;
  }
}

$('messageBody')?.addEventListener('input', (e) => {
  const el = $('messageCount');
  if (el) el.textContent = String(e.target.value.length);
});
$('messageBody')?.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});
$('messageSend')?.addEventListener('click', sendMessage);

// ═════════════════════════════════════════
// 내 댓글
// ═════════════════════════════════════════
async function loadMyComments() {
  $('myCommentsList').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.myComments = await db().comments.listByUser({ limit: 50 });
  renderMyComments();
}

// page_id 를 본문 페이지 URL 로 변환.
// 패턴:
//   stories/<slug> → /stories/<slug>.html#comments  (실제 파일 존재)
//   films/<slug>   → /films.html?film=<slug>#comments  (단일 films.html + ?film= 으로 모달 자동 오픈)
//   기타           → /<page_id>(.html 보강)#comments  (정규화 fallback)
function buildCommentLink(page_id) {
  const p = String(page_id || '').trim();
  if (!p) return '#';
  if (p.startsWith('films/')) {
    const slug = p.slice('films/'.length);
    return '/films.html?film=' + encodeURIComponent(slug) + '#comments';
  }
  const withSlash = p.startsWith('/') ? p : '/' + p;
  const withExt   = /\.html?$/i.test(withSlash) ? withSlash : withSlash + '.html';
  return withExt + '#comments';
}

function renderMyComments() {
  const rows = STATE.myComments || [];
  if (rows.length === 0) {
    $('myCommentsList').innerHTML = `
      <div class="me-empty">${i18n.t('아직 남긴 댓글이 없어요.', 'You haven\'t left any comments yet.', 'まだコメントはありません。')}
        <br /><a class="me-empty-cta" href="${pageHref('stories.html')}">${i18n.t('글 읽으러 가기 →', 'Read some articles →', '記事を読む →')}</a>
      </div>`;
    return;
  }
  $('myCommentsList').innerHTML = rows.map(r => {
    const link = i18n.url(buildCommentLink(r.page_id));
    return `
      <div class="me-mycomment">
        <div class="me-mycomment-meta">
          <a href="${escapeAttr(link)}" class="me-mycomment-link">${escapeHtml(r.page_id)}</a>
          <span class="me-mycomment-date">${fmtDate(r.created_at)}</span>
        </div>
        <p class="me-mycomment-body">${escapeHtml(r.body || '')}</p>
      </div>`;
  }).join('');
}

// ═════════════════════════════════════════
// 내 제안 (film_proposals)
// ═════════════════════════════════════════
async function loadMyProposals() {
  $('myProposalsList').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  STATE.myProposals = await db().filmProposals.listMine();
  renderMyProposals();
}

function renderMyProposals() {
  const rows = STATE.myProposals || [];
  if (rows.length === 0) {
    $('myProposalsList').innerHTML = `
      <div class="me-empty">${i18n.t('아직 제안한 필름이 없어요.', 'You haven\'t suggested any films yet.', 'まだ提案したフィルムはありません。')}
        <br /><a class="me-empty-cta" href="${pageHref('films.html')}">${i18n.t('필름 라이브러리로 →', 'Go to the film library →', 'フィルムライブラリーへ →')}</a>
      </div>`;
    return;
  }
  $('myProposalsList').innerHTML = rows.map(r => {
    const status = String(r.status || 'pending');
    const meta = [r.iso, r.type, r.format].filter(Boolean).join(' · ');
    const notes = r.reviewer_notes ? `<div class="me-prop-notes">${i18n.t('편집부 메모: ', 'Editors\' note: ', '編集部メモ：')}${escapeHtml(r.reviewer_notes)}</div>` : '';
    return `
      <div class="me-prop me-prop--${escapeAttr(status)}">
        <div class="me-prop-head">
          <span class="me-prop-status">${escapeHtml(reviewStatusLabel(status) || status)}</span>
          <span class="me-prop-date">${fmtDate(r.created_at)}</span>
        </div>
        <div class="me-prop-title">${escapeHtml(r.display_name || (r.brand + ' ' + r.name))}</div>
        ${meta ? `<div class="me-prop-meta">${escapeHtml(meta)}</div>` : ''}
        ${r.description ? `<p class="me-prop-desc">${escapeHtml(r.description)}</p>` : ''}
        ${notes}
      </div>`;
  }).join('');
}

// ═════════════════════════════════════════
// 내 책 (열람권이 있는 유료 이북)
// ═════════════════════════════════════════
async function loadMyBooks() {
  $('myBooksGrid').innerHTML = `<div class="me-empty">${i18n.t('불러오는 중…', 'Loading…', '読み込み中…')}</div>`;
  let owned, list;
  try {
    [owned, list] = await Promise.all([db().ebooks.myEntitlementIds(), db().ebooks.listPublished({ strict: true })]);
  } catch (e) {
    console.warn('[me] 내 책 불러오기 실패', e);
    const why = escapeHtml(e?.message || e?.error?.message || String(e || ''));
    $('myBooksGrid').innerHTML = `<div class="me-empty">${i18n.t('책 목록을 불러오지 못했어요.', 'Couldn\'t load your books.', '本の一覧を読み込めませんでした。')}${why ? `<br /><small>(${why})</small>` : ''}<br /><button type="button" class="me-btn me-btn-secondary" id="myBooksRetry" style="margin-top:12px;">${i18n.t('다시 시도', 'Try again', '再試行')}</button></div>`;
    $('myBooksRetry').addEventListener('click', loadMyBooks, { once: true });
    return;
  }
  STATE.myBooks = (list || []).filter(e => owned && owned.has(e.id));
  renderMyBooks();
}

function renderMyBooks() {
  const items = STATE.myBooks || [];
  if (items.length === 0) {
    $('myBooksGrid').innerHTML = `<div class="me-empty">${i18n.t('아직 산 책이 없어요.', 'You haven\'t bought any books yet.', 'まだ購入した本はありません。')}<br /><a class="me-empty-cta" href="${pageHref('books.html')}">${i18n.t('책장 보러 가기 →', 'Browse the bookshelf →', '本棚を見る →')}</a></div>`;
    return;
  }
  $('myBooksGrid').innerHTML = items.map(it => {
    const href = i18n.url('/ebook-read.html') + '?slug=' + encodeURIComponent(it.slug);
    const thumb = it.cover_image
      ? `<img src="${escapeAttr(it.cover_image)}" alt="${escapeAttr(it.title || '')}" loading="lazy" />`
      : `<span style="color:var(--text-muted); font-size:12px;">${escapeHtml(it.title || '')}</span>`;
    return `
      <div class="me-fav-film-card">
        <a href="${escapeAttr(href)}">
          <div class="me-fav-film-img">${thumb}</div>
          <span class="me-fav-film-brand">${i18n.t('읽기 →', 'Read →', '読む →')}</span>
          <p class="me-fav-film-spec">${escapeHtml(it.title || '')}</p>
        </a>
      </div>`;
  }).join('');
}

(async function main() {
  for (let i = 0; i < 50; i++) {
    if (db() && db().isReady()) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const ok = await checkAuth();
  if (!ok) return;
  $('gate').hidden = true;
  $('app').hidden = false;
  await loadPhotos();
  // 초기 알림 / 메시지 뱃지 (다른 탭에서도 보이게)
  refreshNotifsBadge();
  refreshMessagesBadge();
  // URL hash 로 초기 탭 결정
  const validSections = ['photos', 'market', 'notifs', 'messages', 'my-comments', 'my-proposals', 'my-books', 'fav-photos', 'fav-films', 'fav-webzine', 'fav-contributors', 'fav-articles'];
  const hashSection = (location.hash || '').replace(/^#/, '');
  if (validSections.includes(hashSection) && hashSection !== 'photos') {
    switchSection(hashSection);
  }
})();
