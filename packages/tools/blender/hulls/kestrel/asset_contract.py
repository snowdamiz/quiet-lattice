"""Lossless structural inventory and narrow Kestrel contracts for the actual GLB bytes."""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import glb, ktx

STATES=('kestrel','kestrel_damaged','kestrel_husked')
VARIANTS=tuple(s+l for s in STATES for l in ('','_compact','_working'))
REQUIRED_MATERIALS={'Hull','Accent','Dark','Trim','Glass','EngineGlow','NavWhite'}


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()


def inventory(doc,binary):
    nodes=doc.get('nodes',[]);meshes=doc.get('meshes',[]);materials=doc.get('materials',[])
    required=set(doc.get('extensionsRequired',[]))
    assert {'KHR_texture_basisu','EXT_meshopt_compression','KHR_mesh_quantization'}<=required,'required compression extensions missing'
    parents={}
    for i,n in enumerate(nodes):
        for child in n.get('children',[]):
            assert child not in parents,'node has multiple parents';parents[child]=i
    def descend(index):
        out=[];pending=[index];seen=set()
        while pending:
            n=pending.pop();assert n not in seen,'cycle in node graph';seen.add(n);out.append(n);pending.extend(nodes[n].get('children',[]))
        return out
    node_inventory=[]
    for name,point in {'HP_S_1':(-1.5,-.62,.9),'HP_S_2':(1.5,-.62,.9),'HP_M_1':(0,-.86,-2.75)}.items():
        found=[n for n in nodes if n.get('name')==name]
        assert len(found)==1 and all(abs(a-b)<1e-5 for a,b in zip(found[0].get('translation',[0,0,0]),point)),('hardpoint export contract',name)
    for i,n in enumerate(nodes):
        ps=[]
        if 'mesh' in n:
            for j,p in enumerate(meshes[n['mesh']]['primitives']):
                assert 'material' in p or n.get('name','').startswith('COL_'),'render primitive without material'
                accessor=doc['accessors'][p['indices']]
                mi=p.get('material')
                ps.append({'primitive':j,'material':mi,'materialName':materials[mi]['name'] if mi is not None else None,'indexCount':accessor['count'],'triangles':accessor['count']//3,'attributes':p['attributes'],'indices':p['indices']})
        node_inventory.append({'index':i,'name':n.get('name'),'parent':parents.get(i),'mesh':n.get('mesh'),'primitives':ps,'children':n.get('children',[]),'translation':n.get('translation',[0,0,0]),'rotation':n.get('rotation',[0,0,0,1]),'scale':n.get('scale',[1,1,1]),'matrix':n.get('matrix'),'extras':n.get('extras',{})})
    image_inventory=[]
    for i,im in enumerate(doc.get('images',[])):
        assert im.get('mimeType')=='image/ktx2' and 'bufferView' in im,'non-KTX2 or external image'
        bv=doc['bufferViews'][im['bufferView']];start=bv.get('byteOffset',0);data=binary[start:start+bv['byteLength']];head=ktx.header(data)
        assert head and head['width']==4096 and head['height']==4096,'hero image is not 4096 square'
        assert head['fullChain'],'incomplete mip chain'
        image_inventory.append({'index':i,'name':im.get('name'),**head,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    mat_images={}
    material_inventory=[]
    for i,m in enumerate(materials):
        refs=[]
        for slot,t in ktx._texture_refs(m):
            ti=t['index'];tex=doc['textures'][ti];source=tex.get('extensions',{}).get('KHR_texture_basisu',{}).get('source')
            assert source is not None and 'source' not in tex,'missing Basis route or PNG fallback'
            im=image_inventory[source]
            assert im['srgb']==(slot in ktx.COLOUR),'texture transfer function mismatch'
            if slot=='normal':assert im['codec']=='UASTC','normal map is not UASTC'
            refs.append({'slot':slot,'texture':ti,'image':source})
        mat_images[i]={r['image'] for r in refs}
        material_inventory.append({'index':i,'name':m.get('name'),'slots':refs,'extras':m.get('extras',{})})
    variants={}
    for variant in VARIANTS:
        levels={};used_mats=set();lod0_maps=None
        for level in range(4):
            name=f'{variant}_LOD{level}';found=[i for i,n in enumerate(nodes) if n.get('name')==name]
            assert len(found)==1,f'missing or duplicate {name}'
            children=descend(found[0]);primitives=[(i,p) for i in children if not nodes[i].get('name','').startswith('COL_') for p in node_inventory[i]['primitives']]
            mats={p['material'] for _,p in primitives};used_mats|=mats
            names={materials[i]['name'] for i in mats};assert REQUIRED_MATERIALS<=names,(name,'material contract',names)
            maps={role:{(ref['slot'],ref['image']) for mi in mats if materials[mi]['name']==role for ref in material_inventory[mi]['slots']} for role in ('Hull','Accent','Dark','Trim','Glass')}
            assert all(refs for refs in maps.values()),(name,'missing PBR atlas')
            if level==0:lod0_maps=maps
            else:assert maps==lod0_maps,(name,'lower LOD does not share LOD0 atlas')
            assert 0<len(primitives)<=12,(name,'static primitive target',len(primitives))
            tris=sum(p['triangles'] for _,p in primitives)
            levels[str(level)]={'node':found[0],'meshNodes':[i for i in children if 'mesh' in nodes[i]],'primitiveCount':len(primitives),'triangles':tris,'materials':sorted(mats),'atlasImagesByRole':{k:[list(x) for x in sorted(v)] for k,v in maps.items()}}
        counts=[levels[str(i)]['triangles'] for i in range(4)]
        assert 60000<=counts[0]<=150000,(variant,'hero triangle range',counts)
        assert all(a>b>0 for a,b in zip(counts,counts[1:])) and counts[3]/counts[0]<.05,(variant,'LOD budget',counts)
        image_ids=set().union(*(mat_images[i] for i in used_mats))
        gpu=sum(ktx.gpu_bytes(image_inventory[i]['width'],image_inventory[i]['height'],True) for i in image_ids)
        assert gpu<=512*1024*1024,(variant,'GPU texture budget',gpu)
        variants[variant]={'lods':levels,'images':sorted(image_ids),'gpuTextureBytesAt8bppWithMips':gpu}
    assert len(node_inventory)==len(nodes)
    assert sum(len(n['primitives']) for n in node_inventory)==sum(len(meshes[n['mesh']]['primitives']) for n in nodes if 'mesh' in n)
    return {'variants':variants,'nodes':node_inventory,'materials':material_inventory,'images':image_inventory,'extensionsRequired':sorted(required),'rawDocument':doc,'binaryChunkSha256':hashlib.sha256(binary).hexdigest(),'boundsOfClaim':'Complete glTF document retained alongside the node/primitive and compressed-map inventory. Runtime GPU draws, timing and visual grade are not measured.'}


def read_inventory(path):
    data=Path(path).read_bytes();assert len(data)>=20 and struct.unpack_from('<I',data,8)[0]==len(data),'GLB byte length mismatch'
    doc,binary=glb.read(path)
    return inventory(doc,binary)


if __name__=='__main__':
    path=ROOT/'packages/client/public/models/hulls/kestrel.glb'
    result=read_inventory(path);result.update(sha256=sha(path),bytes=path.stat().st_size)
    out=ROOT/'assets/renders/hulls/kestrel-round3-current/glb-inventory.json';out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'sha256':result['sha256'],'variants':len(result['variants']),'nodes':len(result['nodes']),'images':len(result['images'])}))
