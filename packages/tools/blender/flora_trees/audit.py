"""Read actual saved sources and actual decoded compressed exports into bounded evidence."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
import numpy as np

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sys.path.insert(0,str(HERE.parent))
from artlib import core, glb, ktx, rules


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_source(o):
    me=o.data
    me.calc_loop_triangles()
    ca=me.color_attributes.active_color
    assert ca and ca.data_type=='FLOAT_COLOR' and ca.domain=='POINT'
    colors=np.empty(len(ca.data)*4,np.float32); ca.data.foreach_get('color',colors); colors=colors.reshape(-1,4)
    assert np.isfinite(colors).all() and np.all((colors>=0)&(colors<=1))
    assert np.max(np.abs(colors[:,:3].sum(1)-1))<.00001
    positions=[]; rows=set()
    for i,v in enumerate(me.vertices):
        p=o.matrix_world@v.co
        row=[p.x,p.z,-p.y,*colors[i]]
        positions.append(row[:3])
        row=[float(x) if x!=0 else 0.0 for x in row]
        rows.add(struct.pack('<7f',*row).hex())
    coords=np.array(positions)
    # Full unique position+mask cloud, invariant to glTF's normal/UV vertex splitting and reorder.
    cloud=hashlib.sha256(('\n'.join(sorted(rows))+'\n').encode()).hexdigest()
    return {'triangles':len(me.loop_triangles),'vertices':len(me.vertices),'unique_position_mask_count':len(rows),
            'position_mask_sha256':cloud,'bounds_yup':[coords.min(0).tolist(),coords.max(0).tolist()],
            'mask_min':colors.min(0).tolist(),'mask_max':colors.max(0).tolist(),
            'organs':len(o.vertex_groups),'uv_layers':[u.name for u in me.uv_layers]}


def main(kind,run):
    src=ROOT/'assets/blend/flora'/f'tree_{kind}_t04.blend'
    dst=ROOT/'packages/client/public/models/flora'/f'tree_{kind}_t04.glb'
    prefix='cactus_' if kind=='cactus' else 'tree_'+kind+'_'
    before=digest(src)
    core.load(src)
    source={o.name:snapshot_source(o) for o in bpy.data.objects if o.type=='MESH' and o.name.startswith(prefix)}
    assert len(source)==(12 if kind in ('round','conifer','mushroom') else 8)
    packed=[{'name':i.name,'packed':i.packed_file is not None,'size':list(i.size)} for i in bpy.data.images if i.users]
    assert packed and all(i['packed'] for i in packed)
    js,bin_data=glb.read(dst)
    assert {'EXT_meshopt_compression','KHR_texture_basisu'}<=set(js['extensionsRequired'])
    assert 'KHR_mesh_quantization' not in js.get('extensionsUsed',[])
    for m in js['meshes']:
        for p in m['primitives']:
            for key in ('POSITION','COLOR_0','NORMAL','TEXCOORD_0'):
                a=js['accessors'][p['attributes'][key]]
                assert a['componentType']==5126 and not a.get('normalized'),(m['name'],key,a)
            assert not any(k.startswith('_T04_MASK') for k in p['attributes'])
    ktx_info=ktx.inspect(dst)
    core.load(dst) # Actual KTX2 texels transcoded by stock decoder and meshopt decoded by Blender.
    decoded=[]
    for im in bpy.data.images:
        if not im.users or im.type=='RENDER_RESULT': continue
        pixels=np.empty(len(im.pixels),np.float32); im.pixels.foreach_get(pixels)
        assert len(pixels) and np.isfinite(pixels).all()
        channels=pixels.reshape(-1,im.channels)
        decoded.append({'name':im.name,'size':list(im.size),'colorspace':im.colorspace_settings.name,
                        'decoded_float_pixel_sha256':hashlib.sha256(pixels.tobytes()).hexdigest(),
                        'min':channels.min(0).tolist(),'max':channels.max(0).tolist(),'std':channels.std(0).tolist()})
    assert len(decoded)>=3
    assert digest(src)==before
    out={'source':str(src.relative_to(ROOT)),'source_sha256':before,'export':str(dst.relative_to(ROOT)),
         'export_sha256':digest(dst),'source_meshes':source,'source_packed_images':packed,
         'ktx':ktx_info,'decoded_images':decoded,'source_unchanged':True}
    with (run/'audit.json').open('x') as f: json.dump(out,f,indent=2); f.write('\n')
    print('T04_AUDIT',kind,len(source),'LODs;',len(decoded),'decoded maps')


if __name__=='__main__': main(sys.argv[-2],Path(sys.argv[-1]))
