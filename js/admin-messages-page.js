// admin/messages.html 백엔드
// 편집부가 회원 스레드 인박스를 보고, 회원이 보낸 메시지에 답장.
// 회원이 자기 스레드에 메시지를 보내야 인박스에 표시됨 (MVP — 편집부 발신 전용 user-picker 는 추후).

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const db = () => window.MagDB;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATE = {
    threads: [],
    currentUserId: null,
    messages: [],
    sending: false,
  };

  function showGate(msg) {
    $('gate').hidden = false;
    $('app').hidden = true;
    if (msg) $('gate').querySelector('p').textContent = msg;
  }

  async function checkAccess() {
    for (let i = 0; i < 50; i++) { if (db() && db().isReady()) break; await new Promise((r) => setTimeout(r, 50)); }
    if (!db() || !db().isReady()) { showGate('서비스 준비 실패. 잠시 후 새로고침해주세요.'); return false; }
    const session = await db().auth.getSession();
    if (!session) { showGate(); return false; }
    const profile = await db().profiles.getMine();
    if (!profile?.is_editor) { showGate('편집부 권한이 있는 계정으로 로그인해야 이 페이지를 볼 수 있어요.'); return false; }
    $('adminUser').innerHTML = `${esc(profile.display_name || session.user.email || '')} · <button id="logout">로그아웃</button>`;
    $('logout').addEventListener('click', async () => { await db().auth.signOut(); location.reload(); });
    return true;
  }

  $('gateLogin').addEventListener('click', async () => { await db().auth.signInWithGoogle(window.location.href); });

  function fmtAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (sec < 60) return `${sec}초 전`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}일 전`;
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function loadThreads() {
    STATE.threads = await db().messages.listThreads();
    renderThreads();
  }

  function renderThreads() {
    const list = STATE.threads;
    $('threadsTotal').textContent = list.length ? `${list.length}명` : '';
    if (!list.length) {
      $('threadsList').innerHTML = '<div class="msg-thread-empty">아직 도착한 메시지가 없습니다.</div>';
      return;
    }
    $('threadsList').innerHTML = list.map((t) => {
      const active = t.user_id === STATE.currentUserId ? ' is-active' : '';
      const unreadBadge = t.unread_for_admin > 0
        ? `<span class="msg-thread-unread">${t.unread_for_admin}</span>` : '';
      const snippetPrefix = t.last_from_editor ? '편집부: ' : '';
      return `
        <button type="button" class="msg-thread-item${active}" data-user-id="${esc(t.user_id)}">
          <div class="msg-thread-name">
            ${esc(t.display_name || '익명 회원')}
            ${unreadBadge}
          </div>
          <div class="msg-thread-snippet">${esc(snippetPrefix + (t.last_body || ''))}</div>
          <div class="msg-thread-time">${esc(fmtAgo(t.last_at))}</div>
        </button>
      `;
    }).join('');
    document.querySelectorAll('.msg-thread-item').forEach((btn) => {
      btn.addEventListener('click', () => openThread(btn.dataset.userId));
    });
  }

  async function openThread(userId) {
    STATE.currentUserId = userId;
    renderThreads();
    const thread = STATE.threads.find((t) => t.user_id === userId);
    $('viewTitle').textContent = thread?.display_name || '회원';
    $('composeRow').hidden = false;
    $('viewList').innerHTML = '<div class="msg-view-empty">불러오는 중…</div>';
    STATE.messages = await db().messages.list(userId);
    renderMessages();
    // 회원이 보낸 메시지 읽음 처리
    if (thread?.unread_for_admin > 0) {
      const marked = await db().messages.markRead(userId);
      if (marked > 0) {
        thread.unread_for_admin = 0;
        renderThreads();
      }
    }
  }

  function renderMessages() {
    if (!STATE.messages.length) {
      $('viewList').innerHTML = '<div class="msg-view-empty">메시지가 없습니다.</div>';
      return;
    }
    const html = STATE.messages.map((m) => {
      const side = m.from_editor ? 'msg-bubble-from-editor' : 'msg-bubble-from-user';
      return `
        <div class="msg-bubble ${side}">
          ${esc(m.body)}
          <span class="msg-bubble-meta">${esc(fmtTime(m.created_at))}</span>
        </div>
      `;
    }).join('');
    $('viewList').innerHTML = html;
    $('viewList').scrollTop = $('viewList').scrollHeight;
  }

  async function send() {
    if (STATE.sending || !STATE.currentUserId) return;
    const body = $('composeBody').value.trim();
    if (!body) return;
    STATE.sending = true;
    $('composeSend').disabled = true;
    try {
      const res = await db().messages.sendAsEditor(STATE.currentUserId, body);
      if (res.error) throw new Error(res.error.message || 'send failed');
      $('composeBody').value = '';
      $('composeCount').textContent = '0';
      // 메시지 다시 로드 + 스레드 갱신
      STATE.messages = await db().messages.list(STATE.currentUserId);
      renderMessages();
      await loadThreads();
    } catch (err) {
      console.error(err);
      alert('전송 실패: ' + (err.message || '알 수 없는 오류'));
    } finally {
      STATE.sending = false;
      $('composeSend').disabled = false;
    }
  }

  $('composeBody').addEventListener('input', (e) => {
    $('composeCount').textContent = String(e.target.value.length);
  });
  $('composeBody').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  $('composeSend').addEventListener('click', send);

  // 30초마다 인박스 폴링 (창이 켜진 동안)
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (document.hidden) return;
      await loadThreads();
      if (STATE.currentUserId) {
        STATE.messages = await db().messages.list(STATE.currentUserId);
        renderMessages();
      }
    }, 30000);
  }

  (async function start() {
    if (!(await checkAccess())) return;
    $('app').hidden = false;
    await loadThreads();
    startPolling();
  })();
})();
