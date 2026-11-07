"""Embeds the authoring scripts as text blocks (authoring/<path>) and saves the .blend to the given path."""
import sys, os, glob, bpy
argv = sys.argv[sys.argv.index('--') + 1:]
root, out = argv[0], argv[1]
files = sorted(glob.glob(os.path.join(root, '*.py')) + glob.glob(os.path.join(root, 'lib', '*.py')))
for f in files:
    rel = os.path.relpath(f, root)
    name = 'authoring/' + rel
    t = bpy.data.texts.get(name) or bpy.data.texts.new(name)
    t.clear()
    t.write(open(f).read())
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('embedded', len(files), 'scripts ->', out)
