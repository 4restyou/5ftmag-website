// 편집부 전용: 회원 이름 옆 ✉ 버튼 → 그 자리에서 메시지 보내기.
//
// site-common.js 의 bindEditorMessage 가 편집부일 때만 이 파일을 불러온다(평소에는 싣지 않는다).
// 화면은 이름이 있는 요소에 속성만 달아 둔다.
//   data-msg-user="<회원 user_id>"            회원 id 를 아는 곳(댓글·장터·사진 검토)
//   data-msg-submission="<투고 id>"           공개 사진처럼 회원 id 가 없는 곳 — 열 때 id 로 회원을 찾는다
//   data-msg-name="<표시 이름>"                창 제목에 쓴다(없으면 요소의 글자)
// 이 파일이 그 옆에 ✉ 버튼을 붙이고, 나중에 그려지는 목록도 MutationObserver 로 따라 붙인다.
// 보내기 권한은 DB(RLS messages_insert_editor)가 막으므로 버튼을 흉내 내도 편집부가 아니면 보낼 수 없다.
(function () {
  'use strict';
  if (window.EditorMessage) return;
  const SEL = '[data-msg-user], [data-msg-submission]';
  const ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const db = () => window.MagDB;

  const CSS = `
.editor-msg-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; margin-left: 4px;
  padding: 0; border: 1px solid var(--border, #ddd); border-radius: 50%; background: var(--bg, #fff); color: var(--text, #111);
  cursor: pointer; vertical-align: middle; flex: 0 0 auto; }
.editor-msg-btn:hover { background: #ffd400; border-color: #ffd400; color: #111; }
.editor-msg-dialog { position: fixed; inset: 0; margin: auto; height: fit-content; max-height: calc(100vh - 32px); overflow: auto; width: min(440px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--border, #ddd); border-radius: 14px;
  background: var(--bg, #fff); color: var(--text, #111); box-shadow: 0 16px 40px rgba(0,0,0,0.2); }
.editor-msg-dialog::backdrop { background: rgba(0,0,0,0.35); }
.editor-msg-dialog form { display: grid; gap: 12px; padding: 18px; margin: 0; }
.editor-msg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.editor-msg-head h2 { margin: 0; font-size: 16px; }
.editor-msg-head a { font-size: 12px; color: var(--text-muted, #666); white-space: nowrap; }
.editor-msg-log { max-height: 200px; overflow-y: auto; display: grid; gap: 6px; padding: 10px; border-radius: 10px; background: var(--bg-sub, #f5f5f5); font-size: 13px; }
.editor-msg-log p { margin: 0; padding: 6px 10px; border-radius: 10px; max-width: 85%; white-space: pre-wrap; word-break: break-word; background: var(--bg, #fff); }
.editor-msg-log p.is-editor { justify-self: end; background: #fff4b8; color: #111; }
.editor-msg-log small { display: block; margin-top: 2px; font-size: 11px; opacity: .6; }
.editor-msg-log .empty { background: none; color: var(--text-muted, #666); max-width: none; }
.editor-msg-dialog textarea { width: 100%; min-height: 110px; box-sizing: border-box; padding: 10px; border: 1px solid var(--border, #ddd); border-radius: 10px;
  font: inherit; font-size: 14px; background: var(--bg, #fff); color: inherit; resize: vertical; }
.editor-msg-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.editor-msg-foot span { font-size: 12px; color: var(--text-muted, #666); }
.editor-msg-foot div { display: flex; gap: 8px; }
.editor-msg-foot button { font: inherit; font-size: 13px; min-height: 40px; padding: 0 16px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border, #ddd); background: none; color: inherit; }
.editor-msg-foot button[value="send"] { background: #111; border-color: #111; color: #fff; font-weight: 700; }
.editor-msg-foot button[value="send"]:disabled { opacity: .4; cursor: default; }
[data-theme="dark"] .editor-msg-foot button[value="send"] { background: #fff; border-color: #fff; color: #111; }
`;

  function injectCss() {
    if (document.getElementById('editorMsgCss')) return;
    const style = document.createElement('style');
    style.id = 'editorMsgCss';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function nameOf(el) {
    return (el.dataset.msgName || el.textContent || '').trim().replace(/^@/, '@') || '회원';
  }

  function decorate(root) {
    const list = [];
    if (root.matches?.(SEL)) list.push(root);
    root.querySelectorAll?.(SEL).forEach((el) => list.push(el));
    list.forEach((el) => {
      if (el.dataset.msgDone) return;
      el.dataset.msgDone = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'editor-msg-btn';
      btn.title = `${nameOf(el)} 님에게 메시지`;
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = ICON;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        open({ userId: el.dataset.msgUser, submissionId: el.dataset.msgSubmission, name: nameOf(el) });
      });
      el.after(btn);
    });
  }

  function fmt(iso) {
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch (_) { return ''; }
  }

  async function open({ userId, submissionId, name }) {
    injectCss();
    if (!userId && submissionId) userId = await db()?.messages?.ownerOfSubmission?.(submissionId);
    if (!userId) {
      window.notify?.('이 사진을 올린 회원 계정을 찾지 못했습니다. (투고 기록이 없는 사진일 수 있어요)', 'danger');
      return;
    }
    document.querySelector('.editor-msg-dialog')?.remove();
    const dlg = document.createElement('dialog');
    dlg.className = 'editor-msg-dialog';
    const fullHref = `/admin/messages.html?user=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`;
    dlg.innerHTML = `
      <form method="dialog">
        <div class="editor-msg-head">
          <h2>${esc(name)} 님에게 메시지</h2>
          <a href="${esc(fullHref)}">대화 전체 보기 →</a>
        </div>
        <div class="editor-msg-log" aria-live="polite"><p class="empty">최근 대화를 불러오는 중…</p></div>
        <textarea maxlength="2000" placeholder="편집부 이름으로 보냅니다. 회원은 「내 정보 → 메시지」와 알림으로 받습니다. (Ctrl/⌘ + Enter 로 보내기)"></textarea>
        <div class="editor-msg-foot">
          <span><b class="count">0</b> / 2000</span>
          <div>
            <button type="submit" value="cancel">취소</button>
            <button type="submit" value="send" disabled>보내기</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const ta = dlg.querySelector('textarea');
    const sendBtn = dlg.querySelector('button[value="send"]');
    const count = dlg.querySelector('.count');
    ta.addEventListener('input', () => { count.textContent = String(ta.value.length); sendBtn.disabled = !ta.value.trim(); });
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'send') return;
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      sendBtn.textContent = '보내는 중…';
      const res = await db()?.messages?.sendAsEditor?.(userId, body);
      if (!res || res.error) {
        sendBtn.disabled = false;
        sendBtn.textContent = '보내기';
        window.notify?.('보내지 못했습니다: ' + (res?.error?.message || '알 수 없는 오류'), 'danger');
        return;
      }
      window.notify?.(`${name} 님에게 메시지를 보냈습니다.`, 'success');
      dlg.close();
    });
    dlg.showModal();
    ta.focus();

    const rows = (await db()?.messages?.list?.(userId)) || [];
    const recent = rows.filter((m) => !m.deleted_at).slice(-6);
    const log = dlg.querySelector('.editor-msg-log');
    log.innerHTML = recent.length
      ? recent.map((m) => `<p class="${m.from_editor ? 'is-editor' : ''}">${esc(m.body)}<small>${m.from_editor ? '편집부' : esc(name)} · ${esc(fmt(m.created_at))}</small></p>`).join('')
      : '<p class="empty">아직 주고받은 메시지가 없습니다. 첫 메시지가 됩니다.</p>';
    log.scrollTop = log.scrollHeight;
  }

  function start() {
    injectCss();
    decorate(document.body);
    new MutationObserver((records) => {
      records.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) decorate(n); }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.EditorMessage = { open, decorate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
