"""Compare R4 against actual recovered R3 geometry, then audit every variant/LOD."""
import bpy
from collections import Counter
import hashlib
import json
import os
import re
import sys
from pathlib import Path
import numpy as np
from mathutils.bvhtree import BVHTree

out=Path(os.environ['MULE_ATTEMPT'])
source=Path(sys.argv[sys.argv.index('--')+1]).resolve()
baseline=Path('/Users/andreyyurlov/Documents/dev/space/.git/lfs/objects/3c/34/3c3437f2fbc6b6523113c5e45d9bb8f5b06cce33b3bcb3c57d4a391fdc035dd4')
assert hashlib.sha256(baseline.read_bytes()).hexdigest()==baseline.name
def material_role(o,index):
    mat=o.material_slots[index].material
    return str(mat.get('engine_name') or re.sub(r'\.\d{3}$','',mat.name)) if mat else None

def require_normals(norm,allowed):
    assert np.isfinite(norm).all(), 'nonfinite normals'
    invalid=int((np.abs(np.linalg.norm(norm,axis=1)-1)>.001).sum())
    assert invalid<=allowed, ('nonunit normals',invalid,'allowed',allowed)
    return invalid

normal_controls=[]
for label,value in [('short',.5),('long',2.0),('nonfinite',float('nan'))]:
    try:require_normals(np.array([[0.,0.,value]]),0)
    except AssertionError:normal_controls.append(label)
    else:raise AssertionError('normal control accepted '+label)

def digest(o,with_normals=True):
    h=hashlib.sha256()
    h.update(np.array(o.matrix_world,dtype=np.float32).tobytes())
    if o.type=='MESH':
        me=o.data
        h.update(json.dumps([material_role(o,i) for i in range(len(o.material_slots))]).encode())
        h.update(np.array([v.co[:] for v in me.vertices],dtype=np.float32).tobytes())
        h.update(np.array([(l.vertex_index,l.edge_index) for l in me.loops],dtype=np.int32).tobytes())
        h.update(np.array([(p.loop_start,p.loop_total,p.material_index) for p in me.polygons],dtype=np.int32).tobytes())
        if with_normals:h.update(np.array([n.vector[:] for n in me.corner_normals],dtype=np.float32).tobytes())
        if me.uv_layers.active:
            h.update(np.array([d.uv[:] for d in me.uv_layers.active.data],dtype=np.float32).tobytes())
    return h.hexdigest()
def material_contract():
    result={}
    for mat in bpy.data.materials:
        props={k:v for k,v in mat.items() if k=='engine_name' or k.startswith('livery_')}
        node=mat.node_tree.nodes.get('Livery') if mat.node_tree else None
        if node:props['Livery_node_outputs']=[list(s.default_value) if hasattr(s.default_value,'__len__') else s.default_value for s in node.outputs if hasattr(s,'default_value')]
        result[mat.name]=props
    return result

def reference():
    names=set()
    for c in bpy.data.collections:
        if c.name.endswith('_LOD0') or c.name in ['mule','REF']:names.update(o.name for o in c.objects)
    return {n:digest(bpy.data.objects[n]) for n in sorted(names)}
def protected_faces(o,suffix):
    me=o.data
    # Reconstruct complete expected components from R3, not from the candidate.
    parents=list(range(len(me.vertices)))
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    for edge in me.edges:parents[root(edge.vertices[0])]=root(edge.vertices[1])
    groups={}
    for p in me.polygons:groups.setdefault(root(p.vertices[0]),[]).append(p)
    faces=[]
    for ps in groups.values():
        ids={i for p in ps for i in p.vertices}
        co=np.array([me.vertices[i].co[:] for i in ids])
        role=me.materials[ps[0].material_index].get('engine_name','Nacre')
        damage=suffix and role in ['Dark','Accent'] and np.ptp(co,axis=0).max()<3.2 and len(ps)<130 and co[:,2].mean()>.15
        if role in ['Hull','Nacre'] or damage:faces.extend(ps)
    return faces

