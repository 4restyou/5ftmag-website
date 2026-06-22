#!/usr/bin/env python3
"""
Image perf — Phase 3 (PR 3 of 3): Netlify Image CDN responsive srcset

Hero 이미지 (article-hero) 에 모바일 전용 작은 변형을 <source media> 로
끼워넣는다. Netlify Image CDN 의 동적 리사이즈 (/.netlify/images?url=...&w=...)
를 활용 — 사전 생성 파일 불필요, repo 크기 그대로.

규칙:
  - 데스크탑 (>768px): 원본 (또는 기존 webp source) 그대로 사용.
  - 모바일 (<= 768px): /.netlify/images?url=<absolute>&w=900&q=82&fm=webp.
  - 모바일 source 가 picture 의 첫 번째에 오도록 (browser 매칭 순서).

대상:
  - <figure|div class="article-hero"> 안의 <picture><img>...
  - 이미 mobile-source 가 들어 있으면 스킵 (멱등).

품질 영향: 0.
  - 디바이스 크기에 맞는 이미지 받는 거라 본질적 손실 없음.
  - q=82 webp 는 시각 차이 거의 없음.
  - lightbox / 확대 보기는 원본 src 그대로 사용하므로 영향 없음.

실행:
  python3 scripts/perf-images-phase3.py
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE_BREAKPOINT = 768
MOBILE_WIDTH = 900    # device-pixel-ratio 2 까지 깨끗 (=450 CSS px @2x)
MOBILE_QUALITY = 82

# article-hero 의 picture > (sources + img) 블록 통째 매치.
HERO_BLOCK_RE = re.compile(
    r'(<(?:figure|div)[^>]*class="[^"]*article-hero[^"]*"[^>]*>\s*<picture>)(.*?)(</picture>)',
    re.DOTALL,
)

# 안에서 img src 추출.
IMG_SRC_RE = re.compile(r'<img[^>]+\bsrc="([^"]+)"')

# 기존 모바일 source 가 이미 있는지 (멱등)
MOBILE_SOURCE_RE = re.compile(r'/\.netlify/images\?', re.IGNORECASE)


def to_absolute(rel_src: str, file_path: Path) -> str:
    """이미지 상대경로 (../img/foo.jpg 또는 ./img/foo.jpg 또는 /img/foo.jpg)
       를 사이트 절대경로 (/img/foo.jpg) 로 정규화."""
    rel = rel_src.strip()
    if rel.startswith('http://') or rel.startswith('https://'):
        return rel
    if rel.startswith('/'):
        return rel
    # 페이지 위치 기준 해석
    base = file_path.parent
    target = (base / rel).resolve()
    # ROOT 기준 상대화
    try:
        rel_to_root = target.relative_to(ROOT.resolve())
        return '/' + str(rel_to_root).replace('\\', '/')
    except ValueError:
        return rel  # 사이트 밖 — 그대로


def patch_one_file(path: Path) -> bool:
    src = path.read_text(encoding='utf-8')
    new = src

    def repl(m):
        open_tag = m.group(1)   # <figure ...><picture>
        body = m.group(2)
        close_tag = m.group(3)  # </picture>
        # 이미 처리된 경우 스킵
        if MOBILE_SOURCE_RE.search(body):
            return m.group(0)
        # img src 추출
        img_m = IMG_SRC_RE.search(body)
        if not img_m:
            return m.group(0)
        abs_src = to_absolute(img_m.group(1), path)
        # Netlify Image CDN URL 만들기
        cdn_url = f'/.netlify/images?url={abs_src}&w={MOBILE_WIDTH}&q={MOBILE_QUALITY}&fm=webp'
        # 모바일 source 줄 — picture 의 첫 번째에 들어가야 한다.
        # 들여쓰기 추정 — body 시작의 공백 패턴 따라가게.
        # body 가 \n<source ... 또는 \n<img 로 시작 → 같은 들여쓰기 사용.
        # 8 spaces 기본 (article-hero 안의 picture 안).
        indent = '      '  # 6 spaces — figure / picture / source / img 계층
        first_line_match = re.search(r'\n(\s*)<', body)
        if first_line_match:
            indent = first_line_match.group(1)
        mobile_source = (
            f'\n{indent}<source media="(max-width: {MOBILE_BREAKPOINT}px)" '
            f'srcset="{cdn_url}" type="image/webp">'
        )
        # body 첫 줄 직전에 삽입
        # body 가 '\n<source>...' 또는 '\n<img>...' 로 시작하므로 그 앞에.
        new_body = mobile_source + body
        return open_tag + new_body + close_tag

    new = HERO_BLOCK_RE.sub(repl, new)
    if new != src:
        path.write_text(new, encoding='utf-8')
        return True
    return False


count = 0
for path in sorted((ROOT / 'stories').glob('*.html')):
    if patch_one_file(path):
        count += 1
        print(f'  ✓ {path.relative_to(ROOT)}')
# 다른 페이지에도 article-hero 가 있을 수 있음 — index / films / books 등
for path in (ROOT / 'films.html', ROOT / 'index.html', ROOT / 'me.html', ROOT / 'about.html'):
    if path.exists() and patch_one_file(path):
        count += 1
        print(f'  ✓ {path.relative_to(ROOT)}')

print(f'\nresponsive mobile source 추가: {count} files')
