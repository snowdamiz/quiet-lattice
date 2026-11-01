import bpy
print("VERSION", bpy.app.version_string)
for c in bpy.context.scene.collection.children:
    print("TOP", c.name, len(c.all_objects), [ch.name for ch in c.children][:12])
ref = bpy.data.collections.get("REF")
for o in ref.objects:
    print("REF", o.name, o.type, tuple(round(x,2) for x in o.dimensions), o.location[:])
for m in list(bpy.data.materials)[:12]:
    if not m.node_tree: continue
    print("MAT", m.name, m.get("engine_name"), m.library, [n.type for n in m.node_tree.nodes][:14])
for im in list(bpy.data.images)[:10]:
    print("IMG", im.name, im.size[:], im.packed_file is not None, im.filepath)
o = next(o for o in bpy.data.objects if o.type=='MESH' and 'LOD0' in (o.users_collection[0].name))
print("UV", o.name, [u.name for u in o.data.uv_layers])
