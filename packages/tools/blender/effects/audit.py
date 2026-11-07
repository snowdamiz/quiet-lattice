"""CPU audit of editable sources and decoded shipped GLBs, including negative controls."""
import copy
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0,str(Path(__file__).parent))
sys.path.insert(0,str(Path(__file__).parent.parent))
from catalog import BEATS, PALETTES, PUBLIC, ROOT, SOURCES, nodes, sha, signs
from artlib import core, glb, materials as M, rules as R, scene as S

OUT=ROOT/'.claude/pause/P1-E07-T14/audit.json'

def check(condition, message):
    if not condition: raise AssertionError(message)

def check_manifest(m):
    check(m['nodes']==nodes(),'canonical Tier I-II node mapping differs')
    check(len(m['nodes'])==63,'expected nine Tier I-II nodes per branch')
    check(m['palettes']==PALETTES,'palette contract differs')
    ids=[a['id'] for a in m['assets']]
    check(len(ids)==len(set(ids)),'duplicate asset')
    expected={f'{b}_{n}' for b,beats in BEATS.items() for n in beats}
    expected|={b+'_particle' for b in BEATS}
    expected|={'recall_glyph_'+('divider' if letter=='·' else letter) for letter,_ in signs()}
    check(set(ids)==expected,'full effect/glyph set differs')
    byid={a['id']:a for a in m['assets']}
    for n in m['nodes']:
        for name in n['assets']: check(name in byid,'missing mapped asset '+name)
        if n['assets']:
            a=byid[n['assets'][0]]
            count=n['meshInstances']
            # Particle count is per whole cast, shared across links/instances.
            check(a['maxParticles']<=64,'cast particle budget')
            check(count+1<=4,'cast primitive/draw budget')
            check(a['triangles']*count+12*a['maxParticles']<=18000,'cast geometry budget')
    check(m['recall']['maxParticles']<=64,'Recall particle budget')
    check(m['recall']['maxDrawCalls']<=4,'Recall draw budget')
    for a in m['assets']:
        check(a['assetClass']=='effect' and 12<=a['triangles']<=5000,'class/triangle budget '+a['id'])

def reject(fn, label):
    try: fn()
    except AssertionError: return label
    raise AssertionError('negative control was accepted: '+label)

def png_palette_check(path,palette):
    data=path.read_bytes()
    check(data[:8]==b'\x89PNG\r\n\x1a\n','PNG signature')
    offset=8; payload=b''
    while offset<len(data):
        length=struct.unpack_from('>I',data,offset)[0]
        tag=data[offset+4:offset+8]
        body=data[offset+8:offset+8+length]
        if tag==b'IHDR': check(body[8:10]==bytes([8,6]),'expected 8-bit RGBA PNG')
        if tag==b'IDAT': payload+=body
        offset+=length+12
    # Every PNG filter uses zero left/up predictors for the very first pixel.
    pixel=np.frombuffer(zlib.decompress(payload)[1:4],dtype=np.uint8).astype(float)
    endpoints=np.array([[int(palette[k][i:i+2],16) for i in (1,3,5)] for k in ('primary','light')])
    check(np.all(pixel>=endpoints.min(0)-1) and np.all(pixel<=endpoints.max(0)+1),'sRGB palette encoded outside authored endpoints '+str(path))

def uv_check(obj, particle=False):
    me=obj.data
    check(bool(me.uv_layers),'missing UV '+obj.name)
    uv=np.array([x.uv[:] for x in me.uv_layers.active.data])
    check(np.isfinite(uv).all() and uv.min()>=-1e-5 and uv.max()<=1.00001,'UV outside unit atlas '+obj.name)
    me.calc_loop_triangles()
    tri=np.array([t.loops[:] for t in me.loop_triangles])
    p=uv[tri]
    area=np.abs((p[:,1,0]-p[:,0,0])*(p[:,2,1]-p[:,0,1])-(p[:,2,0]-p[:,0,0])*(p[:,1,1]-p[:,0,1]))
    check(float(np.min(area))>1e-9,'degenerate UV triangle '+obj.name)
    if particle:
        check(uv.min()>=14/1024-1e-4 and uv.max()<=.25-14/1024+1e-4,'particle carrier exceeds tile gutter')
    return [float(uv.min()),float(uv.max())]

