// 노션 데이터 → 사이트 데이터 변환 유틸
// - properties 추출
// - 블록 → HTML 변환
// - 이미지 다운로드

import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

// ════════ 속성 추출 ════════

export function getTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  return prop.title.map(t => t.plain_text).join('').trim();
}

export function getRichText(prop) {
  if (!prop || prop.type !== 'rich_text') return '';
  return prop.rich_text.map(t => t.plain_text).join('').trim();
}

export function getSelect(prop) {
  if (!prop || prop.type !== 'select' || !prop.select) return '';
  return prop.select.name;
}

export function getMultiSelect(prop) {
  if (!prop || prop.type !== 'multi_select') return [];
  return prop.multi_select.map(s => s.name);
}

export function getDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return '';
  return prop.date.start;
}

export function getCheckbox(prop) {
  if (!prop || prop.type !== 'checkbox') return false;
  return prop.checkbox;
}

export function getNumber(prop) {
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

export function getUrl(prop) {
  if (!prop || prop.type !== 'url') return '';
  return prop.url || '';
}

export function getFiles(prop) {
  if (!prop || prop.type !== 'files') return [];
  return prop.files.map(f => {
    if (f.type === 'external') return f.external.url;
    if (f.type === 'file') return f.file.url;
    return '';
  }).filter(Boolean);
}

export function getFirstFile(prop) {
  const files = getFiles(prop);
  return files[0] || '';
}

// ════════ Rich Text → HTML ════════

function richTextToHtml(richText) {
  if (!richText || richText.length === 0) return '';
  return richText.map(rt => {
    let text = escapeHtml(rt.plain_text);
    const ann = rt.annotations || {};
    if (ann.code) text = `<code>${text}</code>`;
    if (ann.bold) text = `<strong>${text}</strong>`;
    if (ann.italic) text = `<em>${text}</em>`;
    if (ann.strikethrough) text = `<s>${text}</s>`;
    if (ann.underline) text = `<u>${text}</u>`;
    if (rt.href) text = `<a href="${escapeAttr(rt.href)}" target="_blank" rel="noopener">${text}</a>`;
    return text;
  }).join('');
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ════════ 이미지 다운로드 ════════

export async function downloadImage(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const protocol = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const request = protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadImage(res.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          await fs.writeFile(destPath, Buffer.concat(chunks));
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
    request.on('error', reject);
  });
}

// 노션 URL에서 확장자 추출 (?파라미터 제거)
export function getImageExt(url) {
  try {
    const u = new URL(url);
    const ext = path.extname(u.pathname).toLowerCase();
    return ext || '.jpg';
  } catch {
    return '.jpg';
  }
}

// ════════ 블록 → HTML ════════

// 빌드 컨텍스트로 이미지 다운로드 경로를 받아서 HTML 생성
// imageHandler(url, blockId) → relPath (사이트 기준 상대 경로)
export async function blocksToHtml(blocks, opts = {}) {
  const { imageHandler, isFirstParagraphLead = true } = opts;
  let html = '';
  let firstParagraph = isFirstParagraphLead;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;

    // 리스트는 연속된 항목을 하나의 ul/ol로 묶음
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const tag = type === 'bulleted_list_item' ? 'ul' : 'ol';
      const items = [];
      while (i < blocks.length && blocks[i].type === type) {
        const rt = blocks[i][type].rich_text;
        items.push(`<li>${richTextToHtml(rt)}</li>`);
        i++;
      }
      html += `<${tag}>\n${items.join('\n')}\n</${tag}>\n\n`;
      continue;
    }

    if (type === 'paragraph') {
      const rt = block.paragraph.rich_text;
      const inner = richTextToHtml(rt);
      if (inner.trim()) {
        const cls = firstParagraph ? ' class="lead"' : '';
        html += `<p${cls}>${inner}</p>\n\n`;
        firstParagraph = false;
      }
    } else if (type === 'heading_1' || type === 'heading_2') {
      const rt = block[type].rich_text;
      html += `<h2>${richTextToHtml(rt)}</h2>\n\n`;
      firstParagraph = false;
    } else if (type === 'heading_3') {
      const rt = block.heading_3.rich_text;
      html += `<h3>${richTextToHtml(rt)}</h3>\n\n`;
      firstParagraph = false;
    } else if (type === 'quote') {
      const rt = block.quote.rich_text;
      html += `<blockquote>${richTextToHtml(rt)}</blockquote>\n\n`;
      firstParagraph = false;
    } else if (type === 'divider') {
      html += `<hr />\n\n`;
    } else if (type === 'image') {
      const file = block.image;
      const url = file.type === 'external' ? file.external.url : file.file.url;
      const captionRt = file.caption || [];
      const caption = richTextToHtml(captionRt);
      const altText = captionRt.map(t => t.plain_text).join('').replace(/"/g, "'");
      const isFullWidth = altText.includes('[full]') || altText.includes('[full-width]');
      const cleanCaption = caption.replace(/\[full(-width)?\]\s*/g, '').trim();
      const cleanAlt = altText.replace(/\[full(-width)?\]\s*/g, '').trim() || 'image';

      let relPath = url;
      if (imageHandler) {
        try {
          relPath = await imageHandler(url, block.id);
        } catch (err) {
          console.warn(`이미지 다운로드 실패 (${block.id}):`, err.message);
        }
      }

      const figClass = isFullWidth ? ' class="full-width"' : '';
      const figCaption = cleanCaption ? `\n      <figcaption>${cleanCaption}</figcaption>` : '';
      html += `<figure${figClass}>
      <img src="${escapeAttr(relPath)}" alt="${escapeAttr(cleanAlt)}" loading="lazy" />${figCaption}
    </figure>\n\n`;
      firstParagraph = false;
    } else if (type === 'code') {
      // 언어가 'html'이면 raw HTML 삽입 (커스텀 컴포넌트 escape hatch)
      const code = block.code;
      const lang = code.language || '';
      const text = code.rich_text.map(t => t.plain_text).join('');
      if (lang === 'html' || lang === 'plain text') {
        html += `${text}\n\n`;
      } else {
        html += `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(text)}</code></pre>\n\n`;
      }
      firstParagraph = false;
    } else if (type === 'callout') {
      const rt = block.callout.rich_text;
      html += `<div class="callout"><p>${richTextToHtml(rt)}</p></div>\n\n`;
      firstParagraph = false;
    } else if (type === 'video' || type === 'embed') {
      const data = block[type];
      const url = data.type === 'external' ? data.external.url : (data.url || '');
      if (url) {
        // YouTube embed 자동 변환
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
        if (ytMatch) {
          html += `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe></div>\n\n`;
        } else {
          html += `<p><a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>\n\n`;
        }
      }
      firstParagraph = false;
    }
    // 알 수 없는 블록은 스킵

    i++;
  }
  return html.trim();
}

// ════════ 모든 블록 가져오기 (페이지네이션) ════════

export async function getAllBlocks(notion, blockId) {
  const blocks = [];
  let cursor;
  while (true) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return blocks;
}

// ════════ 모든 DB row 가져오기 (페이지네이션) ════════

export async function queryAllPages(notion, databaseId, filter) {
  const results = [];
  let cursor;
  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ════════ 날짜 포맷 ════════

export function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  return isoDate.replace(/-/g, '.');
}
