import bpy,json,sys
from pathlib import Path
bpy.ops.wm.open_mainfile(filepath=str(Path(sys.argv[sys.argv.index('--')+1]).resolve()))
o=bpy.data.objects['R4_Structure_l1'];me=o.data
for p in me.polygons:
    bad=[li for li in p.loop_indices if me.corner_normals[li].vector.length<.99]
    if bad:
        print(json.dumps({'face':p.index,'area':p.area,'polygon_normal':p.normal[:],'vertices':[me.vertices[i].co[:] for i in p.vertices],'corner_normals':[me.corner_normals[li].vector[:] for li in p.loop_indices]}))
