#!/usr/bin/env python3
"""
Image perf — Phase 2 (PR 2 of 3): 큰 이미지 압축

대상: img/ 아래의 jpg / webp 중 500KB 이상 파일.
보존 정책 (사진 작품 사이트라 품질 1순위):
  - jpg : Pillow quality=85, progressive=True, optimize=True
  - webp: Pillow quality=82, method=6 (slow=high quality), exact=True
  - png : 건드리지 않음 (로고/투명도 보존)
  - 결과 파일이 원본보다 크면 원본 유지 (이미 잘 압축된 파일 — 손대지 않음).
  - exif/icc 같은 메타데이터는 보존 (저작자 정보).

원복: git history. 결과가 마음에 안 들면 PR 통째로 revert.

사용:
  python3 scripts/perf-images-phase2.py --dry-run   # 보고서만
  python3 scripts/perf-images-phase2.py             # 실제 압축
"""

import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMG_DIR = ROOT / 'img'
THRESHOLD = 500 * 1024            # 500KB 이상만
QUALITY_JPG = 85
QUALITY_WEBP = 82
DRY_RUN = '--dry-run' in sys.argv

def fmt_bytes(n):
    for unit in 'B','KB','MB','GB':
        if n < 1024: return f'{n:.1f}{unit}'
        n /= 1024
    return f'{n:.1f}TB'

def compress_jpg(src: Path, dst: Path):
    with Image.open(src) as im:
        # exif/icc 보존
        exif = im.info.get('exif', b'')
        icc = im.info.get('icc_profile', b'')
        save_kwargs = dict(
            format='JPEG',
            quality=QUALITY_JPG,
            optimize=True,
            progressive=True,
        )
        if exif: save_kwargs['exif'] = exif
        if icc: save_kwargs['icc_profile'] = icc
        im.save(dst, **save_kwargs)

def compress_webp(src: Path, dst: Path):
    with Image.open(src) as im:
        icc = im.info.get('icc_profile', b'')
        save_kwargs = dict(
            format='WEBP',
            quality=QUALITY_WEBP,
            method=6,
            exact=True,
        )
        if icc: save_kwargs['icc_profile'] = icc
        im.save(dst, **save_kwargs)

candidates = []
for p in IMG_DIR.rglob('*'):
    if not p.is_file(): continue
    sfx = p.suffix.lower()
    if sfx not in ('.jpg', '.jpeg', '.webp'): continue
    if p.stat().st_size < THRESHOLD: continue
    candidates.append(p)
candidates.sort(key=lambda p: -p.stat().st_size)

print(f"대상: {len(candidates)} files (>= {fmt_bytes(THRESHOLD)})")
print(f"모드: {'DRY-RUN (변경 없음)' if DRY_RUN else 'COMPRESS (덮어쓰기)'}")
print(f"품질: jpg={QUALITY_JPG} (progressive), webp={QUALITY_WEBP} (method=6)")
print('─' * 80)

total_before = 0
total_after = 0
kept = 0          # 압축 결과가 더 커서 원본 유지한 케이스
skipped = 0       # 잘못된 파일 등
errors = []

for src in candidates:
    before = src.stat().st_size
    total_before += before
    sfx = src.suffix.lower()
    tmp = src.with_suffix(src.suffix + '.tmp')
    try:
        if sfx in ('.jpg', '.jpeg'):
            compress_jpg(src, tmp)
        else:
            compress_webp(src, tmp)
        after = tmp.stat().st_size
        ratio = (1 - after / before) * 100
        if after >= before:
            # 압축 효과 없음 → 원본 유지
            tmp.unlink()
            kept += 1
            total_after += before
            print(f"  ··· {fmt_bytes(before):>8} → {fmt_bytes(after):>8} ({ratio:+5.1f}%)  KEEP  {src.relative_to(ROOT)}")
        else:
            if DRY_RUN:
                tmp.unlink()
                total_after += after
                print(f"  →   {fmt_bytes(before):>8} → {fmt_bytes(after):>8} ({-ratio:5.1f}% 절감)  {src.relative_to(ROOT)}")
            else:
                tmp.replace(src)
                total_after += after
                print(f"  ✓   {fmt_bytes(before):>8} → {fmt_bytes(after):>8} ({-ratio:5.1f}% 절감)  {src.relative_to(ROOT)}")
    except Exception as e:
        if tmp.exists(): tmp.unlink()
        errors.append((src, str(e)))
        skipped += 1
        total_after += before
        print(f"  !!! ERROR: {src.relative_to(ROOT)} — {e}")

print('─' * 80)
print(f"Before : {fmt_bytes(total_before)}")
print(f"After  : {fmt_bytes(total_after)}   ({(1-total_after/total_before)*100:.1f}% 절감)")
print(f"KEPT   : {kept} (압축 결과가 더 커서 원본 유지)")
print(f"ERROR  : {skipped}")
if errors:
    for p, e in errors:
        print(f"  - {p.relative_to(ROOT)}: {e}")
