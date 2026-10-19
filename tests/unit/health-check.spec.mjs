import { describe, expect, it } from 'vitest';
import { evaluate } from '../../scripts/health-check.mjs';

const now = Date.parse('2026-10-20T00:10:00Z');
const ok = {
  '5ftmag-reader-auto-approve': '2026-10-20T00:00:05Z',
  '5ftmag-page-view-rollup-daily': '2026-10-19T02:47:10Z',
  '5ftmag-operational-retention-daily': '2026-10-19T03:17:20Z',
  overdue_auto_approvals: 0,
};

describe('health-check evaluate', () => {
  it('passes when every job ran recently', () => {
    expect(evaluate(ok, now)).toEqual([]);
  });
  it('flags a stalled job and overdue reservations', () => {
    const p = evaluate({ ...ok, '5ftmag-reader-auto-approve': '2026-10-19T20:00:00Z', overdue_auto_approvals: 3 }, now);
    expect(p.join('\n')).toMatch(/자동 승인\(10분마다\): 마지막 성공이 4\.2시간 전/);
    expect(p.join('\n')).toMatch(/3건이 기한을/);
  });
  it('flags missing cron history', () => {
    expect(evaluate({ overdue_auto_approvals: 0 }, now)).toHaveLength(3);
    expect(evaluate({ ...ok, '5ftmag-page-view-rollup-daily': null }, now)[0]).toMatch(/성공한 기록이 없습니다/);
  });
});
