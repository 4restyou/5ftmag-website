// 5ft.mag 편집부 전용 DB 도메인
//
// 관리 화면(admin/*.html)만 싣는다. js/db-client.js 보다 먼저 실어야 하고, db-client 가
// create() 를 불러 결과를 window.MagDB 의 같은 이름(review·market·analytics …)에 붙인다.
// 그래서 호출부는 지금처럼 window.MagDB.review.list(...) 로 부른다.
// 권한은 RLS 와 RPC 안의 is_editor 검사가 지킨다. 이 파일을 안 싣는다고 막히는 게 아니다.
(function () {
  'use strict';

  function create({ client, userId, MARKET_BUCKET }) {
    // 응모 검토 — 필터 (query 텍스트 + month YYYY-MM) 공통 적용 헬퍼
    function applyReviewFilters(q, opts) {
      if (opts.themeOnly) q = q.not('theme_month', 'is', null);
      if (opts.query) {
        // submitter_name / instagram / film 셋 중 하나라도 부분일치
        const safe = String(opts.query).replace(/[%,\\]/g, ' ').trim();
        if (safe) {
          const pat = `%${safe}%`;
          q = q.or(`submitter_name.ilike.${pat},instagram.ilike.${pat},film.ilike.${pat}`);
        }
      }
      if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
        const [Y, M] = opts.month.split('-').map(Number);
        const start = `${opts.month}-01T00:00:00`;
        const nextM = M === 12 ? `${Y + 1}-01` : `${Y}-${String(M + 1).padStart(2, '0')}`;
        const end = `${nextM}-01T00:00:00`;
        q = q.gte('created_at', start).lt('created_at', end);
      }
      return q;
    }


    // ─── 통계 (편집부 전용 — 모든 RPC 내부에서 is_editor 검사) ───
    async function fallbackUploadsTop(field, { from = null, to = null, days = null, limit = 10 } = {}) {
      const c = client(); if (!c) return [];
      const col = field === 'camera' ? 'camera' : 'film';
      const since = days ? new Date(Date.now() - Number(days) * 86400000).toISOString() : null;
      const fromIso = from && /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? `${from}T00:00:00` : since;
      const toIso = to && /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? `${to}T23:59:59.999` : null;
      let rows = [];

      let q = c.from('reader_submissions')
        .select(`${col}, status, created_at`)
        .not(col, 'is', null)
        .limit(5000);
      if (fromIso) q = q.gte('created_at', fromIso);
      if (toIso) q = q.lte('created_at', toIso);
      const primary = await q;

      if (primary.error) {
        let publicQ = c.from('reader_submissions_approved')
          .select(`${col}, created_at`)
          .not(col, 'is', null)
          .limit(5000);
        if (fromIso) publicQ = publicQ.gte('created_at', fromIso);
        if (toIso) publicQ = publicQ.lte('created_at', toIso);
        const fallback = await publicQ;
        if (fallback.error) {
          console.warn(`[analytics.fallbackUploadsTop.${col}]`, fallback.error.message);
          return [];
        }
        rows = (fallback.data || []).map(r => ({ ...r, status: 'approved' }));
      } else {
        rows = primary.data || [];
      }

      const grouped = new Map();
      for (const row of rows) {
        const key = String(row[col] || '').trim();
        if (!key) continue;
        const cur = grouped.get(key) || { [col]: key, uploads: 0, approved: 0 };
        cur.uploads += 1;
        if (row.status === 'approved') cur.approved += 1;
        grouped.set(key, cur);
      }
      return [...grouped.values()]
        .sort((a, b) => (b.uploads - a.uploads) || (b.approved - a.approved) || String(a[col]).localeCompare(String(b[col]), 'ko'))
        .slice(0, limit);
    }

    const analytics = {
      async summary({ strict = false } = {}) {
        const c = client(); if (!c) { if (strict) throw new Error('Analytics unavailable'); return null; }
        const { data, error } = await c.rpc('admin_analytics_summary');
        if (error) { if (strict) throw error; console.warn('[analytics.summary]', error.message); return null; }
        const value = Array.isArray(data) ? (data[0] || null) : data;
        if (strict && (!value || typeof value !== 'object')) throw new Error('Invalid analytics summary');
        return value;
      },
      async daily(from = null, to = null) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_daily', { p_from: from, p_to: to });
        if (error) { console.warn('[analytics.daily]', error.message); return []; }
        return data || [];
      },
      async topPaths(from = null, to = null, limit = 20) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_top_paths', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.topPaths]', error.message); return []; }
        return data || [];
      },
      async referrers(from = null, to = null, limit = 20) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_referrers', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.referrers]', error.message); return []; }
        return data || [];
      },
      async regions(from = null, to = null, limit = 20) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_regions', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.regions]', error.message); return []; }
        return data || [];
      },
      // 페이지뷰 밖의 사용자 동작(app_events: nav_clicked·search 등) 이벤트별 횟수.
      // 날짜 범위가 아니라 최근 N일. 편집부만 통과한다(정의자 권한 RPC + 편집부 확인).
      async eventsSummary(days = 30, limit = 50) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_events_summary', { p_days: days, p_limit: limit });
        if (error) { console.warn('[analytics.eventsSummary]', error.message); return []; }
        return data || [];
      },
      async languages(from = null, to = null, limit = 20) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_languages', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.languages]', error.message); return []; }
        return data || [];
      },
      async dwellSummary(from = null, to = null) {
        const c = client(); if (!c) return null;
        const { data, error } = await c.rpc('admin_analytics_dwell_summary', { p_from: from, p_to: to });
        if (error) { console.warn('[analytics.dwellSummary]', error.message); return null; }
        return Array.isArray(data) ? (data[0] || null) : data;
      },
      async dwellByPath(from = null, to = null, limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_analytics_dwell_by_path', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.dwellByPath]', error.message); return []; }
        return data || [];
      },
      async sessionStats(from = null, to = null) {
        const c = client(); if (!c) return null;
        const { data, error } = await c.rpc('admin_analytics_session_stats', { p_from: from, p_to: to });
        if (error) { console.warn('[analytics.sessionStats]', error.message); return null; }
        return Array.isArray(data) ? (data[0] || null) : data;
      },
      // 전체 기간 라벨에 실제 시작일을 적기 위해 쓴다
      async firstDay() {
        const c = await ready();
        const { data, error } = await c.rpc('admin_analytics_first_day');
        if (error) { console.warn('[analytics.firstDay]', error.message); return null; }
        return (data && data[0]) || null;
      },
      async uploadsSummary({ strict = false } = {}) {
        const c = client(); if (!c) { if (strict) throw new Error('Upload summary unavailable'); return null; }
        const { data, error } = await c.rpc('admin_uploads_summary');
        if (error) { if (strict) throw error; console.warn('[analytics.uploadsSummary]', error.message); return null; }
        const value = Array.isArray(data) ? (data[0] || null) : data;
        if (strict && (!value || typeof value !== 'object')) throw new Error('Invalid upload summary');
        return value;
      },
      async uploadsDaily(from = null, to = null) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_daily', { p_from: from, p_to: to });
        if (error) { console.warn('[analytics.uploadsDaily]', error.message); return []; }
        return data || [];
      },
      async uploadsTopContributors(from = null, to = null, limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_top_contributors', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.uploadsTopContributors]', error.message); return []; }
        return data || [];
      },
      async uploadsTopFilms(from = null, to = null, limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_top_films', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.uploadsTopFilms]', error.message); return fallbackUploadsTop('film', { from, to, limit }); }
        return data?.length ? data : fallbackUploadsTop('film', { from, to, limit });
      },
      async uploadsTopFilmsAll(limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_top_films_all', { p_limit: limit });
        if (error) { console.warn('[analytics.uploadsTopFilmsAll]', error.message); return fallbackUploadsTop('film', { limit }); }
        return data?.length ? data : fallbackUploadsTop('film', { limit });
      },
      async uploadsTopCameras(from = null, to = null, limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_top_cameras', { p_from: from, p_to: to, p_limit: limit });
        if (error) { console.warn('[analytics.uploadsTopCameras]', error.message); return fallbackUploadsTop('camera', { from, to, limit }); }
        return data?.length ? data : fallbackUploadsTop('camera', { from, to, limit });
      },
      async uploadsTopCamerasAll(limit = 10) {
        const c = client(); if (!c) return [];
        const { data, error } = await c.rpc('admin_uploads_top_cameras_all', { p_limit: limit });
        if (error) { console.warn('[analytics.uploadsTopCamerasAll]', error.message); return fallbackUploadsTop('camera', { limit }); }
        return data?.length ? data : fallbackUploadsTop('camera', { limit });
      },
      async uploadsThemeRatio(from = null, to = null) {
        const c = client(); if (!c) return null;
        const { data, error } = await c.rpc('admin_uploads_theme_ratio', { p_from: from, p_to: to });
        if (error) { console.warn('[analytics.uploadsThemeRatio]', error.message); return null; }
        return Array.isArray(data) ? (data[0] || null) : data;
      },
      async clientErrorsRecent(hours = 24, limit = 20, { strict = false } = {}) {
        const c = client(); if (!c) { if (strict) throw new Error('Error logs unavailable'); return []; }
        const modern = await c.rpc('admin_client_errors_recent_v2', { p_hours: hours, p_limit: limit });
        if (!modern.error) {
          if (strict && !Array.isArray(modern.data)) throw new Error('Invalid error logs');
          return modern.data || [];
        }
        const legacy = await c.rpc('admin_client_errors_recent', { p_hours: hours, p_limit: limit });
        if (legacy.error) { if (strict) throw legacy.error; console.warn('[analytics.clientErrorsRecent]', legacy.error.message || modern.error.message); return []; }
        if (strict && !Array.isArray(legacy.data)) throw new Error('Invalid error logs');
        return legacy.data || [];
      },
      async clientErrorsPurge(keepDays = 30) {
        const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
        const { data, error } = await c.rpc('admin_client_errors_purge', { p_keep_days: keepDays });
        if (error) { console.warn('[analytics.clientErrorsPurge]', error.message); return { error }; }
        return { deleted: Number(data) || 0 };
      },
    };

    // ─── 금칙어(편집부 관리) ───
    const commentFilterTerms = {
      async list() {
        const c = client(); if (!c) return [];
        const { data, error } = await c.from('comment_filter_terms').select('*').order('term', { ascending: true });
        if (error) return [];
        return data || [];
      },
      async add(term) {
        const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
        const uid = await userId();
        return c.from('comment_filter_terms').insert({ term: String(term || '').trim(), created_by: uid });
      },
      async remove(id) {
        const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
        return c.from('comment_filter_terms').delete().eq('id', id);
      },
    };

    return {
      profiles: {
        // 편집부가 메시지 보낼 회원을 찾을 때.
        // display_name (Google 계정 이름), 사진 등록 시 입력한 작가명 (submitter_name),
        // 사진 등록 시 입력한 IG 핸들 (instagram) 셋 다 검색. 매칭된 필드는 hints[] 로 같이 반환.
        async search(query) {
          const c = client(); if (!c) return [];
          const q = String(query || '').trim();
          if (q.length < 1) return [];
          const like = `%${q}%`;

          const profileQ = c.from('profiles_public')
            .select('user_id, display_name, avatar_url')
            .ilike('display_name', like)
            .limit(20);

          const submissionQ = c.from('reader_submissions')
            .select('user_id, submitter_name, instagram')
            .or(`submitter_name.ilike.${like},instagram.ilike.${like}`)
            .limit(60);

          const [profRes, subRes] = await Promise.all([profileQ, submissionQ]);
          if (profRes.error) console.warn('[profiles.search]', profRes.error.message);
          if (subRes.error)  console.warn('[profiles.search:submissions]', subRes.error.message);

          const results = new Map();
          for (const p of (profRes.data || [])) {
            if (!p.user_id) continue;
            results.set(p.user_id, {
              user_id: p.user_id,
              display_name: p.display_name,
              avatar_url: p.avatar_url,
              hints: ['이름'],
            });
          }

          // submission 의 user_id 중 results 에 없는 것 → profile 조회 (display_name 채우려고)
          const missingUids = [...new Set((subRes.data || [])
            .map(s => s.user_id)
            .filter(uid => uid && !results.has(uid)))];
          if (missingUids.length > 0) {
            const { data: extraProfiles } = await c.from('profiles_public')
              .select('user_id, display_name, avatar_url')
              .in('user_id', missingUids);
            for (const p of (extraProfiles || [])) {
              results.set(p.user_id, {
                user_id: p.user_id,
                display_name: p.display_name,
                avatar_url: p.avatar_url,
                hints: [],
              });
            }
          }

          const ql = q.toLowerCase();
          for (const s of (subRes.data || [])) {
            if (!s.user_id) continue;
            const r = results.get(s.user_id);
            if (!r) continue;
            if (s.submitter_name && s.submitter_name.toLowerCase().includes(ql)) {
              const hint = `사진 등록명 "${s.submitter_name}"`;
              if (!r.hints.includes(hint)) r.hints.push(hint);
            }
            if (s.instagram && s.instagram.toLowerCase().includes(ql)) {
              const ig = s.instagram.startsWith('@') ? s.instagram : '@' + s.instagram;
              const hint = `IG ${ig}`;
              if (!r.hints.includes(hint)) r.hints.push(hint);
            }
          }

          return [...results.values()].slice(0, 20);
        },
      },
      comments: {
        // ─ 모더레이션(편집부) ─ 페이지 구분 없이 전체 댓글을 최신순으로.
        async adminListAll({ limit = 500 } = {}) {
          const c = client(); if (!c) return { data: [], error: null };
          const { data, error } = await c.from('comments_with_meta')
            .select('*').order('created_at', { ascending: false }).limit(limit);
          return { data: data || [], error };
        },
        async adminRestore(id) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('comments').update({ deleted_at: null }).eq('id', id);
        },
      },
      commentFilterTerms,
      review: {
        async count(status, opts = {}) {
          const c = client(); if (!c) return 0;
          let q = c.from('reader_submissions')
            .select('id', { count: 'exact', head: true }).eq('status', status);
          q = applyReviewFilters(q, opts);
          const { count } = await q;
          return count || 0;
        },
        async list(status, from, to, opts = {}) {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          let q = c.from('reader_submissions').select('*').eq('status', status);
          q = applyReviewFilters(q, opts);
          return q.order('created_at', { ascending: status === 'pending' }).range(from, to);
        },
        async remove(id) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('reader_submissions').delete().eq('id', id);
        },
        // ── 중복 거르기 (편집부) ──
        // 「중복 의심」 카드가 가리키는 사진들을 한 번에 가져온다.
        async byIds(ids) {
          const c = client(); if (!c || !ids?.length) return { data: [], error: null };
          return c.from('reader_submissions')
            .select('id, storage_path, status, created_at, submitter_name, instagram')
            .in('id', ids);
        },
        // 기존 사진 지문 채우기: 아직 phash 가 없는 사진 수와 목록.
        async countMissingPhash() {
          const c = client(); if (!c) return 0;
          const { count } = await c.from('reader_submissions')
            .select('id', { count: 'exact', head: true }).is('phash', null);
          return count || 0;
        },
        async listMissingPhash(limit = 40, skipIds = []) {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          let q = c.from('reader_submissions').select('id, storage_path').is('phash', null);
          if (skipIds.length) q = q.not('id', 'in', `(${skipIds.join(',')})`);
          return q.order('created_at', { ascending: true }).limit(limit);
        },
        async setPhash(id, phash) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('reader_submissions').update({ phash }).eq('id', id).select('id');
        },
        // 같은 사람의 닮은 사진 묶음(기존 사진 정리용). RPC 가 편집부인지 확인한다.
        async duplicatePairs() {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.rpc('admin_reader_duplicate_pairs', { p_max_distance: null });
        },
        // 두 사진의 게재일을 맞바꾼다. 관리 화면의 위/아래 화살표가 쓴다.
        //
        // note 는 건드리지 않는다. setFeatured 는 note 를 덮어쓰므로 여기서는
        // featured_at 만 바꾼다. 알림도 보내지 않는다. 이미 뽑힌 사람들끼리
        // 자리를 바꾼 것이라 다시 알릴 일이 아니다.
        //
        // 두 번의 update 라 중간에 실패하면 두 사진이 같은 날짜를 갖게 된다.
        // 그러면 홈이 나중에 등록한 쪽을 걸어서 화면이 헷갈리므로, 두 번째가
        // 실패하면 첫 번째를 되돌린다.
        async swapFeaturedDates(idA, dateA, idB, dateB) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
          if (!idA || !idB || !ok(dateA) || !ok(dateB)) {
            return { error: { message: '바꿀 두 날짜가 올바르지 않습니다' } };
          }
          const { error: e1 } = await c.from('reader_submissions')
            .update({ featured_at: dateB }).eq('id', idA).select('id');
          if (e1) return { error: e1 };

          const { error: e2 } = await c.from('reader_submissions')
            .update({ featured_at: dateA }).eq('id', idB).select('id');
          if (e2) {
            await c.from('reader_submissions').update({ featured_at: dateA }).eq('id', idA);
            return { error: e2 };
          }
          return { error: null };
        },
        async clearFeatured(id) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('reader_submissions').update({
            featured_at: null, featured_note: null,
          }).eq('id', id).select('id');
        },
        // 편집부 전용 — 사진 좋아요 수 집계 (개인정보 노출 X)
        // RPC SECURITY DEFINER 함수가 caller 의 is_editor 검사
        async adminLikeCounts() {
          const c = client(); if (!c) return new Map();
          const { data, error } = await c.rpc('admin_submission_like_counts');
          if (error) {
            console.warn('[admin] like counts:', error.message);
            return new Map();
          }
          return new Map((data || []).map(r => [String(r.target_id), Number(r.like_count) || 0]));
        },
        // 좋아요 순 정렬용 — 페이지네이션 무시하고 status 안의 모든 row 일괄 조회
        //   (5ft.mag 규모에서 approved 가 10k 넘어가기 전엔 한 페이지로 충분)
        async listAll(status, opts = {}) {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          let q = c.from('reader_submissions').select('*').eq('status', status);
          q = applyReviewFilters(q, opts);
          return q.order('created_at', { ascending: false }).limit(2000);
        },
      },
      market: {
        // ─── 편집부 전용 — RLS 가 권한 가드 ───
        async adminGetListing(id) {
          // base 테이블에서 직접 조회 — hidden 포함, RLS 가 편집부만 허용
          const c = client(); if (!c) return null;
          const { data } = await c.from('market_listings').select('*').eq('id', id).maybeSingle();
          if (!data) return null;
          // profiles 조인 (display_name 보강) — 간단히 별도 조회
          const { data: prof } = await c.from('profiles_public').select('display_name')
            .eq('user_id', data.user_id).maybeSingle();
          return { ...data, display_name: prof?.display_name || null };
        },
        async adminReportCount(status = 'pending', { strict = false } = {}) {
          const c = client(); if (!c) { if (strict) throw new Error('Report count unavailable'); return 0; }
          const { count, error } = await c.from('market_reports')
            .select('id', { count: 'exact', head: true })
            .eq('status', status);
          if (error) { if (strict) throw error; console.warn('[market.adminReportCount]', error.message); }
          if (strict && (!Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid report count');
          return count || 0;
        },
        async adminListReports(status, from, to) {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          let q = c.from('market_reports')
            .select('id, listing_id, reporter_id, reason, status, resolved_at, resolved_by, resolver_note, created_at');
          if (status) q = q.eq('status', status);
          return q.order('created_at', { ascending: false }).range(from, to);
        },
        async adminPatchReport(id, patch) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const uid = await userId();
          const merged = { ...patch };
          if (patch.status && patch.status !== 'pending') {
            merged.resolved_at = new Date().toISOString();
            merged.resolved_by = uid;
          } else if (patch.status === 'pending') {
            merged.resolved_at = null;
            merged.resolved_by = null;
          }
          return c.from('market_reports').update(merged).eq('id', id).select('id');
        },
        async adminHideListing(listingId) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('market_listings').update({ status: 'hidden' }).eq('id', listingId).select('id');
        },
        async adminUnhideListing(listingId) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('market_listings').update({ status: 'available' }).eq('id', listingId).select('id');
        },
        async adminDeleteListing(listingId) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          // 매물 row 조회 → storage_paths 회수 → DB 삭제 → storage 삭제
          const { data: row } = await c.from('market_listings').select('storage_paths').eq('id', listingId).maybeSingle();
          const { data, error } = await c.from('market_listings').delete().eq('id', listingId).select('id');
          if (error || !data?.length) return { error: error || { message: '삭제 거부됨 (편집부 권한 확인)' } };
          if (row?.storage_paths?.length) {
            try { const { error } = await c.storage.from(MARKET_BUCKET).remove(row.storage_paths); if (error) console.warn('[storage.remove]', MARKET_BUCKET, error.message || error); } catch (e) { console.warn('[storage.remove]', MARKET_BUCKET, e); }
          }
          return { data };
        },
      },
      cameraOverrides: {
        async upsert({ model_key, brand, display, note, alias_of }) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const uid = await userId();
          if (!uid) return { error: { message: 'login required', code: 'AUTH_REQUIRED' } };
          return c.from('camera_brand_overrides').upsert({
            model_key: String(model_key || '').trim(),
            brand: String(brand || '').trim(),
            display: display ? String(display).trim() : null,
            note: note ? String(note).trim() : null,
            alias_of: alias_of ? String(alias_of).trim() : null,
            created_by: uid,
          });
        },
        async remove(modelKey) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('camera_brand_overrides').delete().eq('model_key', modelKey);
        },
      },
      analytics,
      filmProposals: {
        // 편집부 전용 — pending(또는 전체) 목록
        async listForReview({ status = 'pending', limit = 100, strict = false } = {}) {
          const c = client(); if (!c) { if (strict) throw new Error('Film proposals unavailable'); return []; }
          let q = c.from('film_proposals')
            .select('*').order('created_at', { ascending: false }).limit(limit);
          if (status && status !== 'all') q = q.eq('status', status);
          const { data, error } = await q;
          if (error) { if (strict) throw error; console.warn('[filmProposals.listForReview]', error.message); return []; }
          if (strict && !Array.isArray(data)) throw new Error('Invalid film proposals');
          return data || [];
        },
        // 승인: status=approved + approved_slug 기록. 실제 films INSERT 는 admin/films 폼에서.
        async approve(id, slug, notes) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('film_proposals').update({
            status: 'approved',
            approved_slug: slug || null,
            reviewer_notes: notes || null,
            reviewed_at: new Date().toISOString(),
          }).eq('id', id);
        },
        async reject(id, notes) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          return c.from('film_proposals').update({
            status: 'rejected',
            reviewer_notes: notes || null,
            reviewed_at: new Date().toISOString(),
          }).eq('id', id);
        },
        // 신청자 알림 — 편집부가 승인/반려 후 호출 (RLS 가 본인+편집부만 인서트 허용
        // 하지 않으므로 RPC 가 없다면 편집부 권한으로 user_notifications 직접 INSERT).
        async notifyDecision(proposal, kind /* 'approved'|'rejected' */, link) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const titles = {
            approved: '신청하신 필름이 등록됐어요',
            rejected: '신청하신 필름이 반려됐어요',
          };
          const type = kind === 'approved' ? 'proposal_approved' : 'proposal_rejected';
          return c.from('user_notifications').insert({
            user_id: proposal.user_id,
            type,
            related_id: proposal.id,
            title: titles[kind] || '신청 결과',
            body: `${proposal.brand} ${proposal.name}` + (proposal.reviewer_notes ? ` · ${proposal.reviewer_notes}` : ''),
            link: link || null,
            meta: { brand: proposal.brand, name: proposal.name, notes: proposal.reviewer_notes || null },
          });
        },
      },
      announcements: {
        // 관리: 전체 공지 (예약/지난/비활성 포함).
        async listAll() {
          const c = client(); if (!c) return { data: [], error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const { data, error } = await c
            .from('announcements')
            .select('id, body, body_en, body_ja, starts_at, ends_at, is_active, created_at')
            .order('created_at', { ascending: false });
          return { data: data || [], error };
        },
        async create({ body, body_en, body_ja, starts_at, ends_at }) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const clean = String(body || '').trim();
          if (!clean || clean.length > 500) return { error: { message: 'body 1~500자' } };
          const uid = await userId();
          // 영·일 칸은 선택. 비우면 null 로 두어 화면이 한국어(일문은 영문 먼저)로 대신 쓴다.
          const row = {
            body: clean,
            body_en: String(body_en || '').trim() || null,
            body_ja: String(body_ja || '').trim() || null,
            created_by: uid,
          };
          if (starts_at) row.starts_at = starts_at;
          if (ends_at) row.ends_at = ends_at;
          const { error } = await c.from('announcements').insert(row);
          return { error };
        },
        async update(id, fields) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const patch = {};
          if (typeof fields.body === 'string') patch.body = fields.body.trim();
          if ('body_en' in fields) patch.body_en = String(fields.body_en || '').trim() || null;
          if ('body_ja' in fields) patch.body_ja = String(fields.body_ja || '').trim() || null;
          if ('starts_at' in fields) patch.starts_at = fields.starts_at || null;
          if ('ends_at' in fields) patch.ends_at = fields.ends_at || null;
          if (typeof fields.is_active === 'boolean') patch.is_active = fields.is_active;
          const { error } = await c.from('announcements').update(patch).eq('id', id);
          return { error };
        },
        async remove(id) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const { error } = await c.from('announcements').delete().eq('id', id);
          return { error };
        },
      },
      messages: {
        // 편집부가 특정 회원에게 보냄
        async sendAsEditor(targetUserId, body) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const text = String(body || '').trim();
          if (!text) return { error: { message: 'empty' } };
          if (text.length > 2000) return { error: { message: 'too long' } };
          return c.from('messages').insert({ user_id: targetUserId, from_editor: true, body: text });
        },
        // 편집부 인박스: 회원별 스레드 목록 (마지막 메시지 / 안읽음 카운트 포함)
        async listThreads({ limit = 200 } = {}) {
          const c = client(); if (!c) return [];
          const { data, error } = await c.from('message_threads').select('*')
            .order('last_at', { ascending: false })
            .limit(limit);
          if (error) { console.warn('[messages.listThreads]', error.message); return []; }
          return data || [];
        },
        // 편집부 전용 soft delete
        async remove(id) {
          const c = client(); if (!c) return { error: { message: 'unavailable', code: 'UNAVAILABLE' } };
          const { error } = await c.rpc('delete_message', { p_id: id });
          return { error };
        },
      },
    };
  }

  window.MagDBAdmin = { create };
})();
