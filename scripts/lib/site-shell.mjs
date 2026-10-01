// 공통 내비게이션·푸터 마크업 생성기.
//
// 기존 페이지에 주입하는 sync-site-shell.mjs 와, 페이지를 새로 찍어내는
// build-film-pages.mjs 가 같은 마크업을 쓰도록 한곳에 모아 둔다.
// data/site-shell.json 이 유일한 원본이므로 여기서만 읽는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const shellConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/site-shell.json'), 'utf8'),
);

// 외국어판 디렉터리. 각 언어 페이지는 en/·ja/ 아래에 한국어판과 같은 경로로 둔다.
export const LANGS = ['en', 'ja'];

// 파일이 어느 언어판인가('ko' | 'en' | 'ja').
export function langOf(file) {
  const top = path.relative(ROOT, path.resolve(file)).split(path.sep)[0];
  return LANGS.includes(top) ? top : 'ko';
}

// 영문판(en/ 아래) 페이지인가.
export function isEnFile(file) {
  return langOf(file) === 'en';
}

// 외국어 페이지의 셸은 그 언어판이 있는 곳은 그쪽으로, 없는 곳은 한국어판으로 잇고, 발행처 줄도 그 언어로 쓴다.
function resolveTarget(file, target) {
  const lang = langOf(file);
  if (lang !== 'ko' && fs.existsSync(path.join(ROOT, lang, target))) return path.join(lang, target);
  return target;
}

function hrefFrom(file, target) {
  const resolved = resolveTarget(file, target);
  // 모든 페이지에 <base href="/"> 가 있어 상대경로는 루트(한국어판) 기준으로 풀린다. 외국어 페이지는 절대경로로 쓴다
  if (langOf(file) !== 'ko') return '/' + resolved.split(path.sep).join('/');
  const rel = path.relative(path.dirname(file), path.join(ROOT, resolved)).split(path.sep).join('/');
  return rel || path.basename(resolved);
}

function isCurrent(file, target) {
  return path.resolve(file) === path.resolve(ROOT, resolveTarget(file, target));
}

export function navHtml(file) {
  const links = shellConfig.navigation.map((item) => {
    const current = isCurrent(file, item.path) ? ' class="current"' : '';
    return `      <li><a href="${hrefFrom(file, item.path)}"${current}>${item.label}</a></li>`;
  }).join('\n');
  return `<ul class="main-nav">\n${links}\n    </ul>`;
}

export function mobileNavHtml(file) {
  const links = shellConfig.navigation.map((item) => {
    const current = isCurrent(file, item.path) ? ' class="current"' : '';
    return `    <a href="${hrefFrom(file, item.path)}"${current}>${item.label}</a>`;
  }).join('\n');
  return `<nav class="mobile-nav" id="mobileNav">\n${links}\n  </nav>`;
}

export function footerHtml(file) {
  const links = shellConfig.footerLinks.map((item) => {
    const href = item.path ? hrefFrom(file, item.path) : item.href;
    const external = item.external ? ' target="_blank" rel="noopener"' : '';
    return `    <a href="${href}"${external}>${item.label}</a>`;
  }).join('\n');
  return `<div class="footer-links">\n${links}\n  </div>`;
}

function footerText(file) {
  const lang = file ? langOf(file) : 'ko';
  return lang === 'ko' ? shellConfig.footer : { ...shellConfig.footer, ...shellConfig[lang]?.footer };
}

export function footerPublisherHtml(file) {
  return `<span class="footer-publisher">${footerText(file).publisher}</span>`;
}

export function footerCopyHtml(file) {
  return `<span class="footer-copy">${footerText(file).copyright}</span>`;
}

// 같은 페이지의 다른 언어판 링크(hreflang). 공개한 언어(<lang>.publish=true)만 넣고, 짝이 하나도 없으면 비운다.
// js/site-common.js 는 이 링크가 있는 페이지에만 언어 메뉴를 띄운다.
function canonicalOf(file) {
  const m = fs.readFileSync(file, 'utf8').match(/<link rel="canonical" href="([^"]+)"/);
  return m && m[1];
}

export function alternatesHtml(file) {
  const rel = path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
  const lang = langOf(file);
  const koRel = lang === 'ko' ? rel : rel.slice(lang.length + 1);
  const koFile = path.join(ROOT, koRel);
  // 공개 전인 언어의 페이지도 자기 자신과 공개된 언어판으로는 잇는다(미리 보며 확인할 수 있게)
  const langs = LANGS.filter((l) => shellConfig[l]?.publish || l === lang);
  const found = langs
    .map((l) => ({ l, f: path.join(ROOT, l, koRel) }))
    .filter(({ f }) => fs.existsSync(f))
    .map(({ l, f }) => ({ l, href: canonicalOf(f) }))
    .filter((x) => x.href);
  if (!fs.existsSync(koFile) || !found.length) return '';
  const ko = canonicalOf(koFile);
  if (!ko) return '';
  return [
    `<link rel="alternate" hreflang="ko" href="${ko}">`,
    ...found.map(({ l, href }) => `<link rel="alternate" hreflang="${l}" href="${href}">`),
    `<link rel="alternate" hreflang="x-default" href="${ko}">`,
  ].map((l) => `  ${l}`).join('\n');
}
