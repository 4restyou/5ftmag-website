import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

function csp() {
  const toml = read('netlify.toml');
  const match = toml.match(/Content-Security-Policy = "([^"]+)"/);
  if (!match) throw new Error('Content-Security-Policy header not found');
  return match[1];
}

describe('security headers', () => {
  it('allows geolocation only for the same origin and preserves other restrictions', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain('geolocation=(self)');
    expect(toml).toContain('camera=(), microphone=()');
    expect(csp()).not.toContain("'unsafe-eval'");
    expect(csp()).not.toContain("'wasm-unsafe-eval'");
  });

  it('uses the existing refund page and redirects old links', () => {
    // 외국어판에선 i18n.url 이 /en/·/ja/ 의 같은 규정으로 잇는다
    expect(read('js/ebook-checkout.js')).toContain("i18n.url('/legal/refund.html')");
    expect(fs.existsSync('legal/refund.html')).toBe(true);
    expect(read('netlify.toml')).toMatch(/from = "\/refund\.html"\s+to = "\/legal\/refund\.html"\s+status = 301/);
  });
  it('keeps core CSP boundaries in place', () => {
    const header = csp();
    expect(header).toContain("default-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'self'");
    expect(header).toContain("form-action 'self'");
    expect(header).toContain("frame-ancestors 'self'");
    expect(header).toContain("script-src-attr 'none'");
    expect(header).toContain("worker-src 'self' blob:");
    expect(header).toContain("manifest-src 'self'");
    expect(header).toContain("media-src 'self' data: blob:");
    expect(header).toContain('upgrade-insecure-requests');
  });

  it('allows only the known external execution and telemetry origins', () => {
    const header = csp();
    expect(header).toContain('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/');
    expect(header).toContain('https://oapi.map.naver.com');
    expect(header).toContain('https://plausible.io');
    expect(header).toContain('https://js.sentry-cdn.com');
    expect(header).toContain('https://*.ingest.sentry.io');
    expect(header).toContain('https://api.github.com');
  });

  it('documents why inline script/style are still temporarily allowed', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain("script-src 의 'unsafe-inline'");
    expect(toml).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp()).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('opens jsdelivr only for the package paths the site loads', () => {
    const header = csp();
    const directive = (name) => header.split(';').map(d => d.trim()).find(d => d.startsWith(name + ' ')) || '';
    const jsd = (d) => directive(d).split(/\s+/).filter(src => src.includes('cdn.jsdelivr.net'));
    // 호스트 전체(https://cdn.jsdelivr.net 또는 끝 슬래시)를 여는 항목이 없어야 한다
    for (const d of ['script-src', 'style-src', 'font-src']) {
      for (const src of jsd(d)) expect(src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/(npm|gh)\/.+\/$/);
    }
    expect(jsd('script-src').sort()).toEqual([
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/',
      'https://cdn.jsdelivr.net/npm/lenis@1.1.20/',
      'https://cdn.jsdelivr.net/npm/page-flip@2.0.7/',
      'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/',
      'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/',
    ]);
    expect(jsd('style-src')).toEqual(['https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/']);
    expect(jsd('font-src')).toEqual(['https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/']);
  });

  it('every jsdelivr script the site references is covered by script-src', () => {
    const allowed = csp().split(';').map(d => d.trim()).find(d => d.startsWith('script-src ')).split(/\s+/);
    const files = ['js/webzine-reader.js', 'js/reader-submissions.js', 'films.html', 'admin/ebooks.html', 'books-classic.html', 'index.html'];
    for (const f of files) {
      for (const url of read(f).match(/https:\/\/cdn\.jsdelivr\.net\/[^'"`\s)]+/g) || []) {
        expect(allowed.some(a => a.endsWith('/') && url.startsWith(a)), `${f}: ${url}`).toBe(true);
      }
    }
  });

  it('does not serve repository internals (publish = ".")', () => {
    const toml = read('netlify.toml');
    const blocked = [
      '/CLAUDE.md', '/README.md', '/COMMENTS_SETUP.md', '/CONTENT_GUIDE.md', '/OPERATIONS.md',
      '/docs/*', '/db/*', '/supabase/*', '/scripts/*', '/tests/*', '/relay/*', '/netlify/*',
      '/.claude/*', '/.github/*', '/node_modules/*',
      '/package.json', '/package-lock.json', '/netlify.toml', '/playwright.config.js', '/vitest.config.mjs',
    ];
    for (const from of blocked) {
      const esc = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      expect(toml, from).toMatch(new RegExp(`from = "${esc}"\\s+to = "[^"]+"\\s+status = 404\\s+force = true`));
    }
    // 루트의 .md 파일이 새로 생겨도 막히는지(목록에 빠진 파일이 없는지) 확인한다
    for (const f of fs.readdirSync('.').filter(n => n.endsWith('.md'))) {
      expect(toml, f).toContain(`from = "/${f}"`);
    }
    // 404 규칙이 공개 파일을 덮지 않는다
    for (const pub of ['/data/*', '/llms.txt', '/rss.xml', '/sitemap.xml', '/manifest.webmanifest', '/sw.js', '/robots.txt']) {
      expect(toml).not.toContain(`from = "${pub}"`);
    }
  });
});
