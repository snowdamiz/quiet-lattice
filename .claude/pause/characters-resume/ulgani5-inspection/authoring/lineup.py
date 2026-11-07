"""Side-by-side silhouette sheet from the in-engine far views: the three base bodies' far_lod2.png (noon-lush, LOD2, 100 m,
identical camera settings from the review scene) cropped round each figure at native pixels, side by side, and the same
crops enlarged 4x (nearest neighbour) below them so the silhouettes can be compared at a glance.
   Blender -b -P lineup.py -- <out.png> <far_lod2 a.png> <b.png> <c.png>"""
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
out, srcs = argv[0], argv[1:]
crops = []
for p in srcs:
    im = bpy.data.images.load(p)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    # the figure sits at the frame centre in the far view; crop a window round it
    cw, ch = 120, 120
    cx, cy = w // 2, h // 2
    crops.append(a[cy - ch // 2:cy + ch // 2, cx - cw // 2:cx + cw // 2].copy())
gap = 8
row1 = np.concatenate([np.pad(c, ((0, 0), (0, gap), (0, 0)), constant_values=0) for c in crops], 1)
big = [np.kron(c, np.ones((4, 4, 1), np.float32)) for c in crops]
row2 = np.concatenate([np.pad(b, ((0, 0), (0, gap * 4), (0, 0)), constant_values=0) for b in big], 1)
W = max(row1.shape[1], row2.shape[1])
row1 = np.pad(row1, ((0, gap), (0, W - row1.shape[1]), (0, 0)), constant_values=0)
row2 = np.pad(row2, ((0, 0), (0, W - row2.shape[1]), (0, 0)), constant_values=0)
sheet = np.concatenate([row2, row1], 0)   # Blender images run bottom-up: the enlarged row ends up below
sheet[..., 3] = 1.0
img = bpy.data.images.new('lineup', sheet.shape[1], sheet.shape[0], alpha=True)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = out
img.file_format = 'PNG'
img.save()
print('lineup: wrote', out, sheet.shape[1], 'x', sheet.shape[0])
