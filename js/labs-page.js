// 필름 현상소 / 카메라 수리실 리스트 페이지.
//   상단 탭으로 현상소(labs)·수리실(repair_shops)을 전환한다.
//   둘 다 원본 Supabase 테이블을 직접 읽어 admin 수정이 새로고침만으로 반영된다.
//   (현상소는 실패 시 정적 data/labs.json 으로 폴백.)
//   네이버 지도(Web Dynamic Map)에 현재 필터·검색 결과를 마커로 표시한다.

(function () {
  'use strict';

  // 영문판(/en/)은 js/i18n.js 를 먼저 불러온다. 한국어 페이지에선 한국어 그대로.
  const i18n = window.i18n || { isEn: false, lang: 'ko', locale: 'ko-KR', t: (ko) => ko, url: (u) => u };
  const tr = i18n.t;

  const listEl = document.getElementById('labsList');
  const filterEl = document.getElementById('labsFilter');
  const searchEl = document.getElementById('labsSearch');
  const countEl = document.getElementById('labsCount');
  const tabsEl = document.querySelector('.labs-tabs');
  const introEl = document.getElementById('labsIntro');
  const viewToggleEl = document.querySelector('.labs-view-toggle');
  const mapSectionEl = document.getElementById('labsMapSection');
  const listSectionEl = document.getElementById('main');
  if (!listEl) return;

  let map = null;
  let markers = [];
  let infoWindow = null;
  let mapReady = false;

  // 지역 정렬 우선순위 (그 외는 뒤에 등장 순)
  // 2026-07-01 전남광주통합특별시 출범으로 광주와 전남이 하나가 됐다.
  // 화면에는 다른 지역과 길이를 맞춰 「전남광주」로 줄여 쓴다.
  const REGION_ORDER = ['서울', '경기', '인천', '강원', '대전', '충남', '충북', '세종',
    '대구', '경북', '부산', '울산', '경남', '전남광주', '전북', '제주'];

  // 지역 표시 이름. region 값 자체(필터·?region=·정렬 키)는 한국어 그대로 둔다.
  const REGION_EN = {
    '서울': 'Seoul', '경기': 'Gyeonggi', '인천': 'Incheon', '강원': 'Gangwon',
    '대전': 'Daejeon', '충남': 'Chungnam', '충북': 'Chungbuk', '세종': 'Sejong',
    '대구': 'Daegu', '경북': 'Gyeongbuk', '부산': 'Busan', '울산': 'Ulsan',
    '경남': 'Gyeongnam', '전남광주': 'Gwangju · Jeonnam',
    '전북': 'Jeonbuk', '제주': 'Jeju', '기타': 'Other',
  };
  const REGION_JA = {
    '서울': 'ソウル', '경기': '京畿', '인천': '仁川', '강원': '江原',
    '대전': '大田', '충남': '忠南', '충북': '忠北', '세종': '世宗',
    '대구': '大邱', '경북': '慶北', '부산': '釜山', '울산': '蔚山',
    '경남': '慶南', '전남광주': '全南光州',
    '전북': '全北', '제주': '済州', '기타': 'その他',
  };
  function regionLabel(r) {
    if (!r) return '';
    if (i18n.lang === 'ja') return REGION_JA[r] || REGION_EN[r] || r;
    return i18n.isEn ? (REGION_EN[r] || r) : r;
  }
  // 화면에 보이는 값만 외국어 칸(name_en / nameEn, 일문판은 name_ja / nameJa 먼저)을 쓰고, 없으면 한국어 원문.
  // 슬러그·지역·지도 검색 주소는 원문 그대로 쓴다.
  function shown(item, key) {
    if (!item) return '';
    if (i18n.lang === 'ja') {
      const v = item[key + 'Ja'] ?? item[`${key}_ja`];
      if (v != null && v !== '') return v;
    }
    if (i18n.isEn) {
      const camel = key + 'En';
      const v = item[camel] ?? item[`${key}_en`];
      if (v != null && v !== '') return v;
    }
    return item[key];
  }

  const TAB = {
    labs: {
      intro: tr('전국 필름 현상소를 한자리에 모았어요. 지역과 컬러·흑백·슬라이드 현상 가격, 스캔 화질, 홈페이지를 비교하고 <span class="accent">지도에서 위치까지</span> 확인할 수 있는 목록이에요.',
        'Film labs across Korea in one place. Compare region, color, B&amp;W and slide developing prices, scan resolution and websites, and <span class="accent">find each lab on the map</span>.', '韓国全国のフィルム現像所をまとめました。地域、カラー・モノクロ・スライド現像の料金、スキャン解像度、ウェブサイトを比べて、<span class="accent">地図で場所まで</span>確認できます。'),
      placeholder: tr('현상소·지역·특징으로 검색…', 'Search labs, regions, features…', '現像所・地域・特徴で検索…'),
      empty: tr('조건에 맞는 현상소가 없습니다. 지역이나 검색어를 바꿔보세요.', 'No labs match. Try another region or search term.', '条件に合う現像所がありません。地域や検索語を変えてみてください。'),
      loadFail: tr('현상소 목록을 불러오지 못했어요.', 'Could not load the lab list.', '現像所の一覧を読み込めませんでした。'),
    },
    repairs: {
      intro: tr('전국 카메라 수리실을 모았어요. 라이카·올드카메라·SLR·컴팩트 등 <span class="accent">전문 분야와 지역</span>을 비교할 수 있어요. 주소가 등록된 곳은 지도에서 위치도 확인할 수 있습니다.',
        'Camera repair shops across Korea. Compare <span class="accent">specialties and regions</span>, from Leica and vintage cameras to SLRs and compacts. Shops with an address also appear on the map.', '韓国全国のカメラ修理店をまとめました。ライカ、オールドカメラ、一眼レフ、コンパクトなど、<span class="accent">専門分野と地域</span>を比べられます。住所が登録されている店は地図でも場所を確認できます。'),
      placeholder: tr('수리실·지역·전문분야로 검색…', 'Search repair shops, regions, specialties…', '修理店・地域・専門分野で検索…'),
      empty: tr('조건에 맞는 수리실이 없습니다. 지역이나 검색어를 바꿔보세요.', 'No repair shops match. Try another region or search term.', '条件に合う修理店がありません。地域や検索語を変えてみてください。'),
      loadFail: tr('수리실 목록을 불러오지 못했어요.', 'Could not load the repair shop list.', '修理店の一覧を読み込めませんでした。'),
    },
  };

  let tab = 'labs';
  const datasets = { labs: null, repairs: null };
  let data = [];
  let region = 'all';
  let query = '';
  let view = 'list';

  // 모바일에서 목록이 길어 스크롤 피로가 크므로, 필터·검색이 없을 때만 처음 일부만
  // 보여주고 "더 보기" 로 확장한다. (films 라이브러리와 동일 패턴)
  const MOBILE_INITIAL = 30;
  const MOBILE_STEP = 30;
  let mobileVisible = MOBILE_INITIAL;
  const isMobileLabs = () => !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function won(v) {
    if (v == null || v === '') return null;
    return typeof v === 'number'
      ? tr(`${v.toLocaleString('ko-KR')}원`, `${v.toLocaleString(i18n.locale)} won`, `${v.toLocaleString(i18n.locale)}ウォン`)
      : String(v);
  }
  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-').replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function itemSlug(item) {
    // name + region 으로 고유성 확보 (같은 이름이 지역 달리 있을 수 있음).
    return slugify(`${item.name}-${item.region || ''}`);
  }
  function normalizeLookup(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  }
  function hasCoord(item) {
    return isValidCoord({ lat: Number(item?.lat), lng: Number(item?.lng) });
  }
  function isValidCoord(coord) {
    const lat = Number(coord?.lat);
    const lng = Number(coord?.lng);
    // 국내 현상소·수리실 목록이므로 한국 주변 좌표만 허용한다.
    // 예전 브라우저 캐시에 뒤집힌 좌표가 남아 있으면 모달과 메인 지도 모두 바다로 튄다.
    return Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= 30 && lat <= 39
      && lng >= 124 && lng <= 132;
  }
  function addressCompatible(a, b) {
    const aa = normalizeLookup(a);
    const bb = normalizeLookup(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }
  // 슬러그 → { marker, item } 매핑. updateMarkers 에서 채움.
  const markerBySlug = new Map();
  let activeMapSlug = null;
  let deepLinkApplied = false;
  let regionDeepLinkApplied = false;
  let deepLinkOtherTabTried = false;

  // 테이블 row(컬럼명) → 현상소 카드가 쓰는 형태(scan_res → scanRes 만 다름).
  function rowToLab(r) {
    return {
      name: r.name || '',
      region: r.region ?? null,
      address: r.address ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      scanRes: r.scan_res ?? null,
      features: r.features ?? null,
      url: r.url ?? null,
      prices: r.prices || {},
      nameEn: r.name_en ?? r.nameEn ?? null,
      addressEn: r.address_en ?? r.addressEn ?? null,
      featuresEn: r.features_en ?? r.featuresEn ?? null,
      nameJa: r.name_ja ?? r.nameJa ?? null,
      addressJa: r.address_ja ?? r.addressJa ?? null,
      featuresJa: r.features_ja ?? r.featuresJa ?? null,
    };
  }

  let staticLabsPromise = null;
  async function loadStaticLabs() {
    if (!staticLabsPromise) {
      staticLabsPromise = fetch('/data/labs.json')
        .then((res) => res.json())
        .then((res) => Array.isArray(res.labs) ? res.labs : [])
        .catch(() => []);
    }
    return staticLabsPromise;
  }
  function enrichLabWithStaticCoord(lab, staticLabs) {
    if (hasCoord(lab) || !Array.isArray(staticLabs) || !staticLabs.length) return lab;
    const labName = normalizeLookup(lab.name);
    const labRegion = normalizeLookup(lab.region);
    const match = staticLabs.find((s) => hasCoord(s) && addressCompatible(lab.address, s.address))
      || staticLabs.find((s) => {
        if (!hasCoord(s)) return false;
        if (normalizeLookup(s.name) !== labName || normalizeLookup(s.region) !== labRegion) return false;
        return !lab.address || !s.address || addressCompatible(lab.address, s.address);
    });
    return match ? { ...lab, lat: match.lat, lng: match.lng } : lab;
  }
  async function loadLabs() {
    // 원본 = Supabase labs 테이블. 실패 시 정적 data/labs.json 으로 폴백.
    const staticLabs = await loadStaticLabs();
    try {
      const rows = await window.MagDB?.labs?.list?.();
      if (Array.isArray(rows) && rows.length) {
        return rows.map(rowToLab).map((lab) => enrichLabWithStaticCoord(lab, staticLabs));
      }
    } catch (_) { /* 폴백으로 진행 */ }
    return staticLabs;
  }

  let staticRepairsPromise = null;
  async function loadStaticRepairs() {
    if (!staticRepairsPromise) {
      staticRepairsPromise = fetch('/data/repairs.json')
        .then((res) => res.json())
        .then((res) => Array.isArray(res.repairs) ? res.repairs : [])
        .catch(() => []);
    }
    return staticRepairsPromise;
  }
  async function loadRepairs() {
    // 원본 = Supabase repair_shops 테이블. 실패 시 정적 data/repairs.json 으로
    // 폴백한다(현상소와 같은 구조). 예전에는 폴백이 없어서 DB 가 안 열리면
    // 수리실 탭이 통째로 비었다.
    const staticRepairs = await loadStaticRepairs();
    try {
      const rows = await window.MagDB?.repairs?.list?.();
      if (Array.isArray(rows) && rows.length) return rows;
    } catch (_) { /* 폴백으로 진행 */ }
    return staticRepairs;
  }

  async function setTab(next) {
    if (next === tab && datasets[tab]) return;
    const tabChanged = next !== tab;
    tab = next;
    if (tabsEl) {
      tabsEl.querySelectorAll('.labs-tab').forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    if (introEl) introEl.innerHTML = TAB[tab].intro;
    if (searchEl) searchEl.placeholder = TAB[tab].placeholder;
    region = 'all';
    if (tabChanged) {
      query = '';
      if (searchEl) searchEl.value = '';
    }
    mobileVisible = MOBILE_INITIAL;
    if (!datasets[tab]) {
      listEl.innerHTML = MagState.loading({ count: 8, variant: 'wide' });
      try {
        datasets[tab] = tab === 'labs' ? await loadLabs() : await loadRepairs();
      } catch (_) {
        const loadingTab = tab;
        listEl.innerHTML = MagState.error({ title: TAB[tab].loadFail });
        MagState.bindAction(listEl, 'retry', () => { datasets[loadingTab] = null; setTab(loadingTab); });
        return;
      }
    }
    data = datasets[tab] || [];
    renderFilter();
    apply();
  }

  function regionsInOrder() {
    const present = new Set(data.map((l) => l.region).filter(Boolean));
    const ordered = REGION_ORDER.filter((r) => present.has(r));
    for (const r of present) if (!ordered.includes(r)) ordered.push(r);
    return ordered;
  }

  function renderFilter() {
    if (!filterEl) return;
    const regions = regionsInOrder();
    // labs.html?region=서울 로 들어오면 그 지역만 걸러 보여준다.
    // 지역 페이지(/labs/<region>.html)는 검색용이라, 독자에게 보이는 링크는
    // 이 목록으로 오게 하고 여기서 지역을 맞춰 준다.
    if (!regionDeepLinkApplied) {
      regionDeepLinkApplied = true;
      try {
        const wanted = new URL(location.href).searchParams.get('region');
        if (wanted && regions.includes(wanted)) region = wanted;
      } catch (_) {}
    }
    const chip = (key, label, n) =>
      `<button type="button" class="ft-chip filter-chip${key === region ? ' active' : ''}" data-region="${escapeAttr(key)}">${escapeHtml(label)}<span class="ft-chip-count labs-chip-count">${n}</span></button>`;
    let html = chip('all', tr('전체', 'All', 'すべて'), data.length);
    for (const r of regions) html += chip(r, regionLabel(r), data.filter((l) => l.region === r).length);
    filterEl.innerHTML = html;
    filterEl.querySelectorAll('.filter-chip').forEach((b) => {
      b.addEventListener('click', () => {
        region = b.dataset.region;
        mobileVisible = MOBILE_INITIAL;
        filterEl.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === b));
        apply();
      });
    });
  }

  function matches(item) {
    if (region !== 'all' && item.region !== region) return false;
    if (query) {
      const hay = (tab === 'labs'
        ? `${item.name} ${item.address || ''} ${item.features || ''} ${item.region || ''}`
        : `${item.name} ${item.address || ''} ${item.specialty || ''} ${item.description || ''} ${item.region || ''}`
      ).toLowerCase();
      const hayEn = i18n.isEn
        ? `${shown(item, 'name')} ${shown(item, 'address') || ''} ${(tab === 'labs'
          ? shown(item, 'features')
          : `${shown(item, 'specialty') || ''} ${shown(item, 'description') || ''}`) || ''} ${regionLabel(item.region)}`.toLowerCase()
        : '';
      if (!hay.includes(query) && !hayEn.includes(query)) return false;
    }
    return true;
  }

  // 방문자 정렬.
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko');

  // 지역순: 지역별로 묶어 구분 헤더와 함께 렌더. REGION_ORDER 우선, 그 외는 가나다,
  // 지역 없는 항목은 '기타'로 맨 끝. 각 지역 안은 이름순.
  const regionKey = (it) => it.region || '기타';
  const regionRank = (r) => (r === '기타' ? 9999 : (REGION_ORDER.indexOf(r) === -1 ? 998 : REGION_ORDER.indexOf(r)));
  function sortByRegion(items) {
    return [...items].sort((a, b) => {
      const ka = regionKey(a), kb = regionKey(b);
      return (regionRank(ka) - regionRank(kb)) || ka.localeCompare(kb, 'ko') || byName(a, b);
    });
  }
  // items 는 sortByRegion 을 거친 목록(모바일에선 앞부분만). 머리 숫자는 all(잘리기 전 전체) 기준.
  function renderGrouped(items, all = items) {
    const totals = new Map();
    for (const it of all) totals.set(regionKey(it), (totals.get(regionKey(it)) || 0) + 1);
    const groups = new Map();
    for (const it of items) {
      const key = regionKey(it);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    return [...groups.keys()].map((k) => {
      const grp = groups.get(k);
      const n = totals.get(k) || grp.length;
      return `<h2 class="labs-region-divider">${escapeHtml(regionLabel(k))}<span class="labs-region-divider-count">${tr(`${n}곳`, `${n}`, `${n}か所`)}</span></h2>`
        + grp.map(card).join('');
    }).join('');
  }

  function priceChips(p) {
    if (!p) return '';
    const items = [
      [tr('컬러', 'Color', 'カラー'), p.color && p.color['135'] && p.color['135'].basic],
      [tr('흑백', 'B&W', 'モノクロ'), p.bw && p.bw['135'] && p.bw['135'].basic],
      [tr('슬라이드', 'Slide', 'スライド'), p.slide && p.slide['135'] && p.slide['135'].basic],
      [tr('영화용', 'Cine', '映画用'), p.cinema && p.cinema['135'] && p.cinema['135'].basic],
    ].filter(([, v]) => v != null && v !== '');
    if (!items.length) return '';
    return `<div class="lab-prices">${items
      .map(([k, v]) => `<span class="lab-price"><span class="lab-price-k">${escapeHtml(k)}</span> ${escapeHtml(won(v))}</span>`)
      .join('')}<span class="lab-price-note">${tr('135 기본 기준', '135, standard scan', '135・標準スキャン')}</span></div>`;
  }
  function labCardSummary(lab) {
    const p = lab?.prices || {};
    const items = [
      [tr('컬러', 'Color', 'カラー'), p.color && p.color['135'] && p.color['135'].basic],
      [tr('흑백', 'B&W', 'モノクロ'), p.bw && p.bw['135'] && p.bw['135'].basic],
      [tr('슬라이드', 'Slide', 'スライド'), p.slide && p.slide['135'] && p.slide['135'].basic],
      [tr('영화용', 'Cine', '映画用'), p.cinema && p.cinema['135'] && p.cinema['135'].basic],
    ].filter(([, v]) => v != null && v !== '');
    if (items.length) {
      return `<span class="lab-card-summary">${items
        .map(([k, v]) => `<span>${escapeHtml(k)} <strong>${escapeHtml(won(v))}</strong></span>`)
        .join('')}<span class="lab-card-summary-note">${tr('135 기준', '135', '135基準')}</span></span>`;
    }
    const fallback = [lab.scanRes && tr(`기본 스캔 ${lab.scanRes}`, `Standard scan ${lab.scanRes}`, `標準スキャン ${lab.scanRes}`), shown(lab, 'features')]
      .filter(Boolean)
      .join(' · ');
    return fallback ? `<span class="lab-card-summary">${escapeHtml(fallback)}</span>` : '';
  }
  function repairCardSummary(shop) {
    const summary = [shown(shop, 'specialty'), shop.contact]
      .filter(Boolean)
      .join(' · ');
    return summary ? `<span class="lab-card-summary">${escapeHtml(summary)}</span>` : '';
  }

  function labCard(lab) {
    const slug = itemSlug(lab);
    return `
      <article class="lab-card" data-slug="${escapeAttr(slug)}" data-reveal>
        <button type="button" class="lab-card-head" aria-haspopup="dialog">
          <span class="lab-name">${escapeHtml(shown(lab, 'name'))}</span>
          <span class="lab-region">${escapeHtml(regionLabel(lab.region))}</span>
          <span class="lab-card-chevron" aria-hidden="true">›</span>
          ${labCardSummary(lab)}
        </button>
      </article>`;
  }

  function repairCard(s) {
    const slug = itemSlug(s);
    return `
      <article class="lab-card" data-slug="${escapeAttr(slug)}" data-reveal>
        <button type="button" class="lab-card-head" aria-haspopup="dialog">
          <span class="lab-name">${escapeHtml(shown(s, 'name'))}</span>
          <span class="lab-region">${escapeHtml(regionLabel(s.region))}</span>
          <span class="lab-card-chevron" aria-hidden="true">›</span>
          ${repairCardSummary(s)}
        </button>
      </article>`;
  }

  // 모달에 들어갈 상세 마크업 (현상소).
  function labDetailHtml(lab) {
    const mapHref = lab.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(lab.address)}`
      : null;
    const links = [];
    if (mapHref) links.push(`<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" class="lab-link lab-link-map">${tr('지도에서 보기 ↗', 'Naver Map (Korean) ↗', 'NAVERマップ（韓国語） ↗')}</a>`);
    if (lab.url) links.push(`<a href="${escapeAttr(lab.url)}" target="_blank" rel="noopener" class="lab-link">${tr('홈페이지·SNS ↗', 'Website / social ↗', 'ウェブサイト・SNS ↗')}</a>`);
    return `
      ${lab.address ? `<p class="lab-addr">${escapeHtml(shown(lab, 'address'))}</p>` : ''}
      ${priceChips(lab.prices)}
      ${lab.scanRes ? `<p class="lab-meta">${tr('기본 스캔', 'Standard scan', '標準スキャン')} ${escapeHtml(lab.scanRes)}</p>` : ''}
      ${lab.features ? `<p class="lab-features">${escapeHtml(shown(lab, 'features'))}</p>` : ''}
      ${links.length ? `<div class="lab-links">${links.join('')}</div>` : ''}
    `;
  }
  // 모달에 들어갈 상세 마크업 (수리실).
  function repairDetailHtml(s) {
    const mapHref = s.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(s.address)}`
      : null;
    const links = [];
    if (mapHref) links.push(`<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" class="lab-link lab-link-map">${tr('지도에서 보기 ↗', 'Naver Map (Korean) ↗', 'NAVERマップ（韓国語） ↗')}</a>`);
    if (s.url) links.push(`<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" class="lab-link">${tr('홈페이지·SNS ↗', 'Website / social ↗', 'ウェブサイト・SNS ↗')}</a>`);
    return `
      ${s.address ? `<p class="lab-addr">${escapeHtml(shown(s, 'address'))}</p>` : ''}
      ${s.specialty ? `<p class="lab-meta">${tr('전문', 'Specialty:', '専門：')} ${escapeHtml(shown(s, 'specialty'))}</p>` : ''}
      ${s.contact ? `<p class="lab-meta">${tr('연락처', 'Contact:', '連絡先：')} ${escapeHtml(s.contact)}</p>` : ''}
      ${s.description ? `<p class="lab-features">${escapeHtml(shown(s, 'description'))}</p>` : ''}
      ${links.length ? `<div class="lab-links">${links.join('')}</div>` : ''}
    `;
  }
  function detailHtml(item) {
    return tab === 'labs' ? labDetailHtml(item) : repairDetailHtml(item);
  }

  function card(item) {
    return tab === 'labs' ? labCard(item) : repairCard(item);
  }

  // 지도 SDK 를 못 불렀을 때 독자에게 보이는 안내. 지도 버튼을 눌러도 아무 반응이 없던 문제.
  const mapFailText = () => (tab === 'labs'
    ? tr("지도를 불러오지 못했어요. 각 현상소의 '지도에서 보기'를 눌러 주세요", "The map couldn't load. Use “Naver Map (Korean) ↗” on each lab instead.", '地図を読み込めませんでした。各現像所の「NAVERマップ（韓国語）」からご覧ください。')
    : tr("지도를 불러오지 못했어요. 각 수리실의 '지도에서 보기'를 눌러 주세요", "The map couldn't load. Use “Naver Map (Korean) ↗” on each shop instead.", '地図を読み込めませんでした。各修理店の「NAVERマップ（韓国語）」からご覧ください。'));
  function showMapFailNotice() {
    if (mapSectionEl) mapSectionEl.hidden = true;
    let note = document.getElementById('labsMapFail');
    if (!note) {
      note = document.createElement('p');
      note.id = 'labsMapFail';
      note.className = 'labs-count labs-map-fail';
      note.setAttribute('role', 'status');
      const anchor = document.getElementById('labsCount');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(note, anchor);
      else if (mapSectionEl && mapSectionEl.parentNode) mapSectionEl.parentNode.insertBefore(note, mapSectionEl);
      else return;
    }
    note.textContent = mapFailText();
    note.hidden = false;
  }

  function initMap() {
    const el = document.getElementById('labsMap');
    // SDK 로드 실패(오프라인·차단) 시 지도 영역을 숨기고 리스트만 유지한 채 안내를 띄운다.
    if (!el || !window.naver || !naver.maps) {
      console.warn('[labs] naver maps SDK not loaded');
      showMapFailNotice();
      return;
    }
    // 도메인·키 인증 실패 시에도 빈 회색 박스 대신 영역을 접는다.
    window.addEventListener('labs:naver-map-auth-failed', () => {
      showMapFailNotice();
      setView('list');
    });
    if (window.__labsNaverMapAuthFailed) {
      showMapFailNotice();
      return;
    }
    map = new naver.maps.Map(el, {
      center: new naver.maps.LatLng(36.5, 127.8),
      zoom: 7,
      scaleControl: false,
      mapDataControl: false,
    });
    infoWindow = new naver.maps.InfoWindow({ borderWidth: 1, borderColor: '#111', anchorSize: new naver.maps.Size(10, 10) });
    mapReady = true;
    setupMyLocation();
  }

  // ── 내 위치 보기 ──
  // 브라우저 geolocation 으로 현재 좌표를 받아 지도를 이동하고 파란 점을 찍는다.
  let myLocationMarker = null;
  function setupMyLocation() {
    const btn = document.getElementById('labsMyLocation');
    if (!btn) return;
    if (!('geolocation' in navigator)) return;   // 미지원 브라우저는 버튼을 노출하지 않음
    btn.hidden = false;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-loading')) return;
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (policy && !policy.allowsFeature('geolocation')) {
        const msg = tr('이 화면에서는 위치 접근이 제한되어 있어요. 외부 브라우저에서 열거나 지역을 선택해 주세요.',
          'Location access is blocked here. Open this page in your browser or pick a region.', 'この画面では位置情報が使えません。外部ブラウザで開くか、地域を選んでください。');
        window.notify ? window.notify(msg, 'info') : alert(msg);
        return;
      }
      btn.classList.add('is-loading');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btn.classList.remove('is-loading');
          const here = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
          if (myLocationMarker) {
            myLocationMarker.setPosition(here);
          } else {
            myLocationMarker = new naver.maps.Marker({
              map,
              position: here,
              icon: {
                content: '<span class="labs-my-dot" aria-hidden="true"></span>',
                anchor: new naver.maps.Point(7, 7),
              },
              zIndex: 200,
            });
          }
          // morph: 중심 이동 + 줌을 한 동작으로 부드럽게
          map.morph(here, Math.max(map.getZoom(), 13));
        },
        (err) => {
          btn.classList.remove('is-loading');
          const msg = err && err.code === 1
            ? tr('위치 권한이 꺼져 있어요. 브라우저 설정에서 위치 접근을 허용해 주세요.',
              'Location permission is off. Allow location access in your browser settings.', '位置情報の許可がオフになっています。ブラウザの設定で位置情報へのアクセスを許可してください。')
            : tr('현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
              'Could not get your location. Please try again in a moment.', '現在地を取得できませんでした。しばらくしてからもう一度お試しください。');
          window.notify ? window.notify(msg, 'info') : alert(msg);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  function infoContent(item) {
    const slug = itemSlug(item);
    const naverMap = item.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(item.address)}`
      : null;
    const links = [];
    links.push(`<button type="button" class="labs-map-info-button" data-labs-map-detail="${escapeAttr(slug)}">${tr('자세히', 'Details', '詳細')}</button>`);
    if (naverMap) links.push(`<a href="${escapeAttr(naverMap)}" target="_blank" rel="noopener">${tr('길찾기 ↗', 'Directions ↗', '経路案内 ↗')}</a>`);
    if (item.url) links.push(`<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${tr('홈페이지 ↗', 'Website ↗', 'ウェブサイト ↗')}</a>`);
    return `<div class="labs-map-info">
      <strong>${escapeHtml(shown(item, 'name'))}</strong>
      ${item.address ? `<span class="labs-map-info-addr">${escapeHtml(shown(item, 'address'))}</span>` : ''}
      ${links.length ? `<span class="labs-map-info-links">${links.join('')}</span>` : ''}
    </div>`;
  }

  // ── 좌표 해석 ──
  // DB/정적 JSON 의 lat/lng 를 우선 사용하고, 좌표가 없는 새 항목만 주소 geocode 로 보완한다.
  // 캐시는 주소 키라, admin 에서 주소만 고치면 다음 방문에 자동 반영.
  const GEO_CACHE_KEY = '5ft-labs-geo-v2';
  let geoCache;
  try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch (_) { geoCache = {}; }
  function saveGeoCache() { try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch (_) {} }

  function geocodeAddress(address) {
    return new Promise((resolve) => {
      if (!address) { resolve(null); return; }
      if (isValidCoord(geoCache[address])) { resolve(geoCache[address]); return; }
      if (geoCache[address]) { delete geoCache[address]; saveGeoCache(); }
      if (!window.naver || !naver.maps || !naver.maps.Service) { resolve(null); return; }
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
      try {
        naver.maps.Service.geocode({ query: address }, (status, res) => {
          if (done) return;
          done = true; clearTimeout(timer);
          const a = status === naver.maps.Service.Status.OK && res && res.v2 && res.v2.addresses && res.v2.addresses[0];
          if (!a) { resolve(null); return; }
          const coord = { lat: Number(a.y), lng: Number(a.x) };
          if (!isValidCoord(coord)) { resolve(null); return; }
          geoCache[address] = coord; saveGeoCache();
          resolve(coord);
        });
      } catch (_) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
  }
  async function resolveItemCoord(item) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    if (isValidCoord({ lat, lng })) return { lat, lng };
    return geocodeAddress(item?.address);
  }

  let renderToken = 0;
  function currentFiltered() {
    return data.filter(matches);
  }
  async function updateMarkers(shown) {
    if (!mapReady || !map || view !== 'map') return;
    const token = ++renderToken;
    markers.forEach((m) => m.setMap(null));
    markers = [];
    markerBySlug.clear();
    if (infoWindow) infoWindow.close();
    const bounds = new naver.maps.LatLngBounds();
    let count = 0;
    for (const item of shown) {
      const coord = await resolveItemCoord(item);
      if (token !== renderToken) return; // 더 최신 렌더가 시작됨 → 중단
      if (!coord) continue;
      if (!isValidCoord(coord)) continue;
      const pos = new naver.maps.LatLng(coord.lat, coord.lng);
      const marker = new naver.maps.Marker({ position: pos, map, title: shown(item, 'name') });
      const slug = itemSlug(item);
      naver.maps.Event.addListener(marker, 'click', () => {
        if (activeMapSlug === slug) { openModal(slug); return; }
        focusMarkerBySlug(slug);
      });
      markers.push(marker);
      markerBySlug.set(slug, { marker, item });
      bounds.extend(pos);
      count++;
    }
    if (token !== renderToken) return;
    if (count === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(15);
    } else if (count > 1) {
      map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    }
  }

  function updateMoreButton(total) {
    const wrap = document.getElementById('labsMoreWrap');
    const btn = document.getElementById('labsMoreBtn');
    if (!wrap || !btn) return;
    const shouldShow = total > mobileVisible;
    wrap.hidden = !shouldShow;
    if (shouldShow) btn.textContent = tr(`더 보기 (${total - mobileVisible})`, `Show more (${total - mobileVisible})`, `もっと見る（${total - mobileVisible}）`);
  }

  function resetLabsFilter() {
    region = 'all';
    query = '';
    if (searchEl) searchEl.value = '';
    mobileVisible = MOBILE_INITIAL;
    renderFilter();
    apply();
  }

  function renderLabsCount(count) {
    if (!countEl) return;
    const hasFilter = region !== 'all' || !!query;
    const countLabel = tr(`${count}곳`, count === 1 ? '1 place' : `${count} places`, `${count}か所`);
    if (!hasFilter) { countEl.textContent = countLabel; return; }
    countEl.innerHTML = '';
    const parts = [];
    if (region !== 'all') parts.push(regionLabel(region));
    if (query) parts.push(`"${query}"`);
    const seg = document.createElement('span');
    seg.className = 'labs-count-filter';
    seg.textContent = parts.join(' · ');
    countEl.appendChild(seg);
    const cnt = document.createElement('span');
    cnt.className = 'labs-count-num';
    cnt.textContent = countLabel;
    countEl.appendChild(cnt);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'labs-count-reset';
    reset.textContent = tr('초기화', 'Reset', 'リセット');
    reset.addEventListener('click', resetLabsFilter);
    countEl.appendChild(reset);
  }

  function apply() {
    const filtered = currentFiltered();
    renderLabsCount(filtered.length);
    if (view === 'map') updateMarkers(filtered);
    else if (infoWindow) infoWindow.close();
    if (!filtered.length) {
      const hasFilter = region !== 'all' || !!query;
      listEl.innerHTML = MagState.empty({
        title: TAB[tab].empty,
        actionLabel: hasFilter ? tr('전체 보기', 'Show all', 'すべて表示') : '',
        action: 'reset',
      });
      if (hasFilter) {
        MagState.bindAction(listEl, 'reset', resetLabsFilter);
      }
      updateMoreButton(0);
      return;
    }
    // 모바일 + 필터·검색 없을 때만 처음 일부만 렌더. 지도 마커는 전체(filtered) 유지.
    const capped = isMobileLabs() && region === 'all' && !query;
    const sorted = sortByRegion(filtered);
    listEl.innerHTML = renderGrouped(capped ? sorted.slice(0, mobileVisible) : sorted, sorted);
    updateMoreButton(capped ? filtered.length : 0);
    // 첫 렌더 후 URL 의 ?lab=slug 가 있으면 해당 카드 자동 펼침.
    if (!deepLinkApplied) tryApplyDeepLink();
  }

  // ── 모달 / 공유 / 지도 마커 연동 / deep link ──
  function findItemBySlug(slug) {
    return data.find(it => itemSlug(it) === slug) || null;
  }
  function focusMarkerBySlug(slug, opts = {}) {
    if (!mapReady || !map || !infoWindow) return;
    const entry = markerBySlug.get(slug);
    if (!entry) return;
    const pos = entry.marker.getPosition();
    if (map.getZoom() < 15) map.setZoom(15);
    map.setCenter(pos);
    if (opts.openInfo !== false) {
      activeMapSlug = slug;
      infoWindow.setContent(infoContent(entry.item));
      infoWindow.open(map, entry.marker);
      requestAnimationFrame(() => map.setCenter(pos));
      setTimeout(() => map.setCenter(pos), 120);
    }
  }
  function updateUrlLab(slug) {
    try {
      const u = new URL(location.href);
      if (slug) u.searchParams.set('lab', slug);
      else u.searchParams.delete('lab');
      history.replaceState(null, '', u.toString());
    } catch {}
  }
  function ensureModal() {
    let modal = document.getElementById('labsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'labsModal';
    modal.className = 'labs-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'labsModalTitle');
    modal.hidden = true;
    modal.innerHTML = `
      <div class="labs-modal-backdrop" data-close></div>
      <div class="labs-modal-box" role="document">
        <button type="button" class="labs-modal-close" data-close aria-label="${tr('닫기', 'Close', '閉じる')}">✕</button>
        <div class="labs-modal-head">
          <h2 id="labsModalTitle" class="labs-modal-name"></h2>
          <span class="lab-region labs-modal-region"></span>
        </div>
        <div class="labs-modal-map" aria-label="${tr('위치 미니맵', 'Location map', '位置のミニマップ')}" hidden></div>
        <div class="labs-modal-body"></div>
        <div class="labs-modal-actions">
          <button type="button" class="lab-share-btn" data-share-modal>${tr('공유', 'Share', '共有')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
      else if (e.target.closest('[data-share-modal]')) shareCard(modal.dataset.slug);
    });
    return modal;
  }
  // 모달 미니맵 — 모달 열릴 때 새로 만들고 닫힐 때 즉시 파괴 (메모리 회수)
  let modalMap = null;
  let modalMapMarker = null;
  function destroyModalMap() {
    if (modalMapMarker) { modalMapMarker.setMap(null); modalMapMarker = null; }
    if (modalMap && modalMap.destroy) { modalMap.destroy(); }
    modalMap = null;
  }
  async function setupModalMap(item, slug, modal) {
    const mapEl = modal.querySelector('.labs-modal-map');
    if (!mapEl) return;
    destroyModalMap();
    mapEl.hidden = false;
    mapEl.innerHTML = '';
    mapEl.classList.remove('labs-modal-map-empty');
    const showEmpty = (reason, msg) => {
      console.warn('[labs] modal map skip:', reason, item.name, item.address);
      mapEl.classList.add('labs-modal-map-empty');
      mapEl.innerHTML = `<span class="labs-modal-map-msg">${escapeHtml(msg)}</span>`;
    };
    if (!window.naver || !naver.maps) {
      showEmpty('sdk not loaded', tr("지도를 불러오지 못했어요. 아래 '지도에서 보기'를 눌러 주세요", "The map couldn't load. Use “Naver Map (Korean) ↗” below.", '地図を読み込めませんでした。下の「NAVERマップ（韓国語）」からご覧ください。'));
      return;
    }
    // 좌표 source 우선순위: 1) item.lat/lng (DB·정적 JSON), 2) 메인 지도 geocode 캐시(markerBySlug),
    // 3) item.address 직접 geocode (admin 등록 후 좌표 없는 lab 대응).
    let coord = await resolveItemCoord(item);
    let lat = Number(coord?.lat);
    let lng = Number(coord?.lng);
    if (!isValidCoord({ lat, lng })) {
      const entry = markerBySlug.get(slug);
      if (entry && entry.marker) {
        const pos = entry.marker.getPosition();
        lat = pos.lat(); lng = pos.lng();
      }
    }
    if (!isValidCoord({ lat, lng })) { showEmpty('no coordinates', tr('위치 정보가 없어 지도를 그리지 못했어요', 'No location data for this place yet.', '位置情報がないため地図を表示できません')); return; }
    // 모달 transition 후 size 측정되도록 다음 frame 에서 생성.
    requestAnimationFrame(() => {
      try {
        const center = new naver.maps.LatLng(lat, lng);
        modalMap = new naver.maps.Map(mapEl, {
          center, zoom: 16, minZoom: 12,
          zoomControl: false, scaleControl: false, mapDataControl: false,
        });
        modalMapMarker = new naver.maps.Marker({ position: center, map: modalMap, title: shown(item, 'name') });
      } catch (e) {
        showEmpty('init error ' + (e?.message || e), tr("지도를 불러오지 못했어요. 아래 '지도에서 보기'를 눌러 주세요", "The map couldn't load. Use “Naver Map (Korean) ↗” below.", '地図を読み込めませんでした。下の「NAVERマップ（韓国語）」からご覧ください。'));
      }
    });
  }
  function openModal(slug, opts) {
    const item = findItemBySlug(slug);
    if (!item) return;
    const modal = ensureModal();
    modal.dataset.slug = slug;
    modal.querySelector('.labs-modal-name').textContent = shown(item, 'name') || '';
    modal.querySelector('.labs-modal-region').textContent = regionLabel(item.region);
    modal.querySelector('.labs-modal-body').innerHTML = detailHtml(item);
    if (infoWindow) infoWindow.close();
    activeMapSlug = null;
    modal.hidden = false;
    document.documentElement.classList.add('labs-modal-open');
    if (opts?.focusMap) focusMarkerBySlug(slug);
    setupModalMap(item, slug, modal);
    updateUrlLab(slug);
    // 닫기 버튼에 포커스 (스크린리더 + Esc 대응)
    const closeBtn = modal.querySelector('.labs-modal-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeModal() {
    const modal = document.getElementById('labsModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.documentElement.classList.remove('labs-modal-open');
    destroyModalMap();
    updateUrlLab(null);
  }
  async function shareCard(slug) {
    if (!slug) return;
    const u = new URL(location.href);
    u.searchParams.set('lab', slug);
    const url = window.prettyShareUrl ? window.prettyShareUrl(u.toString()) : u.toString();
    try {
      await navigator.clipboard.writeText(url);
      showLabsToast(tr('링크가 복사됐어요', 'Link copied', 'リンクをコピーしました'));
    } catch {
      prompt(tr('아래 링크를 복사하세요', 'Copy the link below', '下のリンクをコピーしてください'), url);
    }
  }
  function showLabsToast(msg) {
    let t = document.getElementById('labsToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'labsToast';
      t.className = 'labs-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(showLabsToast._tid);
    showLabsToast._tid = setTimeout(() => t.classList.remove('is-show'), 1800);
  }
  function tryApplyDeepLink() {
    const slug = new URL(location.href).searchParams.get('lab');
    if (!slug) { deepLinkApplied = true; return; }
    if (findItemBySlug(slug)) {
      deepLinkApplied = true;
      openModal(slug, { scroll: true });
      return;
    }
    // 공유 링크는 현상소와 수리실이 같은 lab 파라미터를 쓴다. 페이지는 항상
    // 현상소 탭으로 열리므로, 수리실을 공유한 링크는 여기서 찾지 못한다.
    // 반대쪽 목록을 불러와 확인하고, 거기 있으면 탭을 바꿔 연다.
    if (deepLinkOtherTabTried) return;
    deepLinkOtherTabTried = true;
    const other = tab === 'labs' ? 'repairs' : 'labs';
    (async () => {
      try {
        if (!datasets[other]) {
          datasets[other] = other === 'labs' ? await loadLabs() : await loadRepairs();
        }
        const found = (datasets[other] || []).some((item) => itemSlug(item) === slug);
        if (found) await setTab(other);
      } catch (_) {}
    })();
  }
  listEl.addEventListener('click', (e) => {
    const head = e.target.closest('.lab-card-head');
    if (!head) return;
    const card = head.closest('.lab-card');
    if (card?.dataset.slug) openModal(card.dataset.slug);
  });
  document.addEventListener('click', (e) => {
    const detail = e.target.closest('[data-labs-map-detail]');
    if (!detail) return;
    openModal(detail.getAttribute('data-labs-map-detail'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      query = searchEl.value.trim().toLowerCase();
      mobileVisible = MOBILE_INITIAL;
      apply();
    });
  }
  const searchBar = document.getElementById('labsSearchBar');
  const searchBtn = document.getElementById('labsSearchBtn');
  const searchClose = document.getElementById('labsSearchClose');
  searchBtn?.addEventListener('click', () => {
    const open = searchBar.hidden;
    searchBar.hidden = !open;
    searchBtn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => searchEl?.focus(), 10);
  });
  searchClose?.addEventListener('click', () => {
    searchBar.hidden = true;
    searchBtn?.setAttribute('aria-expanded', 'false');
    if (searchEl) {
      searchEl.value = '';
      query = '';
      mobileVisible = MOBILE_INITIAL;
      apply();
    }
  });

  function setView(next) {
    if (next !== 'map') next = 'list';
    if (next === 'map' && window.__labsNaverMapAuthFailed) { showMapFailNotice(); next = 'list'; }
    view = next;
    document.documentElement.classList.toggle('labs-view-map', view === 'map');
    document.documentElement.classList.toggle('labs-view-list', view === 'list');
    if (viewToggleEl) {
      viewToggleEl.querySelectorAll('[data-view]').forEach((b) => {
        const on = b.dataset.view === view;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    if (mapSectionEl) mapSectionEl.hidden = view !== 'map';
    if (listSectionEl) listSectionEl.setAttribute('aria-label', view === 'map' ? tr('현재 지도 결과 목록', 'Results on the map', '地図に表示中の結果') : tr('현상소·수리실 목록', 'Labs and repair shops', '現像所・修理店の一覧'));
    if (view === 'map') {
      if (!mapReady) initMap();
      if (!mapReady) { setView('list'); return; }
      if (mapReady && map) {
        requestAnimationFrame(() => {
          try { naver.maps.Event.trigger(map, 'resize'); } catch (_) {}
          updateMarkers(currentFiltered());
        });
      }
    } else if (infoWindow) {
      infoWindow.close();
      activeMapSlug = null;
    }
  }

  if (viewToggleEl) {
    viewToggleEl.addEventListener('click', (e) => {
      const button = e.target.closest('[data-view]');
      if (!button || !viewToggleEl.contains(button)) return;
      e.preventDefault();
      setView(button.dataset.view);
    });
    viewToggleEl.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        setView(b.dataset.view);
      });
    });
  }

  if (tabsEl) {
    tabsEl.querySelectorAll('.labs-tab').forEach((b) => {
      b.addEventListener('click', () => setTab(b.dataset.tab));
    });
  }

  const moreBtn = document.getElementById('labsMoreBtn');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      mobileVisible += MOBILE_STEP;
      apply();
    });
  }

  // 모바일에선 지도가 더 강력한 디스커버리이므로 기본을 'map' 으로.
  // 데스크톱은 리스트가 정공법 (한눈에 가격·정보 비교).
  const defaultView = window.matchMedia('(max-width: 640px)').matches ? 'map' : 'list';
  setView(defaultView);
  setTab('labs');
})();
