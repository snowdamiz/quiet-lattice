"""Copy of a character source with every texture larger than `res` scaled down (JPEG re-encoded), for the in-engine
export at 2048 while the 4k sources wait for KTX2 compression."""
import sys, os, bpy
argv = sys.argv[sys.argv.index('--') + 1:]
out, res, texdir = argv[0], int(argv[1]), argv[2]
os.makedirs(texdir, exist_ok=True)
for im in list(bpy.data.images):
    if im.size[0] > res:
        name = im.name
        cs = im.colorspace_settings.name
        im.scale(res, res)
        p = os.path.join(texdir, name + '.jpg')
        im.file_format = 'JPEG'
        im.filepath_raw = p
        im.save(filepath=p, quality=92)
        im.unpack(method='REMOVE') if im.packed_file else None
        im.filepath = p
        im.reload()
        im.colorspace_settings.name = cs
        im.pack()
        print('scaled', name, im.size[:])
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
