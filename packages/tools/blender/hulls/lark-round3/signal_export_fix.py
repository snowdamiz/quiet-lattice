"""Preserve husk signal colours above glTF-Transform's zero-elision tolerance."""
import bpy,hashlib,json,subprocess,os
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5];SRC=ROOT/'assets/blend/hulls/lark.blend';OUT=ROOT/'assets/renders/hulls/lark-round3-current'
before=hashlib.sha256(SRC.read_bytes()).hexdigest();assert before=='2f363b8f8658c5ddbd1b50dcf4dbc3cea8553d87cab9570bd76a1d647caa65fd'
bpy.ops.wm.open_mainfile(filepath=str(SRC));bpy.context.preferences.filepaths.save_version=0
def geometry():
    records={}
    for obj in bpy.data.objects:
        h=hashlib.sha256(np.array(obj.matrix_world,dtype=np.float32).tobytes())
        if obj.type=='MESH':
            mesh=obj.data
            for coll,prop,size,dtype in [(mesh.vertices,'co',3,np.float32),(mesh.loops,'vertex_index',1,np.int32),(mesh.polygons,'material_index',1,np.int32),(mesh.polygons,'loop_start',1,np.int32),(mesh.polygons,'loop_total',1,np.int32)]:
                values=np.empty(len(coll)*size,dtype);coll.foreach_get(prop,values);h.update(values.tobytes())
            for uv in mesh.uv_layers:
                values=np.empty(len(uv.data)*2,np.float32);uv.data.foreach_get('uv',values);h.update(values.tobytes())
        records[obj.name]=h.hexdigest()
    return records
def images():return {i.name:hashlib.sha256(bytes(i.packed_file.data)).hexdigest() for i in bpy.data.images if i.packed_file}
old_geometry=geometry();old_images=images()
husk={s.material for o in bpy.data.collections['lark_husked_LOD0'].objects if o.type=='MESH' for s in o.material_slots if s.material}
other={s.material for c in ('lark_LOD0','lark_damaged_LOD0') for o in bpy.data.collections[c].objects if o.type=='MESH' for s in o.material_slots if s.material}
changed=[];pending=[]
for mat in husk:
    semantic=mat.get('engine_name','')
    if semantic=='EngineGlow' or semantic.startswith('Nav'):
        assert mat not in other
        bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');socket=bs.inputs['Emission Strength'];old=socket.default_value
        color=bs.inputs['Emission Color'];assert not color.is_linked
        rgb=list(color.default_value[:3]);assert max(rgb)>0
        factor=[v*old for v in rgb]
        strength=.0001/max(rgb)
        changed.append({'material':mat.name,'semantic':semantic,'emission_rgb':rgb,'before_strength':old,'before_factor':factor,'after_strength':strength,'after_factor':[v*strength for v in rgb]})
        pending.append((socket,strength))
assert len(changed)==4
command=[os.environ['LARK_NODE'],str(Path(__file__).with_name('probe_materials.mjs'))]
probe=subprocess.run(command,input=json.dumps(changed),capture_output=True,text=True,timeout=20,check=True)
serialized=json.loads(probe.stdout)
assert all(r['after'].get('emissiveFactor') and max(r['after']['emissiveFactor'])>=.000099 for r in serialized)
assert all(not r['before'].get('emissiveFactor') for r in serialized if r['semantic'].startswith('Nav'))
for socket,strength in pending:socket.default_value=strength
assert geometry()==old_geometry and images()==old_images
bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
(OUT/'signal-export-correction-v2.json').write_text(json.dumps({'input_source_sha256':before,'output_source_sha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'changes':changed,'serialization_probe':{'command':command,'exit_code':probe.returncode,'results':serialized},'geometry_transform_uv_hashes_unchanged':old_geometry,'packed_image_hashes_unchanged':old_images,'reason':'The inherited husk Nav RGB values are themselves near black. Normalize effective RGB times strength to peak 1e-4, not strength alone. Exact actual material-factor probe reproduces loss before and survival after. Only four husk strengths changed; base/damaged, geometry and maps unchanged. Parent judges final husk appearance.'},indent=2)+'\n')
