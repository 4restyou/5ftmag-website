// Labs 지도 연동 회귀 테스트.
// Naver Maps SDK 는 내부 JSONP/좌표 변환 도메인을 추가로 사용하므로 CSP 누락이 곧 지도 깨짐으로 이어진다.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Labs Naver map integration', () => {
  it('allows Naver SDK internal script/connect domains in CSP', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain('https://oapi.map.naver.com');
    expect(toml).toContain('https://nrbe.pstatic.net');
    expect(toml).toContain('https://map.pstatic.net');
    expect(toml).toContain('https://maps.apigw.ntruss.com');
  });

  it('registers auth failure handler before loading the Naver SDK', () => {
    const html = read('labs.html');
    const handlerIndex = html.indexOf('window.navermap_authFailure');
    const sdkIndex = html.indexOf('https://oapi.map.naver.com/openapi/v3/maps.js');
    expect(handlerIndex).toBeGreaterThan(-1);
    expect(sdkIndex).toBeGreaterThan(-1);
    expect(handlerIndex).toBeLessThan(sdkIndex);
  });

  it('uses stored lat/lng before falling back to address geocoding', () => {
    const js = read('js/labs-page.js');
    const coordIndex = js.indexOf('function resolveItemCoord');
    const geocodeIndex = js.indexOf('return geocodeAddress(item?.address)');
    expect(coordIndex).toBeGreaterThan(-1);
    expect(geocodeIndex).toBeGreaterThan(coordIndex);
    expect(js).toContain('Number(item?.lat)');
    expect(js).toContain('Number(item?.lng)');
    expect(js).toContain('const coord = await resolveItemCoord(item);');
  });

  it('rejects stale or swapped geocode coordinates before drawing maps', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain("const GEO_CACHE_KEY = '5ft-labs-geo-v2';");
    expect(js).toContain('function isValidCoord');
    expect(js).toContain('lat >= 30 && lat <= 39');
    expect(js).toContain('lng >= 124 && lng <= 132');
    expect(js).toContain('if (geoCache[address]) { delete geoCache[address]; saveGeoCache(); }');
  });

  it('backfills missing Supabase coordinates from static Labs data', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('function enrichLabWithStaticCoord');
    expect(js).toContain('return rows.map(rowToLab).map((lab) => enrichLabWithStaticCoord(lab, staticLabs));');
    expect(js).toContain('addressCompatible(lab.address, s.address)');
  });

  it('does not merge static-only Labs entries over the live 92-entry source', () => {
    const js = read('js/labs-page.js');
    expect(js).not.toContain('function mergeStaticOnlyLabs');
    expect(js).not.toContain('function looksLikeSameLab');
  });

  it('clears the search query when switching Labs tabs', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('const tabChanged = next !== tab;');
    expect(js).toContain("query = '';");
    expect(js).toContain("if (searchEl) searchEl.value = '';");
  });

  it('separates card modal behavior from map marker behavior', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('data-labs-map-detail');
    expect(js).toContain('if (activeMapSlug === slug) { openModal(slug); return; }');
    expect(js).toContain('if (opts?.focusMap) focusMarkerBySlug(slug);');
  });

  it('defaults to list view and initializes the map only when map view is selected', () => {
    const html = read('labs.html');
    const js = read('js/labs-page.js');
    expect(html).toContain('data-view="list"');
    expect(html).toContain('data-view="map"');
    expect(html).toContain('id="labsMapSection" hidden');
    expect(js).toContain("let view = 'list';");
    expect(js).toContain("function setView(next)");
    expect(js).toContain("if (!mapReady) initMap();");
    expect(js).toContain("setView('list');");
  });

  it('recenters the selected marker after opening its map info window', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('const pos = entry.marker.getPosition();');
    expect(js).toContain('map.setCenter(pos);');
    expect(js).toContain("requestAnimationFrame(() => map.setCenter(pos));");
    expect(js).toContain('setTimeout(() => map.setCenter(pos), 120);');
  });

  it('shows compact pricing details in list view cards and keeps map view focused on the map', () => {
    const js = read('js/labs-page.js');
    const css = read('css/labs.css');
    expect(js).toContain('function labCardSummary(lab)');
    expect(js).toContain('function repairCardSummary(shop)');
    expect(js).toContain('${labCardSummary(lab)}');
    expect(js).toContain('${repairCardSummary(s)}');
    expect(js).toContain('135 기준');
    expect(css).toContain('.lab-card-summary');
    expect(css).toContain('html.labs-view-map .labs-section');
    expect(css).toContain('display: none;');
  });
});
