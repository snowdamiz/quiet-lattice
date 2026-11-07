"""Complete oriented triangle/attribute bijection against the decoded compressed GLB."""
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
from artlib import rules as R, scene as S

LIMITS=np.array([.004,.00025,.035])  # metres, UV, unit-normal vector distance


def snapshot(rules,model):
    groups={};markers={}
    for asset in model.assets:
        for variant in asset.variants.values():
            for lod,objects in variant.lods.items():
                rows={}
                for o in S.render_meshes(rules,objects):
                    assert not o.modifiers,('unaccounted modifier',o.name)
                    me=o.data;me.calc_loop_triangles()
                    normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
                    normals=me.corner_normals;uv=me.uv_layers.active.data
                    for t in me.loop_triangles:
                        material=R.material_name(o.material_slots[t.material_index].material)
                        corners=[]
                        for li in t.loops:
                            pos=o.matrix_world @ me.vertices[me.loops[li].vertex_index].co
                            normal=(normal_matrix @ normals[li].vector).normalized()
                            corners.append((*pos,*uv[li].uv,*normal))
                        rows.setdefault(material,[]).append(corners)
                groups[variant.id+'/'+str(lod)]={m:np.asarray(v,np.float32) for m,v in rows.items()}
                print('SNAPSHOT',variant.id,lod,sum(len(v) for v in rows.values()),'triangles',flush=True)
            for o in variant.all_objects():
                if o.type=='EMPTY' and o.name.startswith(('Gear','Canopy','Cockpit','Screen','HP_','BAY_','Interact','Blink','Light_')):
                    markers[o.name]=np.asarray(o.matrix_world,dtype=np.float32)
    return groups,markers


def triangle_errors(a,b):
    delta=a-b
    return np.array([np.linalg.norm(delta[:,:3],axis=1).max(),np.linalg.norm(delta[:,3:5],axis=1).max(),np.linalg.norm(delta[:,5:],axis=1).max()])


def triangles_equal(src,dst,label):
    assert src.shape==dst.shape,(label,'triangle count',src.shape,dst.shape)
    assert np.isfinite(src).all() and np.isfinite(dst).all(),(label,'nonfinite')
    tree=KDTree(len(dst))
    for i,point in enumerate(dst[:,:,:3].mean(axis=1)):tree.insert(Vector(point),i)
    tree.balance()
    edges={};owner={};assigned={}
    def candidates(i):
        if i not in edges:
            choices=[]
            for _,j,_ in tree.find_range(Vector(src[i,:,:3].mean(axis=0)),float(LIMITS[0])+1e-6):
                # Only cyclic rotations preserve orientation; reversals must fail.
                errors=[triangle_errors(src[i],np.roll(dst[j],-k,axis=0)) for k in range(3)]
                valid=[e for e in errors if (e<=LIMITS).all()]
                if valid:
                    error=min(valid,key=lambda e:float((e/LIMITS).sum()))
                    choices.append((j,error))
            edges[i]=sorted(choices,key=lambda x:float((x[1]/LIMITS).sum()))
        return edges[i]
    for i in range(len(src)):
        # Augmenting paths provide a true bijection, including duplicate triangles.
        queue=[i];seen={i};parent={};finish=None
        for q in queue:
            for j,error in candidates(q):
                if j not in owner:finish=(q,j,error);break
                nxt=owner[j]
                if nxt not in seen:
                    seen.add(nxt);queue.append(nxt);parent[nxt]=(q,j,error)
            if finish is not None:break
        assert finish is not None,(label,'no oriented triangle bijection',i,'candidates',len(candidates(i)))
        q,j,error=finish
        while True:
            owner[j]=q;assigned[q]=(j,error)
            if q==i:break
            q,j,error=parent[q]
    maximum=np.max([e for _,e in assigned.values()],axis=0) if assigned else np.zeros(3)
    assert len(owner)==len(src)==len(dst)
    return {'triangles_checked':len(src),'corners_checked':3*len(src),'bijection':True,'max_errors_position_m_uv_normal':maximum.tolist()}


def compare(expected,actual):
    eg,em=expected;ag,am=actual
    report={'groups':{},'marker_transforms':{},'method':'Complete oriented triangle corner bijection, preserving material, world position, UV, world normal, connectivity and multiplicity; cyclic rotations only; no sampling.','tolerances_position_m_uv_normal':LIMITS.tolist()}
    assert set(eg)==set(ag),(set(eg),set(ag))
    for key,e in eg.items():
        a=ag[key];assert set(e)==set(a),(key,set(e),set(a))
        report['groups'][key]={}
        for mat,src in e.items():
            report['groups'][key][mat]=triangles_equal(src,a[mat],key+'/'+mat)
        print('IDENTITY',key,'complete',sum(len(v) for v in e.values()),'triangles',flush=True)
    assert set(em)==set(am),('marker set',set(em)^set(am))
    for name,matrix in em.items():
        error=float(np.abs(matrix-am[name]).max());assert error<.0001,(name,error)
        report['marker_transforms'][name]=error
    report['status']='PASS'
    return report


def negative_controls():
    # Same four corners, two different diagonals: counts and corner membership agree.
    v=np.array([[0,0,0,0,0,0,0,1],[1,0,0,1,0,0,0,1],[1,1,0,1,1,0,0,1],[0,1,0,0,1,0,0,1]],np.float32)
    src=v[[[0,1,2],[0,2,3]]]
    cases={'rewired':v[[[0,1,3],[1,2,3]]],'reversed':src[:,::-1].copy(),'duplicate':src[[0,0]].copy()}
    for field,index in [('uv',3),('normal',7),('position',0)]:
        dst=src.copy();dst[1,2,index]+=.1;cases[field]=dst
    rejected=[]
    for label,dst in cases.items():
        try:triangles_equal(src,dst,label)
        except AssertionError:rejected.append(label)
        else:raise AssertionError('negative control accepted '+label)
    triangles_equal(src,np.roll(src[::-1],1,axis=1),'positive permutation')
    triangles_equal(src[[0,0,1]],src[[1,0,0]],'positive multiplicity')
    return rejected
