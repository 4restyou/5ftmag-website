// 5ft.mag 댓글 위젯
// 사용법:
//   <div data-comments data-page-id="stories/12"></div>
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
//   <script src="../js/db-client.js"></script>
//   <script src="../js/comments.js"></script>

(function () {
  'use strict';

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const tr = (window.i18n || { t: (ko) => ko }).t;

  const STATE = {
    pageId: null,
    container: null,
    comments: [],
    user: null,
    profile: null,
    realtimeChannel: null,
  };

  const escapeHtml = window.MagUtil.escapeHtml;

  function nl2br(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
  }

  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return tr('방금 전', 'just now', 'たった今');
    if (diff < 3600) return tr(`${Math.floor(diff / 60)}분 전`, `${Math.floor(diff / 60)}m ago`, `${Math.floor(diff / 60)}分前`);
    if (diff < 86400) return tr(`${Math.floor(diff / 3600)}시간 전`, `${Math.floor(diff / 3600)}h ago`, `${Math.floor(diff / 3600)}時間前`);
    if (diff < 604800) return tr(`${Math.floor(diff / 86400)}일 전`, `${Math.floor(diff / 86400)}d ago`, `${Math.floor(diff / 86400)}日前`);
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function defaultAvatar(name) {
    const ch = (name || '?').trim().charAt(0).toUpperCase();
    const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
    const hash = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const bg = colors[hash % colors.length];
    return `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="${bg}"/><text x="50%" y="50%" font-size="18" font-family="sans-serif" fill="white" text-anchor="middle" dy=".35em" font-weight="600">${ch}</text></svg>`
    )}`;
  }

  function db() { return window.MagDB; }

  async function postComment(body, parentId = null) {
    const { error } = await db().comments.insert({
      pageId: STATE.pageId, body, parentId,
    });
    if (error) { window.notify?.(tr('댓글을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요. (', 'Could not save your comment. Please try again in a moment. (', 'コメントを保存できませんでした。しばらくしてからもう一度お試しください。（') + error.message + ')', 'danger'); return false; }
    return true;
  }

  async function updateComment(id, body) {
    const { error } = await db().comments.update(id, body);
    if (error) { window.notify?.(tr('댓글 수정을 저장하지 못했어요. 새로고침 후 다시 시도해 주세요. (', 'Could not save your edit. Please refresh and try again. (', 'コメントの編集を保存できませんでした。ページを再読み込みしてもう一度お試しください。（') + error.message + ')', 'danger'); return false; }
    return true;
  }

  async function deleteComment(id) {
    if (!confirm(tr('이 댓글을 삭제할까요? 삭제 후에는 본문을 다시 볼 수 없습니다.', 'Delete this comment? This cannot be undone.', 'このコメントを削除しますか？削除すると元に戻せません。'))) return false;
    const { error } = await db().comments.softDelete(id);
    if (error) { window.notify?.(tr('댓글을 삭제하지 못했어요. 권한이나 네트워크 상태를 확인해 주세요. (', 'Could not delete the comment. Check your permissions or connection. (', 'コメントを削除できませんでした。権限またはネットワーク接続を確認してください。（') + error.message + ')', 'danger'); return false; }
    return true;
  }

  async function toggleLike(commentId, alreadyLiked) {
    if (!STATE.user) {
      window.notify?.(tr('좋아요는 로그인 후에 누를 수 있어요. 로그인하면 이 글로 다시 돌아옵니다.', 'Sign in to like comments. You will come back to this article after signing in.', 'いいねはログインすると押せます。ログイン後はこの記事に戻ります。'), 'info');
      return;
    }
    if (alreadyLiked) await db().likes.remove(commentId);
    else              await db().likes.add(commentId);
    await refresh();
  }

  function renderAuthBar() {
    if (!STATE.user) {
      return `
        <div class="cm-auth">
          <span class="cm-auth-text">${tr('로그인하면 댓글과 좋아요를 남길 수 있어요.', 'Sign in to comment and like.', 'ログインすると、コメントやいいねができます。')}</span>
          <div class="cm-auth-buttons">
            <button class="cm-btn cm-btn-google" data-action="login-google">
              <svg viewBox="0 0 18 18" width="14" height="14"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.78 2.72v2.26h2.88c1.69-1.55 2.66-3.84 2.66-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.88-2.26c-.8.54-1.83.86-3.07.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.34A8.99 8.99 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.66 9c0-.59.1-1.17.3-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0C5.48 0 2.44 2.02.96 4.96l3 2.34C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
              ${tr('Google로 계속하기', 'Continue with Google', 'Googleで続ける')}
            </button>
          </div>
        </div>`;
    }
    const name = STATE.profile?.display_name || STATE.user.email?.split('@')[0] || tr('사용자', 'User', 'ユーザー');
    const avatar = STATE.profile?.avatar_url || defaultAvatar(name);
    return `
      <div class="cm-auth cm-auth-on">
        <img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" class="cm-avatar-sm" />
        <span class="cm-auth-name">${escapeHtml(name)}${STATE.profile?.is_editor ? ` <span class="cm-badge-editor">${tr('편집부', 'Editor', '編集部')}</span>` : ''}</span>
        <button class="cm-btn-link" data-action="logout">${tr('로그아웃', 'Sign out', 'ログアウト')}</button>
      </div>`;
  }

  function renderComposer(parentId = null, defaultText = '', isEdit = false, commentId = null) {
    if (!STATE.user) return '';
    const placeholder = parentId ? tr('답글을 남겨보세요…', 'Write a reply…', '返信を書く…') : tr('의견을 남겨주세요. 작가와 다른 독자들이 함께 봅니다.', 'Leave a comment. The writer and other readers will see it. Comments are shared with the Korean edition.', 'コメントをどうぞ。筆者やほかの読者も読みます。コメントは韓国語版と共通です。');
    return `
      <form class="cm-composer" data-parent-id="${parentId || ''}" ${isEdit ? `data-edit-id="${commentId}"` : ''}>
        <textarea name="body" class="cm-textarea" placeholder="${placeholder}" required maxlength="2000" rows="3">${escapeHtml(defaultText)}</textarea>
        <div class="cm-composer-actions">
          ${isEdit ? `<button type="button" class="cm-btn-link" data-action="cancel-edit">${tr('취소', 'Cancel', 'キャンセル')}</button>` : ''}
          ${parentId ? `<button type="button" class="cm-btn-link" data-action="cancel-reply">${tr('취소', 'Cancel', 'キャンセル')}</button>` : ''}
          <button type="submit" class="cm-btn cm-btn-primary">${isEdit ? tr('수정', 'Save', '保存') : (parentId ? tr('답글', 'Reply', '返信') : tr('댓글 작성', 'Post comment', 'コメントする'))}</button>
        </div>
      </form>`;
  }

  function renderComment(c, myLikes, depth = 0) {
    const isMine = STATE.user && STATE.user.id === c.user_id;
    const isEditor = STATE.profile?.is_editor;
    const canDelete = isMine || isEditor;
    const liked = myLikes.has(c.id);
    const name = c.display_name || tr('익명', 'Anonymous', '匿名');
    const avatar = c.avatar_url || defaultAvatar(name);

    const isDeleted = !!c.deleted_at;
    const bodyHtml = isDeleted
      ? `<em class="cm-deleted">${tr('삭제된 댓글입니다', 'This comment was deleted', 'このコメントは削除されました')}</em>`
      : nl2br(c.body);

    return `
      <div class="cm-item${depth > 0 ? ' cm-reply' : ''}" data-comment-id="${c.id}" data-user-id="${c.user_id}">
        <img src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}" class="cm-avatar" />
        <div class="cm-body">
          <div class="cm-head">
            <span class="cm-name">${escapeHtml(name)}</span>
            ${c.is_editor ? `<span class="cm-badge-editor">${tr('편집부', 'Editor', '編集部')}</span>` : ''}
            <span class="cm-time">${timeAgo(c.created_at)}${c.updated_at && c.updated_at !== c.created_at && !isDeleted ? tr(' · 수정됨', ' · edited', ' · 編集済み') : ''}</span>
          </div>
          <div class="cm-text">${bodyHtml}</div>
          ${isDeleted ? '' : `
            <div class="cm-actions">
              <button class="cm-action${liked ? ' is-liked' : ''}" data-action="like" data-id="${c.id}" data-liked="${liked}">
                <span class="cm-heart">${liked ? '♥' : '♡'}</span>
                <span class="cm-like-count">${c.like_count || 0}</span>
              </button>
              ${depth === 0 && STATE.user ? `<button class="cm-action" data-action="reply" data-id="${c.id}">${tr('답글', 'Reply', '返信')}</button>` : ''}
              ${isMine ? `<button class="cm-action" data-action="edit" data-id="${c.id}">${tr('수정', 'Edit', '編集')}</button>` : ''}
              ${canDelete ? `<button class="cm-action cm-action-danger" data-action="delete" data-id="${c.id}">${tr('삭제', 'Delete', '削除')}</button>` : ''}
            </div>
          `}
          <div class="cm-reply-slot" data-reply-slot="${c.id}"></div>
        </div>
      </div>`;
  }

  async function renderAll() {
    const myLikes = await db().likes.listMine();
    const topLevel = STATE.comments.filter(c => !c.parent_id);
    const repliesMap = {};
    for (const c of STATE.comments) {
      if (c.parent_id) (repliesMap[c.parent_id] ||= []).push(c);
    }
    const totalCount = STATE.comments.filter(c => !c.deleted_at).length;

    const itemsHtml = topLevel.map(c => {
      const replies = repliesMap[c.id] || [];
      const repliesHtml = replies.map(r => renderComment(r, myLikes, 1)).join('');
      return renderComment(c, myLikes, 0).replace(
        `<div class="cm-reply-slot" data-reply-slot="${c.id}"></div>`,
        `${repliesHtml ? `<div class="cm-replies">${repliesHtml}</div>` : ''}<div class="cm-reply-slot" data-reply-slot="${c.id}"></div>`
      );
    }).join('');

    STATE.container.innerHTML = `
      <div class="cm-root">
        <div class="cm-header">
          <h3 class="cm-title">${tr('댓글', 'Comments', 'コメント')} ${totalCount}</h3>
        </div>
        ${renderAuthBar()}
        ${STATE.user ? renderComposer() : ''}
        <div class="cm-list">
          ${itemsHtml || `<p class="cm-empty">${tr('아직 댓글이 없습니다. 이 글에 대한 첫 의견을 남겨보세요.', 'No comments yet. Be the first to share your thoughts.', 'まだコメントはありません。最初のコメントを書いてみませんか。')}</p>`}
        </div>
      </div>`;

    bindHandlers();
  }

  function bindHandlers() {
    STATE.container.addEventListener('click', onClick);
    STATE.container.addEventListener('submit', onSubmit);
  }

  async function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'login-google') return loginWithGoogle();
    if (action === 'logout')       return logout();

    if (action === 'like') {
      const liked = btn.dataset.liked === 'true';
      return toggleLike(btn.dataset.id, liked);
    }

    if (action === 'reply') {
      const slot = STATE.container.querySelector(`[data-reply-slot="${btn.dataset.id}"]`);
      if (slot.firstChild) { slot.innerHTML = ''; return; }
      slot.innerHTML = renderComposer(btn.dataset.id);
      slot.querySelector('textarea').focus();
      return;
    }

    if (action === 'cancel-reply') {
      btn.closest('.cm-reply-slot').innerHTML = '';
      return;
    }

    if (action === 'edit') {
      const item = btn.closest('.cm-item');
      const current = STATE.comments.find(c => c.id === btn.dataset.id);
      if (!current) return;
      const text = item.querySelector('.cm-text');
      const actions = item.querySelector('.cm-actions');
      text.style.display = 'none';
      actions.style.display = 'none';
      const composer = document.createElement('div');
      composer.className = 'cm-edit-slot';
      composer.innerHTML = renderComposer(null, current.body, true, current.id);
      text.after(composer);
      composer.querySelector('textarea').focus();
      return;
    }

    if (action === 'cancel-edit') {
      const slot = btn.closest('.cm-edit-slot');
      const item = slot.closest('.cm-item');
      slot.remove();
      item.querySelector('.cm-text').style.display = '';
      item.querySelector('.cm-actions').style.display = '';
      return;
    }

    if (action === 'delete') {
      const ok = await deleteComment(btn.dataset.id);
      if (ok) { await refresh(); window.notify?.(tr('댓글을 삭제했어요.', 'Comment deleted.', 'コメントを削除しました。'), 'info'); }
      return;
    }
  }

  async function onSubmit(e) {
    if (!e.target.matches('.cm-composer')) return;
    e.preventDefault();
    const form = e.target;
    const body = form.querySelector('textarea').value.trim();
    if (!body) return;
    const editId = form.dataset.editId;
    const parentId = form.dataset.parentId || null;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn?.textContent || '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = editId ? tr('수정 중…', 'Saving…', '保存中…') : (parentId ? tr('답글 저장 중…', 'Posting reply…', '返信を投稿中…') : tr('댓글 저장 중…', 'Posting…', '投稿中…'));
    }

    let ok = false;
    if (editId) ok = await updateComment(editId, body);
    else        ok = await postComment(body, parentId);
    if (ok) {
      form.reset();
      await refresh();
      window.notify?.(editId ? tr('댓글을 수정했어요.', 'Comment updated.', 'コメントを更新しました。') : (parentId ? tr('답글을 등록했어요.', 'Reply posted.', '返信を投稿しました。') : tr('댓글을 등록했어요.', 'Comment posted.', 'コメントを投稿しました。')), 'info');
    }
    else if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }

  async function loginWithGoogle() {
    if (!db() || !db().isReady()) return window.notify?.(tr('댓글 시스템을 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.', 'Comments are still loading. Please try again in a moment.', 'コメント機能を読み込んでいます。しばらくしてからもう一度お試しください。'), 'info');
    const { error } = await db().auth.signInWithGoogle(window.location.href.split('#')[0]);
    if (error) window.notify?.(tr('로그인을 시작하지 못했어요. 팝업 차단이나 네트워크 상태를 확인해 주세요. (', 'Could not start sign-in. Check your pop-up blocker or connection. (', 'ログインを開始できませんでした。ポップアップブロックやネットワーク接続を確認してください。（') + error.message + ')', 'danger');
  }

  async function logout() {
    if (!db()) return;
    await db().auth.signOut();
    STATE.user = null;
    STATE.profile = null;
    await refresh();
  }

  async function loadProfile() {
    if (!STATE.user) { STATE.profile = null; return; }
    STATE.profile = await db().profiles.getMine();
  }

  async function refresh() {
    STATE.comments = await db().comments.list(STATE.pageId);
    await renderAll();
  }

  function setupRealtime() {
    if (STATE.realtimeChannel) return;
    STATE.realtimeChannel = db().realtime.subscribeComments(STATE.pageId, refresh);
  }

  async function init({ pageId, container } = {}) {
    container = container || document.querySelector('[data-comments]');
    if (!container) return;
    pageId = pageId || container.dataset.pageId;
    if (!pageId) return;
    if (!db() || !db().isReady()) {
      container.innerHTML = `<p class="cm-error">${tr('댓글을 불러오지 못했습니다. 새로고침 후에도 반복되면 편집부에 알려주세요 (인스타그램 @5ft.magazine DM).', 'Could not load comments. If this keeps happening after a refresh, please let the editors know (Instagram DM @5ft.magazine).', 'コメントを読み込めませんでした。再読み込みしても続く場合は、編集部までお知らせください（Instagram @5ft.magazine に DM）。')}</p>`;
      return;
    }

    STATE.pageId = pageId;
    STATE.container = container;

    const session = await db().auth.getSession();
    STATE.user = session?.user || null;
    await loadProfile();

    await refresh();
    setupRealtime();

    db().auth.onChange(async (_event, sess) => {
      STATE.user = sess?.user || null;
      await loadProfile();
      await refresh();
    });
  }

  window.MagComments = { init };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('[data-comments]')) init();
    });
  } else {
    if (document.querySelector('[data-comments]')) init();
  }
})();
