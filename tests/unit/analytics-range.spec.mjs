// 통계 기간 계산은 화면 스크립트 안에 있어 그대로 import 할 수 없다.
// 실제 파일에서 순수 함수 구간만 떼어 내 돌린다. 파일이 바뀌면 이 테스트가 같이 깨진다.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'js/admin-analytics-page.js'), 'utf8');

function load(state) {
  const start = SRC.indexOf('// ── 기간 ──');
  const end = SRC.indexOf('const spanNote =');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = SRC.slice(start, SRC.indexOf(';', end) + 1);
  return new Function('STATE', `${block}; return { applyPreset, rangeLabel, bucketDays, isoDay, daysAgo };`)(state);
}

const dayCount = (from, to) =>
  (new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000 + 1;

describe('통계 기간', () => {
  it('N일 버튼은 오늘을 포함해 정확히 N일을 만든다', () => {
    for (const n of ['7', '30', '90']) {
      const state = { preset: '30', from: null, to: null, firstDay: null };
      load(state).applyPreset(n);
      expect(dayCount(state.from, state.to)).toBe(Number(n));
      expect(state.to).toBe(load(state).isoDay(new Date()));
    }
  });

  it('전체를 고르면 두 날짜를 비워 서버가 하한 없이 읽게 한다', () => {
    const state = { preset: '30', from: '2026-01-01', to: '2026-01-31', firstDay: null };
    const api = load(state);
    api.applyPreset('all');
    expect(state.from).toBeNull();
    expect(state.to).toBeNull();
    expect(api.rangeLabel()).toBe('전체 기간');
    state.firstDay = '2026-05-18';
    expect(api.rangeLabel()).toBe('전체 기간 (2026.05.18부터)');
  });

  it('직접 지정한 날짜는 그대로 두고 라벨에 적는다', () => {
    const state = { preset: '30', from: '2026-06-01', to: '2026-06-30', firstDay: null };
    const api = load(state);
    api.applyPreset('custom');
    expect(state.from).toBe('2026-06-01');
    expect(state.to).toBe('2026-06-30');
    expect(api.rangeLabel()).toBe('2026.06.01 – 2026.06.30');
  });

  it('구간이 길면 막대를 묶되 합계는 잃지 않는다', () => {
    const api = load({ preset: 'all', from: null, to: null, firstDay: null });
    const rows = (n) => Array.from({ length: n }, () => ({ day: '2026-01-01', views: 1, sessions: 2 }));
    expect(api.bucketDays(rows(120), ['views', 'sessions'])).toHaveLength(120);   // 그대로
    const weekly = api.bucketDays(rows(121), ['views', 'sessions']);
    expect(weekly).toHaveLength(18);                                             // 주 단위
    expect(weekly[0].span).toBe(7);
    expect(weekly.reduce((a, r) => a + r.views, 0)).toBe(121);
    expect(weekly.reduce((a, r) => a + r.sessions, 0)).toBe(242);
    const monthly = api.bucketDays(rows(900), ['views']);
    expect(monthly).toHaveLength(30);                                            // 달 단위
    expect(monthly.reduce((a, r) => a + r.views, 0)).toBe(900);
  });
});

describe('통계 RPC 계약', () => {
  const CLIENT = fs.readFileSync(path.resolve(process.cwd(), 'js/db-client.js'), 'utf8');
  const SQL = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260830000001_analytics_date_range.sql'), 'utf8');

  const FNS = [
    'admin_analytics_daily', 'admin_analytics_top_paths', 'admin_analytics_referrers',
    'admin_analytics_regions', 'admin_analytics_languages', 'admin_analytics_dwell_summary',
    'admin_analytics_dwell_by_path', 'admin_analytics_session_stats', 'admin_uploads_daily',
    'admin_uploads_top_contributors', 'admin_uploads_top_films', 'admin_uploads_top_cameras',
    'admin_uploads_theme_ratio',
  ];

  it('열세 개 함수가 옛 p_days 시그니처를 버리고 날짜 두 개를 받는다', () => {
    for (const fn of FNS) {
      expect(SQL, fn).toContain(`drop function if exists public.${fn}(`);
      expect(SQL, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\(\\s*\\n?\\s*p_from date`));
      expect(CLIENT, fn).toContain(`'${fn}', { p_from: from, p_to: to`);
    }
  });

  it('통계 호출에 p_days 가 남아 있지 않다', () => {
    for (const fn of FNS) {
      expect(CLIENT.includes(`'${fn}', { p_days`)).toBe(false);
    }
  });
});