def face_multiset(o,faces,with_normals=True):
    me=o.data;uv=me.uv_layers.active.data;norm=me.corner_normals
    records=Counter()
    for p in faces:
        corners=tuple(tuple(round(float(v),6) for v in (*me.vertices[me.loops[i].vertex_index].co,*uv[i].uv,*(norm[i].vector[:] if with_normals else ()))) for i in p.loop_indices)
        cycle=min(corners[j:]+corners[:j] for j in range(len(corners)))
        records[(material_role(o,p.material_index),cycle)]+=1
    return records

def equal_surface(expected,actual,matrix,actual_matrix):
    assert np.array_equal(matrix,np.array(actual_matrix,dtype=np.float32)), 'protected object transform changed'
    assert expected==actual, ('protected faces differ',sum((expected-actual).values()),sum((actual-expected).values()))

bpy.ops.wm.open_mainfile(filepath=str(baseline));before=reference();before_materials=material_contract()
def far_visible_faces(o):
    result=[]
    for p in o.data.polygons:
        co=[o.data.vertices[i].co for i in p.vertices]
        edge=max((co[(i+1)%len(co)]-co[i]).length for i in range(len(co)))
        if p.area>=1e-9 and 2*p.area/max(edge,1e-20)>=1e-5:result.append(p)
    return result
baseline_far={suffix:(face_multiset(bpy.data.objects['Body'+suffix+'_l3'],far_visible_faces(bpy.data.objects['Body'+suffix+'_l3']),False),np.array(bpy.data.objects['Body'+suffix+'_l3'].matrix_world,dtype=np.float32)) for suffix in ['', '_dmg', '_husk']}
protected={}
for suffix in ['', '_dmg', '_husk']:
    o=bpy.data.objects['Body'+suffix]
    protected[suffix]=(face_multiset(o,protected_faces(o,suffix)),np.array(o.matrix_world,dtype=np.float32))
