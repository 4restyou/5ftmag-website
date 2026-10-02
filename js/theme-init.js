// 테마 첫 적용 — <head> 에서 동기로 돌아 깜빡임을 막는다.
// 사용자가 토글로 고른 값(5ftTheme)이 있으면 그것, 없으면 기기 설정(prefers-color-scheme)을 따른다.
document.documentElement.dataset.theme = localStorage.getItem('5ftTheme')
  || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
