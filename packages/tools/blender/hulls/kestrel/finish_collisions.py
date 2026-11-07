"""Fit the measured landing-gear and outer-shell omissions without closing the port entry."""
import hashlib,json,sys
from pathlib import Path
import bmesh,bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[5];sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core,rules,scene as S
SRC=ROOT/'assets/blend/hulls/kestrel.blend';OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def hull(name,points,collection,parent):
    bm=bmesh.new()
    for p in points:bm.verts.new(p)
    result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    bmesh.ops.delete(bm,geom=list(set(result['geom_interior']+result['geom_unused'])),context='VERTS')
    mesh=bpy.data.meshes.new(name);bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj)
    world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world;obj.hide_render=True
    assert S.tri_count(obj)<=512,(name,S.tri_count(obj))
    return obj


def reshape_box(name,low,high):
    obj=bpy.data.objects[name];lo,hi=S.bounds([obj]);inv=obj.matrix_world.inverted()
    for v in obj.data.vertices:
        p=obj.matrix_world@v.co
        v.co=inv@Vector([low[i] if abs(p[i]-lo[i])<abs(p[i]-hi[i]) else high[i] for i in range(3)])


def refine():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert before=='d997c9e69af4f1293412c2a64f56cbb2ad1fd57b69fd1c17ba3a7cb38036bf70'
    model=S.collect_source(rules.load());asset=model.assets[0]
    for v in asset.variants.values():
        objects=v.lods[0];coll=bpy.data.collections[v.id+'_LOD0']
        canopy=next(o for o in objects if o.type=='EMPTY' and o.name.split('.')[0]=='Canopy')
        old=next(o for o in objects if o.name.startswith('COL_Canopy'))
        lo,hi=S.bounds([o for o in objects if o.type=='MESH' and o.name.startswith(('CanopyGlass','CanopyFrame'))])
        points=[Vector((x,y,z)) for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])]
        bpy.data.objects.remove(old,do_unlink=True);hull('COL_Canopy',points,coll,canopy)
    coll=bpy.data.collections['kestrel']
    for name,lo,hi in [('COL_HP_M_1',(-.42,2.20,-.99),(.42,3.18,-.48)),('COL_HP_S_1',(-1.9,-1.30,-.96),(-1.1,-.48,-.35)),('COL_HP_S_2',(1.1,-1.30,-.96),(1.9,-.48,-.35))]:
        hull(name,[Vector((x,y,z)) for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])],coll,None)
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    (OUT/'collision-refinement.json').write_text(json.dumps({'inputSha256':before,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'changes':'Closed canopy envelope follows pivot; three mount-root volumes below the cabin; no geometry or material change'},indent=2)+'\n')


def main():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert before=='e9219a15d8d4cfb8bfd0ce82b21d20858b3ef32ea8119c6e93617d6fee323856','requires measured pre-fit source'
    reshape_box('COL_BodyAft',(-1.0,-7.68,-.68),(1.0,1.10,1.40))
    reshape_box('COL_Nose',(-1.0,3.38,-.65),(1.0,7.12,1.10))
    for side in ('Port','Starboard'):
        obj=bpy.data.objects['COL_Engine'+side];lo,hi=S.bounds([obj])
        reshape_box(obj.name,(float(lo[0])-.04,-6.80,-.98),(float(hi[0])+.04,-.90,.34))
    model=S.collect_source(rules.load());created=[]
    for v in model.assets[0].variants.values():
        objects=v.lods[0];coll=bpy.data.collections[v.id+'_LOD0']
        for gear in ('Front','Left','Right'):
            parent=next(o for o in objects if o.name.split('.')[0]=='Gear'+gear)
            mesh=next(o for o in objects if o.name.startswith('Gear'+gear+'_Assembly'))
            points=[mesh.matrix_world@p.co for p in mesh.data.vertices]
            body=points if gear!='Front' else [p for p in points if p.x>-.70]
            created.append(hull('COL_Gear'+gear,body,coll,parent).name)
            if gear=='Front':
                for i,y in enumerate((1.22,2.70)):
                    rail=[p for p in points if p.x<-.70 and abs(p.y-y)<.08]
                    created.append(hull('COL_BoardingRail_'+str(i),rail,coll,parent).name)
        parent=next(o for o in objects if o.name.split('.')[0]=='Canopy')
        points=[o.matrix_world@p.co for o in objects if o.type=='MESH' and o.name.startswith(('CanopyGlass','CanopyFrame')) for p in o.data.vertices]
        old=next(o for o in objects if o.name.startswith('COL_Canopy'));bpy.data.objects.remove(old,do_unlink=True)
        created.append(hull('COL_Canopy',points,coll,parent).name)
    bpy.context.scene['round3_measured_collision_fit']=True
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    (OUT/'collision-correction.json').write_text(json.dumps({'inputSha256':before,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'created':created,'scope':'Landed source geometry and pivot-parented convex volumes only; runtime collision/animation remains unqualified'},indent=2)+'\n')


if __name__=='__main__':refine() if '--refine' in sys.argv else main()
