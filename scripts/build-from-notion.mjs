// 노션 → 5ft.mag 사이트 빌드 스크립트
// Stories, News, Films, Readers 4개 DB를 읽어와 JSON/HTML 생성

import { Client } from '@notionhq/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getTitle,
  getRichText,
  getSelect,
  getMultiSelect,
  getDate,
  getCheckbox,
  getNumber,
  getUrl,
  getFiles,
  getFirstFile,
  blocksToHtml,
  getAllBlocks,
  queryAllPages,
  downloadImage,
  getImageExt,
  formatDateDisplay,
  escapeHtml,
  escapeAttr,
} from './notion-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// DB ID 정규화 — URL을 통째로 붙여넣어도 32자 ID만 추출
function sanitizeDbId(raw) {
  if (!raw) return '';
  const cleaned = String(raw).trim();
  // UUID 형식 (8-4-4-4-12) 또는 32자 hex 모두 매치
  const uuidMatch = cleaned.match(/[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/);
  if (uuidMatch) return uuidMatch[0].replace(/-/g, '');
  return cleaned;
}

const TOKEN = process.env.NOTION_TOKEN;
const STORIES_DB_ID = sanitizeDbId(process.env.STORIES_DB_ID);
const NEWS_DB_ID = sanitizeDbId(process.env.NEWS_DB_ID);
const FILMS_DB_ID = sanitizeDbId(process.env.FILMS_DB_ID);
const READERS_DB_ID = sanitizeDbId(process.env.READERS_DB_ID);
const DRY_RUN = process.env.DRY_RUN === '1';

if (process.env.STORIES_DB_ID && !STORIES_DB_ID) {
  console.warn('⚠ STORIES_DB_ID 형식이 이상합니다:', process.env.STORIES_DB_ID);
}

if (!TOKEN) {
  console.error('❌ NOTION_TOKEN 환경 변수가 없습니다. 빌드를 건너뜁니다.');
  console.error('   로컬에서는 .env 파일을, Netlify에서는 사이트 환경 변수를 설정하세요.');
  process.exit(0); // 빌드는 통과시키고 정적 자산만 배포
}

const notion = new Client({ auth: TOKEN });

// ════════ 시드 데이터 — 기존 수동 콘텐츠 (덮어쓰지 않음) ════════
// 기존 stories 01-08 등은 노션으로 이전하기 전까지 시드로 보존됩니다.

async function readJSON(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJSON(filePath, data) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, filePath)}`);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
}

async function writeFile(filePath, content) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, filePath)}`);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`  ✓ ${path.relative(ROOT, filePath)}`);
}

// ════════ Stories ════════

