"""Save stock-generated LODs and remove duplicate faces produced by collapse.

LOD0 is untouched. The stock export then reads all four saved collections.
"""
import bpy
import hashlib
import json
from pathlib import Path
import shutil
import sys
sys.dont_write_bytecode=True
import numpy as np

HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
from artlib import core,lods,rules,scene
R=rules.load(); records=[]

def points(me):
    h=hashlib.sha256()
    co=np.empty(len(me.vertices)*3,np.float32); me.vertices.foreach_get('co',co); h.update(co.tobytes())
    for name,prop,width in [('_limb','value',1),('_pivot','vector',3),('_glow','value',1),('RegionMask','color',4)]:
        a=me.attributes.get(name)
        if a:
            data=np.empty(len(a.data)*width,np.float32); a.data.foreach_get(prop,data); h.update(data.tobytes())
    return h.hexdigest()

for family in ['creatures','constructs']:
    for path in sorted((ROOT/'assets/blend'/family).glob('*.blend')):
        result=core.validate_path(R,path,family=family)
        assert result.status=='PASS',(path,result.status)
        bpy.context.preferences.filepaths.save_version=0
        shutil.copyfile(path,HERE/'reports/history'/(path.stem+'-before-saved-lods.blend'))
        scratch=bpy.data.collections.new('_stock_lod_work'); bpy.context.scene.collection.children.link(scratch)
        asset=result.model.assets[0]; variants=[]
        for v in asset.variants.values():
            assert sorted(v.lods)==[0],(v.id,'already has saved LODs')
            base={o.name:points(o.data) for o in scene.render_meshes(R,v.lods[0])}
            assert all(not o.data.validate(verbose=True) for o in scene.render_meshes(R,v.lods[0]))
            lods.generate(R,v,scratch)
            repairs=[]
            for n in range(1,4):
                coll=bpy.data.collections.new(v.id+'_LOD'+str(n)); (v.collection or asset.holder).children.link(coll)
                for o in v.lods[n]:
                    coll.objects.link(o); scratch.objects.unlink(o)
                    o.name=rules.strip(o.name)+'_detail'+str(n)
                    if o.type=='MESH':
                        me=o.data; me.name=o.name+'_mesh'
                        before=points(me); count=len(me.polygons)
                        changed=me.validate(verbose=True)
                        assert points(me)==before,(o.name,'point data changed')
                        assert not me.validate(verbose=True),(o.name,'still invalid')
                        repairs.append(dict(lod=n,object=o.name,removedFaces=count-len(me.polygons),repaired=changed,pointsSHA256=before))
            assert base=={o.name:points(o.data) for o in scene.render_meshes(R,v.lods[0])},'LOD0 changed'
            variants.append(dict(variant=v.id,lod0PointHashes=base,repairs=repairs))
        bpy.data.collections.remove(scratch)
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        check=core.validate_path(R,path,family=family)
        core.write_and_print(check,HERE/'reports/saved-lods'/(family+'__'+path.name+'.json'))
        assert check.status=='PASS',path
        records.append(dict(path=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),variants=variants))
(HERE/'reports/saved-lods.json').write_text(json.dumps(records,indent=2)+'\n')
print('Saved clean LODs in',len(records),'sources; LOD0 point hashes unchanged')