def alpha_check(mat):
    info=M.MaterialInfo(mat)
    check(info.bsdf is not None,'missing principled material')
    alpha=M.trace(info.bsdf.inputs['Alpha'])
    check(alpha.kind=='image' and alpha.index==3,'alpha channel not connected to shader')
    check(info.channels['baseColor'].image==alpha.image,'base/alpha not same RGBA image')
    check(info.channels['emissive'].image is not None,'missing emissive texture')
    px=np.empty(len(alpha.image.pixels),np.float32)
    alpha.image.pixels.foreach_get(px)
    a=px.reshape(-1,4)[:,3]
    check(float(a.max())>.15 and float(a.std())>.01,'nonfunctional uniform alpha')
    return [float(a.min()),float(a.max()),float(a.std())]

def glyph_check(obj, strokes, exported=False):
    me=obj.data
    me.calc_loop_triangles()
    v=np.array([(obj.matrix_world @ p.co)[:] for p in me.vertices])
    # A glTF import converts +Y up back to Blender +Z, so both artifacts use XZ here.
    p=v[:,[0,2]]
    triangles=p[np.array([t.vertices[:] for t in me.loop_triangles])]
    def covered(point):
        a,b,c=triangles[:,0],triangles[:,1],triangles[:,2]
        e1=b-a; e2=c-a; q=np.array(point)-a
        den=e1[:,0]*e2[:,1]-e1[:,1]*e2[:,0]
        valid=np.abs(den)>1e-10
        den=np.where(valid,den,1)
        u=(q[:,0]*e2[:,1]-q[:,1]*e2[:,0])/den
        w=(e1[:,0]*q[:,1]-e1[:,1]*q[:,0])/den
        return bool(np.any(valid&(u>=-1e-4)&(w>=-1e-4)&(u+w<=1.0001)))
    def pt(i):
        a=math.pi/2-i*math.pi/3
        return np.array([.5*math.cos(a),.5*math.sin(a)])
    for kind in 'SR':
        for i in range(6):
            a=np.zeros(2) if kind=='S' else pt(i)
            b=pt(i) if kind=='S' else pt((i+1)%6)
            for t in (.25,.5,.75):
                check(covered(a*(1-t)+b*t)==(kind+str(i) in strokes),f'wrong physical glyph stroke {obj.name}: {kind}{i}@{t}')
    if not strokes: check(covered((0,0)) and max(np.ptp(p,axis=0))<.09,'divider must be a lone dot')

