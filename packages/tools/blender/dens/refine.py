"""First CPU review corrections, operating only on the existing editable sculpts.

Chiselled strata, broken cage, worn bark and irregular weave replace the overly
smooth first pass. Refuses to apply a revision twice. Not part of export.
"""
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).parent))
import author as A

for name,radius,_ in A.ASSETS:
    file=A.OUT/(name+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(file))
    scene=bpy.context.scene
    if scene.get('den_revision'): raise RuntimeError('Revision already applied')
    A.ASSET=bpy.data.collections[name]; A.LOD=bpy.data.collections[name+'_LOD0']
    ob=bpy.data.objects[name+'_Sculpt']; A.MAT=ob.data.materials[0]
    groups={g.index:g.name for g in ob.vertex_groups}
    stone_prefix=('SlippedShale','LairButtress','FanStone','PerchShelf','FallenShard','EarthHaunch')
    wood_prefix=('VaultRoot','AncientSnag','CrownBough','ShelterStem','PerchBough','FossilRib','BrokenSpine')
    bygroup={}
    for v in ob.data.vertices:
        gn=groups[v.groups[0].group]
        bygroup.setdefault(gn,[]).append(v)
    for gn,verts in bygroup.items():
        if gn.startswith(stone_prefix):
            lo=Vector(tuple(min(v.co[k] for v in verts) for k in range(3)))
            hi=Vector(tuple(max(v.co[k] for v in verts) for k in range(3)))
            center=(lo+hi)/2; size=(hi-lo)/2
            for v in verts:
                q=v.co-center
                # Chisel broad, sloping fracture planes into the rounded shoulder.
                for normal,offset in [((1,.3,.35),.78),((-.7,1,.4),.82),((.1,-1,.2),.82),((.25,.15,1),.86)]:
                    n=Vector(normal).normalized()
                    unit=Vector(tuple(q[k]/max(size[k],.01) for k in range(3)))
                    over=unit.dot(n)-offset
                    if over>0:
                        q-=Vector(tuple(n[k]*size[k]*over*.85 for k in range(3)))
                band=math.sin((q.z+.18*q.x-.12*q.y)*15)
                groove=max(0,band-.8)*.16
                q.x*=1-groove; q.y*=1-groove
                if 'Earth' not in gn:
                    q.z+=.035*math.sin(q.x*7+q.y*5)*math.sin(q.y*3-q.z*2)
                v.co=center+q
        elif gn.startswith(('WovenCourse','DishWeave','CrossWicker')):
            for v in verts:
                p=v.co; angle=math.atan2(p.x,p.y)
                p.x+=.07*math.sin(angle*7+p.z*11)
                p.y+=.06*math.cos(angle*9-p.z*7)
                p.z+=.065*math.sin(angle*5+p.z*4)
        elif gn.startswith('FossilRib2'):
            # One rib broke away at the eastern arch: fracture, not another vault.
            for v in verts:
                if v.co.x>1.7: v.co.z-=min(2.5,(v.co.x-1.7)*.9)
        elif gn.startswith('FossilRib0'):
            for v in verts: v.co.y-=.18*v.co.x; v.co.z*=.90
    ob.data.update()
    # Paint geological bands and scars across the existing mesh corners. Colours
    # are baked into the atlas; they are not a runtime recolouring material.
    paint=ob.data.color_attributes['Wear']
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            v=ob.data.vertices[ob.data.loops[li].vertex_index]
            gn=groups[v.groups[0].group]; p=v.co
            col=list(paint.data[li].color)
            if gn.startswith(stone_prefix):
                seam=abs(math.sin((p.z+.18*p.x-.12*p.y)*15))
                dark=.40 if seam>.94 else .78+.12*math.sin(p.z*2.5+p.x)
                for k in range(3): col[k]*=dark
                # Sheltered moss streaks on the lower shoulders.
                moss=max(0,math.sin(p.x*4+p.y*3)-.55)*max(0,1-p.z/3)
                for k in range(3): col[k]=col[k]*(1-moss)+A.MOSS[k]*moss
            elif gn.startswith(wood_prefix):
                scar=abs(math.sin(p.x*31+p.y*7+math.sin(p.z*2.5)*1.3))
                dark=.35 if scar>.96 else .65+.18*math.sin(p.z*6+p.x*2)
                for k in range(3): col[k]*=dark
            elif gn.startswith(('Bedding','ShelterBlade','Woven','Dish','Cross')):
                for k in range(3): col[k]*=.48+.2*(.5+.5*math.sin(p.x*8+p.y*11))
            paint.data[li].color=col
    # Fissures and loose tendrils are real geometry, with editable part groups.
    if name=='den_burrow_1':
        for i in range(4):
            A.sweep(f'RockFissure{i}',[(-2.4+i*.75,-.98,2.55),(-2.2+i*.75,-1.08,2.58),(-2.05+i*.75,-.97,2.75)], [.018,.032,.01],A.EARTH,sides=8,steps=4)
    if name=='den_roost_0':
        for i in range(8):
            x=-1.6+i*.17
            A.sweep(f'BarkRidge{i}',[(x,.56,.2),(x-.1,.65,1.6),(x+.2,.65,3.3),(x+.15,.92,4.8)], [.035,.065,.045,.008],A.EARTH,sides=8,steps=8)
    if name=='den_apex_lair_0':
        for i in range(4):
            A.sweep(f'BrokenRibSplinter{i}',[(4.2+i*.35,1.4,2.3),(4.6+i*.3,1.3,3.0),(4.5+i*.3,1.2,3.6)], [.12,.075,.006],A.IVORY,sides=10,steps=6)
    # Smaller fronds break the planted fan silhouette and occupy crevices.
    positions={'den_burrow_0':[(-2.4,1.1,1.65),(1.8,1.7,1.5)],
               'den_burrow_1':[(-2.5,.7,1.5),(1.7,2,1.5)],
               'den_nest_0':[(-3.1,1.4,.9),(2.9,1.5,.7)],
               'den_nest_1':[(-2.4,2.1,.7),(2.6,1.7,.6)],
               'den_roost_0':[(-1.2,.8,2.8),(-.8,1,4.7)],
               'den_roost_1':[(-2.2,.65,2.2),(.1,1.7,3.1)],
               'den_apex_lair_0':[(-5.8,2.1,2.5),(4.8,3.1,2.4)]}
    for j,(x,y,z) in enumerate(positions[name]):
        for k in range(7):
            angle=k*.55
            A.leaf(f'CreviceFrond{j}_{k}',(x,y,z),(x+math.sin(angle)*.5,y-math.cos(angle)*.45,z-.5-k*.025),.055,A.MOSS)
    bpy.ops.object.select_all(action='DESELECT')
    for o in A.LOD.objects: o.select_set(True)
    bpy.context.view_layer.objects.active=ob; bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene['den_revision']='cpu-r1: chisel strata, bark scars, broken fossil rib, irregular woven courses'
    bpy.ops.wm.save_as_mainfile(filepath=str(file),compress=True)
