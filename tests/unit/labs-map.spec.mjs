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

  it('backfills missing Supabase coordinates from static Labs data', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('function enrichLabWithStaticCoord');
    expect(js).toContain('return mergeStaticOnlyLabs(labs, staticLabs);');
    expect(js).toContain('addressCompatible(lab.address, s.address)');
  });

  it('keeps static-only Labs entries when the live table is missing rows', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('function mergeStaticOnlyLabs');
    expect(js).toContain('if (!merged.some((lab) => looksLikeSameLab(lab, staticLab))) merged.push(staticLab);');
    expect(js).toContain('function looksLikeSameLab');
  });

  it('separates card modal behavior from map marker behavior', () => {
    const js = read('js/labs-page.js');
    expect(js).toContain('data-labs-map-detail');
    expect(js).toContain('if (activeMapSlug === slug) { openModal(slug); return; }');
    expect(js).toContain('if (opts?.focusMap) focusMarkerBySlug(slug);');
  });
});
