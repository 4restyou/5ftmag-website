// 생성 스크립트가 자산 캐시버스트 버전(?v=)을 알아내는 방법.
//
// 생성기 안에 버전을 하드코딩하면 bump-version.mjs 로 버전을 올려도 생성기는
// 모른 채 옛 버전을 다시 써 버린다. 실제로 build-authors.mjs 가 그렇게 동작해서
// 저자 페이지 11개만 옛 버전에 묶여 있었다. 손으로 관리하는 페이지에서 읽어 온다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './site-shell.mjs';

// 손으로 관리하는 페이지라 bump-version 이 올린 최신 버전을 들고 있다.
// 여러 개를 주면 앞에서부터 찾아 처음 발견한 버전을 쓴다. 자산에 따라 참조하는
// 페이지가 다르기 때문이다(예: css/authors.css 는 index.html 에 없다).
const DEFAULT_REFERENCES = ['index.html'];

export function assetVersions(referencePages = DEFAULT_REFERENCES) {
  const pages = (Array.isArray(referencePages) ? referencePages : [referencePages])
    .map((page) => path.join(ROOT, page))
    .filter((full) => fs.existsSync(full))
    .map((full) => fs.readFileSync(full, 'utf8'));
  return function versionOf(assetPath) {
    const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}(\\?v=[0-9a-z-]+)?`);
    for (const html of pages) {
      const found = html.match(pattern);
      if (found?.[1]) return found[1];
    }
    return '';
  };
}

// 다른 HTML 이 참조하지 않는 자산은 bump-version 의 관리 대상이 아니다.
// 그런 파일은 내용 해시를 버전으로 쓴다.
export function hashVersion(relPath) {
  const buf = fs.readFileSync(path.join(ROOT, relPath));
  return `?v=${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)}`;
}
