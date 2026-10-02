#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATION_VERSION = '20261003000003';
export const JOB_NAME = '5ftmag-operational-retention-daily';
export const JOB_SCHEDULE = '17 3 * * *';
export const JOB_COMMAND = "SET statement_timeout = '5min'; SET lock_timeout = '5s'; SELECT ops_private.purge_operational_logs();";
export const PUBLIC_PATHS = ['/index.html', '/en/index.html', '/ja/index.html', '/admin/index.html'];
export const BLOCKED_PATHS = [
  '/CLAUDE.md', '/package.json', '/package-lock.json', '/netlify.toml',
  '/docs/database-recovery.md', '/docs/operations-verification.md', '/db/baseline.sql',
  '/supabase/migrations/20261003000003_log_retention_schedule.sql',
  '/scripts/ops-health.mjs', '/tests/unit/operations-health.spec.mjs',
  '/relay/server.mjs', '/.claude/settings.json', '/.github/workflows/db-deploy.yml',
  '/.git/config', '/node_modules/vitest/package.json',
];

const check = (name, status, detail) => ({ name, status, detail });
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function securityHeaderIssues(headers) {
  const issues = [];
  const expected = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'cross-origin-resource-policy': 'same-site',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (headers.get(name)?.trim() !== value) issues.push(name);
  }
  const hsts = headers.get('strict-transport-security') || '';
  if (!/(?:^|;)\s*max-age=31536000(?:;|$)/i.test(hsts)
      || !/(?:^|;)\s*includeSubDomains(?:;|$)/i.test(hsts)) issues.push('strict-transport-security');

  const csp = headers.get('content-security-policy') || '';
  const entries = csp.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values.join(' ')];
  }).filter(([name]) => name);
  const directives = new Map(entries);
  const boundaries = {
    'default-src': "'self'", 'object-src': "'none'", 'base-uri': "'self'",
    'frame-ancestors': "'self'", 'script-src-attr': "'none'",
  };
  if (directives.size !== entries.length
      || Object.entries(boundaries).some(([name, value]) => directives.get(name) !== value)
      || !directives.has('upgrade-insecure-requests')
      || !directives.get('script-src')?.split(' ').includes("'self'")
      || /'unsafe-eval'|'wasm-unsafe-eval'/.test(csp)) issues.push('content-security-policy');
  const permissions = headers.get('permissions-policy') || '';
  if (!/(?:^|,)\s*camera=\(\)/.test(permissions)
      || !/(?:^|,)\s*microphone=\(\)/.test(permissions)
      || !/(?:^|,)\s*geolocation=\(self\)/.test(permissions)) issues.push('permissions-policy');
  return issues;
}

function siteOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('invalid site origin');
  }
  return url.origin;
}

export async function verifyHttp(value, fetchImpl = globalThis.fetch) {
  if (!value) return [check('http', 'unverified', 'OPS_SITE_URL is not configured.')];
  let origin;
  try { origin = siteOrigin(value); }
  catch { return [check('http', 'fail', 'OPS_SITE_URL must be a credential-free HTTPS origin (HTTP loopback allowed).')]; }
  const checks = [];
  for (const path of [...PUBLIC_PATHS, ...BLOCKED_PATHS]) {
    const blocked = BLOCKED_PATHS.includes(path);
    let response;
    try {
      response = await fetchImpl(new URL(path, origin), {
        method: 'GET', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(10_000),
      });
      const status = response.status;
      if (blocked) {
        checks.push(check(`blocked:${path}`, status === 404 ? 'pass' : 'fail', `HTTP ${status}; expected 404 without redirect.`));
      } else {
        const issues = securityHeaderIssues(response.headers);
        checks.push(check(`headers:${path}`, status === 200 && issues.length === 0 ? 'pass' : 'fail',
          `HTTP ${status}; ${issues.length ? `missing or unexpected: ${issues.join(', ')}` : 'required header boundaries present'}.`));
      }
    } catch {
      // Fetch/driver errors may contain URLs, credentials or response content.
      checks.push(check(`http:${path}`, 'unverified', 'Request failed or timed out; no response content logged.'));
    } finally {
      try { await response?.body?.cancel(); } catch { /* Never consume response bodies. */ }
    }
  }
  return checks;
}

export const CORE_SQL = `SELECT jsonb_build_object(
  'cron_installed', EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'),
  'function_secure', EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ops_private' AND p.proname = 'purge_operational_logs' AND p.pronargs = 0
      AND p.proowner = 'postgres'::regrole AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""', 'lock_timeout=5s']::text[]
      AND has_schema_privilege('service_role', n.oid, 'USAGE')
      AND NOT has_schema_privilege('anon', n.oid, 'USAGE')
      AND NOT has_schema_privilege('authenticated', n.oid, 'USAGE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE a.privilege_type = 'EXECUTE'
          AND a.grantee NOT IN ('postgres'::regrole, 'service_role'::regrole)
      )
  )
) AS evidence;`;

export const MIGRATION_SQL = `SELECT jsonb_build_object('recorded', EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${MIGRATION_VERSION}'
)) AS evidence;`;

export const JOB_SQL = `SELECT jsonb_build_object(
  'count', count(*),
  'full_visibility', NOT pg_catalog.row_security_active('cron.job'::regclass),
  'matches', coalesce(bool_and(active AND username = 'postgres' AND database = current_database()
    AND schedule = ${literal(JOB_SCHEDULE)} AND command = ${literal(JOB_COMMAND)}), false),
  'utc', coalesce(current_setting('cron.timezone', true), 'GMT') IN ('GMT', 'UTC', 'Etc/UTC'),
  'launcher_enabled', current_setting('cron.launch_active_jobs', true) IS DISTINCT FROM 'off'
) AS evidence FROM cron.job WHERE jobname = ${literal(JOB_NAME)};`;

