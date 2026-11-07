import bpy,json,os
from pathlib import Path
p='/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects/3c/34/3c3437f2fbc6b6523113c5e45d9bb8f5b06cce33b3bcb3c57d4a391fdc035dd4'
bpy.ops.wm.open_mainfile(filepath=p)
report={}
for suffix in ['', '_dmg','_husk']:
 o=bpy.data.objects['Body'+suffix+'_l3'];me=o.data
 bad={i for i,n in enumerate(me.corner_normals) if n.vector.length<.99}
 faces=[{'index':f.index,'area':f.area,'loops':len(f.loop_indices),'normal_length':f.normal.length,'positions':[me.vertices[i].co[:] for i in f.vertices]} for f in me.polygons if bad.intersection(f.loop_indices)]
 report[o.name]={'nonunit_normals_before_any_edits':len(bad),'faces':faces,'total_small_faces':sum(f.area<1e-10 for f in me.polygons)}
(Path(os.environ['MULE_ATTEMPT'])/'far-normal-diagnosis.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:{x:v[x] for x in ['nonunit_normals_before_any_edits','total_small_faces']} for k,v in report.items()},indent=2))