def main():
    m=json.loads((SOURCES/'manifest.json').read_text())
    check_manifest(m)
    negatives=[]
    bad=copy.deepcopy(m); bad['nodes'].pop()
    negatives.append(reject(lambda:check_manifest(bad),'missing canonical node'))
    bad=copy.deepcopy(m); bad['assets'][0]['maxParticles']=65
    negatives.append(reject(lambda:check_manifest(bad),'particle budget overflow'))
    bad=copy.deepcopy(m); bad['assets'].pop()
    negatives.append(reject(lambda:check_manifest(bad),'missing source/export member'))
    results=[]
    rules=R.load()
    for branch in BEATS:
        expected={a['id']:a for a in m['assets'] if a['branch']==branch}
        for ext in ('blend','glb'):
            path=SOURCES/f'{branch}.blend' if ext=='blend' else PUBLIC/f'models/effects/{branch}.glb'
            core.load(path)
            model=S.collect_source(rules) if ext=='blend' else S.collect_export(rules)
            S.assign_classes(rules,'effects',model)
            check({a.name for a in model.assets}==set(expected),'source/export roots differ '+str(path))
            check(not any(o.animation_data for o in bpy.data.objects),'unexpected unmanifested animation')
            if ext=='blend':
                ref=model.ref
                check(ref is not None and ref.hide_render,'missing/visible REF collection')
                biped=bpy.data.objects.get('REF_Biped')
                grid=bpy.data.objects.get('REF_Grid')
                check(biped is not None and len(biped.data.vertices)>100,'reference must be the library biped, not a box')
                check(grid is not None and len(grid.data.vertices)==441,'reference must be the 20x20 metre library grid')
            else:
                js,_=glb.read(path)
                check(not js.get('animations'),'unmanifested exported clips')
                check(len(js['meshes'])==len(expected) and all(len(mesh['primitives'])==1 for mesh in js['meshes']),'actual GLB primitive/draw count differs')
                check(all(mat.get('alphaMode')=='BLEND' and mat.get('doubleSided') for mat in js['materials']),'GLB alpha/double-sided contract')
                check(all('baseColorTexture' in mat['pbrMetallicRoughness'] and 'emissiveTexture' in mat for mat in js['materials']),'GLB texture routing')
                check({'KHR_texture_basisu','EXT_meshopt_compression','KHR_mesh_quantization'}<=set(js['extensionsRequired']),'missing loader compression extensions')
            for asset in model.assets:
                row=expected[asset.name]
                v=asset.variants[asset.name]
                check(v.cls=='effect' and set(v.lods)=={0},'wrong class/LODs '+asset.name)
                objects=S.render_meshes(rules,v.lods[0])
                check(len(objects)==1,'one-mesh contract '+asset.name)
                obj=objects[0]
                check(len(obj.material_slots)==1,'one-material/draw contract '+asset.name)
                check(S.tri_count(obj)==row['triangles'],'source/export triangle count differs '+asset.name)
                bounds=S.bounds(objects)
                check(np.allclose(np.array(bounds),row['boundsBlender'],atol=.0015),'source/export scale differs '+asset.name)
                uv=uv_check(obj,row['role']=='particle')
                mat=obj.material_slots[0].material
                check(R.material_name(mat)==row['material'],'material name contract '+asset.name)
                alpha=alpha_check(mat)
                if row['role']=='glyph': glyph_check(obj,row['strokes'],ext=='glb')
                if ext=='blend' and asset.name=='gravitic_pull':
                    old=obj.data.uv_layers.active.data[0].uv.copy()
                    obj.data.uv_layers.active.data[0].uv=(2,2)
                    negatives.append(reject(lambda:uv_check(obj),'UV outside atlas'))
                    obj.data.uv_layers.active.data[0].uv=old
                    bs=M.MaterialInfo(mat).bsdf
                    link=bs.inputs['Alpha'].links[0]
                    src=link.from_socket
                    mat.node_tree.links.remove(link)
                    negatives.append(reject(lambda:alpha_check(mat),'disconnected material alpha'))
                    mat.node_tree.links.new(src,bs.inputs['Alpha'])
                if ext=='blend' and asset.name=='recall_glyph_a':
                    negatives.append(reject(lambda:glyph_check(obj,['S0']),'extra physical glyph stroke'))
                results.append(dict(artifact=str(path.relative_to(ROOT)),asset=asset.name,triangles=row['triangles'],uvRange=uv,alphaRangeStd=alpha,status='PASS'))
    sheets=[]
    for entry in m['sheets']:
        path=PUBLIC/entry['path'].lstrip('/')
        png_palette_check(path,PALETTES[entry['branch']])
        png_palette_check(path.with_name(entry['branch']+'_filament.png'),PALETTES[entry['branch']])
        im=bpy.data.images.load(str(path),check_existing=False)
        check(tuple(im.size)==(1024,1024),'sheet dimensions')
        px=np.empty(len(im.pixels),np.float32); im.pixels.foreach_get(px)
        px=px.reshape(1024,1024,4)
        frames=[]
        first_frames=[]
        for row in range(4):
            previous=None
            for col in range(4):
                tile=px[row*256:(row+1)*256,col*256:(col+1)*256,3]
                check(tile.max()>.04 and tile.std()>.02,'empty or uniform particle frame')
                border=np.concatenate((tile[:14].ravel(),tile[-14:].ravel(),tile[:,:14].ravel(),tile[:,-14:].ravel()))
                check(border.max()==0,'alpha bleed across particle frame')
                occupancy=float((tile>.02).mean())
                check(.005<occupancy<.7,'particle fill bounds')
                if previous is not None: check(np.abs(tile-previous).mean()>.003,'duplicate decay frame')
                previous=tile
                if col==0: first_frames.append(tile.copy())
                frames.append(dict(row=row,frame=col,fill=occupancy))
        check(all(np.abs(a-b).mean()>.003 for i,a in enumerate(first_frames) for b in first_frames[i+1:]),'duplicate particle shape row')
        sheets.append(dict(path=str(path.relative_to(ROOT)),sha256=sha(path),frames=frames))
    artifacts={str(p.relative_to(ROOT)):sha(p) for pattern in ('assets/blend/effects/*.blend','packages/client/public/models/effects/*.glb','packages/client/public/particles/effects/*.png') for p in sorted(ROOT.glob(pattern))}
    out=dict(status='PASS',sourceCount=6,exportCount=6,assetCount=len(m['assets']),nodeCount=len(m['nodes']),negativeControls=negatives,checks=results,sheets=sheets,sha256=artifacts,
             qualification='CPU source/export proof only. No client playback, GPU timing, independent review or visual acceptance.')
    OUT.write_text(json.dumps(out,indent=2)+'\n')
    print('AUDIT PASS',len(results),'source/export asset checks;',len(negatives),'negative controls; report',OUT)

if __name__=='__main__': main()
