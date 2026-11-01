import sys
import bpy
import numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
import os
paths, out = [os.path.abspath(p) for p in a[:-1]], os.path.abspath(a[-1])
imgs = [bpy.data.images.load(p) for p in paths]
w, h = imgs[0].size
cols = 2
rows = (len(imgs) + 1) // 2
o = np.zeros((h * rows, w * cols, 4), np.float32)
for i, im in enumerate(imgs):
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    r, c = divmod(i, cols)
    o[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = px
img = bpy.data.images.new("o", w * cols, h * rows)
img.pixels.foreach_set(o.ravel())
img.filepath_raw = out
img.file_format = "PNG"
img.save()
print("MONTAGE", out)
