"""Read the saved sources; emit measured geometry samples for the real loader test."""
import bpy
import hashlib
import json
import sys
sys.dont_write_bytecode=True
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE)); from author import INVENTORY

def array(mesh,name,prop,width):
    attr=mesh.attributes.get(name); assert attr is not None, name
    assert attr.domain=='POINT', (name,attr.domain)
    out=np.empty(len(attr.data)*width,np.float32); attr.data.foreach_get(prop,out)
    assert np.isfinite(out).all(),name
    return out.reshape(-1,width)

def check_rig(limb,pivot,glow,mask,walker=True):
    assert np.equal(limb,np.round(limb)).all(),'fractional limb ID'
    assert limb.min()>=0 and limb.max()<=8,'limb range'
    assert np.isin(glow,[0,1]).all(),'nonbinary glow'
    assert np.max(np.abs(mask[:,:3].sum(1)-1))<1e-5,'mask sum'
    assert mask.min()>=0 and mask.max()<=1,'mask range'
    assert (glow>0).mean()<.015,'glow coverage'
    for i in [1,2,3,4]:
        p=pivot[limb[:,0]==i]
        if len(p) and walker: assert (p[:,2]>0).all(),'Z-up hip pivot'

records=[]; controls=[]
for stem,suffixes in INVENTORY.items():
    family='constructs' if stem.startswith('outpost') else 'creatures'; path=ROOT/'assets/blend'/family/(stem+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(path))
    assert bpy.context.scene.unit_settings.scale_length==1
    assert any(Path(lib.filepath).name=='_library.blend' for lib in bpy.data.libraries),'linked library'
    assert all(lib.filepath.startswith('//') for lib in bpy.data.libraries),('portable library paths',[lib.filepath for lib in bpy.data.libraries])
    assert not any(o.type=='ARMATURE' for o in bpy.data.objects),'no humanoid rig'
    variants=[]; lod_checks=[]
    for suffix in suffixes:
        vid=stem+('_'+suffix if suffix else ''); coll=bpy.data.collections[vid+'_LOD0']
        objs=list(coll.objects); samples=[]; bounds=[]; tris=0; joints={}; shoulder=None
        for obj in objs:
            assert obj.type=='MESH'; assert obj.data.shape_keys is None
            assert tuple(obj.location)==(0,0,0) and tuple(obj.scale)==(1,1,1)
            me=obj.data; co=np.empty(len(me.vertices)*3,np.float32); me.vertices.foreach_get('co',co); co=co.reshape(-1,3)
            bounds.append(co); tris+=sum(len(p.vertices)-2 for p in me.polygons)
            assert me.uv_layers and all(s.material for s in obj.material_slots)
            for slot in obj.material_slots:
                assert not any(n.type=='TEX_NOISE' for n in slot.material.node_tree.nodes),'no noise stand-in'
            if family=='creatures':
                limb=array(me,'_limb','value',1); pivot=array(me,'_pivot','vector',3); glow=array(me,'_glow','value',1)
                ca=me.color_attributes; assert ca[0]==ca.active_color and ca.render_color_index==0
                assert ca[0].domain=='POINT'; mask=array(me,ca[0].name,'color',4)
                check_rig(limb,pivot,glow,mask,stem!='flyer')
                if stem.startswith('quad'):
                    shoulder=float(co[limb[:,0]==0,2].max())
                    lo_band,hi_band={'quad_heavy':(2.5,5),'quad_grazer':(1.2,2.4),'quad_small':(.4,1.2)}[stem]
                    assert lo_band<=shoulder<=hi_band,(vid,'body shoulder envelope',shoulder)
                assert not any(md.type=='ARMATURE' for md in obj.modifiers)
                for i in sorted(set(limb[:,0])):
                    ids=np.flatnonzero(limb[:,0]==i); p=pivot[ids]
                    assert np.max(np.abs(p-p[0]))<1e-6,('one posed joint per integer ID',vid,i)
                    joints[int(i)]=p[0].tolist()
                    picks=ids[np.linspace(0,len(ids)-1,min(40,len(ids)),dtype=int)]
                    for j in picks:
                        samples.append(dict(position=[float(co[j,0]),float(co[j,2]),float(-co[j,1])],limb=float(i),pivot=pivot[j].tolist(),glow=float(glow[j,0]),mask=mask[j].tolist()))
                    if i in (1,2,3,4) and stem!='flyer' and suffix in ('0','1','predator'):
                        h=float(p[0,2]); z=co[ids,2]/h
                        # Whole rings in the shader's blend bands, not isolated test vertices.
                        assert np.sum((z>=.38)&(z<=.62))>=72,(vid,i,'knee rings')
                        assert np.sum((z>=.10)&(z<=.24))>=48,(vid,i,'ankle rings')
                        assert np.min(co[ids,2])==0,(vid,i,'sole')
                        assert np.max(np.abs(co[ids,0]-p[:,0]))<h*.9,(vid,i,'near vertical')
                if not controls:
                    for label,change in [('fractional limb',lambda l,p,g,c:l.__setitem__((0,0),1.5)),
                                          ('zero mask',lambda l,p,g,c:c.__setitem__((0,slice(0,3)),0)),
                                          ('fractional glow',lambda l,p,g,c:g.__setitem__((0,0),.5)),
                                          ('Y-up pivot',lambda l,p,g,c:p.__setitem__((l[:,0]==1,2),0))]:
                        args=[x.copy() for x in [limb,pivot,glow,mask]]; change(*args)
                        try: check_rig(*args)
                        except AssertionError as e: controls.append(dict(control=label,rejected=str(e)))
                        else: raise AssertionError('malformed control accepted: '+label)
            else:
                assert not me.color_attributes and all(me.attributes.get(a) is None for a in ('_limb','_pivot','_glow'))
        allco=np.concatenate(bounds); lo=allco.min(0); hi=allco.max(0)
        assert 15000<=tris<=40000,(vid,tris)
        if stem=='biped':assert 1.6<=hi[2]<=2.6,(vid,hi[2])
        if stem=='flyer':assert 1<=hi[0]-lo[0]<=6
        if stem=='outpost_drone':assert 1.5<=max(hi-lo)<=3
        if stem=='outpost_overseer':assert 23<=max(hi-lo)<=25
        variants.append(dict(id=vid,triangles=tris,min=lo.tolist(),max=hi.tolist(),shoulder=shoulder,joints=joints,samples=samples,
                             geometrySHA256=hashlib.sha256(allco.tobytes()).hexdigest()))
        for level in range(1,4):
            for obj in bpy.data.collections[vid+'_LOD'+str(level)].objects:
                me=obj.data
                if family=='creatures':
                    limb=array(me,'_limb','value',1); pivot=array(me,'_pivot','vector',3)
                    glow=array(me,'_glow','value',1); ca=me.color_attributes
                    assert ca[0]==ca.active_color and ca.render_color_index==0
                    check_rig(limb,pivot,glow,array(me,ca[0].name,'color',4),stem!='flyer')
                    for i in set(limb[:,0]):
                        assert np.equal(pivot[limb[:,0]==i],np.asarray(joints[int(i)],np.float32)).all()
                else:
                    assert not me.color_attributes and all(me.attributes.get(a) is None for a in ('_limb','_pivot','_glow'))
                lod_checks.append(dict(variant=vid,lod=level,points=len(me.vertices)))
    markers=[]
    for obj in bpy.data.objects:
        if not obj.name.startswith(('COL_','Muzzle_')): continue
        p=obj.matrix_world.translation
        marker=dict(name=obj.name,type=obj.type,position=[float(p.x),float(p.z),float(-p.y)],
                    triangles=sum(len(p.vertices)-2 for p in obj.data.polygons) if obj.type=='MESH' else None)
        if obj.type=='MESH':
            pts=[obj.matrix_world @ v.co for v in obj.data.vertices]
            co=np.array([(p.x,p.z,-p.y) for p in pts]); marker.update(min=co.min(0).tolist(),max=co.max(0).tolist())
        markers.append(marker)
    records.append(dict(stem=stem,family=family,source=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),variants=variants,lowerLODChecks=lod_checks,markers=markers))
out=HERE/'reports/source-contract.json'; out.write_text(json.dumps(dict(files=records,malformedControls=controls),indent=2)+'\n')
print(json.dumps(dict(files=len(records),variants=sum(len(r['variants']) for r in records),malformedControls=controls,report=str(out))))
