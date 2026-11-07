"""Save damage/panel-loss states, three PBR liveries each, and LODs derived from textured LOD0."""
import hashlib
import json
import math
from pathlib import Path
import sys
import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, bake, lods, rules, scene as S
import author_round3 as A
from atlas import SIZE, PALETTES, raster, fields, paint, make_image, bake_image, pixels, wire, linear

SRC=ROOT/'assets/blend/hulls/kestrel.blend'
OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'


def clone(objects, coll, independent):
    mapping={}
    for o in objects:
        c=o.copy()
        if independent and o.type=='MESH':c.data=o.data.copy()
        coll.objects.link(c);mapping[o]=c
    for o,c in mapping.items():
        if o.parent in mapping:
            c.parent=mapping[o.parent];c.matrix_parent_inverse=o.matrix_parent_inverse.copy()
    return list(mapping.values())


def local_materials(objects, state):
    mapping={}
    for o in objects:
        if o.type!='MESH':continue
        for slot in o.material_slots:
            old=slot.material
            if old not in mapping:
                new=old.copy();new.name='Kestrel_R3_'+state+'_'+old.get('engine_name',old.name);mapping[old]=new
            slot.link='OBJECT';slot.material=mapping[old]
    return list(mapping.values())


def panel_loss(body,state):
    me=body.data;parents=list(range(len(me.vertices)))
    def find(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for e in me.edges:
        a,b=map(find,e.vertices);parents[a]=b
    groups={}
    for p in me.polygons:groups.setdefault(find(p.vertices[0]),[]).append(p)
    reg=me.attributes['paint_region']
    panels=[]
    for ps in groups.values():
        if not all(reg.data[p.index].value==0 for p in ps):continue
        area=sum(p.area for p in ps)
        if area<.02:continue
        centre=sum((p.center*p.area for p in ps),Vector())/area
        panels.append({'faces':[p.index for p in ps],'area':area,'centre':centre})
    total=sum(p['area'] for p in panels)
    chosen=[]
    if state=='damaged':
        for target in [Vector((3.8,-2.8,.4)),Vector((-.85,-2.6,.15))]:
            p=min((p for p in panels if p not in chosen),key=lambda p:(p['centre']-target).length);chosen.append(p)
    else:
        def rank(p):
            c=p['centre']
            return min((c-Vector((3.8,-2.6,.4))).length, (c-Vector((-.8,-2.5,.2))).length, (c-Vector((0,-5.5,.5))).length)
        for p in sorted(panels,key=rank):
            if (sum(x['area'] for x in chosen)+p['area'])/total>.29:continue
            if (len(chosen)+1)/len(panels)>.29:continue
            chosen.append(p)
            if len(chosen)/len(panels)>=.19 and sum(x['area'] for x in chosen)/total>=.19:break
        assert .15<=len(chosen)/len(panels)<=.30
        assert .15<=sum(x['area'] for x in chosen)/total<=.30
    doomed={i for p in chosen for i in p['faces']}
    bm=bmesh.new();bm.from_mesh(me);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.faces[i] for i in doomed],context='FACES');bm.to_mesh(me);bm.free()
    return {'outerPanelsBefore':len(panels),'panelsRemoved':len(chosen),'panelFraction':len(chosen)/len(panels),'surfaceAreaFraction':sum(p['area'] for p in chosen)/total,'removedCentres':[list(p['centre']) for p in chosen]}


