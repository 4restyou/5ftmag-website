'use strict';

// 이북 보호 뷰어. ?slug=<ebook slug>.
// 로그인 + 열람권 확인 → Edge Function(ebook-page)이 워터마크 새긴 페이지를
// 토큰과 함께 받아 표시. 클린 원본은 클라이언트로 오지 않는다.

function $(id) { return document.getElementById(id); }
function db() { return window.MagDB; }
function escapeHtml(s) { return window.MagUtil ? window.MagUtil.escapeHtml(s) : String(s == null ? '' : s); }

function slugFromUrl() {
  return (new URLSearchParams(location.search).get('slug') || '').trim();
}

function showState(html) {
  const el = $('state');
  el.hidden = false;
  el.innerHTML = html;
}
function hideState() { $('state').hidden = true; }

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    if (db() && db().isReady()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return !!(db() && db().isReady());
}

function lockedHtml(product, loggedIn) {
  const cover = product.cover_image
    ? `<img class="reader-cover" src="${escapeHtml(product.cover_image)}" alt="${escapeHtml(product.title)} 표지" />`
    : '';
  if (!loggedIn) {
    return `${cover}<h2>${escapeHtml(product.title)}</h2>
      <p>이 이북은 로그인 후 열람권이 있어야 볼 수 있어요.</p>
      <button type="button" class="reader-cta" id="loginBtn">Google로 로그인</button>`;
  }
  if (product.ebook_on_sale) {
    return `${cover}<h2>${escapeHtml(product.title)}</h2>
      <p>아직 열람권이 없어요. 구매(입금) 확인 후 편집부가 열람권을 부여합니다.</p>
      <p style="font-size:13px;">구매 안내는 인스타그램 <a href="https://instagram.com/film_socialclub" target="_blank" rel="noopener">@film_socialclub</a> DM 으로 문의해 주세요.</p>`;
  }
  return `${cover}<h2>${escapeHtml(product.title)}</h2>
    <p>현재 이 이북은 열람권을 판매하고 있지 않아요.</p>`;
}

async function renderReader(product) {
  hideState();
  $('note').hidden = false;
  const total = product.page_count || 0;
  const progress = $('progress');
  const pagesEl = $('pages');
  if (!total) { showState('<p>아직 페이지가 준비되지 않았어요.</p>'); return; }

  progress.hidden = false;
  // 순차 로드 — 앞 페이지부터 보이게. (대량 동시 요청 방지)
  for (let p = 1; p <= total; p++) {
    progress.textContent = `${p} / ${total} 쪽 불러오는 중…`;
    const blob = await db().ebooks.fetchPage(product.slug, p);
    if (!blob) {
      // 한 장 실패해도 계속 시도하되, 첫 장부터 실패면 권한/배포 문제 가능성 안내
      if (p === 1) {
        progress.hidden = true;
        showState(`<h2>페이지를 불러오지 못했어요</h2>
          <p>열람권은 있는데 페이지가 안 열리면, 잠시 후 다시 시도해 주세요.</p>`);
        return;
      }
      continue;
    }
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div');
    wrap.className = 'reader-page';
    const img = document.createElement('img');
    img.decoding = 'async';
    img.alt = `${product.title} ${p}쪽`;
    img.src = url;
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    wrap.appendChild(img);
    pagesEl.appendChild(wrap);
  }
  progress.hidden = true;
}

async function init() {
  const slug = slugFromUrl();
  if (!slug) { showState('<h2>잘못된 주소</h2><p>이북을 찾을 수 없어요.</p>'); return; }

  const ready = await waitReady();
  if (!ready) { showState('<p>서비스 준비에 실패했어요. 잠시 후 새로고침해 주세요.</p>'); return; }

  const product = await db().ebooks.get(slug);
  if (!product || !product.published) {
    showState('<h2>없는 이북</h2><p>공개되지 않았거나 삭제된 이북이에요.</p>');
    return;
  }
  $('title').textContent = product.title;
  document.title = `${product.title} | 5ft magazine`;

  const session = await db().auth.getSession();
  if (!session) {
    showState(lockedHtml(product, false));
    const btn = $('loginBtn');
    if (btn) btn.addEventListener('click', () => db().auth.signInWithGoogle(location.href));
    return;
  }

  const entitled = await db().ebooks.hasAccess(product.id);
  if (!entitled) { showState(lockedHtml(product, true)); return; }

  await renderReader(product);
}

// 저장·우클릭 억제 (워터마크 보조)
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.reader-pages')) e.preventDefault();
});

init();
