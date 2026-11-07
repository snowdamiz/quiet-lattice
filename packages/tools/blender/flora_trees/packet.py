"""Prove preview/source correspondence and compose one compact sibling inspection sheet."""
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[4]
EVIDENCE=ROOT/'assets/blend/flora/trees/evidence'


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def surface(path):
    bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False)
    meshes={}
    for o in bpy.data.objects:
        if o.type!='MESH' or o.name.startswith('REF_'): continue
        me=o.data; ca=me.color_attributes.active_color
        if ca is None: continue
        rows=[]
        for p in me.polygons:
            corners=[]
            for li in p.loop_indices:
                i=me.loops[li].vertex_index
                values=[*me.vertices[i].co,*ca.data[i].color,*me.uv_layers.active.data[li].uv]
                corners.append(struct.pack('<9f',*[x if x!=0 else 0.0 for x in values]).hex())
            # Cyclic rotations preserve winding, topology and the interpolated UV/mask surface.
            face=min(''.join(corners[k:]+corners[:k]) for k in range(len(corners)))
            rows.append(f'{p.material_index}:{p.use_smooth}:{face}')
        meshes[o.name]=hashlib.sha256(('\n'.join(sorted(rows))+'\n').encode()).hexdigest()
    maps={}
    for im in bpy.data.images:
        if not im.users: continue
        data=np.empty(len(im.pixels),np.float32); im.pixels.foreach_get(data)
        maps[im.name]=hashlib.sha256(data.tobytes()).hexdigest()
    return {'polygon_uv_mask_smooth_signatures':meshes,'packed_pixel_signatures':maps}


def main(run):
    selected={}; historical=[]
    for p in sorted(EVIDENCE.glob('*_preview_*/preview.json')):
        receipt=p.parent/'receipt.json'
        d=json.loads(p.read_text())
        if not receipt.exists() or json.loads(receipt.read_text())['exit']!=0:
            historical.extend(d['sheets']); continue
        kind=json.loads(receipt.read_text())['kind']
        if kind in selected: historical.extend(selected[kind]['sheets'])
        selected[kind]=dict(d,receipt=str(receipt.relative_to(ROOT)))
    assert len(selected)==8
    correspondence=[]
    for kind,d in selected.items():
        current=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
        preview_sha=d['source_sha256']
        record={'kind':kind,'preview_source_sha256':preview_sha,'current_source_sha256':sha(current)}
        if record['current_source_sha256']==preview_sha:
            record['proof']='exact source bytes'
        else:
            previous=next((p for p in EVIDENCE.glob('*/previous-source.blend') if sha(p)==preview_sha),None)
            assert previous is not None,kind
            old=surface(previous); now=surface(current)
            assert old==now,kind+' rendered surface changed; preview must be repeated'
            record.update(proof='all polygon topology/winding, coordinates, UVs, masks, smooth flags and packed image pixels identical; only unreferenced vertices and exact carriers changed',
                          historical_source=str(previous.relative_to(ROOT)),surface=now)
        correspondence.append(record)
    sheets=[s for kind in ('round','conifer','palm','mushroom','spiral','coral','blob','cactus') for s in selected[kind]['sheets']]
    pixels=np.ones((1280,1600,4),np.float32)*.08; pixels[:,:,3]=1
    tiles=[]
    for k,s in enumerate(sheets):
        im=bpy.data.images.load(str(ROOT/s['path']),check_existing=False)
        data=np.empty(len(im.pixels),np.float32); im.pixels.foreach_get(data)
        a=data.reshape(640,960,4)[320:640,0:320]
        row=3-k//5; col=k%5
        pixels[row*320:(row+1)*320,col*320:(col+1)*320]=a
        bpy.data.images.remove(im)
        tiles.append({'tile':k,'name':s['name'],'selected_sheet':s['path']})
    out=ROOT/'assets/renders/flora/t04'/('siblings_'+run.name+'.png')
    im=bpy.data.images.new('T04_19_siblings',width=1600,height=1280,alpha=True)
    im.pixels.foreach_set(pixels.ravel()); im.filepath_raw=str(out); im.file_format='PNG'; im.save()
    all_images=list((ROOT/'assets/renders/flora/t04').rglob('*.png'))
    assert len(all_images)<=48
    assert sum(p.stat().st_size for p in all_images)<=512*1024**2
    result={'selected':sheets,'historical':historical,'correspondence':correspondence,
            'overview':{'path':str(out.relative_to(ROOT)),'sha256':sha(out),'tiles':tiles},
            'total_images':len(all_images),'total_bytes':sum(p.stat().st_size for p in all_images),
            'limits':{'images':48,'bytes':512*1024**2},'native_visual_gate':'NOT RUN; parent owned'}
    with (run/'preview-manifest.json').open('x') as f: json.dump(result,f,indent=2); f.write('\n')
    print('T04_PACKET',len(sheets),'selected',len(historical),'historical',len(all_images),'total images')


if __name__=='__main__': main(Path(sys.argv[-1]))
