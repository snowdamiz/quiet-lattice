"""Repair circular strand pinching observed in the exported material close-ups.

Walk the existing quad rings from their end caps, preserving centerlines, radii,
UVs, parts and painted atlases. Parallel transport their frame instead of letting
it flip where a ring's tangent aligns with a fixed reference axis. No generator
or exporter is invoked here; this edits the saved source meshes.
"""
from pathlib import Path
import bpy
import math
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[4]
NAMES=['den_nest_0','den_nest_1','den_roost_0','den_roost_1']
for name in NAMES:
    path=ROOT/'assets/blend/sites'/(name+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(path))
    scene=bpy.context.scene
    if scene.get('den_weave_repair'): raise RuntimeError('Already repaired')
    # Repair the export mesh and the excluded editable paint source alike.
    for obname in [name+'_Sculpt','PaintSource_'+name]:
        ob=bpy.data.objects[obname]; data=ob.data
        groups=[g for g in ob.vertex_groups if g.name.startswith(('WovenCourse','DishWeave','PerchNest','StoneNest'))]
        neighbours={v.index:set() for v in data.vertices}
        for edge in data.edges:
            x,y=edge.vertices; neighbours[x].add(y); neighbours[y].add(x)
        for group in groups:
            indices={v.index for v in data.vertices if any(g.group==group.index for g in v.groups)}
            caps=[p for p in data.polygons if len(p.vertices)>4 and set(p.vertices)<=indices]
            assert len(caps)==2,(name,group.name,len(caps))
            ring=list(caps[0].vertices); rings=[]; seen=set()
            while ring:
                rings.append(ring); seen.update(ring)
                following=[list((neighbours[i]&indices)-seen) for i in ring]
                if all(not a for a in following): break
                assert all(len(a)==1 for a in following),(name,group.name,'ring topology')
                ring=[a[0] for a in following]
            assert seen==indices,(name,group.name,'unvisited vertices')
            centers=[sum((data.vertices[i].co for i in r),Vector())/len(r) for r in rings]
            side=None
            for k,r in enumerate(rings):
                c=centers[k]
                tangent=(centers[min(k+1,len(rings)-1)]-centers[max(0,k-1)]).normalized()
                if side is None: side=Vector((0,0,1))
                side=(side-tangent*side.dot(tangent)).normalized()
                up=tangent.cross(side).normalized()
                radius=sum((data.vertices[i].co-c).length for i in r)/len(r)
                for j,i in enumerate(r):
                    angle=math.tau*j/len(r)
                    flute=1+.05*math.cos(5*angle+k*.13)
                    data.vertices[i].co=c+radius*flute*(side*math.cos(angle)+up*math.sin(angle))
            print('REPAIRED',obname,group.name,len(rings),'rings',flush=True)
        data.update()
    # The second nest carries explicit reductions: remake them from the repaired
    # saved LOD0 with refine_nest_lods.py before export.
    scene['den_weave_repair']='parallel-transported existing circular strand quad rings after CPU close-up inspection'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
