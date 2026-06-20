'use strict';

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
  // favorites
  favPhotos: null,       // null = 미로딩, [] = 비어있음
  favFilms:  null,
  favWebzine: null,
  favArticles: null,
  favContributors: null,
  filmsData: null,       // films.json 캐시 (좋아한 필름 렌더용)
  storiesData: null,     // stories.json 캐시 (스크랩한 글 렌더용)
};

const CAT_LABELS = { film:'필름', camera:'카메라', lens:'렌즈', accessory:'액세서리', etc:'기타' };

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
function fmtPrice(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const n = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return escapeHtml(raw);
  return escapeHtml(n.toLocaleString('ko-KR')) + '원';
}
function statusLabel(s) {
  return ({ pending:'대기', approved:'공개 중', rejected:'반려',
           available:'판매중', reserved:'예약중', sold:'판매완료', hidden:'숨김' })[s] || s;
}
function nextStatusOf(s) {
  return s === 'available' ? 'reserved' : s === 'reserved' ? 'sold' : 'available';
}

async function checkAuth() {
  if (!db() || !db().isReady()) {
    document.body.innerHTML = '<div class="gate"><h2>인증 모듈을 불러오지 못했습니다</h2><p>새로고침 후에도 반복되면 편집부에 알려주세요.</p></div>';
    return false;
  }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;
  const profile = await db().profiles.getMine();
  const name = profile?.display_name || STATE.user.email?.split('@')[0] || '사용자';
  $('meUser').innerHTML = `${escapeHtml(name)} · <button id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => {
    await db().auth.signOut();
    location.reload();
  });
  return true;
}

function showGate() {
  $('gate').hidden = false;
  $('app').hidden = true;
  $('gateLogin').addEventListener('click', async () => {
    await db().auth.signInWithGoogle(window.location.href.split('#')[0]);
  });
}

// ═════════════════════════════════════════
// 사진 섹션 (기존)
// ═════════════════════════════════════════
async function loadPhotos() {
  $('list').innerHTML = '<div class="me-empty">불러오는 중…</div>';
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
      ? '아직 올린 사진이 없습니다. 독자 사진 영역에 보낼 사진을 메인에서 제출해 보세요.'
      : `${statusLabel(STATE.filter)} 상태의 사진이 없습니다. 다른 분류를 선택해 보세요.`;
    $('list').innerHTML = `
      <div class="me-empty">
        ${photoEmpty}
        <br /><a class="me-empty-cta" href="index.html">메인에서 사진 올리러 가기 →</a>
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
  const deleteLabel = r.status === 'pending' ? '제출 취소' : '삭제';
  return `
    <div class="me-card" data-id="${r.id}">
      <div class="me-card-img" data-zoom="${escapeAttr(url)}">
        <img src="${escapeAttr(url)}" alt="" loading="lazy" />
      </div>
      <div class="me-card-meta">
        <div>
          <span class="me-card-status ${escapeAttr(r.status)}">${escapeHtml(statusLabel(r.status))}</span>
          ${r.theme_month ? `<span class="me-card-theme">🎬 ${escapeHtml(r.theme_month)} 응모</span>` : ''}
        </div>
        <div class="me-card-row"><span class="k">제출</span><span class="v">${fmtDate(r.created_at)}</span></div>
        <div class="me-card-row"><span class="k">이름</span><span class="v" data-field="submitter_name">${escapeHtml(r.submitter_name || '-')}</span></div>
        <div class="me-card-row"><span class="k">인스타</span><span class="v" data-field="instagram">${escapeHtml(r.instagram || '-')}</span></div>
        <div class="me-card-row"><span class="k">필름</span><span class="v" data-field="film">${escapeHtml(r.film || '-')}</span></div>
        <div class="me-card-row"><span class="k">카메라</span><span class="v" data-field="camera">${escapeHtml(r.camera || '-')}</span></div>
        <div class="me-card-row"><span class="k">메모</span><span class="v" data-field="caption">${escapeHtml(r.caption || '-')}</span></div>
        ${r.rejection_reason ? `<div class="me-card-row"><span class="k">반려 사유</span><span class="v">${escapeHtml(r.rejection_reason)}</span></div>` : ''}
        <div class="me-card-actions">
          <button type="button" class="me-btn me-btn-secondary" data-action="edit">수정</button>
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
    <button type="button" class="me-btn me-btn-primary" data-action="save">저장</button>
    <button type="button" class="me-btn me-btn-secondary" data-action="cancel-edit">취소</button>`;
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
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중…'; }
  const { error } = await db().submissions.updateMine(id, patch);
  if (error) {
    window.notify?.('수정 내용을 저장하지 못했어요. 새로고침 후 다시 시도해 주세요. (' + error.message + ')', 'danger');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
    return;
  }
  await loadPhotos();
}

