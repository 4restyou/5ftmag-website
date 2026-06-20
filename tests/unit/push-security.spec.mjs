import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const edge = readFileSync('supabase/functions/send-push/index.ts', 'utf8');
const worker = readFileSync('sw.js', 'utf8');
const migration = readFileSync('supabase/migrations/20260620000001_push_dispatch_harden.sql', 'utf8');

describe('push dispatch security', () => {
  it('fails closed when the dispatch secret is missing', () => {
    expect(edge).toContain("if (!DISPATCH_SECRET) return jsonResp({ error: 'dispatch unavailable' }, 503)");
    expect(migration).toMatch(/secret IS NULL OR secret = ''/);
  });

  it('normalizes notification links to same-origin paths twice', () => {
    expect(edge).toContain("if (!raw.startsWith('/') || raw.startsWith('//')) return '/'");
    expect(edge).toContain("parsed.origin !== 'https://www.5ftmag.com'");
    expect(worker).toContain('url.origin !== self.location.origin');
    expect(worker).toContain('normalizeNotificationLink(event.notification.data?.link)');
  });
});
