"""Make PNGs 24-bit with no alpha channel, as the Chrome Web Store requires.

    python scripts/flatten-png.py marketing/store
"""
import sys
from pathlib import Path

from PIL import Image

for png in Path(sys.argv[1]).glob('*.png'):
    im = Image.open(png)
    if im.mode != 'RGB':
        im.convert('RGB').save(png, optimize=True)
    print(png.name, Image.open(png).size, Image.open(png).mode)