async function buildStories() {
  if (!STORIES_DB_ID) {
    console.log('— Stories DB ID 미설정. 시드 JSON 그대로 유지합니다.');
    return;
  }
  console.log('\n📝 Stories 빌드 중…');

  const template = await fs.readFile(path.join(__dirname, 'templates/story.html'), 'utf-8');
  const seedStories = await readJSON(path.join(ROOT, 'data/stories.json')) || [];
  // 노션이 아닌 수동 글은 'manual: true'로 표시; 표시 안 된 것은 노션이 덮어씀
  const manualStories = seedStories.filter(s => s.manual === true);

  const pages = await queryAllPages(notion, STORIES_DB_ID);
  console.log(`  노션에서 ${pages.length}개 글 발견`);

  const notionStories = [];

  for (const page of pages) {
    const props = page.properties;
    const id = getRichText(props['ID']) || getTitle(props['ID']);
    if (!id) {
      console.warn(`  ⚠ ID 없는 글 스킵: ${page.id}`);
      continue;
    }
    const title = getTitle(props['Title']) || getTitle(props['제목']);
    const subtitle = getRichText(props['Subtitle']) || getRichText(props['부제']);
    const category = getSelect(props['Category']) || 'essay';
    const categoryLabel = getRichText(props['CategoryLabel']) ||
                         getSelect(props['CategoryLabel']) ||
                         category.toUpperCase();
    const author = getRichText(props['Author']) || getTitle(props['Author']) || '5ft.mag 편집부';
    const date = getDate(props['Date']) || new Date().toISOString().split('T')[0];
    const issue = getSelect(props['Issue']) || getRichText(props['Issue']) || 'Vol.01';
    const excerpt = getRichText(props['Excerpt']) || getRichText(props['요약']) || '';
    const published = getCheckbox(props['Published']);

    const idDir = path.join(ROOT, 'img/stories', id);
    let heroRel = '';

    // 커버 이미지
    const coverUrl = page.cover
      ? (page.cover.type === 'external' ? page.cover.external.url : page.cover.file.url)
      : (getFirstFile(props['Cover']) || getFirstFile(props['Hero']));
    if (coverUrl) {
      const ext = getImageExt(coverUrl);
      const coverPath = path.join(idDir, `cover${ext}`);
      try {
        if (!DRY_RUN) await downloadImage(coverUrl, coverPath);
        heroRel = `img/stories/${id}/cover${ext}`;
      } catch (err) {
        console.warn(`  ⚠ 커버 다운로드 실패 (${id}):`, err.message);
      }
    }

    // 본문 블록
    const blocks = await getAllBlocks(notion, page.id);
    let imgCounter = 0;
    const bodyHtml = await blocksToHtml(blocks, {
      isFirstParagraphLead: true,
      imageHandler: async (url) => {
        imgCounter++;
        const ext = getImageExt(url);
        const fileName = `body-${String(imgCounter).padStart(2, '0')}${ext}`;
        const dest = path.join(idDir, fileName);
        if (!DRY_RUN) await downloadImage(url, dest);
        return `../img/stories/${id}/${fileName}`;
      },
    });

    // 썸네일 — 카드용 (커버 그대로 사용)
    const thumbnail = heroRel || '';

    // JSON 엔트리
    notionStories.push({
      id,
      title,
      category,
      categoryLabel,
      author,
      date,
      issue,
      thumbnail,
      excerpt,
      page: `stories/${id}.html`,
      published,
    });

    // HTML 페이지
    const heroBlock = heroRel
      ? `<div class="article-hero">\n    <img src="../${heroRel}" alt="${escapeAttr(title)}" loading="lazy" />\n  </div>`
      : '';

    const html = template
      .replaceAll('{{TITLE}}', escapeHtml(title))
      .replaceAll('{{DESCRIPTION}}', escapeAttr(excerpt))
      .replaceAll('{{ID}}', id)
      .replaceAll('{{HERO_ABS}}', heroRel || '')
      .replaceAll('{{HERO_BLOCK}}', heroBlock)
      .replaceAll('{{ISSUE}}', escapeHtml(issue))
      .replaceAll('{{CATEGORY_LABEL}}', escapeHtml(categoryLabel))
      .replaceAll('{{CATEGORY}}', escapeHtml(category))
      .replaceAll('{{SUBTITLE}}', escapeHtml(subtitle || excerpt))
      .replaceAll('{{AUTHOR}}', escapeHtml(author))
      .replaceAll('{{DATE_ISO}}', date)
      .replaceAll('{{DATE_DISPLAY}}', formatDateDisplay(date))
      .replaceAll('{{BODY_HTML}}', bodyHtml);

    await writeFile(path.join(ROOT, `stories/${id}.html`), html);
    console.log(`  ✓ ${id}: ${title}`);
  }

  // 수동 글 + 노션 글 합쳐서 stories.json 작성 (날짜 내림차순)
  const merged = [...manualStories, ...notionStories]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  await writeJSON(path.join(ROOT, 'data/stories.json'), merged);
}

// ════════ News ════════