export const RUN_SQL = `SELECT jsonb_build_object(
  'latest_status', (SELECT status FROM cron.job_run_details r JOIN cron.job j USING (jobid)
    WHERE j.jobname = ${literal(JOB_NAME)} ORDER BY r.runid DESC LIMIT 1),
  'recent_success', EXISTS (SELECT 1 FROM cron.job_run_details r JOIN cron.job j USING (jobid)
    WHERE j.jobname = ${literal(JOB_NAME)} AND r.status = 'succeeded'
      AND r.end_time >= now() - interval '26 hours'),
  'running_recent', coalesce((SELECT r.start_time >= now() - interval '10 minutes'
    FROM cron.job_run_details r JOIN cron.job j USING (jobid)
    WHERE j.jobname = ${literal(JOB_NAME)} ORDER BY r.runid DESC LIMIT 1), false)
) AS evidence;`;

export function readDatabaseEvidence(databaseUrl, sql, runner = spawnSync) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid database URL');
  const result = runner('psql', ['-X', '--no-password', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1'], {
    input: `BEGIN READ ONLY;\nSET LOCAL statement_timeout = '10s';\n${sql}\nROLLBACK;\n`,
    encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024,
    env: { ...process.env, PGDATABASE: databaseUrl, PGSSLMODE: process.env.PGSSLMODE || 'require', PGCONNECT_TIMEOUT: '10' },
    // No shell, URI arguments, psql startup files, stderr forwarding or business-row queries.
  });
  if (result.error || result.status !== 0) throw new Error('database evidence unavailable');
  return JSON.parse(result.stdout.trim());
}

export function verifyRunEvidence(evidence) {
  const name = 'retention:last-run';
  if (evidence.latest_status == null) return check(name, 'unverified', 'No run history; wait for the first daily run.');
  if (evidence.latest_status === 'failed') return check(name, 'fail', 'Latest retention run failed; inspect history privately.');
  if (['starting', 'running', 'connecting', 'sending'].includes(evidence.latest_status)) {
    if (evidence.running_recent !== true) return check(name, 'fail', 'Latest retention run appears stuck.');
    if (evidence.recent_success !== true) return check(name, 'unverified', 'Run in progress; no successful run in the last 26 hours.');
  } else if (evidence.latest_status !== 'succeeded') {
    return check(name, 'unverified', 'Unexpected run state; inspect history privately.');
  }
  return check(name, evidence.recent_success === true ? 'pass' : 'fail',
    evidence.recent_success === true ? 'Successful daily run within 26 hours.' : 'No successful daily run within 26 hours.');
}

export function verifyDatabase(databaseUrl, read = readDatabaseEvidence) {
  if (!databaseUrl) return [check('database', 'unverified', 'OPS_DATABASE_URL is not configured; migration and schedule not verified.')];
  const checks = [];
  let core;
  try {
    core = read(databaseUrl, CORE_SQL);
    checks.push(check('retention:function', core.function_secure === true ? 'pass' : 'fail',
      'Requires postgres-owned private definer function and service-only execution grants.'));
    checks.push(check('retention:extension', core.cron_installed === true ? 'pass' : 'fail',
      core.cron_installed === true ? 'pg_cron installed.' : 'pg_cron missing: retention is not scheduled/verified.'));
  } catch {
    checks.push(check('database:metadata', 'unverified', 'psql, connection or catalog permissions unavailable.'));
  }
  try {
    const migration = read(databaseUrl, MIGRATION_SQL);
    checks.push(check('retention:migration', migration.recorded === true ? 'pass' : 'fail',
      migration.recorded === true ? 'R12 migration recorded.' : 'R12 migration is not recorded.'));
  } catch {
    checks.push(check('retention:migration', 'unverified', 'Migration registry unavailable; SQL Editor application alone does not record CLI migration history.'));
  }
  if (core?.cron_installed === true) {
    try {
      const job = read(databaseUrl, JOB_SQL);
      if (job.full_visibility !== true) {
        checks.push(check('retention:schedule', 'unverified', 'Cron metadata is RLS-restricted; cannot rule out hidden same-name jobs.'));
      } else {
        checks.push(check('retention:schedule', job.count === 1 && job.matches === true && job.utc === true && job.launcher_enabled === true ? 'pass' : 'fail',
          'Requires one active named job, exact command/schedule, postgres owner, target database, UTC and enabled launcher.'));
      }
    } catch {
      checks.push(check('retention:schedule', 'unverified', 'Cron job metadata unavailable.'));
    }
    try { checks.push(verifyRunEvidence(read(databaseUrl, RUN_SQL))); }
    catch { checks.push(check('retention:last-run', 'unverified', 'Cron run history unavailable.')); }
  }
  return checks;
}

export function exitCode(checks) {
  if (checks.some(item => item.status === 'fail')) return 1;
  if (!checks.length || checks.some(item => item.status === 'unverified')) return 2;
  return 0;
}

export async function runHealth(env = process.env, dependencies = {}) {
  const checks = await verifyHttp(env.OPS_SITE_URL, dependencies.fetch);
  checks.push(...verifyDatabase(env.OPS_DATABASE_URL, dependencies.readDatabase));
  return { checks, exitCode: exitCode(checks) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) {
    console.log('Usage: node scripts/ops-health.mjs (OPS_SITE_URL and optional OPS_DATABASE_URL via environment only)');
    process.exitCode = 2;
  } else {
    try {
      const report = await runHealth();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.exitCode;
    } catch {
      console.log('Operational verification unavailable; no secrets or raw errors logged.');
      process.exitCode = 2;
    }
  }
}
