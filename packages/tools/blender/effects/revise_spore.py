"""Targeted source revision after the initial 5,292-triangle Spore failed the family gate."""
import json
import sys
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).parent))
from author import shape
from catalog import SOURCES

bpy.ops.wm.open_mainfile(filepath=str(SOURCES/'symbiotic.blend'),load_ui=False)
old=bpy.data.objects['symbiotic_spore_Surface']
mat=old.data.materials[0]
parent=old.users_collection[0]
bpy.data.objects.remove(old,do_unlink=True)
obj=shape('symbiotic','spore').object('symbiotic_spore_Surface',mat,parent)
obj.data.calc_loop_triangles()
m=json.loads((SOURCES/'manifest.json').read_text())
row=next(a for a in m['assets'] if a['id']=='symbiotic_spore')
row['triangles']=len(obj.data.loop_triangles)
row['boundsBlender']=[[min(v.co[i] for v in obj.data.vertices) for i in range(3)],
                      [max(v.co[i] for v in obj.data.vertices) for i in range(3)]]
assert 12<=row['triangles']<=5000
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCES/'symbiotic.blend'),compress=True)
(SOURCES/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print('REVISED SPORE',row['triangles'])
