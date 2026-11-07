import bpy
print('IMGS', bpy.data.filepath.rsplit('/', 1)[-1], sorted((i.name, tuple(i.size)) for i in bpy.data.images if i.size[0]))
print('TEXTS', [t.name for t in bpy.data.texts])
