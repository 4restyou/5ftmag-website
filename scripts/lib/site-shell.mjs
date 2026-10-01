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

// 영문판(en/ 아래) 페이지인가. 영문 페이지의 셸은 영문판이 있는 곳은 en/ 쪽으로, 없는 곳(장터·구매 등)은
// 한국어판으로 잇고, 발행처 줄도 영문으로 쓴다.
export function isEnFile(file) {
  return path.relative(ROOT, path.resolve(file)).split(path.sep)[0] === 'en';
}

function resolveTarget(file, target) {
  if (isEnFile(file) && fs.existsSync(path.join(ROOT, 'en', target))) return path.join('en', target);
  return target;
}

function hrefFrom(file, target) {
  const resolved = resolveTarget(file, target);
  // 모든 페이지에 <base href="/"> 가 있어 상대경로는 루트(한국어판) 기준으로 풀린다. 영문 페이지는 절대경로로 쓴다
  if (isEnFile(file)) return '/' + resolved.split(path.sep).join('/');
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
  return file && isEnFile(file) ? { ...shellConfig.footer, ...shellConfig.en.footer } : shellConfig.footer;
}

export function footerPublisherHtml(file) {
  return `<span class="footer-publisher">${footerText(file).publisher}</span>`;
}

export function footerCopyHtml(file) {
  return `<span class="footer-copy">${footerText(file).copyright}</span>`;
}

// 한·영 두 판이 다 있는 페이지의 언어 대응 링크(hreflang). 영문판 공개 전(en.publish=false)에는 비운다.
// js/site-common.js 는 이 링크가 있는 페이지에만 KO/EN 전환을 띄운다.
function canonicalOf(file) {
  const m = fs.readFileSync(file, 'utf8').match(/<link rel="canonical" href="([^"]+)"/);
  return m && m[1];
}

export function alternatesHtml(file) {
  if (!shellConfig.en?.publish) return '';
  const rel = path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
  const koRel = isEnFile(file) ? rel.slice(3) : rel;
  const koFile = path.join(ROOT, koRel), enFile = path.join(ROOT, 'en', koRel);
  if (!fs.existsSync(koFile) || !fs.existsSync(enFile)) return '';
  const ko = canonicalOf(koFile), en = canonicalOf(enFile);
  if (!ko || !en) return '';
  return [
    `<link rel="alternate" hreflang="ko" href="${ko}">`,
    `<link rel="alternate" hreflang="en" href="${en}">`,
    `<link rel="alternate" hreflang="x-default" href="${ko}">`,
  ].map((l) => `  ${l}`).join('\n');
}
