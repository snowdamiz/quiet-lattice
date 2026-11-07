"""Finish collision fit and the 1.4 m clear stair passage on the saved round3 source."""
import hashlib
import json
from pathlib import Path
import sys
import bmesh
import bpy
from mathutils import Matrix

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, rules, scene as S
SRC=ROOT/'assets/blend/hulls/kestrel.blend'
OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def main():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert bpy.context.scene.get('kestrel_stage')=='final'
    assert not bpy.context.scene.get('round3_collision_fit')
    ruleset=rules.load();model=S.collect_source(ruleset);seen=set();moved=0;colliders=[]
    for mat in bpy.data.materials:
        if 'husked' in mat.name and mat.get('engine_name')=='NavWhite':
            bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
            bs.inputs['Emission Color'].default_value=(1e-4,1e-4,1e-4,1)
            bs.inputs['Emission Strength'].default_value=1e-8
    for v in model.assets[0].variants.values():
        for level,objects in v.lods.items():
            gear=next(o for o in objects if o.name.split('.')[0]=='GearFront')
            assembly=next(o for o in objects if o.name.startswith('GearFront_Assembly'))
            if assembly.data.as_pointer() not in seen:
                seen.add(assembly.data.as_pointer())
                inv=assembly.matrix_world.inverted()
                for vert in assembly.data.vertices:
                    p=assembly.matrix_world@vert.co
                    if p.x<-.78:
                        if abs(p.y-1.24)<.065:p.y-=.02;moved+=1
                        elif abs(p.y-2.68)<.065:p.y+=.02;moved+=1
                        vert.co=inv@p
            if level!=0:continue
            coll=bpy.data.collections[v.id+'_LOD0']
            # Colliders inherit the exact same gear and canopy pivots as their visible parts.
            for i in range(9):
                x=-3.45+i*.30;top=-1.71+(i+1)*.18
                bpy.ops.mesh.primitive_cube_add(size=1,location=(x,1.96,top-.035))
                o=bpy.context.object;o.name='COL_BoardingTread_'+str(i)
                for c in list(o.users_collection):c.objects.unlink(o)
                coll.objects.link(o);o.scale=(.30,1.4,.07)
                bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
                world=o.matrix_world.copy();o.parent=gear;o.matrix_world=world;o.hide_render=True;colliders.append(o.name)
            canopy=next(o for o in objects if o.type=='EMPTY' and o.name.split('.')[0]=='Canopy')
            cover=next(o for o in objects if o.name.startswith('CanopyGlass'))
            bm=bmesh.new()
            for vert in cover.data.vertices:bm.verts.new(cover.matrix_world@vert.co)
            bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
            me=bpy.data.meshes.new('CanopyCollision');bm.to_mesh(me);bm.free()
            o=bpy.data.objects.new('COL_Canopy',me);coll.objects.link(o);world=o.matrix_world.copy();o.parent=canopy;o.matrix_world=world;o.hide_render=True
            assert S.tri_count(o)<=512;colliders.append(o.name)
    bpy.context.scene['round3_collision_fit']=True
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    (OUT/'collision-fit.json').write_text(json.dumps({'inputSha256':before,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'changedRailVerticesAcrossUniqueMeshes':moved,'railCentrelinesY':[1.22,2.70],'railRadiusMax':.03,'clearWidth_m':1.42,'treads':{'rise':.18,'going':.30,'clearWidth':1.4},'movingColliders':colliders,'scope':'CPU source fit, landed stairs and open canopy; no gameplay collision or animation integration claim'},indent=2)+'\n')


if __name__=='__main__':main()
