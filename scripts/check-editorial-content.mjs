#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const STORY_ID = 'oct-2026-exhibitions';
export const LANGUAGES = ['ko', 'en', 'ja'];
export const EXHIBITION_IDS = [
  'jeong-bongchae', 'lee-juhyung', 'photo-cinema', 'yoo-seungho', 'martin-parr',
  'yuhwajeong', 'still-chubby', 'daegu-biennale', 'photo-jinju', 'jaime-permuth',
  'miners-life', 'photo-world', 'deborah-turbeville', 'roger-ballen', 'min-byunghun', 'lee-inmi',
];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.5ftmag.com';
const articlePath = lang => `${lang === 'ko' ? '' : lang + '/'}stories/${STORY_ID}.html`;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const text = node => node?.textContent.trim() || '';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// The existing articles use dotted dates, with a month-only Roger Ballen end date.
function articleDate(value) {
  if (value === 'February 2027') return '2027-02';
  const pieces = value.split('.');
  const year = pieces[0]?.length === 4 ? pieces.shift() : '2026';
  return [year, ...pieces.map(piece => piece.padStart(2, '0'))].join('-');
}

function period(value) {
  const match = value.match(/((?:\d{4}\.)?\d{1,2}\.\d{1,2})\s*[–-]\s*(February 2027|(?:\d{4}\.)?\d{1,2}(?:\.\d{1,2})?)/);
  return match ? [articleDate(match[1]), articleDate(match[2])] : null;
}

function venue(value) {
  return value.replace(/\([^)]*\)|（[^）]*）/g, '').replace(/\s+/g, '').replace(/[.。]$/, '');
}

function infoLine(node) {
  let line = '';
  let breaks = 0;
  for (const child of node?.childNodes || []) {
    if (child.nodeName === 'BR') {
      if (++breaks === 2) break;
    } else if (breaks === 1) line += child.textContent;
  }
  return line.trim();
}

export function readEditorialInputs(root = ROOT) {
  return {
    articles: Object.fromEntries(LANGUAGES.map(lang => [lang, readFileSync(path.join(root, articlePath(lang)), 'utf8')])),
    ledger: JSON.parse(readFileSync(path.join(root, 'data/editorial-assets.json'), 'utf8')),
    catalogItem: JSON.parse(readFileSync(path.join(root, 'data/stories.json'), 'utf8')).find(item => item.id === STORY_ID),
  };
}

