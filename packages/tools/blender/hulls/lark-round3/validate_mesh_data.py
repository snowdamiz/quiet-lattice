"""Inspect Blender's own mesh repairs before export; save only explicit data repairs."""
import bpy,json,hashlib,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
before=hashlib.sha256(SRC.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
def geometry(mesh):
    h=hashlib.sha256()
    for v in mesh.vertices:h.update(struct.pack('<3f',*v.co))
    for p in mesh.polygons:
        h.update(struct.pack('<II',len(p.vertices),p.material_index))
        h.update(struct.pack('<'+'I'*len(p.vertices),*p.vertices))
    for uv in mesh.uv_layers:
        for value in uv.data:h.update(struct.pack('<2f',*value.uv))
    return {'surface_sha256':h.hexdigest(),'vertices':len(mesh.vertices),'edges':len(mesh.edges),'polygons':len(mesh.polygons),'loops':len(mesh.loops),'attributes':[a.name for a in mesh.attributes]}
def face_signatures(mesh):
    return { (p.material_index,tuple(p.vertices),tuple(tuple(layer.data[i].uv) for layer in mesh.uv_layers for i in p.loop_indices)) for p in mesh.polygons }
hero_before={o.name:geometry(o.data) for c in bpy.data.collections if c.name.endswith('_LOD0') for o in c.objects if o.type=='MESH'}
images_before={i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file}
records=[]
for mesh in bpy.data.meshes:
    initial=geometry(mesh)
    vertices=tuple(tuple(v.co) for v in mesh.vertices);faces=face_signatures(mesh)
    changed=mesh.validate(verbose=True,clean_customdata=True)
    if changed:
        owners=[o for o in bpy.data.objects if o.type=='MESH' and o.data==mesh]
        assert owners and all(any(c.name.endswith(('_LOD1','_LOD2','_LOD3')) for c in o.users_collection) for o in owners)
        assert tuple(tuple(v.co) for v in mesh.vertices)==vertices
        assert face_signatures(mesh)<=faces,'A surviving face changed its material or UVs'
        record={'mesh':mesh.name,'before':initial,'after':geometry(mesh),'owners':[o.name for o in owners]};records.append(record);print('MESH REPAIR',json.dumps(record),flush=True)
assert records,'Exporter warning was not reproduced in source; inspect exporter transformations instead'
assert not any(mesh.validate() for mesh in bpy.data.meshes)
hero_after={o.name:geometry(o.data) for c in bpy.data.collections if c.name.endswith('_LOD0') for o in c.objects if o.type=='MESH'}
assert hero_before==hero_after
assert images_before=={i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file}
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(OUT/'mesh-data-repair.json').write_text(json.dumps({'before_source_sha256':before,'after_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'repairs':records,'lod0_exact_surface_inventory':hero_after,'packed_image_hashes_unchanged':images_before,'surface_policy':'Removed duplicate faces only from LOD1-3. Every vertex coordinate and every surviving face material and UV unchanged. LOD0 surfaces and packed maps byte-identical.'},indent=2)+'\n')
