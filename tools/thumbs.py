#!/usr/bin/env python3
"""Make the small copies of the photos that project cards and gallery tiles load.

    python3 tools/thumbs.py        (needs Pillow: pip install pillow)

Writes thumbs/<name> for every photos/<name> that has none or is newer than its copy, and removes
copies whose photo is gone. A photo without a copy still works: the page loads the full one.
"""
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parent.parent
src, out = root / "photos", root / "thumbs"
out.mkdir(exist_ok=True)
made = 0
for photo in sorted(src.iterdir()):
    if photo.suffix.lower() not in {".webp", ".jpg", ".jpeg", ".png"}:
        continue
    small = out / photo.name
    if small.exists() and small.stat().st_mtime >= photo.stat().st_mtime:
        continue
    image = ImageOps.exif_transpose(Image.open(photo))
    image.thumbnail((900, 1200))
    image.save(small, quality=72, method=6)
    made += 1
for small in out.iterdir():
    if not (src / small.name).exists():
        small.unlink()
print(f"thumbs: made {made}")
