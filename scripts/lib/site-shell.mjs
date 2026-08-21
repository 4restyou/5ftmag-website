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

function hrefFrom(file, target) {
  const rel = path.relative(path.dirname(file), path.join(ROOT, target)).split(path.sep).join('/');
  return rel || path.basename(target);
}

function isCurrent(file, target) {
  return path.resolve(file) === path.resolve(ROOT, target);
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

export function footerPublisherHtml() {
  return `<span class="footer-publisher">${shellConfig.footer.publisher}</span>`;
}

export function footerCopyHtml() {
  return `<span class="footer-copy">${shellConfig.footer.copyright}</span>`;
}