export function checkEditorialContent({ articles, ledger, catalogItem, root = ROOT }) {
  const errors = [];
  const warnings = [];
  const fail = message => errors.push(message);
  const files = new Map();
  const assets = new Map();
  const snapshots = {};
  const withinRoot = file => typeof file === 'string' && !path.isAbsolute(file) &&
    !path.relative(root, path.resolve(root, file)).startsWith('..');
  const fileExists = file => withinRoot(file) && existsSync(path.join(root, file));

  if (ledger?.schemaVersion !== 1 || ledger?.storyId !== STORY_ID || !Array.isArray(ledger?.assets)) {
    fail('Ledger: invalid schemaVersion, storyId or assets array');
  }
  if (!isoDay(ledger?.auditDate) || !nonempty(ledger?.auditBasis)) fail('Ledger: audit date and basis are required');
  if (!catalogItem || catalogItem.page !== articlePath('ko')) fail('Catalog: missing October article or page mismatch');

  for (const asset of Array.isArray(ledger?.assets) ? ledger.assets : []) {
    const label = `Asset ${asset?.id || '(missing id)'}`;
    if (!EXHIBITION_IDS.includes(asset?.id) || assets.has(asset?.id)) fail(`${label}: invalid or duplicate id`);
    assets.set(asset?.id, asset);
    if (!nonempty(asset?.subject)) fail(`${label}: subject is required`);
    for (const field of ['creator', 'acquisition']) {
      if (asset?.[field] !== null && !nonempty(asset?.[field])) fail(`${label}: ${field} must be recorded or explicitly null`);
    }
    if (!nonempty(asset?.source?.name) || asset?.source?.status !== 'credited-only' || !nonempty(asset?.source?.note)) {
      fail(`${label}: source credit, status and limits of evidence are required`);
    }
    if (asset?.source?.url !== null && !/^https:\/\//.test(asset?.source?.url || '')) fail(`${label}: source URL must be HTTPS or null`);
    if (asset?.reviewed?.source !== true || asset?.reviewed?.use !== true) fail(`${label}: source/use reviewed flags must both be true`);
    if (!['unknown', 'confirmed'].includes(asset?.use?.status) || !nonempty(asset?.use?.note)) fail(`${label}: use status and note are required`);
    if (asset?.use?.status === 'confirmed' && (!nonempty(asset.use.evidence) || !nonempty(asset.use.scope))) {
      fail(`${label}: confirmed use requires evidence and scope`);
    }
    if (asset?.use?.status === 'unknown') {
      if (asset.use.evidence !== null || asset.use.scope !== null) fail(`${label}: unknown use must keep evidence and scope explicitly null`);
      warnings.push(`${label}: use basis unknown; reviewed does not mean permission`);
    }
    for (const lang of LANGUAGES) {
      if (!nonempty(asset?.captionCredits?.[lang])) fail(`${label}: missing ${lang} caption credit`);
    }
    if (!Array.isArray(asset?.files) || !asset.files.length) fail(`${label}: files are required`);
    for (const file of Array.isArray(asset?.files) ? asset.files : []) {
      if (!fileExists(file) || !file.startsWith(`img/stories/${STORY_ID}/`)) fail(`${label}: missing or out-of-scope file ${file}`);
      if (files.has(file)) fail(`${label}: duplicate asset file ${file}`);
      files.set(file, asset);
    }
  }

  for (const lang of LANGUAGES) {
    const label = `${lang} article`;
    if (!nonempty(articles?.[lang])) { fail(`${label}: missing HTML`); continue; }
    const canonical = `${ORIGIN}/${articlePath(lang)}`;
    const dom = new JSDOM(articles[lang], { url: canonical });
    const doc = dom.window.document;
    try {
      if (doc.documentElement.lang !== lang) fail(`${label}: HTML language mismatch`);
      const ids = [...doc.querySelectorAll('[id]')].map(node => node.id);
      if (new Set(ids).size !== ids.length) fail(`${label}: duplicate HTML ids`);
      const metadata = JSON.parse(doc.querySelector('script[type="application/ld+json"]')?.textContent || 'null');
      if (metadata?.['@type'] !== 'NewsArticle') fail(`${label}: NewsArticle metadata missing`);
      if (metadata?.datePublished !== catalogItem?.date || !isoDay(metadata?.datePublished) ||
          !isoDay(metadata?.dateModified) || metadata.dateModified < metadata.datePublished) fail(`${label}: publication/modification date mismatch`);
      if (text(doc.querySelector('.article-author .date')) !== metadata?.datePublished?.replaceAll('-', '.')) fail(`${label}: displayed publication date mismatch`);
      if (metadata?.articleSection !== catalogItem?.categoryLabel || catalogItem?.category !== 'exhibition' ||
          !same([...doc.querySelectorAll('.article-meta .article-tag')].map(text), [catalogItem?.categoryLabel, '2026 / 10'])) fail(`${label}: category/month mismatch`);
      if (metadata?.inLanguage?.split('-')[0] !== lang) fail(`${label}: metadata language mismatch`);
      if (doc.querySelector('link[rel="canonical"]')?.href !== canonical ||
          doc.querySelector('meta[property="og:url"]')?.content !== canonical ||
          metadata?.mainEntityOfPage?.['@id'] !== canonical) fail(`${label}: canonical article identity mismatch`);
      if (doc.querySelector('[data-comments]')?.getAttribute('data-page-id') !== `stories/${STORY_ID}`) fail(`${label}: comments article identity mismatch`);
      for (const language of [...LANGUAGES, 'x-default']) {
        if (doc.querySelector(`link[hreflang="${language}"]`)?.href !== `${ORIGIN}/${articlePath(language === 'x-default' ? 'ko' : language)}`) fail(`${label}: ${language} alternate link mismatch`);
      }

      const summary = doc.querySelector('.article-body details.exhibition-summary');
      const nav = summary?.querySelector('nav');
      if (!nonempty(text(summary?.querySelector('summary'))) || !nonempty(nav?.getAttribute('aria-label'))) fail(`${label}: named native summary/navigation missing`);
      const entries = [...(nav?.querySelectorAll('ol > li') || [])];
      const jumpIds = [];
      const periods = [];
      for (const entry of entries) {
        const link = entry.querySelector('a');
        const url = link && new URL(link.href);
        const id = url?.hash.slice(1);
        jumpIds.push(id);
        const target = id && doc.getElementById(id);
        if (!text(link) || url?.origin !== ORIGIN || url?.pathname !== `/${articlePath(lang)}` || !target || !target.closest('.article-body') || target.getAttribute('tabindex') !== '-1') fail(`${label}: invalid/focus-inaccessible jump ${id || '(missing)'}`);
        const dates = [...entry.querySelectorAll('time')];
        const values = dates.map(node => node.getAttribute('datetime'));
        if (!isoDay(values[0]) || !(isoDay(values[1]) || /^\d{4}-(0[1-9]|1[0-2])$/.test(values[1] || '')) || values[1] < values[0]) fail(`${label}: invalid date range for ${id}`);
        if (dates.length !== 2 || !same(dates.map(node => articleDate(text(node))), values) || !same(period(infoLine(target)), values)) fail(`${label}: summary/body dates differ for ${id}`);
        if (!same(period(entry.textContent), values)) fail(`${label}: visible summary dates differ for ${id}`);
        let summaryVenue = '';
        for (let node = dates[1]?.nextSibling; node; node = node.nextSibling) summaryVenue += node.textContent;
        const bodyVenue = infoLine(target).split(/(?:\d{4}\.)?\d{1,2}\.\d{1,2}/)[0];
        if (!bodyVenue || venue(summaryVenue.replace(/^\s*·\s*/, '')) !== venue(bodyVenue)) fail(`${label}: summary/body venue differs for ${id}`);
        periods.push(values);
      }
      if (!same(jumpIds, EXHIBITION_IDS)) fail(`${label}: exhibition ids/order mismatch`);
      const bodyIds = [...doc.querySelectorAll('.article-body > p[id]')].map(node => node.id);
      if (!same(bodyIds, EXHIBITION_IDS)) fail(`${label}: body exhibition ids/order mismatch`);

      const links = [];
      for (const link of doc.querySelectorAll('.article-body a[href]')) {
        const url = new URL(link.href);
        if (url.origin === ORIGIN) {
          if (!fileExists(url.pathname.slice(1))) fail(`${label}: broken internal link ${url.pathname}`);
          const expectedPrefix = lang === 'ko' ? '/stories/' : `/${lang}/stories/`;
          if (!url.pathname.startsWith(expectedPrefix)) fail(`${label}: wrong-language internal link ${url.pathname}`);
          if (url.hash && url.pathname === `/${articlePath(lang)}` && !doc.getElementById(url.hash.slice(1))) fail(`${label}: missing fragment ${url.hash}`);
          links.push(url.pathname.replace(/^\/(en|ja)\//, '/') + url.search + url.hash);
        } else {
          if (url.protocol !== 'https:') fail(`${label}: external source must use HTTPS`);
          if (link.target === '_blank' && !link.relList.contains('noopener')) fail(`${label}: new-tab source needs noopener`);
          links.push(url.href);
        }
      }
      const imageFiles = [];
      for (const figure of doc.querySelectorAll('.article-body figure')) {
        const caption = text(figure.querySelector('figcaption'));
        const target = figure.nextElementSibling;
        if (!same(period(caption), period(infoLine(target)))) fail(`${label}: caption/body dates differ for ${target?.id}`);
        const img = figure.querySelector('img');
        if (!nonempty(img?.getAttribute('alt'))) fail(`${label}: image alt missing`);
        const references = [img?.getAttribute('src'), ...[...figure.querySelectorAll('source[srcset]')].flatMap(node => node.getAttribute('srcset').split(',').map(candidate => candidate.trim().split(/\s+/)[0]))];
        for (const reference of references) {
          const file = new URL(reference || '', doc.baseURI).pathname.slice(1);
          imageFiles.push(file);
          const asset = files.get(file);
          if (!asset || !fileExists(file)) fail(`${label}: undeclared/missing image ${file}`);
          if (asset && (asset.id !== target?.id || !caption.endsWith(asset.captionCredits?.[lang] || '\0'))) fail(`${label}: image/caption ledger mismatch for ${file}`);
        }
      }
      for (const reference of [doc.querySelector('meta[property="og:image"]')?.content, doc.querySelector('meta[name="twitter:image"]')?.content, ...(Array.isArray(metadata?.image) ? metadata.image : [])]) {
        const file = new URL(reference || '', canonical).pathname.slice(1);
        if (!files.has(file)) fail(`${label}: undeclared social image ${file}`);
      }
      for (const asset of assets.values()) {
        if (!asset?.files?.some(file => imageFiles.includes(file))) fail(`${label}: stale ledger asset ${asset?.id}`);
        if (asset?.source?.url && !links.includes(asset.source.url)) fail(`${label}: declared source link missing for ${asset.id}`);
      }
      snapshots[lang] = { datePublished: metadata?.datePublished, dateModified: metadata?.dateModified, category: metadata?.articleSection, jumpIds, periods, links: links.sort(), imageFiles: imageFiles.sort() };
    } catch (error) {
      fail(`${label}: cannot inspect content (${error.message})`);
    } finally {
      dom.window.close();
    }
  }
  for (const lang of ['en', 'ja']) {
    if (!same(snapshots.ko, snapshots[lang])) fail(`${lang} article: KO/EN/JA ids, dates, category, links or image references differ`);
  }
  return { errors, warnings, articleCount: Object.keys(snapshots).length, assetCount: assets.size, fileCount: files.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkEditorialContent(readEditorialInputs());
    for (const message of result.errors) console.error(`ERROR: ${message}`);
    for (const message of result.warnings) console.warn(`REVIEW: ${message}`);
    console.log(`Editorial content: ${result.articleCount} articles, ${result.assetCount} assets, ${result.fileCount} files; ${result.errors.length} errors, ${result.warnings.length} follow-ups.`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`ERROR: cannot read editorial inputs (${error.message})`);
    process.exitCode = 1;
  }
}
