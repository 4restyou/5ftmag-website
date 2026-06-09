// 필름 현상소 / 카메라 수리실 리스트 페이지.
//   상단 탭으로 현상소(labs)·수리실(repair_shops)을 전환한다.
//   둘 다 원본 Supabase 테이블을 직접 읽어 admin 수정이 새로고침만으로 반영된다.
//   (현상소는 실패 시 정적 data/labs.json 으로 폴백.)
//   네이버 지도(Web Dynamic Map)에 현재 필터·검색 결과를 마커로 표시한다.

(function () {
  'use strict';

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
  const REGION_ORDER = ['서울', '경기', '인천', '강원', '대전', '충남', '충북', '세종',
    '대구', '경북', '부산', '울산', '경남', '광주', '전북', '전남', '제주'];

  const TAB = {
    labs: {
      intro: '전국 필름 현상소를 한자리에 모았어요. 지역과 컬러·흑백·슬라이드 현상 가격, 스캔 화질, 홈페이지를 비교하고 <span class="accent">지도에서 위치까지</span> 확인할 수 있는 목록이에요.',
      placeholder: '현상소·지역·특징으로 검색…',
      empty: '조건에 맞는 현상소가 없습니다. 지역이나 검색어를 바꿔보세요.',
      loadFail: '현상소 목록을 불러오지 못했어요.',
    },
    repairs: {
      intro: '전국 카메라 수리실을 모았어요. 라이카·올드카메라·SLR·컴팩트 등 <span class="accent">전문 분야와 지역</span>을 비교할 수 있어요. 주소가 등록된 곳은 지도에서 위치도 확인할 수 있습니다.',
      placeholder: '수리실·지역·전문분야로 검색…',
      empty: '조건에 맞는 수리실이 없습니다. 지역이나 검색어를 바꿔보세요.',
      loadFail: '수리실 목록을 불러오지 못했어요.',
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
    return typeof v === 'number' ? `${v.toLocaleString('ko-KR')}원` : String(v);
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

  async function loadRepairs() {
    // 원본 = Supabase repair_shops 테이블. (정적 폴백 없음)
    try {
      const rows = await window.MagDB?.repairs?.list?.();
      if (Array.isArray(rows)) return rows;
    } catch (_) { /* 빈 목록으로 진행 */ }
    return [];
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
    const chip = (key, label, n) =>
      `<button type="button" class="filter-chip${key === region ? ' active' : ''}" data-region="${escapeAttr(key)}">${escapeHtml(label)}<span class="labs-chip-count">${n}</span></button>`;
    let html = chip('all', '전체', data.length);
    for (const r of regions) html += chip(r, r, data.filter((l) => l.region === r).length);
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
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  // 방문자 정렬.
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko');

  // 지역순: 지역별로 묶어 구분 헤더와 함께 렌더. REGION_ORDER 우선, 그 외는 가나다,
  // 지역 없는 항목은 '기타'로 맨 끝. 각 지역 안은 이름순.
  function renderGrouped(items) {
    const groups = new Map();
    for (const it of items) {
      const key = it.region || '기타';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const rank = (r) => (r === '기타' ? 9999 : (REGION_ORDER.indexOf(r) === -1 ? 998 : REGION_ORDER.indexOf(r)));
    const keys = [...groups.keys()].sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b, 'ko'));
    return keys.map((k) => {
      const grp = groups.get(k).sort(byName);
      return `<h2 class="labs-region-divider">${escapeHtml(k)}<span class="labs-region-divider-count">${grp.length}곳</span></h2>`
        + grp.map(card).join('');
    }).join('');
  }

  function priceChips(p) {
    if (!p) return '';
    const items = [
      ['컬러', p.color && p.color['135'] && p.color['135'].basic],
      ['흑백', p.bw && p.bw['135'] && p.bw['135'].basic],
      ['슬라이드', p.slide && p.slide['135'] && p.slide['135'].basic],
      ['영화용', p.cinema && p.cinema['135'] && p.cinema['135'].basic],
    ].filter(([, v]) => v != null && v !== '');
    if (!items.length) return '';
    return `<div class="lab-prices">${items
      .map(([k, v]) => `<span class="lab-price"><span class="lab-price-k">${k}</span> ${escapeHtml(won(v))}</span>`)
      .join('')}<span class="lab-price-note">135 기본 기준</span></div>`;
  }
  function labCardSummary(lab) {
    const p = lab?.prices || {};
    const items = [
      ['컬러', p.color && p.color['135'] && p.color['135'].basic],
      ['흑백', p.bw && p.bw['135'] && p.bw['135'].basic],
      ['슬라이드', p.slide && p.slide['135'] && p.slide['135'].basic],
      ['영화용', p.cinema && p.cinema['135'] && p.cinema['135'].basic],
    ].filter(([, v]) => v != null && v !== '');
    if (items.length) {
      return `<span class="lab-card-summary">${items
        .map(([k, v]) => `<span>${escapeHtml(k)} <strong>${escapeHtml(won(v))}</strong></span>`)
        .join('')}<span class="lab-card-summary-note">135 기준</span></span>`;
    }
    const fallback = [lab.scanRes && `기본 스캔 ${lab.scanRes}`, lab.features]
      .filter(Boolean)
      .join(' · ');
    return fallback ? `<span class="lab-card-summary">${escapeHtml(fallback)}</span>` : '';
  }
  function repairCardSummary(shop) {
    const summary = [shop.specialty, shop.contact]
      .filter(Boolean)
      .join(' · ');
    return summary ? `<span class="lab-card-summary">${escapeHtml(summary)}</span>` : '';
  }

  function labCard(lab) {
    const slug = itemSlug(lab);
    return `
      <article class="lab-card" data-slug="${escapeAttr(slug)}" data-reveal>
        <button type="button" class="lab-card-head" aria-haspopup="dialog">
          <span class="lab-name">${escapeHtml(lab.name)}</span>
          <span class="lab-region">${escapeHtml(lab.region || '')}</span>
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
          <span class="lab-name">${escapeHtml(s.name)}</span>
          <span class="lab-region">${escapeHtml(s.region || '')}</span>
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
    if (mapHref) links.push(`<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" class="lab-link lab-link-map">지도에서 보기 ↗</a>`);
    if (lab.url) links.push(`<a href="${escapeAttr(lab.url)}" target="_blank" rel="noopener" class="lab-link">홈페이지·SNS ↗</a>`);
    return `
      ${lab.address ? `<p class="lab-addr">${escapeHtml(lab.address)}</p>` : ''}
      ${priceChips(lab.prices)}
      ${lab.scanRes ? `<p class="lab-meta">기본 스캔 ${escapeHtml(lab.scanRes)}</p>` : ''}
      ${lab.features ? `<p class="lab-features">${escapeHtml(lab.features)}</p>` : ''}
      ${links.length ? `<div class="lab-links">${links.join('')}</div>` : ''}
    `;
  }
  // 모달에 들어갈 상세 마크업 (수리실).
  function repairDetailHtml(s) {
    const mapHref = s.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(s.address)}`
      : null;
    const links = [];
    if (mapHref) links.push(`<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" class="lab-link lab-link-map">지도에서 보기 ↗</a>`);
    if (s.url) links.push(`<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" class="lab-link">홈페이지·SNS ↗</a>`);
    return `
      ${s.address ? `<p class="lab-addr">${escapeHtml(s.address)}</p>` : ''}
      ${s.specialty ? `<p class="lab-meta">전문 ${escapeHtml(s.specialty)}</p>` : ''}
      ${s.contact ? `<p class="lab-meta">연락처 ${escapeHtml(s.contact)}</p>` : ''}
      ${s.description ? `<p class="lab-features">${escapeHtml(s.description)}</p>` : ''}
      ${links.length ? `<div class="lab-links">${links.join('')}</div>` : ''}
    `;
  }
  function detailHtml(item) {
    return tab === 'labs' ? labDetailHtml(item) : repairDetailHtml(item);
  }

  function card(item) {
    return tab === 'labs' ? labCard(item) : repairCard(item);
  }

  function initMap() {
    const el = document.getElementById('labsMap');
    // SDK 로드 실패(오프라인·차단) 시 지도 영역을 숨기고 리스트만 유지한다.
    if (!el || !window.naver || !naver.maps) {
      if (mapSectionEl) mapSectionEl.hidden = true;
      return;
    }
    // 도메인·키 인증 실패 시에도 빈 회색 박스 대신 영역을 접는다.
    window.addEventListener('labs:naver-map-auth-failed', () => {
      if (mapSectionEl) mapSectionEl.hidden = true;
      setView('list');
    });
    if (window.__labsNaverMapAuthFailed) {
      if (mapSectionEl) mapSectionEl.hidden = true;
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
  }

  function infoContent(item) {
    const slug = itemSlug(item);
    const naverMap = item.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(item.address)}`
      : null;
    const links = [];
    links.push(`<button type="button" class="labs-map-info-button" data-labs-map-detail="${escapeAttr(slug)}">자세히</button>`);
    if (naverMap) links.push(`<a href="${escapeAttr(naverMap)}" target="_blank" rel="noopener">길찾기 ↗</a>`);
    if (item.url) links.push(`<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">홈페이지 ↗</a>`);
    return `<div class="labs-map-info">
      <strong>${escapeHtml(item.name)}</strong>
      ${item.address ? `<span class="labs-map-info-addr">${escapeHtml(item.address)}</span>` : ''}
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
      const marker = new naver.maps.Marker({ position: pos, map, title: item.name });
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
    if (shouldShow) btn.textContent = `더 보기 (${total - mobileVisible})`;
  }

  function apply() {
    const filtered = currentFiltered();
    if (countEl) countEl.textContent = `${filtered.length}곳`;
    if (view === 'map') updateMarkers(filtered);
    else if (infoWindow) infoWindow.close();
    if (!filtered.length) {
      const hasFilter = region !== 'all' || !!query;
      listEl.innerHTML = MagState.empty({
        title: TAB[tab].empty,
        actionLabel: hasFilter ? '전체 보기' : '',
        action: 'reset',
      });
      if (hasFilter) {
        MagState.bindAction(listEl, 'reset', () => {
          region = 'all';
          query = '';
          if (searchEl) searchEl.value = '';
          mobileVisible = MOBILE_INITIAL;
          renderFilter();
          apply();
        });
      }
      updateMoreButton(0);
      return;
    }
    // 모바일 + 필터·검색 없을 때만 처음 일부만 렌더. 지도 마커는 전체(filtered) 유지.
    const capped = isMobileLabs() && region === 'all' && !query;
    const shown = capped ? filtered.slice(0, mobileVisible) : filtered;
    listEl.innerHTML = renderGrouped(shown);
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
        <button type="button" class="labs-modal-close" data-close aria-label="닫기">✕</button>
        <div class="labs-modal-head">
          <h2 id="labsModalTitle" class="labs-modal-name"></h2>
          <span class="lab-region labs-modal-region"></span>
        </div>
        <div class="labs-modal-map" aria-label="위치 미니맵" hidden></div>
        <div class="labs-modal-body"></div>
        <div class="labs-modal-actions">
          <button type="button" class="lab-share-btn" data-share-modal>공유</button>
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
    const showEmpty = (reason) => {
      console.warn('[labs] modal map skip:', reason, item.name, item.address);
      mapEl.classList.add('labs-modal-map-empty');
      mapEl.innerHTML = `<span class="labs-modal-map-msg">지도 표시 실패 (${reason})</span>`;
    };
    if (!window.naver || !naver.maps) { showEmpty('SDK 미로드'); return; }
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
    if (!isValidCoord({ lat, lng })) { showEmpty('좌표 없음'); return; }
    // 모달 transition 후 size 측정되도록 다음 frame 에서 생성.
    requestAnimationFrame(() => {
      try {
        const center = new naver.maps.LatLng(lat, lng);
        modalMap = new naver.maps.Map(mapEl, {
          center, zoom: 16, minZoom: 12,
          zoomControl: false, scaleControl: false, mapDataControl: false,
        });
        modalMapMarker = new naver.maps.Marker({ position: center, map: modalMap, title: item.name });
      } catch (e) {
        showEmpty('생성 오류 ' + (e?.message || e));
      }
    });
  }
  function openModal(slug, opts) {
    const item = findItemBySlug(slug);
    if (!item) return;
    const modal = ensureModal();
    modal.dataset.slug = slug;
    modal.querySelector('.labs-modal-name').textContent = item.name || '';
    modal.querySelector('.labs-modal-region').textContent = item.region || '';
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
    const url = u.toString();
    try {
      await navigator.clipboard.writeText(url);
      showLabsToast('링크가 복사됐어요');
    } catch {
      prompt('아래 링크를 복사하세요', url);
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
    if (!findItemBySlug(slug)) return; // 다음 렌더에서 다시 시도 (탭 전환 후 등)
    deepLinkApplied = true;
    openModal(slug, { scroll: true });
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

  function setView(next) {
    if (next !== 'map') next = 'list';
    if (next === 'map' && window.__labsNaverMapAuthFailed) next = 'list';
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
    if (listSectionEl) listSectionEl.setAttribute('aria-label', view === 'map' ? '현재 지도 결과 목록' : '현상소·수리실 목록');
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

  setView('list');
  setTab('labs');
})();
