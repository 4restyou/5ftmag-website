import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { checkEditorialContent, EXHIBITION_IDS, LANGUAGES, readEditorialInputs } from '../../scripts/check-editorial-content.mjs';

const baseline = readEditorialInputs();
const inputs = () => structuredClone(baseline);
function editArticle(input, lang, edit) {
  const dom = new JSDOM(input.articles[lang]);
  try {
    edit(dom.window.document);
    input.articles[lang] = dom.serialize();
  } finally {
    dom.window.close();
  }
}
function editMetadata(input, lang, edit) {
  editArticle(input, lang, doc => {
    const script = doc.querySelector('script[type="application/ld+json"]');
    const metadata = JSON.parse(script.textContent);
    edit(metadata);
    script.textContent = JSON.stringify(metadata);
  });
}
const errors = input => checkEditorialContent(input).errors.join('\n');

describe('C01/C03 October exhibition content safeguards', () => {
  it('checks only the three October articles and treats reviewed unknown use as follow-up', () => {
    const result = checkEditorialContent(inputs());
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({ articleCount: 3, assetCount: 11, fileCount: 22 });
    expect(result.warnings).toHaveLength(11);
    expect(result.warnings.every(warning => warning.includes('does not mean permission'))).toBe(true);
  });

  it.each(LANGUAGES)('uses native disclosure, localized article URLs and focusable destinations in %s', lang => {
    const dom = new JSDOM(baseline.articles[lang], { url: `https://www.5ftmag.com/${lang === 'ko' ? '' : lang + '/'}stories/oct-2026-exhibitions.html` });
    try {
      const doc = dom.window.document;
      expect(doc.querySelector('details.exhibition-summary > summary').textContent.trim()).not.toBe('');
      const nav = doc.querySelector('details.exhibition-summary nav');
      expect(nav.getAttribute('aria-label')).toBeTruthy();
      const links = [...nav.querySelectorAll('ol > li > a')];
      expect(links.map(link => new URL(link.href).hash.slice(1))).toEqual(EXHIBITION_IDS);
      for (const link of links) {
        const url = new URL(link.href);
        expect(url.pathname).toBe(`/${lang === 'ko' ? '' : lang + '/'}stories/oct-2026-exhibitions.html`);
        expect(doc.getElementById(url.hash.slice(1)).getAttribute('tabindex')).toBe('-1');
      }
      expect(doc.querySelector('a[href$="#roger-ballen"]').parentElement.querySelectorAll('time')[1].getAttribute('datetime')).toBe('2027-02');
      expect(doc.getElementById('yoo-seungho').querySelector('a').getAttribute('href')).toContain('yoo-seungho-blue-hour.html');
      expect(doc.getElementById('yuhwajeong').textContent).toContain('FACES OF ALL THINGS');
      expect(doc.getElementById('yuhwajeong').textContent).not.toContain('BLUE HOUR');
    } finally {
      dom.window.close();
    }
  });

  it('rejects a bare hash resolving to the home page because of base href', () => {
    const input = inputs();
    editArticle(input, 'en', doc => doc.querySelector('.exhibition-summary a').setAttribute('href', '#jeong-bongchae'));
    expect(errors(input)).toContain('invalid/focus-inaccessible jump');
  });

  it.each(['remove', 'duplicate', 'focus'])('detects %s target regression', mode => {
    const input = inputs();
    editArticle(input, 'ja', doc => {
      const target = doc.getElementById('yuhwajeong');
      if (mode === 'remove') target.removeAttribute('id');
      if (mode === 'duplicate') doc.getElementById('yoo-seungho').id = target.id;
      if (mode === 'focus') target.removeAttribute('tabindex');
    });
    expect(errors(input)).toContain('invalid/focus-inaccessible jump');
  });

  it.each(['body', 'caption', 'display', 'datetime', 'venue'])('detects %s date/place drift', field => {
    const input = inputs();
    editArticle(input, 'en', doc => {
      const target = doc.getElementById('jeong-bongchae');
      const entry = doc.querySelector('.exhibition-summary li');
      if (field === 'body') target.innerHTML = target.innerHTML.replace('10.13', '10.14');
      if (field === 'caption') target.previousElementSibling.querySelector('figcaption').textContent = target.previousElementSibling.querySelector('figcaption').textContent.replace('10.13', '10.14');
      if (field === 'display') entry.querySelectorAll('time')[1].textContent = '10.14';
      if (field === 'datetime') entry.querySelectorAll('time')[1].setAttribute('datetime', '2026-10-14');
      if (field === 'venue') entry.innerHTML = entry.innerHTML.replace('Space Leeseen', 'Wrong Gallery');
    });
    expect(errors(input)).toMatch(/dates differ|venue differs/);
  });

  it('rejects an invented day for a month-only end date', () => {
    const input = inputs();
    editArticle(input, 'ja', doc => doc.querySelector('a[href$="#roger-ballen"]').parentElement.querySelectorAll('time')[1].setAttribute('datetime', '2027-02-28'));
    expect(errors(input)).toContain('summary/body dates differ for roger-ballen');
  });

  it.each(['datePublished', 'dateModified', 'articleSection'])('rejects %s metadata drift', field => {
    const input = inputs();
    editMetadata(input, 'en', metadata => { metadata[field] = field === 'articleSection' ? 'INTERVIEW' : '2026-10-02'; });
    expect(errors(input)).toMatch(/date mismatch|category\/month mismatch|KO\/EN\/JA/);
  });

  it.each(['canonical', 'comments', 'alternate'])('detects %s identity drift', field => {
    const input = inputs();
    editArticle(input, 'en', doc => {
      if (field === 'canonical') doc.querySelector('link[rel="canonical"]').setAttribute('href', '/stories/yoo-seungho-blue-hour.html');
      if (field === 'comments') doc.querySelector('[data-comments]').setAttribute('data-page-id', 'stories/wrong');
      if (field === 'alternate') doc.querySelector('link[hreflang="ja"]').remove();
    });
    expect(errors(input)).toMatch(/identity mismatch|alternate link mismatch/);
  });

  it.each(['wrong-language', 'missing-page', 'external'])('detects %s link drift', mode => {
    const input = inputs();
    editArticle(input, 'ja', doc => {
      if (mode === 'external') doc.getElementById('roger-ballen').querySelector('a').href = 'https://www.rogerballen.com/wrong';
      else doc.getElementById('yoo-seungho').querySelector('a').href = mode === 'wrong-language' ? '/en/stories/yoo-seungho-blue-hour.html' : '/ja/stories/missing.html';
    });
    expect(errors(input)).toMatch(/wrong-language|broken internal link|KO\/EN\/JA/);
  });

  it('allows intentional Latin-script names in JA instead of guessing translation errors', () => {
    const input = inputs();
    expect(input.articles.ja).toContain('Yoo Seung-ho');
    expect(errors(input)).toBe('');
  });
});