async function buildNews() {
  if (!NEWS_DB_ID) {
    console.log('— News DB ID 미설정. 시드 JSON 유지.');
    return;
  }
  console.log('\n📰 News 빌드 중…');

  const seed = await readJSON(path.join(ROOT, 'data/news.json')) || [];
  const manual = seed.filter(n => n.manual === true);

  const pages = await queryAllPages(notion, NEWS_DB_ID);
  console.log(`  노션에서 ${pages.length}개 소식 발견`);

  const items = [];
  for (const page of pages) {
    const props = page.properties;
    const id = getRichText(props['ID']) || getTitle(props['ID']) || page.id.slice(0, 8);
    const tag = getSelect(props['Tag']) || getRichText(props['Tag']) || 'News';
    const title = getTitle(props['Title']) || getTitle(props['제목']);
    const date = getDate(props['Date']) || new Date().toISOString().split('T')[0];
    const link = getUrl(props['Link']) || getRichText(props['Link']) || '';
    const externalProp = props['External'];
    const external = externalProp ? getCheckbox(externalProp) : link.startsWith('http');
    const published = getCheckbox(props['Published']);

    let thumbnail = '';
    const thumbUrl = (page.cover
      ? (page.cover.type === 'external' ? page.cover.external.url : page.cover.file.url)
      : getFirstFile(props['Thumbnail']));
    if (thumbUrl) {
      const ext = getImageExt(thumbUrl);
      const dest = path.join(ROOT, 'img/news', id, `thumb${ext}`);
      try {
        if (!DRY_RUN) await downloadImage(thumbUrl, dest);
        thumbnail = `img/news/${id}/thumb${ext}`;
      } catch (err) {
        console.warn(`  ⚠ 썸네일 다운로드 실패 (${id}):`, err.message);
      }
    }

    items.push({ id, tag, title, date, thumbnail, link, external, published });
  }

  const merged = [...manual, ...items]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  await writeJSON(path.join(ROOT, 'data/news.json'), merged);
}

// ════════ Films ════════
// 2026-05: films 카탈로그는 Supabase 의 public.films 테이블로 이전됨.
// 관리자 페이지(/admin/films) 에서 직접 추가·수정·삭제.
// 빌드 시 data/films.json 생성은 scripts/build-films.mjs (Supabase → JSON) 에서 처리.
// Notion Films DB 동기화는 더 이상 수행하지 않음.

async function buildFilms() {
  console.log('— Films: Supabase 단일 source. Notion 빌드 스킵.');
}

// ════════ Readers ════════

async function buildReaders() {
  if (!READERS_DB_ID) {
    console.log('— Readers DB ID 미설정. 시드 JSON 유지.');
    return;
  }
  console.log('\n📷 Readers 빌드 중…');

  const seed = await readJSON(path.join(ROOT, 'data/readers.json')) || [];
  const manual = seed.filter(r => r.manual === true);

  const pages = await queryAllPages(notion, READERS_DB_ID);
  console.log(`  노션에서 ${pages.length}개 독자 사진 발견`);

  const items = [];
  for (const page of pages) {
    const props = page.properties;
    const id = getRichText(props['ID']) || getTitle(props['ID']) || page.id.slice(0, 8);
    const author = getRichText(props['Author']) || getTitle(props['Author']) || '';
    const instagramUrl = getUrl(props['InstagramUrl']) || getRichText(props['InstagramUrl']) || '';
    const film = getRichText(props['Film']) || getSelect(props['Film']) || '';
    const published = getCheckbox(props['Published']);

    let image = '';
    const imgUrl = page.cover
      ? (page.cover.type === 'external' ? page.cover.external.url : page.cover.file.url)
      : getFirstFile(props['Image']);
    if (imgUrl) {
      const ext = getImageExt(imgUrl);
      const dest = path.join(ROOT, 'img/readers', `${id}${ext}`);
      try {
        if (!DRY_RUN) await downloadImage(imgUrl, dest);
        image = `img/readers/${id}${ext}`;
      } catch (err) {
        console.warn(`  ⚠ 이미지 다운로드 실패 (${id}):`, err.message);
      }
    }

    items.push({ id, image, author, instagramUrl, film, published });
  }

  await writeJSON(path.join(ROOT, 'data/readers.json'), [...manual, ...items]);
}

// ════════ 메인 ════════

(async () => {
  const start = Date.now();
  console.log('🚀 5ft.mag 빌드 시작');
  if (DRY_RUN) console.log('   (dry-run 모드 — 파일을 쓰지 않습니다)');

  let hadError = false;
  for (const [name, fn] of [
    ['Stories', buildStories],
    ['News', buildNews],
    ['Films', buildFilms],
    ['Readers', buildReaders],
  ]) {
    try {
      await fn();
    } catch (err) {
      hadError = true;
      console.error(`\n❌ ${name} 빌드 실패:`, err.message || err);
      if (err.body) console.error('   응답:', err.body);
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (hadError) {
    console.log(`\n⚠ 일부 실패하며 빌드 종료 (${elapsed}초) — 다른 콘텐츠는 정상 배포됩니다.`);
    // 부분 실패는 배포 차단하지 않음 (정적 자산만으로도 사이트 정상 동작)
  } else {
    console.log(`\n✅ 빌드 완료 (${elapsed}초)`);
  }
})();
