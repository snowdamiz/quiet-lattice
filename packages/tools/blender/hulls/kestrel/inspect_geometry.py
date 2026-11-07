import bpy, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core
core.load(ROOT/'assets/blend/hulls/kestrel.blend')
out={}
for o in bpy.data.collections['kestrel'].objects:
    out[o.name]={'loc':list(o.matrix_world.translation),'bbox': [list(o.matrix_world @ Vector(c)) for c in o.bound_box] if o.type=='MESH' else None}
for name in ['Body','CockpitInteriorMesh','CanopyGlass','GearFront_leg']:
    o=bpy.data.objects[name];me=o.data
    parents=list(range(len(me.vertices)))
    def find(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    for e in me.edges:
        a,b=map(find,e.vertices);parents[a]=b
    comps={}
    for v in me.vertices:comps.setdefault(find(v.index),[]).append(v)
    faces={}
    for p in me.polygons:faces.setdefault(find(p.vertices[0]),[]).append(p)
    out[name]=[]
    for key,vs in comps.items():
        ps=faces.get(key,[]);pts=[o.matrix_world@v.co for v in vs]
        out[name].append({'key':key,'verts':len(vs),'faces':len(ps),'materials':sorted({o.material_slots[p.material_index].material.name for p in ps}), 'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]})
(ROOT/'assets/renders/hulls/kestrel-round3-current/geometry-before.json').write_text(json.dumps(out,indent=2))
print('written geometry inventory')
