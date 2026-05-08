// Supabase 설정 — 댓글 시스템에서 사용
// 환경 변수가 없을 때를 대비해 직접 값을 적습니다.
// (anon key는 공개되어도 안전 — Supabase RLS가 권한을 보호합니다.)

window.SUPABASE_CONFIG = {
  // Supabase 프로젝트 → Settings → API 에서 복사
  url: 'https://YOUR-PROJECT-ID.supabase.co',
  anonKey: 'YOUR-ANON-PUBLIC-KEY',
};

// Supabase 클라이언트 즉시 생성 (전역 window.sb 로 노출)
(function init() {
  if (!window.supabase) {
    console.warn('[5ft.mag] supabase-js 가 먼저 로드되어야 합니다.');
    return;
  }
  if (window.SUPABASE_CONFIG.url.includes('YOUR-PROJECT-ID')) {
    console.warn('[5ft.mag] Supabase 설정이 비어 있습니다. js/supabase-config.js 를 채워주세요.');
    return;
  }
  window.sb = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.anonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );
})();