async function deletePhoto(card) {
  if (!confirm('이 사진 제출을 삭제할까요? 저장된 사진 파일도 함께 삭제되어 복구할 수 없습니다.')) return;
  const id   = card.dataset.id;
  const row  = STATE.rows.find(r => r.id === id);
  const path = row?.storage_path;
  const btn  = card.querySelector('[data-action="delete"]');
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '삭제 중…'; }
  const { data, error } = await db().submissions.deleteMine(id);
  // RLS 가 silently 차단하면 error 없이 data: [] 로 돌아옴 — 반드시 명시 검사.
  // 검사 없이 storage 만 지우면 DB row 남아서 깨진 썸네일이 생김.
  if (error || !data?.length) {
    window.notify?.('사진 제출을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (' + (error?.message || '서버에서 거부했습니다. 관리자에게 문의해 주세요.') + ')', 'danger');
    if (btn) { btn.disabled = false; btn.textContent = origLabel || '삭제'; }
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
  $('marketList').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  STATE.marketRows = await db().market.listMine();
  renderMarketList();
}

function renderMarketList() {
  const rows = STATE.marketRows;
  if (rows.length === 0) {
    $('marketList').innerHTML = `
      <div class="me-empty">
        아직 올린 매물이 없습니다. 사용하지 않는 카메라, 렌즈, 필름을 마켓에 등록해 보세요.
        <br /><a class="me-empty-cta" href="market.html#new">매물 올리러 가기 →</a>
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
          <span>· 사진 ${r.storage_paths?.length || 0}장</span>
        </div>
        <div class="me-card-actions">
          ${canEdit ? `<button type="button" class="me-btn me-btn-secondary" data-action="cycle">${escapeHtml(statusLabel(r.status))} → ${escapeHtml(statusLabel(next))}</button>` : ''}
          ${canEdit ? `<a href="market.html?edit=${escapeAttr(r.id)}" class="me-btn me-btn-secondary">수정</a>` : ''}
          <button type="button" class="me-btn me-btn-danger" data-action="delete">삭제</button>
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
          if (error) { window.notify?.('매물 상태를 변경하지 못했어요. 새로고침 후 다시 시도해 주세요. (' + error.message + ')', 'danger'); btn.disabled = false; return; }
          await loadMarket();
        } else if (a === 'delete') {
          if (!confirm('이 매물을 삭제할까요? 등록한 사진 파일도 함께 삭제됩니다.')) return;
          btn.disabled = true; btn.textContent = '삭제 중…';
          const row = STATE.marketRows.find(r => r.id === id);
          const { data, error } = await db().market.deleteMine(id);
          // RLS silent block 가드 — data 비면 storage 건드리지 않고 종료
          if (error || !data?.length) {
            window.notify?.('매물을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (' + (error?.message || '서버에서 거부했습니다.') + ')', 'danger');
            btn.disabled = false; btn.textContent = '삭제';
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
  $('section-photos').hidden           = sec !== 'photos';
  $('section-market').hidden           = sec !== 'market';
  $('section-notifs').hidden           = sec !== 'notifs';
  $('section-messages').hidden         = sec !== 'messages';
  $('section-my-comments').hidden      = sec !== 'my-comments';
  $('section-my-proposals').hidden     = sec !== 'my-proposals';
  $('section-fav-photos').hidden       = sec !== 'fav-photos';
  $('section-fav-films').hidden        = sec !== 'fav-films';
  $('section-fav-webzine').hidden      = sec !== 'fav-webzine';
  $('section-fav-contributors').hidden = sec !== 'fav-contributors';
  $('section-fav-articles').hidden     = sec !== 'fav-articles';
  if (sec === 'market' && STATE.marketRows.length === 0) loadMarket();
  if (sec === 'notifs'            && STATE.notifs           === null) loadNotifs();
  if (sec === 'messages'          && STATE.messages         === null) loadMessages();
  if (sec === 'my-comments'       && STATE.myComments       === null) loadMyComments();
  if (sec === 'my-proposals'      && STATE.myProposals      === null) loadMyProposals();
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
// 좋아한 사진 (reader_submissions 중 본인이 ♡ 한 것)
// ═════════════════════════════════════════
async function loadFavPhotos() {
  $('favPhotosGrid').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  const favs = await db().favorites.list('submission');
  if (favs.length === 0) {
    STATE.favPhotos = [];
    $('favPhotosGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 사진이 없어요.<br /><a class="me-empty-cta" href="films.html">필름 페이지에서 사진 보러 가기 →</a></div>`;
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
    $('favPhotosGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 사진이 없어요.<br /><a class="me-empty-cta" href="films.html">필름 페이지에서 사진 보러 가기 →</a></div>`;
    return;
  }
  $('favPhotosGrid').innerHTML = rows.map(r => {
    const url = db().submissions.publicUrl(r.storage_path);
    const author = r.submitter_name || (r.instagram || '').replace(/^@/, '') || '';
    const film = r.film || '';
    return `
      <div class="me-fav-photo" data-id="${escapeAttr(r.id)}" data-zoom="${escapeAttr(url)}">
        <img src="${escapeAttr(url)}" alt="" loading="lazy" />
        <button type="button" class="me-fav-unbtn" data-action="unfav-photo" data-id="${escapeAttr(r.id)}" aria-label="즐겨찾기 해제" title="즐겨찾기 해제">♥</button>
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
        if (error) { window.notify?.('해제 실패: ' + error.message, 'danger'); return; }
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
  $('favFilmsGrid').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  const favs = await db().favorites.list('film');
  if (favs.length === 0) {
    STATE.favFilms = [];
    $('favFilmsGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 필름이 없어요.<br /><a class="me-empty-cta" href="films.html">필름 라이브러리 둘러보기 →</a></div>`;
    return;
  }
  if (!STATE.filmsData) {
    try {
      // Supabase 우선 (admin/films 변경 즉시 반영), fallback 정적 JSON
      if (db() && db().isReady()) {
        STATE.filmsData = await db().films.listAsObject();
      }
      if (!STATE.filmsData || Object.keys(STATE.filmsData).length === 0) {
        const res = await fetch('data/films.json', { cache: 'no-cache' });
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
    $('favFilmsGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 필름이 없어요.<br /><a class="me-empty-cta" href="films.html">필름 라이브러리 둘러보기 →</a></div>`;
    return;
  }
  $('favFilmsGrid').innerHTML = items.map(({ slug, film }) => {
    const thumb = film.canThumbnail || '';
    const thumbHtml = thumb
      ? `<img src="${escapeAttr(thumb)}" alt="${escapeAttr(film.displayName || film.name)}" loading="lazy" />`
      : `<span style="color:var(--text-muted); font-size:12px;">${escapeHtml(film.name || '')}</span>`;
    return `
      <div class="me-fav-film-card" data-slug="${escapeAttr(slug)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-film" data-slug="${escapeAttr(slug)}" aria-label="즐겨찾기 해제" title="즐겨찾기 해제">♥</button>
        <a href="films.html#${encodeURIComponent(slug)}">
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
      if (error) { window.notify?.('해제 실패: ' + error.message, 'danger'); return; }
      STATE.favFilms = STATE.favFilms.filter(x => x.slug !== slug);
      renderFavFilms();
    });
  });
}

// ═════════════════════════════════════════
// 좋아한 웹진 (webzine_issues 중 본인이 ♡ 한 것)
// ═════════════════════════════════════════
async function loadFavWebzine() {
  $('favWebzineGrid').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  const favs = await db().favorites.list('webzine');
  if (favs.length === 0) {
    STATE.favWebzine = [];
    $('favWebzineGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 책이 없어요.<br /><a class="me-empty-cta" href="books.html">책 보러 가기 →</a></div>`;
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
    $('favWebzineGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 책이 없어요.<br /><a class="me-empty-cta" href="books.html">책 보러 가기 →</a></div>`;
    return;
  }
  $('favWebzineGrid').innerHTML = items.map(it => {
    const cover = it.cover_path ? db().webzine.publicUrl(it.cover_path) : '';
    const thumb = cover
      ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(it.title || '')}" loading="lazy" />`
      : `<span style="color:var(--text-muted); font-size:12px;">${escapeHtml(it.title || '')}</span>`;
    return `
      <div class="me-fav-film-card" data-id="${escapeAttr(it.id)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-webzine" data-id="${escapeAttr(it.id)}" aria-label="좋아요 해제" title="좋아요 해제">♥</button>
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
      if (error) { window.notify?.('해제 실패: ' + error.message, 'danger'); return; }
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
  $('favContributorsGrid').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  const favs = await db().favorites.list('contributor');
  if (favs.length === 0) {
    STATE.favContributors = [];
    $('favContributorsGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 작가가 없어요.<br /><a class="me-empty-cta" href="films.html">필름별 작가 보러 가기 →</a></div>`;
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
    $('favContributorsGrid').innerHTML = `<div class="me-empty">아직 ♡ 누른 작가가 없어요.<br /><a class="me-empty-cta" href="films.html">필름별 작가 보러 가기 →</a></div>`;
    return;
  }
  $('favContributorsGrid').innerHTML = items.map(({ key, label, instagram, instagramUrl, photos }) => {
    const thumbs = photos.slice(0, 3).map(p => {
      const src = p.image || p.thumbnail || '';
      return src ? `<div class="me-fav-contrib-thumb"><img src="${escapeAttr(src)}" alt="" loading="lazy" /></div>` : '';
    }).join('');
    const filmsCount = new Set(photos.map(p => p.film || '').filter(Boolean)).size;
    const meta = `${photos.length}컷${filmsCount ? ` · ${filmsCount}개 필름` : ''}`;
    const collectionHref = `contributor/${encodeURIComponent(key)}`;
    const igLine = instagram
      ? `<a class="me-fav-contrib-ig" href="${escapeAttr(instagramUrl)}" target="_blank" rel="noopener">Instagram ↗</a>`
      : '';
    return `
      <div class="me-fav-contrib-card" data-key="${escapeAttr(key)}">
        <button type="button" class="me-fav-unbtn" data-action="unfav-contributor" data-key="${escapeAttr(key)}" aria-label="작가 즐겨찾기 해제" title="작가 즐겨찾기 해제">♥</button>
        <a class="me-fav-contrib-main" href="${escapeAttr(collectionHref)}" aria-label="${escapeAttr(label)} 사진 모아 보기">
          <div class="me-fav-contrib-thumbs">${thumbs || '<div class="me-fav-contrib-thumb empty"></div>'}</div>
          <div class="me-fav-contrib-info">
            <h3 class="me-fav-contrib-name">${escapeHtml(label)}</h3>
            <p class="me-fav-contrib-meta">${escapeHtml(meta)}</p>
            <span class="me-fav-contrib-cta">사진 모아 보기 →</span>
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
      if (error) { window.notify?.('해제 실패: ' + error.message, 'danger'); return; }
      STATE.favContributors = STATE.favContributors.filter(x => x.key !== key);
      renderFavContributors();
    });
  });
}

// ═════════════════════════════════════════
// 스크랩한 글 (stories.json 중 본인이 🔖 한 것)
// ═════════════════════════════════════════
async function loadFavArticles() {
  $('favArticlesList').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  const favs = await db().favorites.list('article');
  if (favs.length === 0) {
    STATE.favArticles = [];
    $('favArticlesList').innerHTML = `<div class="me-empty">아직 스크랩한 글이 없어요.<br /><a class="me-empty-cta" href="stories.html">Articles 둘러보기 →</a></div>`;
    return;
  }
  if (!STATE.storiesData) {
    try {
      const res = await fetch('data/stories.json', { cache: 'no-cache' });
      STATE.storiesData = await res.json();
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
    $('favArticlesList').innerHTML = `<div class="me-empty">아직 스크랩한 글이 없어요.<br /><a class="me-empty-cta" href="stories.html">Articles 둘러보기 →</a></div>`;
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
        <button type="button" class="me-fav-unbtn" data-action="unfav-article" data-id="${escapeAttr(id)}" aria-label="스크랩 해제" title="스크랩 해제">♥</button>
      </div>`;
  }).join('');
  $('favArticlesList').querySelectorAll('[data-action="unfav-article"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const { error } = await db().favorites.remove('article', id);
      if (error) { window.notify?.('해제 실패: ' + error.message, 'danger'); return; }
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
  $('notifsList').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  STATE.notifs = await db().notifications.list({ limit: 50 });
  renderNotifs();
}

function renderNotifs() {
  const rows = STATE.notifs || [];
  const markBtn = $('notifsMarkAll');
  const anyUnread = rows.some(r => !r.read_at);
  if (markBtn) markBtn.hidden = !anyUnread;
  if (rows.length === 0) {
    $('notifsList').innerHTML = '<div class="me-empty">아직 알림이 없어요.</div>';
    return;
  }
  $('notifsList').innerHTML = rows.map(r => `
    <div class="me-notif${r.read_at ? '' : ' is-unread'}" data-id="${escapeAttr(r.id)}">
      <span class="me-notif-dot" aria-hidden="true"></span>
      <div class="me-notif-body">
        <div class="me-notif-title">${escapeHtml(r.title || '')}</div>
        ${r.body ? `<div class="me-notif-text">${escapeHtml(r.body)}</div>` : ''}
        <div class="me-notif-meta">${fmtDate(r.created_at)}${r.link ? ` · <a href="${escapeAttr(r.link)}">바로가기 →</a>` : ''}</div>
      </div>
    </div>`).join('');
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
  $('messagesList').innerHTML = '<div class="me-msg-empty">불러오는 중…</div>';
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
  if (isYest)  return `어제 ${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function bucketKey(iso, fromEditor) {
  const d = new Date(iso);
  return `${fromEditor ? 'e' : 'u'}-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

function renderMessages() {
  const list = STATE.messages || [];
  if (!list.length) {
    $('messagesList').innerHTML = '<div class="me-msg-empty">아직 주고받은 메시지가 없습니다. 편집부에 처음 인사를 보내보세요.</div>';
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
          <div class="me-msg-bubble me-msg-bubble-deleted">삭제된 메시지입니다.</div>
        </div>
      `;
    }
    const editedMark = m.edited_at ? `<span class="me-msg-edited">수정됨</span>` : '';
    const readMark = mine && m.read_at ? `<span class="me-msg-read">읽음</span>` : '';
    const senderLabel = mine ? '' : `<span class="me-msg-sender">편집부</span>`;
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
          ${mine ? `<button type="button" class="me-msg-action" data-action="edit-msg">수정</button>` : ''}
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
      <button type="button" class="me-msg-action" data-action="cancel-edit">취소</button>
      <button type="button" class="me-msg-action me-msg-action-primary" data-action="save-edit">저장</button>
    </div>
  `;
  const input = document.getElementById(inputId);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  bubble.querySelector('[data-action="cancel-edit"]').addEventListener('click', () => loadMessages());
  bubble.querySelector('[data-action="save-edit"]').addEventListener('click', async () => {
    const next = input.value.trim();
    if (!next) return;
    const res = await db().messages.edit(messageId, next);
    if (res?.error) { alert('수정 실패: ' + res.error.message); return; }
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
    alert('전송 실패: ' + (err.message || '알 수 없는 오류'));
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
  $('myCommentsList').innerHTML = '<div class="me-empty">불러오는 중…</div>';
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
      <div class="me-empty">아직 남긴 댓글이 없어요.
        <br /><a class="me-empty-cta" href="stories.html">글 읽으러 가기 →</a>
      </div>`;
    return;
  }
  $('myCommentsList').innerHTML = rows.map(r => {
    const link = buildCommentLink(r.page_id);
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
  $('myProposalsList').innerHTML = '<div class="me-empty">불러오는 중…</div>';
  STATE.myProposals = await db().filmProposals.listMine();
  renderMyProposals();
}

function statusLabelKor(s) {
  return ({ pending: '검토 중', approved: '승인됨', rejected: '반려됨' })[s] || s;
}

function renderMyProposals() {
  const rows = STATE.myProposals || [];
  if (rows.length === 0) {
    $('myProposalsList').innerHTML = `
      <div class="me-empty">아직 제안한 필름이 없어요.
        <br /><a class="me-empty-cta" href="films.html">필름 라이브러리로 →</a>
      </div>`;
    return;
  }
  $('myProposalsList').innerHTML = rows.map(r => {
    const status = String(r.status || 'pending');
    const meta = [r.iso, r.type, r.format].filter(Boolean).join(' · ');
    const notes = r.reviewer_notes ? `<div class="me-prop-notes">편집부 메모: ${escapeHtml(r.reviewer_notes)}</div>` : '';
    return `
      <div class="me-prop me-prop--${escapeAttr(status)}">
        <div class="me-prop-head">
          <span class="me-prop-status">${escapeHtml(statusLabelKor(status))}</span>
          <span class="me-prop-date">${fmtDate(r.created_at)}</span>
        </div>
        <div class="me-prop-title">${escapeHtml(r.display_name || (r.brand + ' ' + r.name))}</div>
        ${meta ? `<div class="me-prop-meta">${escapeHtml(meta)}</div>` : ''}
        ${r.description ? `<p class="me-prop-desc">${escapeHtml(r.description)}</p>` : ''}
        ${notes}
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
  const validSections = ['photos', 'market', 'notifs', 'messages', 'my-comments', 'my-proposals', 'fav-photos', 'fav-films', 'fav-webzine', 'fav-contributors', 'fav-articles'];
  const hashSection = (location.hash || '').replace(/^#/, '');
  if (validSections.includes(hashSection) && hashSection !== 'photos') {
    switchSection(hashSection);
  }
})();
