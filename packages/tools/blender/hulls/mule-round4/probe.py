import bpy, json, os
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path('assets/blend/hulls/mule.blend').resolve()))
me=bpy.data.objects['Body'].data
out={}
for k in ['plate','ds','dt','pid']:
 a=me.attributes[k]; out[k]={'min':min(d.value for d in a.data),'max':max(d.value for d in a.data)}
for i in [0,100,1000,10000]:
 p=me.polygons[i]
 out[str(i)]={'material':me.materials[p.material_index].name,'pid':me.attributes['pid'].data[i].value,'verts':[{'i':v,'co':list(me.vertices[v].co),'n':list(me.vertices[v].normal),**{k:me.attributes[k].data[v].value for k in ['plate','ds','dt']}} for v in p.vertices], 'uv':[list(me.uv_layers.active.data[j].uv) for j in p.loop_indices]}
print(json.dumps(out,indent=2))
