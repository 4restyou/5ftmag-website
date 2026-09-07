import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Opt-in network integration: real PDF.js + worker under the production CSP.
test('PDF CDN renders preview pages under CSP', async ({ page }, testInfo) => {
  test.skip(process.env.PDF_CDN_CHECK !== '1', 'Run with PDF_CDN_CHECK=1 for CDN integration');
  test.setTimeout(60000);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
  ];
  for (let i = 0; i < 3; i++) {
    const stream = `${i / 3} 0.3 0.7 rg 20 20 260 360 re f`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents ${4 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const csp = readFileSync('netlify.toml', 'utf8').match(/Content-Security-Policy = "([^"]+)"/)[1];
  const html = readFileSync('ebook-read.html', 'utf8');
  await page.route('**/ebook-read.html?*', route => route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': csp }, body: html }));
  await page.route('**/fixture.pdf', route => route.fulfill({ contentType: 'application/pdf', body: Buffer.from(pdf) }));
  await page.route('**/js/db-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/js/db/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.addInitScript(() => {
    window.MagDB = {
      isReady: () => true,
      ebooks: {
        get: async () => ({ published: true, title: 'Preview QA', price: 4000 }),
        getAccess: async () => ({ url: '/fixture.pdf', entitled: false }),
      },
    };
  });
  await page.goto('/ebook-read.html?slug=preview-qa');
  await expect(page.locator('[data-pageno]')).toHaveText('1 / 3', { timeout: 30000 });
  await expect(page.locator('.wz-reader canvas').first()).toBeVisible();
  await expect(page.locator('.wz-reader-cta-note')).toBeHidden();
  await expect(page.locator('#ebookRoot')).not.toContainText('불러오는 중');
  const colored = await page.locator('.wz-reader canvas').first().evaluate(canvas => {
    const [r, g, b, a] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return a > 0 && b > r && b > g;
  });
  expect(colored).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('preview-first.png') });
  await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
  await expect(page.locator('[data-pageno]')).toHaveText('2 / 3');
  if (testInfo.project.name.includes('mobile')) {
    await expect(page.locator('.wz-reader-cta-note')).toBeHidden();
    await page.getByRole('button', { name: '다음 페이지', exact: true }).click();
    await expect(page.locator('[data-pageno]')).toHaveText('3 / 3');
  }
  await expect(page.locator('.wz-reader-cta-note')).toBeVisible();
  const stage = await page.locator('.wz-reader-stage').boundingBox();
  const prompt = await page.locator('.wz-reader-cta-wrap').boundingBox();
  expect(stage.y + stage.height).toBeLessThanOrEqual(prompt.y + 1);
  await page.screenshot({ path: testInfo.outputPath('preview-last.png') });
});
