// 「앱처럼 설치하기」 안내 카드 (폰에서만, 홈 화면 앱이 아닐 때).
//
// site-common.js 의 bindInstallGuide 가 조건(두 번째 페이지부터·닫은 적 없음·설치 안 함)을 보고
// 이 파일을 그때 불러와 PwaInstall.show() 를 부른다. 평소에는 실리지 않는다.
//
//   - 아이폰·아이패드 Safari: 공유 버튼 → 「홈 화면에 추가」 두 단계를 그림과 함께 안내
//   - 인스타그램·카카오톡 등 앱 안 브라우저: 홈 화면 추가가 안 되므로 Safari(또는 Chrome)로 열라고 안내
//   - 안드로이드 Chrome 등: 브라우저가 준 설치 창(beforeinstallprompt)을 「설치」 버튼에 연결
// 「다음에」는 14일 동안, 「알겠어요」·설치는 다시 띄우지 않는다(5ft-install-guide).
// 마크업과 스타일은 이 파일이 만들어 붙인다(film-slot.js 와 같은 방식).
(function () {
  'use strict';
  if (window.PwaInstall) return;
  const i18n = window.i18n || { t: (ko) => ko };
  const t = i18n.t;
  const KEY = '5ft-install-guide';
  const LATER_DAYS = 14;

  const save = (v) => { try { localStorage.setItem(KEY, v); } catch (_) {} };

  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  const CSS = `
.pwa-guide { position: fixed; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 1100;
  max-width: 420px; margin: 0 auto; padding: 16px; border-radius: 14px;
  background: var(--bg, #fff); color: var(--text, #111); border: 1px solid var(--border, #e5e5e5);
  box-shadow: 0 10px 30px rgba(0,0,0,0.18); font-size: 14px; line-height: 1.5;
  transform: translateY(16px); opacity: 0; transition: transform .2s ease, opacity .2s ease; }
.pwa-guide.is-in { transform: none; opacity: 1; }
.pwa-guide-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.pwa-guide-head img { width: 44px; height: 44px; border-radius: 10px; flex: 0 0 auto; border: 1px solid var(--border, #e5e5e5); }
.pwa-guide-title { margin: 0; font-size: 15px; font-weight: 700; }
.pwa-guide-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-muted, #666); }
.pwa-guide-steps { margin: 0 0 12px; padding: 0; list-style: none; display: grid; gap: 6px; }
.pwa-guide-steps li { display: flex; align-items: center; gap: 8px; }
.pwa-guide-steps .n { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  background: var(--text, #111); color: var(--bg, #fff); font-size: 12px; font-weight: 700; flex: 0 0 auto; }
.pwa-guide-steps svg { vertical-align: -4px; margin: 0 2px; }
.pwa-guide-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pwa-guide-actions button { font: inherit; font-size: 13px; min-height: 40px; padding: 0 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border, #ddd); background: none; color: inherit; }
.pwa-guide-actions .is-primary { background: #ffd400; border-color: #ffd400; color: #111; font-weight: 700; }
`;

  function platform() {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const inApp = /Instagram|FBAN|FBAV|KAKAOTALK|NAVER\(inapp|Line\/|DaumApps|everytimeApp/i.test(ua);
    if (inApp) return 'inapp';
    if (ios) return 'ios';
    if (window.__pwaInstallPrompt) return 'prompt';
    return '';
  }

  function close(card, value) {
    if (value) save(value);
    card.classList.remove('is-in');
    setTimeout(() => card.remove(), 220);
  }

  function show() {
    const kind = platform();
    if (!kind || document.querySelector('.pwa-guide')) return;
    if (!document.getElementById('pwaGuideCss')) {
      const style = document.createElement('style');
      style.id = 'pwaGuideCss';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const card = document.createElement('div');
    card.className = 'pwa-guide';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t('앱처럼 설치하기', 'Install as an app', 'アプリとして追加'));

    let body = '';
    let primary = '';
    if (kind === 'ios') {
      body = `<ol class="pwa-guide-steps">
        <li><span class="n">1</span><span>${t(`아래(또는 위) 막대의 공유 버튼 ${SHARE_ICON} 을 누르고`, `Tap the Share button ${SHARE_ICON} in the toolbar,`, `ツールバーの共有ボタン ${SHARE_ICON} を押して`)}</span></li>
        <li><span class="n">2</span><span>${t(`${ADD_ICON} 「홈 화면에 추가」를 고르면 끝이에요.`, `then choose ${ADD_ICON} "Add to Home Screen".`, `${ADD_ICON}「ホーム画面に追加」を選べば完了です。`)}</span></li>
      </ol>`;
      primary = `<button type="button" class="is-primary" data-act="done">${t('알겠어요', 'Got it', 'わかりました')}</button>`;
    } else if (kind === 'inapp') {
      body = `<p class="pwa-guide-sub" style="margin:0 0 12px">${t(
        '지금 보는 곳은 앱 안의 브라우저라 홈 화면에 추가할 수 없어요. 오른쪽 위(또는 아래) 메뉴에서 「Safari로 열기」나 「다른 브라우저로 열기」를 누른 뒤 추가해 주세요.',
        'This in-app browser can\'t add to the Home Screen. Use the menu to open the page in Safari or Chrome, then add it there.',
        'アプリ内ブラウザではホーム画面に追加できません。メニューから「Safariで開く」などを選んでから追加してください。'
      )}</p>`;
      primary = `<button type="button" class="is-primary" data-act="done">${t('알겠어요', 'Got it', 'わかりました')}</button>`;
    } else {
      body = `<p class="pwa-guide-sub" style="margin:0 0 12px">${t(
        '설치하면 홈 화면에서 바로 열리고 알림도 받을 수 있어요. 저장 공간은 거의 쓰지 않아요.',
        'Open it straight from your home screen and get notifications. It takes almost no space.',
        'ホーム画面からすぐ開け、通知も受け取れます。容量はほとんど使いません。'
      )}</p>`;
      primary = `<button type="button" class="is-primary" data-act="install">${t('설치', 'Install', 'インストール')}</button>`;
    }

    card.innerHTML = `
      <div class="pwa-guide-head">
        <img src="/img/favicon/icon-192.png" alt="" width="44" height="44">
        <div>
          <p class="pwa-guide-title">${t('5ft.mag 를 앱처럼 쓰세요', 'Use 5ft.mag like an app', '5ft.mag をアプリのように')}</p>
          <p class="pwa-guide-sub">${t('홈 화면에 두면 한 번에 열려요. 앱스토어 설치는 필요 없어요.', 'Keep it on your home screen. No app store needed.', 'ホーム画面からワンタップ。App Storeは不要です。')}</p>
        </div>
      </div>
      ${body}
      <div class="pwa-guide-actions">
        <button type="button" data-act="later">${t('다음에', 'Later', 'あとで')}</button>
        ${primary}
      </div>`;

    card.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'later') return close(card, `later:${Date.now()}`);
      if (act === 'done') return close(card, 'done');
      if (act === 'install') {
        const prompt = window.__pwaInstallPrompt;
        window.__pwaInstallPrompt = null;
        if (!prompt) return close(card, `later:${Date.now()}`);
        prompt.prompt();
        const choice = await prompt.userChoice.catch(() => null);
        close(card, choice && choice.outcome === 'accepted' ? 'done' : `later:${Date.now()}`);
      }
    });
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('is-in'));
  }

  window.PwaInstall = { show, LATER_DAYS };
})();
