#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stories = JSON.parse(fs.readFileSync(path.join(root, 'data/stories.json'), 'utf8'));
const theme = JSON.parse(fs.readFileSync(path.join(root, 'data/current-theme.json'), 'utf8'));
const now = Date.now();
const published = stories.filter(item => item && item.published !== false && item.date)
  .sort((a, b) => new Date(b.date) - new Date(a.date));
const inDays = days => published.filter(item => now - new Date(item.date).getTime() <= days * 86400000);
const categoryCounts = new Map();
for (const item of inDays(90)) {
  const category = item.categoryLabel || item.category || '기타';
  categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
}
const latest = published[0];
const latestAge = latest ? Math.max(0, Math.floor((now - new Date(latest.date).getTime()) / 86400000)) : null;

console.log('콘텐츠 운영 건강도');
console.log(`  최근 글: ${latest ? `${latest.title} (${latestAge}일 전)` : '없음'}`);
console.log(`  최근 30일 ${inDays(30).length}편 / 60일 ${inDays(60).length}편 / 전체 ${published.length}편`);
console.log(`  최근 90일 주제 분포: ${[...categoryCounts].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
console.log(`  현재 호 참여 안내: ${theme?.active ? `${theme.issue || '다음 호'} · ${theme.title || '제목 없음'}` : '비활성'}`);

// 발행 주기를 약속하지 않는 운영 원칙상 CI 실패 조건으로 사용하지 않는다.
// 대신 45일 이상 새 글이 없으면 운영자가 볼 수 있는 명확한 신호를 출력한다.
if (latestAge != null && latestAge >= 45) {
  console.warn('  ⚠ 새 글이 45일 이상 없습니다. 기존 글 재발견 편집 또는 짧은 소식 발행을 검토하세요.');
}
