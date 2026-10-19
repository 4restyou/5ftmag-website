#!/usr/bin/env node
// 매일 운영 상태 확인(.github/workflows/health.yml). 실패하면 exit 1 → GitHub 이 운영자에게 메일로 알린다.
//   1) 공개 페이지가 열리는가(200, 사이트 이름이 들어 있는가)
//   2) 예약 작업이 제때 성공했는가(public.ops_heartbeat)
//   3) 자동 승인 예약이 기한을 넘겨 쌓이지 않았는가
// 로컬: node scripts/health-check.mjs   (SITE_URL 로 대상 바꾸기)
const SITE = process.env.SITE_URL || 'https://www.5ftmag.com';
const SUPABASE = 'https://pucpqsfwqouqohwsvmnd.supabase.co';
// 공개 anon 키(js/db-client.js 와 같은 값, 보안은 RLS 에 있다)
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1Y3Bxc2Z3cW91cW9od3N2bW5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjYyMDUsImV4cCI6MjA5Mzc0MjIwNX0.adLzT0UrX3e1IbkQ70G6LeFWeKbuGaa0PTL6AmrSBD8';

const PAGES = ['/', '/stories.html', '/films.html', '/labs.html', '/market.html', '/en/', '/ja/', '/sitemap.xml'];
// 작업별 허용 공백(마지막 성공에서 지금까지)
const JOBS = {
  '5ftmag-reader-auto-approve': { hours: 1, label: '독자 사진 자동 승인(10분마다)' },
  '5ftmag-page-view-rollup-daily': { hours: 26, label: '페이지뷰 날짜별 합산(매일)' },
  '5ftmag-operational-retention-daily': { hours: 26, label: '오래된 로그 정리(매일)' },
};

export function evaluate(beat, now = Date.now()) {
  const problems = [];
  for (const [job, { hours, label }] of Object.entries(JOBS)) {
    if (!(job in beat)) { problems.push(`${label}: pg_cron 실행 기록을 읽지 못했습니다`); continue; }
    if (!beat[job]) { problems.push(`${label}: 성공한 기록이 없습니다`); continue; }
    const gapH = (now - Date.parse(beat[job])) / 3600e3;
    if (gapH > hours) problems.push(`${label}: 마지막 성공이 ${gapH.toFixed(1)}시간 전입니다(허용 ${hours}시간)`);
  }
  if (Number(beat.overdue_auto_approvals) > 0) {
    problems.push(`자동 승인 예약 ${beat.overdue_auto_approvals}건이 기한을 30분 넘게 지났습니다`);
  }
  return problems;
}

async function main() {
  const problems = [];
  for (const path of PAGES) {
    try {
      const res = await fetch(SITE + path, { redirect: 'follow' });
      const text = await res.text();
      if (!res.ok) problems.push(`${path}: HTTP ${res.status}`);
      else if (!/5ft/i.test(text)) problems.push(`${path}: 열렸지만 내용이 이상합니다(사이트 이름 없음)`);
    } catch (e) { problems.push(`${path}: 열리지 않음 (${e.message})`); }
  }
  try {
    const res = await fetch(`${SUPABASE}/rest/v1/rpc/ops_heartbeat`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) problems.push(`DB 상태 확인(ops_heartbeat): HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    else problems.push(...evaluate(await res.json()));
  } catch (e) { problems.push(`DB 상태 확인: 연결 실패 (${e.message})`); }

  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    console.log(`\n문제 ${problems.length}건. docs/maintenance.md 와 Supabase 대시보드를 확인하세요.`);
    process.exit(1);
  }
  console.log('✓ 공개 페이지·예약 작업·자동 승인 모두 정상');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
