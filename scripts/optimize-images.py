#!/usr/bin/env python3
"""
5ft.mag 이미지 웹 최적화
- img/ 하위 모든 JPG/JPEG/PNG 검사
- 긴 변 2000px 초과 시 리사이즈 (Lanczos)
- JPEG q85 / PNG optimize=True 로 재저장
- WebP q82 페어 생성 (없거나, 원본이 새로 압축된 경우)
- 500KB 이하 + 2000px 이하 + WebP 페어 있음 → 스킵 (이미 최적화)

사용:
  npm run optimize-images        # 전체 sweep
  python3 scripts/optimize-images.py [폴더경로]   # 특정 폴더만
  python3 scripts/optimize-images.py --dry-run    # 변경 미리보기
"""
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("ERROR: Pillow 가 필요합니다. pip3 install --user Pillow")
    sys.exit(1)

# ── 설정 ──
MAX_LONG_SIDE = 2000
JPEG_QUALITY = 85
WEBP_QUALITY = 82
SKIP_SIZE_BYTES = 500 * 1024
SKIP_DIRS = {'favicon', 'og'}

ROOT = Path(__file__).resolve().parent.parent
DRY_RUN = '--dry-run' in sys.argv

# 대상 폴더 — 인자로 받거나 기본 img/
target_arg = next((a for a in sys.argv[1:] if not a.startswith('--')), None)
TARGET = Path(target_arg).resolve() if target_arg else ROOT / 'img'

if not TARGET.exists():
    print(f"ERROR: {TARGET} 경로가 존재하지 않습니다.")
    sys.exit(1)

stats = {'optimized': 0, 'webp_only': 0, 'skipped': 0, 'before': 0, 'after': 0, 'webp_size': 0}
changes = []

print(f"\n이미지 최적화 sweep: {TARGET.relative_to(ROOT)}")
if DRY_RUN:
    print("(--dry-run: 실제로 파일은 변경하지 않습니다)\n")

for src in sorted(TARGET.rglob('*')):
    if not src.is_file():
        continue
    if any(p in SKIP_DIRS for p in src.parts):
        continue
    if src.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
        continue

    orig_bytes = src.stat().st_size
    try:
        with Image.open(src) as probe:
            w, h = probe.size
    except Exception as e:
        print(f"  ⚠ {src.relative_to(ROOT)}: 이미지 로드 실패 — {e}")
        continue

    webp_path = src.with_suffix('.webp')
    needs_optimize = orig_bytes > SKIP_SIZE_BYTES or max(w, h) > MAX_LONG_SIDE
    needs_webp = not webp_path.exists()

    if not needs_optimize and not needs_webp:
        stats['skipped'] += 1
        continue

    if DRY_RUN:
        stats['optimized'] += int(needs_optimize)
        stats['webp_only'] += int(needs_webp and not needs_optimize)
        changes.append(f"  {src.relative_to(ROOT)} ({orig_bytes//1024}KB)"
                       + (f" → optimize" if needs_optimize else "")
                       + (f" + webp" if needs_webp else ""))
        continue

    img = Image.open(src)
    img = ImageOps.exif_transpose(img)
    cw, ch = img.size
    if max(cw, ch) > MAX_LONG_SIDE:
        if cw >= ch:
            img = img.resize((MAX_LONG_SIDE, int(ch * MAX_LONG_SIDE / cw)), Image.LANCZOS)
        else:
            img = img.resize((int(cw * MAX_LONG_SIDE / ch), MAX_LONG_SIDE), Image.LANCZOS)

    if needs_optimize:
        if src.suffix.lower() == '.png':
            img.save(src, 'PNG', optimize=True)
        else:
            rgb = img.convert('RGB') if img.mode != 'RGB' else img
            rgb.save(src, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
        stats['optimized'] += 1
    else:
        stats['webp_only'] += 1

    # WebP 페어
    rgb = img.convert('RGB') if img.mode in ('CMYK', 'P') else img
    rgb.save(webp_path, 'WEBP', quality=WEBP_QUALITY, method=6)

    new_bytes = src.stat().st_size
    new_webp_bytes = webp_path.stat().st_size
    stats['before'] += orig_bytes
    stats['after'] += new_bytes
    stats['webp_size'] += new_webp_bytes

    saved = orig_bytes - new_bytes
    if saved > 100 * 1024:  # 100KB 이상 절약된 경우 출력
        changes.append(f"  {src.relative_to(ROOT)}: {orig_bytes//1024}KB → {new_bytes//1024}KB JPG + {new_webp_bytes//1024}KB WebP")

# 결과
if changes:
    print("Changes:")
    for c in changes[:30]:
        print(c)
    if len(changes) > 30:
        print(f"  ... {len(changes) - 30} more")

if DRY_RUN:
    print(f"\n[DRY RUN] 처리 예정: {stats['optimized']} 최적화, {stats['webp_only']} webp 페어 생성, {stats['skipped']} 스킵")
else:
    mb = lambda b: b / 1024 / 1024
    print(f"\nDone:")
    print(f"  최적화: {stats['optimized']}개")
    print(f"  WebP 페어만 생성: {stats['webp_only']}개")
    print(f"  스킵 (이미 최적화): {stats['skipped']}개")
    if stats['before']:
        print(f"  용량: {mb(stats['before']):.1f}MB → {mb(stats['after']):.1f}MB ({stats['after']*100//stats['before']}%)")
        print(f"  WebP 페어 합계: {mb(stats['webp_size']):.1f}MB")
