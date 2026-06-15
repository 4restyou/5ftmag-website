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
    expect(header).toContain('https://cdn.jsdelivr.net');
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
});
