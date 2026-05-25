// 필름 현상소 리스트 페이지.
//   data/labs.json 을 읽어 지역 필터 + 검색 + 카드 리스트 렌더.
//   네이버 지도(Web Dynamic Map)에 현재 필터·검색 결과를 마커로 표시한다.

(function () {
  'use strict';

  const listEl = document.getElementById('labsList');
  const filterEl = document.getElementById('labsFilter');
  const searchEl = document.getElementById('labsSearch');
  const countEl = document.getElementById('labsCount');
  if (!listEl) return;

  let map = null;
  let markers = [];
  let infoWindow = null;
  let mapReady = false;

  // 지역 정렬 우선순위 (그 외는 뒤에 등장 순)
  const REGION_ORDER = ['서울', '경기', '인천', '강원', '대전', '충남', '충북', '세종',
    '대구', '경북', '부산', '울산', '경남', '광주', '전북', '전남', '제주'];

  let labs = [];
  let region = 'all';
  let query = '';

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

  fetch('/data/labs.json')
    .then((r) => r.json())
    .then((data) => {
      labs = Array.isArray(data.labs) ? data.labs : [];
      renderFilter();
      initMap();
      apply();
    })
    .catch(() => {
      listEl.innerHTML = '<div class="labs-empty">현상소 목록을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 새로고침해 주세요.</div>';
    });

  function regionsInOrder() {
    const present = new Set(labs.map((l) => l.region).filter(Boolean));
    const ordered = REGION_ORDER.filter((r) => present.has(r));
    for (const r of present) if (!ordered.includes(r)) ordered.push(r);
    return ordered;
  }

  function renderFilter() {
    if (!filterEl) return;
    const regions = regionsInOrder();
    const chip = (key, label, n) =>
      `<button type="button" class="filter-chip${key === region ? ' active' : ''}" data-region="${escapeAttr(key)}">${escapeHtml(label)}<span class="labs-chip-count">${n}</span></button>`;
    let html = chip('all', '전체', labs.length);
    for (const r of regions) html += chip(r, r, labs.filter((l) => l.region === r).length);
    filterEl.innerHTML = html;
    filterEl.querySelectorAll('.filter-chip').forEach((b) => {
      b.addEventListener('click', () => {
        region = b.dataset.region;
        filterEl.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === b));
        apply();
      });
    });
  }

  function matches(lab) {
    if (region !== 'all' && lab.region !== region) return false;
    if (query) {
      const hay = `${lab.name} ${lab.address || ''} ${lab.features || ''} ${lab.region || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
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

  function card(lab) {
    const mapHref = lab.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(lab.address)}`
      : null;
    const links = [];
    if (mapHref) links.push(`<a href="${escapeAttr(mapHref)}" target="_blank" rel="noopener" class="lab-link lab-link-map">지도에서 보기 ↗</a>`);
    if (lab.url) links.push(`<a href="${escapeAttr(lab.url)}" target="_blank" rel="noopener" class="lab-link">홈페이지·SNS ↗</a>`);
    return `
      <article class="lab-card" data-reveal>
        <div class="lab-card-head">
          <h3 class="lab-name">${escapeHtml(lab.name)}</h3>
          <span class="lab-region">${escapeHtml(lab.region || '')}</span>
        </div>
        ${lab.address ? `<p class="lab-addr">${escapeHtml(lab.address)}</p>` : ''}
        ${priceChips(lab.prices)}
        ${lab.scanRes ? `<p class="lab-meta">기본 스캔 ${escapeHtml(lab.scanRes)}</p>` : ''}
        ${lab.features ? `<p class="lab-features">${escapeHtml(lab.features)}</p>` : ''}
        ${links.length ? `<div class="lab-links">${links.join('')}</div>` : ''}
      </article>`;
  }

  function initMap() {
    const el = document.getElementById('labsMap');
    const section = document.getElementById('labsMapSection');
    // SDK 로드 실패(오프라인·차단) 시 지도 영역을 숨기고 리스트만 유지한다.
    if (!el || !window.naver || !naver.maps) {
      if (section) section.hidden = true;
      return;
    }
    // 도메인·키 인증 실패 시에도 빈 회색 박스 대신 영역을 접는다.
    window.navermap_authFailure = function () {
      if (section) section.hidden = true;
    };
    map = new naver.maps.Map(el, {
      center: new naver.maps.LatLng(36.5, 127.8),
      zoom: 7,
      scaleControl: false,
      mapDataControl: false,
    });
    infoWindow = new naver.maps.InfoWindow({ borderWidth: 1, borderColor: '#111', anchorSize: new naver.maps.Size(10, 10) });
    mapReady = true;
  }

  function infoContent(lab) {
    const naverMap = lab.address
      ? `https://map.naver.com/p/search/${encodeURIComponent(lab.address)}`
      : null;
    const links = [];
    if (naverMap) links.push(`<a href="${escapeAttr(naverMap)}" target="_blank" rel="noopener">길찾기 ↗</a>`);
    if (lab.url) links.push(`<a href="${escapeAttr(lab.url)}" target="_blank" rel="noopener">홈페이지 ↗</a>`);
    return `<div class="labs-map-info">
      <strong>${escapeHtml(lab.name)}</strong>
      ${lab.address ? `<span class="labs-map-info-addr">${escapeHtml(lab.address)}</span>` : ''}
      ${links.length ? `<span class="labs-map-info-links">${links.join('')}</span>` : ''}
    </div>`;
  }

  // ── 주소 → 좌표 (브라우저 즉석 변환 + localStorage 캐시) ──
  // 좌표를 데이터로 저장하지 않고, 지도 표시 때 주소를 변환한다.
  // 캐시는 주소 키라, admin 에서 주소만 고치면 다음 방문에 자동 반영.
  const GEO_CACHE_KEY = '5ft-labs-geo-v1';
  let geoCache;
  try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch (_) { geoCache = {}; }
  function saveGeoCache() { try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch (_) {} }

  function geocodeAddress(address) {
    return new Promise((resolve) => {
      if (!address) { resolve(null); return; }
      if (geoCache[address]) { resolve(geoCache[address]); return; }
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
          geoCache[address] = coord; saveGeoCache();
          resolve(coord);
        });
      } catch (_) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    });
  }

  let renderToken = 0;
  async function updateMarkers(shown) {
    if (!mapReady || !map) return;
    const token = ++renderToken;
    markers.forEach((m) => m.setMap(null));
    markers = [];
    if (infoWindow) infoWindow.close();
    const bounds = new naver.maps.LatLngBounds();
    let count = 0;
    for (const lab of shown) {
      const coord = await geocodeAddress(lab.address);
      if (token !== renderToken) return; // 더 최신 렌더가 시작됨 → 중단
      if (!coord) continue;
      const pos = new naver.maps.LatLng(coord.lat, coord.lng);
      const marker = new naver.maps.Marker({ position: pos, map, title: lab.name });
      naver.maps.Event.addListener(marker, 'click', () => {
        infoWindow.setContent(infoContent(lab));
        infoWindow.open(map, marker);
      });
      markers.push(marker);
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

  function apply() {
    const shown = labs.filter(matches);
    if (countEl) countEl.textContent = `${shown.length}곳`;
    updateMarkers(shown);
    if (!shown.length) {
      listEl.innerHTML = '<div class="labs-empty">조건에 맞는 현상소가 없습니다. 지역이나 검색어를 바꿔보세요.</div>';
      return;
    }
    listEl.innerHTML = shown.map(card).join('');
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      query = searchEl.value.trim().toLowerCase();
      apply();
    });
  }
})();
