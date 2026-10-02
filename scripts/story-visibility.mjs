import { warnBuild } from './lib/build-warn.mjs';

export function seoulTodayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isPublishedContent(item, todayIso) {
  if (!item || item.published === false) return false;
  const date = String(item.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
  const today = typeof todayIso === 'string' ? todayIso : seoulTodayIso();
  return date <= today;
}

// ── 관리 화면의 공개/비공개 토글(story_visibility) 반영 ──
//
// 토글은 DB 의 story_visibility 만 바꾸고 data/stories.json 은 그대로 둔다. 목록 화면은
// js/util.js 의 applyVisibility 가 둘을 합치지만, rss·sitemap·llms 빌더는 JSON 만 읽어
// 숨긴 글까지 실었다. 그래서 빌더도 같은 규칙(DB 에 행이 있으면 그것이 이긴다)으로 합친다.
//
// 공개 읽기 정책이라 공개 anon 키(js/db-client.js 와 같은 값)로 REST 를 읽는다
// (scripts/build-films.mjs 와 같은 방식). 못 읽으면 경고만 남기고 JSON 그대로 쓴다.
// 빌드가 DB 때문에 멈추거나 실패하면 안 된다.
const SB_URL = process.env.SUPABASE_URL || 'https://pucpqsfwqouqohwsvmnd.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

// js/util.js applyVisibility 와 같은 규칙. 순수 함수.
export function applyVisibility(list, rows) {
  if (!Array.isArray(list)) return [];
  if (!Array.isArray(rows) || !rows.length) return list;
  const map = new Map();
  for (const r of rows) {
    if (r && r.story_id != null) map.set(String(r.story_id), r.published !== false);
  }
  if (!map.size) return list;
  return list.map((s) => {
    const key = String(s && s.id != null ? s.id : '');
    return map.has(key) ? { ...s, published: map.get(key) } : s;
  });
}

// stories 에 DB 오버라이드를 덮어 돌려준다. 실패하면 경고 후 원본 그대로.
export async function withDbVisibility(stories, { label = 'build', timeoutMs = 5000 } = {}) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/story_visibility?select=story_id,published`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('expected array');
    const hidden = rows.filter((r) => r && r.published === false).length;
    if (hidden) console.log(`  [${label}] story_visibility: 비공개 ${hidden}편을 뺍니다`);
    return applyVisibility(stories, rows);
  } catch (err) {
    warnBuild(label, `story_visibility 를 읽지 못해 data/stories.json 그대로 싣습니다: ${err?.message || err}`);
    return stories;
  }
}
