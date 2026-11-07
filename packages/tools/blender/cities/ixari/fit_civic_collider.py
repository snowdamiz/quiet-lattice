"""Fit the listening hall's bowed fracture bed to the actual saved stone surface."""
import hashlib
import json
from pathlib import Path
import bpy

ROOT=Path(__file__).resolve().parents[5]
source=ROOT/'assets/blend/cities/ixari_civic.blend'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
bpy.context.preferences.filepaths.save_version=0
mesh=bpy.data.objects['ixari_listening_house_Facets']
group=mesh.vertex_groups['ShaftBed18']
ids=[v.index for v in mesh.data.vertices if any(g.group==group.index for g in v.groups)]
index={old:new for new,old in enumerate(ids)}
faces=[tuple(index[i] for i in p.vertices) for p in mesh.data.polygons if all(i in index for i in p.vertices)]
collider=bpy.data.objects['COL_ixari_listening_house_ShaftBed18']
data=bpy.data.meshes.new(collider.name+'_Fitted')
data.from_pydata([mesh.data.vertices[i].co for i in ids],[],faces);data.update();collider.data=data
assert len(data.loops)-2*len(data.polygons)<=512
bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
ip=ROOT/'assets/blend/cities/ixari/inventory/civic.json'
inventory=json.loads(ip.read_text())
for entry in inventory:entry['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
ip.write_text(json.dumps(inventory,indent=2)+'\n')
