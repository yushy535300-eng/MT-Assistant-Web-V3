from PIL import Image
import sys
src, dest = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
im = im.resize((512, 512), Image.Resampling.LANCZOS)
im.save(dest)
print('wrote', dest)