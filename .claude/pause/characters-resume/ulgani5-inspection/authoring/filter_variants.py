"""Copy of a character .blend keeping only the variants whose id contains `keep` (the head-row or suit-row sibling
sheets through packages/tools/blender/turntable.py --family)."""
import sys, bpy
argv = sys.argv[sys.argv.index('--') + 1:]
out, keep = argv[0], argv[1]
drop = [c.name for c in bpy.data.collections
        if not c.name.endswith(tuple(f'_LOD{n}' for n in range(4))) and ('_head' in c.name or '_suit' in c.name)
        and keep not in c.name]
names = set()
for n in drop:
    c = bpy.data.collections[n]
    names.add(n)
    names.update(ch.name for ch in c.children_recursive)
objs = {o.name for n in names for o in bpy.data.collections[n].objects}
for n in objs:
    o = bpy.data.objects.get(n)
    if o is not None and not any(c.name not in names for c in o.users_collection):
        bpy.data.objects.remove(o)
for n in names:
    c = bpy.data.collections.get(n)
    if c is not None:
        bpy.data.collections.remove(c)
print('kept', sorted(c.name for c in bpy.data.collections if keep in c.name and '_LOD' not in c.name))
bpy.ops.wm.save_as_mainfile(filepath=out)
