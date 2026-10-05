"""Fail closed if a structural PDF rewrite changes any page or image stream."""
import hashlib
import json
import sys
from pathlib import Path
import pymupdf as fitz

original, optimized = (fitz.open(p) for p in sys.argv[1:3])
output = Path(sys.argv[3])
assert len(original) == len(optimized) and len(original) > 0
sample = {0, len(original) // 2, len(original) - 1}
images = 0
for index, (before, after) in enumerate(zip(original, optimized)):
    assert before.rect == after.rect and before.rotation == after.rotation, (index, 'geometry')
    assert before.get_text() == after.get_text(), (index, 'text')
    # Image data is compared at its original resolution, not just at screen size.
    source = sorted(hashlib.sha256(original.extract_image(i[0])['image']).hexdigest() for i in before.get_images())
    target = sorted(hashlib.sha256(optimized.extract_image(i[0])['image']).hexdigest() for i in after.get_images())
    assert source == target, (index, 'image data')
    images += len(source)
    a = before.get_pixmap(dpi=72, alpha=False)
    b = after.get_pixmap(dpi=72, alpha=False)
    assert (a.width, a.height, a.samples) == (b.width, b.height, b.samples), (index, 'render')
    if index in sample:
        a = before.get_pixmap(dpi=160, alpha=False)
        b = after.get_pixmap(dpi=160, alpha=False)
        assert a.samples == b.samples, (index, 'high-resolution render')
        if index == 0:
            a.save(output / 'before.png')
            b.save(output / 'after.png')
print(json.dumps({'identical': True, 'pages': len(original), 'images': images, 'dpi': 72, 'sampleDpi': 160}))
