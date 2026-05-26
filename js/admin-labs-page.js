'use strict';

const STATE = { user: null, isEditor: false, labs: [], filter: '', editingId: null, sortKey: null, sortDir: 1 };

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }

// 세션 만료 시 인증 쓰기 요청이 응답 없이 멈추는 것을 막는다.
// 일정 시간 안에 안 끝나면 끊고, 새로고침 안내를 error 로 돌려준다.
function withWriteTimeout(promise, ms = 10000) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ error: { message: '세션이 만료된 것 같아요. 페이지를 새로고침한 뒤 다시 시도해주세요.' } });
    }, ms);
    Promise.resolve(promise).then(
      (res) => { if (!settled) { settled = true; clearTimeout(t); resolve(res); } },
      (err) => { if (!settled) { settled = true; clearTimeout(t); resolve({ error: { message: err?.message || String(err) } }); } }
    );
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;

// ── 접근 권한 ──
function showGate(msg) { $('gate').hidden = false; if (msg) $('gate').querySelector('p').textContent = msg; }

async function checkAccess() {
  for (let i = 0; i < 50; i++) {
    if (db() && db().isReady()) break;
    await new Promise(r => setTimeout(r, 50));
  }
  if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
  const session = await db().auth.getSession();
  if (!session) { showGate(); return false; }
  STATE.user = session.user;
  const profile = await db().profiles.getMine();
  if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
  STATE.isEditor = true;
  $('adminUser').innerHTML = `${escapeHtml(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
  $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
  return true;
}

$('gateLogin').addEventListener('click', async () => {
  await db().auth.signInWithGoogle(window.location.href);
});

// ── 목록 ──
async function reload() {
  const labs = await db().labs.listAll();
  STATE.labs = Array.isArray(labs) ? labs : [];
  render();
}

function applyFilter(labs, q) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return labs;
  return labs.filter(l => (
    String(l.name || '').toLowerCase().includes(k) ||
    String(l.region || '').toLowerCase().includes(k) ||
    String(l.address || '').toLowerCase().includes(k)
  ));
}

function fmt(n) { return n == null ? '' : Number(n).toLocaleString('ko-KR'); }

function sortLabs(arr) {
  if (!STATE.sortKey) return arr;
  const k = STATE.sortKey, dir = STATE.sortDir;
  return arr.slice().sort((a, b) =>
    dir * String(a[k] || '').localeCompare(String(b[k] || ''), 'ko', { numeric: true }));
}

function updateSortIndicators() {
  document.querySelectorAll('.labs-table thead th.th-sort').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (ind) ind.textContent = STATE.sortKey === th.dataset.sort ? (STATE.sortDir > 0 ? ' ▲' : ' ▼') : '';
  });
}

function render() {
  updateSortIndicators();
  const filtered = sortLabs(applyFilter(STATE.labs, STATE.filter));
  $('count').textContent = `${filtered.length} / ${STATE.labs.length}`;
  if (filtered.length === 0) {
    $('tbody').innerHTML = '<tr><td colspan="5" class="empty">현상소가 없어요.</td></tr>';
    return;
  }
  $('tbody').innerHTML = filtered.map(l => {
    const hidden = !!l.is_hidden;
    const c135 = l.prices?.color?.['135']?.basic;
    return `
      <tr${hidden ? ' style="opacity:.55"' : ''}>
        <td>
          <div class="col-name">${escapeHtml(l.name)}${hidden ? ' <span class="badge" style="background:#fde68a;color:#78350f">숨김</span>' : ''}</div>
        </td>
        <td class="col-meta">${escapeHtml(l.region || '')}</td>
        <td class="col-meta">${escapeHtml(l.address || '')}</td>
        <td class="col-meta">${fmt(c135)}</td>
        <td class="col-actions">
          <button type="button" class="row-btn" data-edit="${escapeAttr(l.id)}">수정</button>
          <button type="button" class="row-btn" data-hide="${escapeAttr(l.id)}" data-cur="${hidden}">${hidden ? '복원' : '숨김'}</button>
          <button type="button" class="row-btn danger" data-del="${escapeAttr(l.id)}">삭제</button>
        </td>
      </tr>`;
  }).join('');

  $('tbody').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.edit)));
  $('tbody').querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => toggleHidden(b.dataset.hide, b.dataset.cur === 'true')));
  $('tbody').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => removeLab(b.dataset.del)));
}

$('filter').addEventListener('input', (e) => { STATE.filter = e.target.value; render(); });

document.querySelectorAll('.labs-table thead th.th-sort').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (STATE.sortKey === k) STATE.sortDir *= -1;
    else { STATE.sortKey = k; STATE.sortDir = 1; }
    render();
  });
});

// ── 가격 폼 ↔ 객체 ──
const numOrNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : Number(s); };
const textOrNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : (isNaN(Number(s)) ? s : Number(s)); };

function fillPrices(p) {
  p = p || {};
  const set = (id, val) => { $(id).value = (val == null ? '' : val); };
  const g = (type, fmtKey, lvl) => p?.[type]?.[fmtKey]?.[lvl];
  set('p-c135b', g('color', '135', 'basic')); set('p-c135h', g('color', '135', 'high'));
  set('p-c120b', g('color', '120', 'basic')); set('p-c120h', g('color', '120', 'high'));
  set('p-b135b', g('bw', '135', 'basic'));    set('p-b135h', g('bw', '135', 'high'));
  set('p-b120b', g('bw', '120', 'basic'));    set('p-b120h', g('bw', '120', 'high'));
  set('p-s135b', g('slide', '135', 'basic')); set('p-s135h', g('slide', '135', 'high'));
  set('p-s120b', g('slide', '120', 'basic')); set('p-s120h', g('slide', '120', 'high'));
  set('p-m135b', g('cinema', '135', 'basic')); set('p-m135h', g('cinema', '135', 'high'));
  set('p-110', p?.etc?.['110'] ?? '');
  set('p-aps', p?.etc?.aps ?? '');
}

function readPrices() {
  const v = (id) => numOrNull($(id).value);
  return {
    color:  { '120': { basic: v('p-c120b'), high: v('p-c120h') }, '135': { basic: v('p-c135b'), high: v('p-c135h') } },
    bw:     { '120': { basic: v('p-b120b'), high: v('p-b120h') }, '135': { basic: v('p-b135b'), high: v('p-b135h') } },
    slide:  { '120': { basic: v('p-s120b'), high: v('p-s120h') }, '135': { basic: v('p-s135b'), high: v('p-s135h') } },
    cinema: { '135': { basic: v('p-m135b'), high: v('p-m135h') } },
    etc:    { '110': textOrNull($('p-110').value), aps: textOrNull($('p-aps').value) },
  };
}

// ── 폼 ──
function openForm(id) {
  STATE.editingId = id || null;
  $('modal').classList.add('open');
  const l = id ? STATE.labs.find(x => x.id === id) : null;
  if (l) {
    $('modalTitle').textContent = `현상소 수정 · ${l.name}`;
    $('f-id').value = l.id;
    $('f-name').value = l.name || '';
    $('f-region').value = l.region || '';
    $('f-address').value = l.address || '';
    $('f-scanRes').value = l.scan_res || '';
    $('f-url').value = l.url || '';
    $('f-features').value = l.features || '';
    fillPrices(l.prices);
  } else {
    $('modalTitle').textContent = '새 현상소';
    $('labForm').reset();
    $('f-id').value = '';
    fillPrices({});
  }
}

function closeForm() {
  $('modal').classList.remove('open');
  STATE.editingId = null;
  $('labForm').reset();
}

$('newBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', closeForm);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeForm(); });

$('labForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = $('saveBtn');
  saveBtn.disabled = true; saveBtn.textContent = '저장 중…';
  try {
    const name = $('f-name').value.trim();
    if (!name) { window.notify?.('이름이 필요해요.', 'danger'); return; }
    const record = {
      name,
      region: $('f-region').value.trim() || null,
      address: $('f-address').value.trim() || null,
      scan_res: $('f-scanRes').value.trim() || null,
      url: $('f-url').value.trim() || null,
      features: $('f-features').value.trim() || null,
      prices: readPrices(),
    };
    const id = $('f-id').value.trim();
    if (id) {
      record.id = id;
    } else {
      // 신규는 기존 최대 sort_order 다음에 추가
      const maxSort = STATE.labs.reduce((m, x) => Math.max(m, x.sort_order || 0), 0);
      record.sort_order = maxSort + 1;
    }
    const { error } = await withWriteTimeout(db().labs.upsert(record));
    if (error) { window.notify?.('저장 실패: ' + (error.message || ''), 'danger'); return; }
    window.notify?.(id ? '현상소를 수정했어요.' : '새 현상소를 추가했어요.', 'info');
    closeForm();
    await reload();
  } catch (err) {
    window.notify?.('저장 실패: ' + (err?.message || err), 'danger');
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = '저장';
  }
});

async function removeLab(id) {
  if (!id) return;
  const l = STATE.labs.find(x => x.id === id);
  const label = l ? l.name : id;
  if (!confirm(`"${label}" 현상소를 삭제할까요?`)) return;
  const { error } = await db().labs.remove(id);
  if (error) { window.notify?.('삭제 실패: ' + (error.message || ''), 'danger'); return; }
  window.notify?.(`"${label}" 을 삭제했어요.`, 'info');
  STATE.labs = STATE.labs.filter(x => x.id !== id);
  render();
}

async function toggleHidden(id, currentlyHidden) {
  if (!id) return;
  const l = STATE.labs.find(x => x.id === id);
  const label = l ? l.name : id;
  const next = !currentlyHidden;
  const { error } = await db().labs.setHidden(id, next);
  if (error) { window.notify?.((next ? '숨김' : '복원') + ' 실패: ' + (error.message || ''), 'danger'); return; }
  if (l) l.is_hidden = next;
  window.notify?.(`"${label}" 을 ${next ? '숨김' : '복원'} 처리했어요. 다음 빌드부터 반영됩니다.`, 'info');
  render();
}

(async function main() {
  const ok = await checkAccess();
  if (!ok) return;
  $('gate').hidden = true;
  $('app').hidden = false;
  await reload();
})();
