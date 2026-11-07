import sys, bpy, numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
out = a[-1]; srcs = a[:-1]
tiles = []
for p in srcs:
    im = bpy.data.images.load(p)
    w, h = im.size
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    # over a checker so alpha shows
    chk = ((np.indices((h, w)).sum(0) // 32) % 2)[..., None] * 0.25 + 0.35
    rgb = px[..., :3] * px[..., 3:4] + chk * (1 - px[..., 3:4])
    step = max(1, w // 768)
    tiles.append(rgb[::step, ::step])
H = max(t.shape[0] for t in tiles); W = sum(t.shape[1] for t in tiles)
o = np.ones((H, W, 4), np.float32); x = 0
for t in tiles:
    o[:t.shape[0], x:x + t.shape[1], :3] = t; x += t.shape[1]
img = bpy.data.images.new("o", W, H); img.pixels.foreach_set(o.ravel()); img.filepath_raw = out; img.file_format = "PNG"; img.save()
