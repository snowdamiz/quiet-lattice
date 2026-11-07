import bpy, numpy as np
for im in bpy.data.images:
    w, h = im.size
    px = np.empty(w * h * im.channels, np.float32) if w else None
    if px is not None:
        im.pixels.foreach_get(px)
        px = px.reshape(-1, im.channels)
        print(im.name, im.size, im.channels, im.colorspace_settings.name, im.source, im.packed_file is not None, px.std(0), px.mean(0))
    else:
        print(im.name, 'empty')