baseline_nonunit={o.name:sum(abs(n.vector.length-1)>.001 for n in o.data.corner_normals) for o in bpy.data.objects if o.type=='MESH'}
bpy.ops.wm.open_mainfile(filepath=str(source));after=reference();after_materials=material_contract()
assert before_materials==after_materials, 'engine roles or livery metadata changed'
report={'normal_negative_controls_rejected':normal_controls,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'r3_sha256':baseline.name,'livery_engine_role_contract_equal':before_materials==after_materials,'livery_material_contract':after_materials,'lod0_marker_ref_identity':before==after,'unchanged_objects':len(before),'lods':{},'surface_contract':{}}
assert before==after, 'R4 changed LOD0 geometry/UV/corner normals/transforms/markers/REF'
for variant,suffix in [('mule',''),('mule_damaged','_dmg'),('mule_husked','_husk')]:
    for lod in range(4):
        meshes=[o for o in bpy.data.collections[variant+'_LOD'+str(lod)].objects if o.type=='MESH'];facts=[]
        for o in meshes:
            me=o.data;me.calc_loop_triangles();co=np.array([v.co[:] for v in me.vertices]);uv=np.array([d.uv[:] for d in me.uv_layers.active.data]);norm=np.array([n.vector[:] for n in me.corner_normals])
            assert np.isfinite(co).all() and np.isfinite(uv).all() and np.isfinite(norm).all()
            strict=o.name.startswith('R4_') or o.name in ['Body_l3','Body_dmg_l3','Body_husk_l3']
            nonunit=require_normals(norm,0 if strict else baseline_nonunit.get(o.name,0))
            zero=sum(t.area<1e-10 for t in me.loop_triangles)
            uvzero=0
            for t in me.loop_triangles:
                a,b,c=uv[list(t.loops)];uvzero+=abs(np.cross(b-a,c-a))<1e-12
            facts.append({'name':o.name,'triangles':len(me.loop_triangles),'zero_area':int(zero),'zero_uv_area':int(uvzero),'nonunit_normals':nonunit,'baseline_nonunit_normals':baseline_nonunit.get(o.name,0),'strict_unit_normals_required':strict,'uv_bounds':[uv.min(0).tolist(),uv.max(0).tolist()],'custom_normals':me.has_custom_normals})
            print('TOPOLOGY',o.name,'tris',len(me.loop_triangles),'nonunit',nonunit,'inherited',baseline_nonunit.get(o.name,0),'zero_area',zero,flush=True)
            assert not strict or nonunit==0,(o.name,nonunit)
        report['lods'][variant+'_LOD'+str(lod)]={'triangles':sum(f['triangles'] for f in facts),'objects':facts}
    expected,matrix=protected[suffix]
    for lod in [1,2]:
        o=bpy.data.objects['R4_Panels'+suffix+'_l'+str(lod)]
        actual=face_multiset(o,o.data.polygons)
        equal_surface(expected,actual,matrix,o.matrix_world)
        # Negative controls use the same comparison: losing a face or changing a
        # single normal must fail even when every remaining corner still exists.
        controls=[]
        key=next(iter(actual))
        for label in ['deleted_face','corner_normal','object_transform']:
            bad=actual.copy();bad_matrix=matrix.copy()
            if label=='deleted_face':bad.subtract({key:1});bad=+bad
            elif label=='corner_normal':
                bad.subtract({key:1});bad=+bad
                material,cycle=key;row=list(cycle[0]);row[-1]+=.01
                bad[(material,(tuple(row),)+cycle[1:])]+=1
            else:bad_matrix[0,3]+=.01
            try:equal_surface(expected,bad,matrix,bad_matrix)
            except AssertionError:controls.append(label)
            else:raise AssertionError('negative control accepted '+label)
        # Reassign the actual object slot, prove rejection, then restore without saving.
        slot=o.material_slots[0];saved=slot.material
        replacement=next(s.material for s in o.material_slots if s.material and s.material.get('engine_name')!=saved.get('engine_name'))
        original_digest=digest(o)
        try:
            slot.material=replacement
            assert digest(o)!=original_digest, 'slot reassignment escaped digest'
            try:equal_surface(expected,face_multiset(o,o.data.polygons),matrix,o.matrix_world)
            except AssertionError:controls.append('material_slot_reassignment')
            else:raise AssertionError('slot reassignment escaped protected-face comparison')
        finally:slot.material=saved
        report['surface_contract'][variant+'_LOD'+str(lod)]={'complete_oriented_polygon_multiset_equal':True,'faces':sum(expected.values()),'matrix_equal':True,'includes':'position, UV, corner normal, material, cyclic connectivity and multiplicity at 1e-6 precision','negative_controls_rejected':controls}
    # Both retained authoring approaches are auditable; topology PASS is not a grade.
    if 'Body'+suffix+'_l3' in bpy.data.objects:
        far=bpy.data.objects['Body'+suffix+'_l3']
        expected_far,far_matrix=baseline_far[suffix]
        equal_surface(expected_far,face_multiset(far,far.data.polygons,False),far_matrix,far.matrix_world)
        high=bpy.data.objects['Body'+suffix].data
        bvh=BVHTree.FromPolygons([v.co for v in high.vertices],[p.vertices[:] for p in high.polygons])
        distances=[bvh.find_nearest(v.co)[3] for v in far.data.vertices]
        report['surface_contract'][variant+'_LOD3']={'r3_visible_faces_topology_uv_roles_transform_identity':True,'excluded_r3_faces':'area below 1e-9 square metres or altitude below 1e-5 metres; every other oriented face retained','corner_normals':'transferred from LOD0 in source space; finite and unit checked above','vertex_to_lod0_surface_max_m':max(distances),'p95_m':float(np.percentile(distances,95))}
    else:
        far=bpy.data.objects['R4_Panels'+suffix+'_l3'].data
        high=bpy.data.objects['R4_Panels'+suffix+'_l2'].data
        p0={d.value for d in high.attributes['pid'].data};p3={d.value for d in far.attributes['pid'].data}
        bvh=BVHTree.FromPolygons([v.co for v in high.vertices],[p.vertices[:] for p in high.polygons])
        distances=[bvh.find_nearest(v.co)[3] for v in far.vertices]
        assert not p0-p3,(variant,'LOD3 lost panels',p0-p3)
        report['surface_contract'][variant+'_LOD3']={'retained_panel_ids':len(p0&p3),'missing_panel_ids':sorted(p0-p3),'vertex_to_lod2_surface_max_m':max(distances),'p95_m':float(np.percentile(distances,95))}
    report['surface_contract'][variant+'_LOD3']['appearance_qualified']=False
(out/'source-audit.json').write_text(json.dumps(report,indent=2))
print('SOURCE_AUDIT',report['lod0_marker_ref_identity'],len(report['lods']),'LODs',report['surface_contract'],flush=True)
