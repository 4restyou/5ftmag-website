#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/site-shell.json'), 'utf8'));
const check = process.argv.includes('--check');
const changed = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'playwright-report', 'test-results'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function hrefFrom(file, target) {
  const rel = path.relative(path.dirname(file), path.join(root, target)).split(path.sep).join('/');
  return rel || path.basename(target);
}

function isCurrent(file, target) {
  return path.resolve(file) === path.resolve(root, target);
}

function navHtml(file) {
  const links = config.navigation.map(item => {
    const current = isCurrent(file, item.path) ? ' class="current"' : '';
    return `      <li><a href="${hrefFrom(file, item.path)}"${current}>${item.label}</a></li>`;
  }).join('\n');
  return `<ul class="main-nav">\n${links}\n    </ul>`;
}

function mobileNavHtml(file) {
  const links = config.navigation.map(item => {
    const current = isCurrent(file, item.path) ? ' class="current"' : '';
    return `    <a href="${hrefFrom(file, item.path)}"${current}>${item.label}</a>`;
  }).join('\n');
  return `<nav class="mobile-nav" id="mobileNav">\n${links}\n  </nav>`;
}

function footerHtml(file) {
  const links = config.footerLinks.map(item => {
    const href = item.path ? hrefFrom(file, item.path) : item.href;
    const external = item.external ? ' target="_blank" rel="noopener"' : '';
    return `    <a href="${href}"${external}>${item.label}</a>`;
  }).join('\n');
  return `<div class="footer-links">\n${links}\n  </div>`;
}

for (const file of walk(root)) {
  let source = fs.readFileSync(file, 'utf8');
  let next = source;
  if (/<ul class="main-nav">[\s\S]*?<\/ul>/.test(next)) {
    next = next.replace(/<ul class="main-nav">[\s\S]*?<\/ul>/, navHtml(file));
  }
  if (/<nav class="mobile-nav" id="mobileNav">[\s\S]*?<\/nav>/.test(next)) {
    next = next.replace(/<nav class="mobile-nav" id="mobileNav">[\s\S]*?<\/nav>/, mobileNavHtml(file));
  }
  if (/<div class="footer-links">[\s\S]*?<\/div>/.test(next)) {
    next = next.replace(/<div class="footer-links">[\s\S]*?<\/div>/, footerHtml(file));
  }
  if (next !== source) {
    changed.push(path.relative(root, file));
    if (!check) fs.writeFileSync(file, next);
  }
}

if (check && changed.length) {
  console.error(`공통 셸 불일치 ${changed.length}개. npm run shell:sync를 실행하세요.`);
  changed.slice(0, 20).forEach(file => console.error(`  ${file}`));
  process.exit(1);
}
console.log(check ? '✓ 공통 내비게이션·푸터 동기화' : `✓ 공통 셸 갱신 (${changed.length}개 파일)`);
