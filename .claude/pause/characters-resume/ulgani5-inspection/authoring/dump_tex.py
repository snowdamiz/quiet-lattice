import sys, os, bpy, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
outdir = argv[0]; names = argv[1].split(',')
os.makedirs(outdir, exist_ok=True)
for n in names:
    im = bpy.data.images.get(n)
    if im is None:
        print('missing', n, [i.name for i in bpy.data.images][:30]); continue
    im2 = im.copy(); im2.filepath_raw = os.path.join(outdir, n + '.png'); im2.file_format = 'PNG'; im2.save()
    print('saved', n, im.size[:])
# also UV layout of the head object
o = bpy.data.objects.get('TH_Head1_head1_L0')
if o:
    uv = o.data.uv_layers.active
    a = np.empty(len(o.data.loops) * 2); uv.data.foreach_get('uv', a); a = a.reshape(-1, 2)
    print('head uv range', a.min(0), a.max(0), 'materials', [m.name for m in o.data.materials])
