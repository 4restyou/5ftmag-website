'use strict';

// 기사 라벨(categoryLabel) → Articles 필터 칸(category). 기사 목록·관리 에디터·자산 검증이 같은 표를 쓴다.
// 새 라벨을 쓰려면 여기에 먼저 넣고, 새 칸이면 stories.html 에 칩도 만든다.
// 표에 없는 라벨이나 칩이 없는 칸은 scripts/validate-assets.mjs 가 CI 에서 막는다.
(function (root) {
  const LABEL_TO_KEY = {
    'PHOTO': 'photo',
    'PHOTOBOOK': 'photo',
    'ESSAY': 'essay',
    'PHOTOGRAPHER': 'photographer',
    'FILM': 'film',
    'FILM STORY': 'film',
    'CINEMA': 'cinema',
    'CAMERA': 'camera',
    'INTERVIEW': 'interview',
    'GOODS': 'goods',
    'EXHIBITION': 'exhibition',
    'FEEL:TOON': 'illustration',
    'ILLUSTRATION': 'illustration',
    'EDITORIAL': 'editorial',
    'FEATURE': 'editorial',
  };
  function normLabel(label) { return String(label || '').trim().toUpperCase(); }
  // 라벨이 표에 있으면 그 칸, 없으면 저장된 category, 그것도 없으면 editorial
  function keyFor(story) {
    const k = LABEL_TO_KEY[normLabel(story && story.categoryLabel)];
    return k || String((story && story.category) || '').toLowerCase() || 'editorial';
  }
  const api = { LABEL_TO_KEY, normLabel, keyFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StoryCategories = api;
})(typeof window !== 'undefined' ? window : this);
