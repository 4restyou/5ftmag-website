# Magazine Reading Performance

Updated: 2026-10-06

## Scope

- Preserve scroll poses, the 550 ms opening handoff and the 560 ms page flip.
- Keep descriptions in normal flow, and keep the previous opening-overlap fix.
- Measure library loading, server access checks, PDF loading, layout setup, first visible page rendering and opening handoff separately.
- Save the last book/page locally, without saving PDF URLs, signed tokens or account IDs.
- Do not modify pricing, entitlements, payment configuration or Storage access policies.

## Findings

The current catalog contains 22 free PDFs and four private full/preview PDFs. They total 670,331,400 bytes and 3,856 pages. All servers support byte ranges; the free PDFs and both paid full PDFs are already linearized. The two previews are not.

Lossless qpdf rewriting produced 652,556,357 bytes in total (2.65% smaller). Every page's geometry, text, 72 dpi pixels and extracted original-resolution image bytes match. First/middle/last pages additionally match at 160 dpi. This is a candidate set, not a claim that all files should be replaced.

A first-page benchmark with real PDF.js/PageFlip, warm libraries, fresh browser contexts, 60 ms latency and 32 KiB per 4 ms transfers found that forcing `disableStream` plus `disableAutoFetch` reduced bytes but increased preparation time. The production reader therefore retains PDF.js's default streaming/range behavior. This local controlled benchmark is not a production speed guarantee.

Already-linearized originals with less than 1% savings are retained. Other candidates require three original/optimized comparisons; a candidate whose median first-page time regresses by more than 5% is retained as an original too. This avoids trading a smaller file for slower first use.

Publication selected 11 files: Vol.01, 02, 08, 13, 15, 17, 18, 19, 20, 21 and SPC Issue 01's private full PDF. Ten originals had less than 1% savings; five other originals (Vol.14, 16, 22 and both previews) were retained because the first-page benchmark regressed. For example, the controlled median improved from 1,829 to 1,658 ms for Vol.18 and 673 to 605 ms for Vol.17. Other selected files were close to their original timing; no claim is made that every book opens faster.

## Reading Progress

- Storage key: `5ft-book-progress-v1`; up to 50 records, retained for 180 days on the current browser/device.
- Keys separate free books, paid full editions and previews.
- Resume only if page count and available document fingerprints match.
- Render both visible pages of a resumed desktop spread before revealing the reader.
- `Continue` replaces the read action when a saved page exists. A plain `Read from the beginning` command is available in details and the reader toolbar.
- `Last read` in the shelf intro opens the appropriate introduction, not a reader without warning.
- Closing refreshes the shelf labels. Corrupt/blocked storage does not prevent reading.
- A revealed reader freezes background detail selection; resizing preserves the same book instead of cancelling reading through a background scroll change.
- Local records never grant access: each paid open still requests an authorized URL from the server, and that server result selects the full/preview history namespace.

## Operations

Use an authenticated Supabase CLI session on an authorized operator machine. The script keeps operations credentials in memory and never writes them into reports.

```sh
node scripts/books-pdf-optimize.mjs --audit /absolute/private/report-dir
PDF_QA_PYTHON=/path/to/python-with-pymupdf node scripts/books-pdf-optimize.mjs --prepare /absolute/private/report-dir
BOOK_PDF_BENCH_DIR=/absolute/private/report-dir BOOK_PDF_CANDIDATES=1 npx playwright test tests/books-pdf-performance.spec.js --project=chromium-desktop --workers=1
node scripts/books-pdf-optimize.mjs --publish /absolute/private/report-dir
```

Preparation is local only. Publication requires a matching catalog, unchanged original hash, verified visual/image equivalence, matching benchmark hashes and verified backup. Originals are copied to a hash-qualified filename **inside the same bucket**, keeping paid files private. The manifest journals backup and publication state. The uploaded hash and linearized range response are checked afterward. No catalog rows or access policies change.

To restore a replaced PDF, use its manifest `backup` object from the same bucket to overwrite the original `path`, then verify `originalHash`. Never change a private object to public for testing. Do not commit downloaded books, rendered images or the operational manifest.

## Sources

- [PDF.js loading options](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [qpdf structural transformations](https://qpdf.readthedocs.io/en/stable/cli.html)
- [PageFlip startPage](https://nodlik.github.io/StPageFlip/docs/interfaces/flipsetting.html)
