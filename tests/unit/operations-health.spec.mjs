// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  BLOCKED_PATHS, CORE_SQL, JOB_SQL, MIGRATION_SQL, PUBLIC_PATHS, RUN_SQL,
  exitCode, readDatabaseEvidence, runHealth, securityHeaderIssues, verifyDatabase, verifyHttp, verifyRunEvidence,
} from '../../scripts/ops-health.mjs';

const goodHeaders = () => new Headers({
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; script-src-attr 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', 'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
});
const goodDatabase = (url, sql) => {
  if (sql === CORE_SQL) return { cron_installed: true, function_secure: true };
  if (sql === MIGRATION_SQL) return { recorded: true };
  if (sql === JOB_SQL) return { count: 1, full_visibility: true, matches: true, utc: true, launcher_enabled: true };
  if (sql === RUN_SQL) return { latest_status: 'succeeded', recent_success: true, running_recent: false };
  throw new Error('unexpected SQL');
};

describe('read-only operations health', () => {
  it('checks public pages and exact 404 blocks using GET without redirects or credentials; discards bodies', async () => {
    const cancel = vi.fn(async () => {});
    const fetch = vi.fn(async (url, options) => {
      expect(options).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
      expect(url.origin).toBe('https://example.test');
      return { status: BLOCKED_PATHS.includes(url.pathname) ? 404 : 200, headers: goodHeaders(), body: { cancel } };
    });
    const report = await runHealth({ OPS_SITE_URL: 'https://example.test', OPS_DATABASE_URL: 'postgresql://secret' }, { fetch, readDatabase: goodDatabase });
    expect(report.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(PUBLIC_PATHS.length + BLOCKED_PATHS.length);
    expect(cancel).toHaveBeenCalledTimes(fetch.mock.calls.length);
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('fails open paths and redirects rather than following to a misleading 404', async () => {
    const checks = await verifyHttp('https://example.test', async url => ({
      status: BLOCKED_PATHS.includes(url.pathname) ? 302 : 200, headers: goodHeaders(),
    }));
    expect(checks.filter(item => item.status === 'fail')).toHaveLength(BLOCKED_PATHS.length);
    expect(exitCode(checks)).toBe(1);
    const open = await verifyHttp('https://example.test', async () => ({ status: 200, headers: goodHeaders() }));
    expect(open.find(item => item.name.startsWith('blocked:')).status).toBe('fail');
  });

  it('detects missing and relaxed security boundaries without printing header values', () => {
    expect(securityHeaderIssues(goodHeaders())).toEqual([]);
    const headers = goodHeaders();
    headers.set('Content-Security-Policy', "default-src *; script-src 'self' 'unsafe-eval'; report-uri https://secret.invalid");
    headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=*');
    headers.delete('Strict-Transport-Security');
    expect(securityHeaderIssues(headers)).toEqual(['strict-transport-security', 'content-security-policy', 'permissions-policy']);
    expect(securityHeaderIssues(new Headers()).length).toBeGreaterThan(5);
    const duplicates = goodHeaders();
    duplicates.set('Content-Security-Policy', `default-src *; ${duplicates.get('Content-Security-Policy')}`);
    expect(securityHeaderIssues(duplicates)).toEqual(['content-security-policy']);
  });

  it('rejects secret-bearing/malformed origins before requests; redacts network errors', async () => {
    const fetch = vi.fn();
    for (const origin of ['https://user:secret@example.test', 'https://example.test?token=secret', 'https://example.test/path', 'http://example.test', 'not-a-url']) {
      expect(exitCode(await verifyHttp(origin, fetch))).toBe(1);
    }
    expect(fetch).not.toHaveBeenCalled();
    const checks = await verifyHttp('http://127.0.0.1:4321', async () => { throw new Error('secret private row'); });
    expect(exitCode(checks)).toBe(2);
    expect(JSON.stringify(checks)).not.toMatch(/secret|private row/);
  });

  it('marks missing credentials, catalogs and run history unverified, never passed', async () => {
    const report = await runHealth({});
    expect(report.exitCode).toBe(2);
    const inaccessible = verifyDatabase('postgresql://secret', () => { throw new Error('secret'); });
    expect(inaccessible.every(item => item.status === 'unverified')).toBe(true);
    expect(JSON.stringify(inaccessible)).not.toContain('secret');
    expect(verifyRunEvidence({ latest_status: null }).status).toBe('unverified');
    expect(exitCode([])).toBe(2);
  });

  it('fails a missing extension or migration and duplicate/inactive/misconfigured jobs', () => {
    for (const [query, bad] of [
      [CORE_SQL, { cron_installed: false, function_secure: true }],
      [CORE_SQL, { cron_installed: true, function_secure: false }],
      [MIGRATION_SQL, { recorded: false }],
      [JOB_SQL, { count: 2, full_visibility: true, matches: true, utc: true, launcher_enabled: true }],
      [JOB_SQL, { count: 1, full_visibility: true, matches: false, utc: true, launcher_enabled: true }],
      [JOB_SQL, { count: 1, full_visibility: true, matches: true, utc: false, launcher_enabled: true }],
      [JOB_SQL, { count: 1, full_visibility: true, matches: true, utc: true, launcher_enabled: false }],
    ]) {
      expect(exitCode(verifyDatabase('postgresql://secret', (url, sql) => sql === query ? bad : goodDatabase(url, sql)))).toBe(1);
    }
  });

  it('does not pass duplicate verification when cron RLS hides other owners', () => {
    const checks = verifyDatabase('postgresql://secret', (url, sql) => sql === JOB_SQL
      ? { count: 1, full_visibility: false, matches: true, utc: true, launcher_enabled: true }
      : goodDatabase(url, sql));
    expect(checks.find(item => item.name === 'retention:schedule').status).toBe('unverified');
    expect(exitCode(checks)).toBe(2);
  });

  it('requires a recent successful run and surfaces failure/stuck states', () => {
    expect(verifyRunEvidence({ latest_status: 'succeeded', recent_success: true }).status).toBe('pass');
    expect(verifyRunEvidence({ latest_status: 'succeeded', recent_success: false }).status).toBe('fail');
    expect(verifyRunEvidence({ latest_status: 'failed', recent_success: true }).status).toBe('fail');
    expect(verifyRunEvidence({ latest_status: 'running', running_recent: false, recent_success: true }).status).toBe('fail');
    expect(verifyRunEvidence({ latest_status: 'running', running_recent: true, recent_success: false }).status).toBe('unverified');
    expect(verifyRunEvidence({ latest_status: 'running', running_recent: true, recent_success: true }).status).toBe('pass');
    expect(verifyRunEvidence({ latest_status: 'unexpected secret', recent_success: true }).detail).not.toContain('secret');
  });

  it('passes database credentials only in env, disables startup files/prompts and encloses metadata SQL in a read-only transaction', () => {
    const uri = 'postgresql://user:secret@example.test/postgres';
    const runner = vi.fn(() => ({ status: 0, stdout: '{"cron_installed":true}', stderr: 'never print secret' }));
    expect(readDatabaseEvidence(uri, CORE_SQL, runner)).toEqual({ cron_installed: true });
    const [command, args, options] = runner.mock.calls[0];
    expect(command).toBe('psql');
    expect(args).toContain('-X');
    expect(args).toContain('--no-password');
    expect(args.join(' ')).not.toContain('secret');
    expect(options.env.PGDATABASE).toBe(uri);
    expect(options.input).toMatch(/^BEGIN READ ONLY;/);
    expect(options.input).toMatch(/ROLLBACK;\n$/);
    for (const query of [CORE_SQL, MIGRATION_SQL, JOB_SQL, RUN_SQL]) {
      expect(query).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|CALL)\b|SELECT\s+ops_private\.purge_operational_logs\(\)(?!;')/i);
      expect(query).not.toMatch(/return_message|SELECT\s+\*/i);
    }
    expect(() => readDatabaseEvidence(uri, CORE_SQL, () => ({ status: 1, stderr: 'secret' }))).toThrow('database evidence unavailable');
    expect(() => readDatabaseEvidence(uri, CORE_SQL, () => ({ status: 0, stdout: 'secret' }))).toThrow();
  });
});
