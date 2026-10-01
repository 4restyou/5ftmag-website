// 영문 페이지에 남은 한국어 찾기(scripts/en-check.mjs, tests/unit/en-site.spec.mjs 가 같이 쓴다).
//
// 세지 않는 곳: HTML·CSS 주석, <script> 안(JSON-LD 는 센다), data-author 속성(작가 매칭 키),
// 원제를 밝히는 괄호·홑화살괄호 안(《충돌과 반동》 (충돌과 반동) 처럼 원어를 병기한 자리).

export function leftoverKorean(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m) => m.replace(/\/\*[\s\S]*?\*\//g, ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => (/application\/ld\+json/.test(m) ? m : ''))
    .replace(/\sdata-author="[^"]*"/g, '')
    .replace(/[(（][^()（）]*[가-힣][^()（）]*[)）]/g, '')
    .replace(/[《〈「『][^》〉」』]*[》〉」』]/g, '');
  return text.split('\n').map((line, i) => ({ line: i + 1, text: line.trim() })).filter((l) => /[가-힣]/.test(l.text));
}