describe('C02 declared asset source/use audit', () => {
  it.each(['source', 'use'])('requires the %s review flag without treating unknown as approved', field => {
    const input = inputs();
    delete input.ledger.assets[0].reviewed[field];
    expect(errors(input)).toContain('source/use reviewed flags');
  });

  it('rejects approval claims without evidence and scope', () => {
    const input = inputs();
    input.ledger.assets[0].use.status = 'confirmed';
    expect(errors(input)).toContain('confirmed use requires evidence and scope');
  });

  it('accepts an explicit evidence reference and scope as a declaration, not a legal verdict', () => {
    const input = inputs();
    input.ledger.assets[0].use = { status: 'confirmed', evidence: 'INTERNAL-REVIEW-FIXTURE', scope: 'Fixture: KO/EN/JA article only', note: 'Test declaration only.' };
    expect(checkEditorialContent(input).errors).toEqual([]);
    expect(checkEditorialContent(input).warnings).toHaveLength(10);
  });

  it.each(['source', 'creator', 'acquisition', 'caption', 'file', 'duplicate', 'missing'])('rejects %s ledger omissions or drift', field => {
    const input = inputs();
    const asset = input.ledger.assets[0];
    if (field === 'source') delete asset.source.url;
    if (field === 'creator') delete asset.creator;
    if (field === 'acquisition') delete asset.acquisition;
    if (field === 'caption') delete asset.captionCredits.ja;
    if (field === 'file') asset.files.push('img/stories/oct-2026-exhibitions/missing.jpg');
    if (field === 'duplicate') input.ledger.assets.push(structuredClone(asset));
    if (field === 'missing') input.ledger.assets.shift();
    expect(checkEditorialContent(input).errors.length).toBeGreaterThan(0);
  });

  it('rejects a new undeclared image and a falsely changed source credit', () => {
    const input = inputs();
    editArticle(input, 'ko', doc => {
      doc.querySelector('.article-body img').setAttribute('src', '/img/stories/oct-2026-exhibitions/new.jpg');
      doc.getElementById('yuhwajeong').previousElementSibling.querySelector('figcaption').textContent = '이미지 제공: Threads.';
    });
    expect(errors(input)).toContain('undeclared/missing image');
    expect(errors(input)).toContain('image/caption ledger mismatch');
  });

  it('fails malformed metadata and missing ledger inputs without claiming success', () => {
    const input = inputs();
    input.ledger = null;
    editArticle(input, 'en', doc => { doc.querySelector('script[type="application/ld+json"]').textContent = '{broken'; });
    expect(errors(input)).toContain('invalid schemaVersion');
    expect(errors(input)).toContain('cannot inspect content');
  });
});