def add_husk_seams(body,coll,materials):
    A.COLL=coll;glow=next(m for m in materials if m.get('engine_name')=='EngineGlow')
    bs=next(n for n in glow.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Emission Color'].default_value=(*linear('#9FE8DA'),1);bs.inputs['Emission Strength'].default_value=.5
    additions=[]
    for s in (-1,1):
        additions.append(A.tube('HollowRootSeam',[(s*.94,-.98,.49),(s*.97,-.50,.50),(s*.96,-.02,.52)],[.008,.01,.008],glow,4))
    # Canonical alphabet fragment 'a': centre-to-north, then northeast (art/glyph-alphabet.svg).
    for y in (-3.1,-4.1):
        additions.append(A.tube('HollowGlyphFragment',[(-.80,y,.12),(-.80,y,.32),(-.80,y-.173,.22)],[.008,.008,.008],glow,4))
    body=A.join([body,*additions],body.name)
    for p in body.data.polygons:
        if body.data.attributes['paint_region'].data[p.index].value==4:
            for li in p.loop_indices:body.data.uv_layers.active.data[li].uv=(0,0)
    return body


def main():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert bpy.context.scene.get('kestrel_stage')=='base_atlas_baked'
    bpy.context.preferences.filepaths.save_version=0
    sc=bpy.context.scene;bake.ensure_cycles(sc,16);sc.render.threads_mode='FIXED';sc.render.threads=2
    asset=bpy.data.collections['kestrel'];base=list(bpy.data.collections['kestrel_LOD0'].objects)
    A.ASSET=asset
    for side in (-1,1):
        x0,x1=sorted((side*1.0,side*2.1))
        A.collider('COL_EnginePort' if side<0 else 'COL_EngineStarboard',(x0,-6.55,-.67),(x1,-.95,.30))
    normal=bpy.data.images['Kestrel_R3_LOD0_Normal_4096']
    report={'inputSha256':before,'states':{},'liveries':list(PALETTES),'normalAtlasOrigin':'CPU Cycles bake on base LOD0; retained surfaces preserve the exact same UVs and relief in damage/husk states','runtimeDraws':'NOT MEASURED'}
    for state in ('damaged','husked'):
        coll=bpy.data.collections.new('kestrel_'+state+'_LOD0');asset.children.link(coll);objects=clone(base,coll,True)
        mats=local_materials(objects,state);body=next(o for o in objects if o.name.split('.')[0]=='Body')
        loss=panel_loss(body,state)
        if state=='husked':
            body=add_husk_seams(body,coll,mats);objects=list(coll.objects)
            nav=next(m for m in mats if m.get('engine_name')=='NavWhite')
            bs=next(n for n in nav.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(.005,.006,.006,1);bs.inputs['Emission Color'].default_value=(1e-6,1e-6,1e-6,1);bs.inputs['Emission Strength'].default_value=1e-6
            nav['round3_note']='dormant: 1e-12 radiance preserves shared signal profile without visible running lights'
            for o in objects:
                if o.name.startswith('Light_'):o['intensity']=0.0
        meshes=[o for o in objects if o.type=='MESH' and not o.name.startswith('SporeNavigation')]
        atlas,mask,coverage=raster(meshes);f=fields(atlas)
        ao=bake_image(meshes,'Kestrel_R3_'+state+'_AO_4096','AO',mask)
        packed=np.zeros((SIZE,SIZE,3),np.float32);packed[:,:,0]=pixels(ao)[:,:,0];packed[:,:,1]=np.clip(f['rough']+(.10 if state=='husked' else .04),0,1)
        orm=make_image('Kestrel_R3_'+state+'_ORM_4096',packed);bpy.data.images.remove(ao)
        colours={l:make_image('Kestrel_R3_'+state+'_'+l+'_Color_4096',paint(atlas,f,l,state),True) for l in PALETTES}
        for mat in mats:
            if mat.get('engine_name') in ('Hull','Accent','Trim','Dark','Glass'):wire(mat,colours['ulgani'],orm,normal)
        report['states'][state]={'panelLoss':loss,'atlas':coverage,'ao':'CPU Cycles, this state LOD0 only'}
        del atlas,mask,f,packed
    # Save real lower LOD geometry, preserving the LOD0 UVs and exact shared images.
    r=rules.load();model=S.collect_source(r);S.assign_classes(r,'hulls',model)
    for v in model.assets[0].variants.values():
        for n,ratio in enumerate((.30,.10,.035),1):
            coll=bpy.data.collections.new(v.id+'_LOD'+str(n));asset.children.link(coll)
            objects=clone(v.lods[0],coll,True);meshes=S.render_meshes(r,objects)
            tris0=sum(S.tri_count(o) for o in S.render_meshes(r,v.lods[0]))
            lods._decimate(meshes,int(tris0*ratio))
        print('saved lower LODs',v.id,flush=True)
    # Actual material sets and variants for all three liveries, without runtime shader substitutions.
    model=S.collect_source(r)
    for v in model.assets[0].variants.values():
        state='base' if v.id=='kestrel' else v.id.removeprefix('kestrel_')
        for livery in ('compact','working'):
            variant=v.id+'_'+livery
            new_objects=[]
            for n,objects in v.lods.items():
                coll=bpy.data.collections.new(variant+'_LOD'+str(n));asset.children.link(coll)
                new_objects+=clone(objects,coll,False)
            mats=local_materials(new_objects,state+'_'+livery)
            for mat in mats:
                if mat.get('engine_name') in ('Hull','Accent','Trim','Dark','Glass'):
                    wire(mat,bpy.data.images['Kestrel_R3_'+state+'_'+livery+'_Color_4096'],bpy.data.images['Kestrel_R3_'+state+'_ORM_4096'],normal)
                    mat['livery_name']=livery
    # Fake-user legacy images were removed in the base bake; the one relief image remains editable authoring data.
    asset['round3']='saved geometry, packed 4096 LOD0 atlases, 9 state/livery combinations, four LODs each'
    sc['kestrel_stage']='final'
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    report['outputSha256']=hashlib.sha256(SRC.read_bytes()).hexdigest()
    report['images']=[{'name':i.name,'packedSha256':hashlib.sha256(i.packed_file.data).hexdigest(),'size':list(i.size)} for i in bpy.data.images if i.name.startswith('Kestrel_R3_')]
    (OUT/'states-and-liveries.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))


if __name__=='__main__':main()
