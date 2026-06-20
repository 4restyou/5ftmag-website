// DB 계약 안전망:
// 클라이언트(js/*.js)가 .from()/.rpc() 로 참조하는 객체 중 마이그레이션에도
// 없고 KNOWN_BASE_OBJECTS 에도 없는 "신규 drift" 가 있으면 실패한다.
//
// 누군가 새 테이블/뷰/RPC 를 클라이언트에 추가하면서 마이그레이션을 빠뜨리면
// (2026-06 profiles_public / messages 사고처럼) 이 테스트가 PR 시점에 잡는다.
// 의도적으로 추적 안 된 객체를 추가할 땐 scripts/db-audit.mjs 의
// KNOWN_BASE_OBJECTS 에 등재 (prod 존재 확인 후).

import { describe, it, expect } from 'vitest';
import { audit } from '../../scripts/db-audit.mjs';

describe('DB 계약 (클라이언트 ↔ 마이그레이션)', () => {
  const result = audit();

  it('신규 drift 가 없다 (마이그레이션 누락된 새 객체)', () => {
    const names = result.newDrift.map((d) => `${d.name} (${d.files.join(', ')})`);
    expect(names, `신규 drift:\n${names.join('\n')}`).toEqual([]);
  });

  it('클라이언트가 참조하는 객체를 실제로 수집한다 (회귀 가드)', () => {
    expect(result.counts.tables).toBeGreaterThan(10);
    expect(result.counts.rpcs).toBeGreaterThan(10);
  });
});
