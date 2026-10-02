// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync('labs.html', 'utf8');
const source = fs.readFileSync('js/labs-page.js', 'utf8');
const util = fs.readFileSync('js/util.js', 'utf8');
const instances = [];
afterEach(() => { instances.splice(0).forEach(dom => dom.window.close()); });

function setup(lang = 'ko', labRows = null) {
  const dom = new JSDOM(html, { url: 'https://5ftmag.test/labs.html', runScripts: 'outside-only' });
  instances.push(dom);
  const w = dom.window;
  w.i18n = { lang, isEn: lang !== 'ko', t: (ko, en, ja) => lang === 'ja' ? ja || en : lang === 'en' ? en : ko };
  w.eval(util);
  w.matchMedia = () => ({ matches: false });
  w.requestAnimationFrame = callback => w.setTimeout(callback, 0);
  w.MagState = { loading: () => '', empty: ({ title }) => title, error: ({ title }) => title, bindAction: () => {} };
  const labs = labRows || [
    { name: '현상소 A', name_en: 'Lab A', name_ja: '現像所 A', region: '서울', lat: 37.55, lng: 126.97 },
    { name: '현상소 B', name_en: 'Lab B', name_ja: '現像所 B', region: '서울', lat: 37.56, lng: 126.98 },
    { name: '잘못된 좌표', region: '서울', lat: 126.97, lng: 37.55 },
  ];
  const repairs = [{ name: '수리점', name_en: 'Repair shop', name_ja: '修理店', region: '서울', lat: 37.57, lng: 126.99 }];
  w.MagDB = { labs: { list: vi.fn(async () => labs) }, repairs: { list: vi.fn(async () => repairs) } };
  w.fetch = vi.fn(async url => ({ json: async () => url.includes('repairs') ? { repairs } : { labs } }));
  const maps = [], markers = [], infos = [];
  class LatLng { constructor(lat, lng) { this.latitude = lat; this.longitude = lng; } lat() { return this.latitude; } lng() { return this.longitude; } }
  class MapStub {
    constructor(el, options) { this.el = el; this.zoom = options.zoom; maps.push(this); }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; }
    setCenter = vi.fn();
    fitBounds = vi.fn();
    destroy() {}
  }
  class Marker {
    constructor(options) { this.options = options; this.handlers = {}; markers.push(this); }
    getPosition() { return this.options.position; }
    setMap(map) { this.options.map = map; }
  }
  class InfoWindow {
    constructor() { infos.push(this); }
    close = vi.fn();
    setContent = vi.fn();
    open = vi.fn();
  }
  w.naver = { maps: {
    Map: MapStub, Marker, InfoWindow, LatLng,
    LatLngBounds: class { points = []; extend(p) { this.points.push(p); } getCenter() { return this.points[0]; } },
    Size: class {},
    Event: { trigger: vi.fn(), addListener: (target, event, handler) => { target.handlers[event] = handler; } },
  } };
  w.eval(source);
  return { w, maps, markers, infos, liveMarkers: () => markers.filter(marker => marker.options.map === maps[0]) };
}

describe('Labs live marker behavior', () => {
  it.each(['ko', 'en', 'ja'])('creates translated markers, recenters selection and opens detail on second click (%s)', async lang => {
    const env = setup(lang);
    await vi.waitFor(() => expect(env.w.document.getElementById('labsCount').textContent).toContain('3'));
    env.w.document.querySelector('[data-view="map"]').click();
    await vi.waitFor(() => expect(env.liveMarkers()).toHaveLength(2));
    const marker = env.liveMarkers()[0];
    expect(marker.options.title).toBe(lang === 'ko' ? '현상소 A' : lang === 'en' ? 'Lab A' : '現像所 A');
    marker.handlers.click();
    expect(env.maps[0].setCenter).toHaveBeenCalledWith(marker.getPosition());
    expect(env.infos[0].open).toHaveBeenCalledWith(env.maps[0], marker);
    expect(env.w.document.getElementById('labsModal')).toBeNull();
    marker.handlers.click();
    expect(env.w.document.getElementById('labsModal').hidden).toBe(false);
    expect(env.w.document.getElementById('labsModalTitle').textContent).toBe(marker.options.title);
  });

  it('removes old markers when switching tabs and updates repair accessibility names', async () => {
    const env = setup();
    await vi.waitFor(() => expect(env.w.document.getElementById('labsCount').textContent).toContain('3'));
    env.w.document.querySelector('[data-view="map"]').click();
    await vi.waitFor(() => expect(env.liveMarkers()).toHaveLength(2));
    const old = env.liveMarkers();
    env.w.document.querySelector('[data-tab="repairs"]').click();
    await vi.waitFor(() => expect(env.liveMarkers()).toHaveLength(1));
    expect(env.liveMarkers()[0].options.title).toBe('수리점');
    expect(old.every(marker => marker.options.map === null)).toBe(true);
    expect(env.w.document.getElementById('labsSearchBtn').getAttribute('aria-label')).toBe('수리실 검색');
    expect(env.w.document.getElementById('labsMap').getAttribute('aria-label')).toBe('수리실 위치 지도');
    const search = env.w.document.getElementById('labsSearch');
    search.value = '없는 곳';
    search.dispatchEvent(new env.w.Event('input'));
    await vi.waitFor(() => expect(env.liveMarkers()).toHaveLength(0));
  });

  it('does not restore static entries after a successful empty database response', async () => {
    const env = setup('ko', []);
    await vi.waitFor(() => expect(env.w.document.getElementById('labsCount').textContent).toContain('0'));
    expect(env.w.document.querySelectorAll('.lab-card')).toHaveLength(0);
  });

  it('keeps the repair list usable if the external map popup fails while closing', async () => {
    const env = setup();
    await vi.waitFor(() => expect(env.w.document.querySelectorAll('.lab-card').length).toBeGreaterThan(0));
    env.w.document.querySelector('[data-view="map"]').click();
    await vi.waitFor(() => expect(env.liveMarkers()).toHaveLength(2));
    env.infos[0].close.mockImplementation(() => { throw new Error('map authentication failed'); });
    env.w.document.querySelector('[data-view="list"]').click();
    env.w.document.querySelector('[data-tab="repairs"]').click();
    await vi.waitFor(() => expect(env.w.document.getElementById('labsList').textContent).toContain('수리점'));
    expect(env.w.document.getElementById('labsList').textContent).not.toContain('불러오는');
  });

  it('traps keyboard focus in detail and restores the originating card', async () => {
    const env = setup();
    await vi.waitFor(() => expect(env.w.document.querySelectorAll('.lab-card').length).toBeGreaterThan(0));
    const card = env.w.document.querySelector('.lab-card-head');
    card.focus(); card.click();
    const modal = env.w.document.getElementById('labsModal');
    const first = modal.querySelector('.labs-modal-close');
    const last = modal.querySelector('[data-share-modal]');
    expect(env.w.document.activeElement).toBe(first);
    env.w.document.dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(env.w.document.activeElement).toBe(last);
    env.w.document.dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(env.w.document.activeElement).toBe(first);
    env.w.document.dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.hidden).toBe(true);
    expect(env.w.document.activeElement).toBe(card);
  });
});
