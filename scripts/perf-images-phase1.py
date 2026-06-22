#!/usr/bin/env python3
"""
Image perf — Phase 1 (PR 1 of 3): fetchpriority / preconnect / decoding
일괄 적용. 품질 손실 0.

작업:
1. article-hero figure > picture > img 에 fetchpriority="high" + loading 제거.
2. 모든 <img ...> 에 decoding="async" 추가 (이미 있으면 스킵).
3. 모든 페이지 <head> 끝부분에 Supabase preconnect / dns-prefetch link 추가.

실행:
  python3 scripts/perf-images-phase1.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPABASE = 'https://pucpqsfwqouqohwsvmnd.supabase.co'

# ───── 1. article-hero img 에 fetchpriority="high" + lazy 제거 ─────
HERO_RE = re.compile(
    r'(<(?:figure|div)[^>]*class="[^"]*article-hero[^"]*"[^>]*>\s*(?:<picture>\s*(?:<source[^>]*>\s*)?)?)(<img[^>]+>)',
    re.DOTALL,
)

def patch_hero(html: str) -> str:
    def repl(m):
        prefix = m.group(1)
        img = m.group(2)
        # loading="lazy" 제거
        img2 = re.sub(r'\s*loading="lazy"', '', img)
        # fetchpriority 가 없으면 추가
        if 'fetchpriority=' not in img2:
            img2 = re.sub(r'<img\s', '<img fetchpriority="high" ', img2, count=1)
        return prefix + img2
    return HERO_RE.sub(repl, html)

# ───── 2. 모든 img 에 decoding="async" 추가 (이미 있으면 스킵) ─────
IMG_RE = re.compile(r'<img\b([^>]*)>')

def patch_decoding(html: str) -> str:
    def repl(m):
        attrs = m.group(1)
        if 'decoding=' in attrs:
            return m.group(0)
        # decoding="async" 를 src 다음에 자연스럽게 — 또는 img 직후에 삽입
        return '<img decoding="async"' + attrs + '>'
    return IMG_RE.sub(repl, html)

# ───── 3. <head> 안에 preconnect / dns-prefetch ─────
PRECONNECT_BLOCK = (
    f'  <link rel="preconnect" href="{SUPABASE}" crossorigin>\n'
    f'  <link rel="dns-prefetch" href="{SUPABASE}">\n'
)
PRECONNECT_MARKER = 'href="https://pucpqsfwqouqohwsvmnd.supabase.co"'

def patch_preconnect(html: str) -> str:
    if PRECONNECT_MARKER in html:
        return html  # 이미 적용
    # </head> 직전에 삽입
    if '</head>' in html:
        return html.replace('</head>', PRECONNECT_BLOCK + '</head>', 1)
    return html

# ───── 실행 ─────
patterns = [
    ROOT / 'index.html',
    ROOT / 'me.html', ROOT / 'films.html', ROOT / 'books.html',
    ROOT / 'labs.html', ROOT / 'market.html', ROOT / 'about.html',
    ROOT / 'search.html', ROOT / 'stories.html', ROOT / 'authors.html',
    ROOT / 'unsubscribe.html',
]
patterns += list((ROOT / 'stories').glob('*.html'))
patterns += list((ROOT / 'authors').glob('*.html'))
patterns += list((ROOT / 'admin').glob('*.html'))
patterns += list((ROOT / 'legal').glob('*.html'))

count = {'hero': 0, 'decoding': 0, 'preconnect': 0}
for path in patterns:
    if not path.exists(): continue
    src = path.read_text(encoding='utf-8')
    new = src

    before_hero = new.count('fetchpriority="high"')
    new = patch_hero(new)
    if new.count('fetchpriority="high"') > before_hero:
        count['hero'] += 1

    before_dec = new.count('decoding="async"')
    new = patch_decoding(new)
    if new.count('decoding="async"') > before_dec:
        count['decoding'] += 1

    if PRECONNECT_MARKER not in src and PRECONNECT_MARKER in patch_preconnect(src):
        count['preconnect'] += 1
    new = patch_preconnect(new)

    if new != src:
        path.write_text(new, encoding='utf-8')

print(f"hero fetchpriority   : {count['hero']} files")
print(f"decoding async       : {count['decoding']} files")
print(f"Supabase preconnect  : {count['preconnect']} files")
