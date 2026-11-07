"""Paint the saved LOD0 UV atlas, then bake its relief and occlusion with CPU Cycles.

Paint masks describe named wear sites in metres. No noise/crackle/stipple generator is used.
All lower LODs and liveries share this UV layout and its LOD0-derived normal/ORM maps.
"""
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[5]
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'packages/tools/blender'))
from artlib import core, bake
from author_round3 import select

SRC=ROOT/'assets/blend/hulls/kestrel.blend'
OUT=ROOT/'assets/renders/hulls/kestrel-round3-current'
SIZE=4096
PALETTES={'ulgani':('#F2EAD3','#D9962B','#5B4636'),'compact':('#F4F4F0','#22406A','#F28C28'),'working':('#9A968C','#3A3B3D','#E3B341')}


def linear(hexcode):
    c=np.array([int(hexcode[i:i+2],16)/255 for i in (1,3,5)],np.float32)
    return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)


def make_image(name, rgb, colour=False):
    old=bpy.data.images.get(name)
    if old:bpy.data.images.remove(old)
    im=bpy.data.images.new(name,SIZE,SIZE,alpha=False,float_buffer=False)
    im.colorspace_settings.name='sRGB' if colour else 'Non-Color'
    px=np.ones((SIZE,SIZE,4),np.float32)
    px[:,:,:3]=rgb[:,:,None] if rgb.ndim==2 else rgb
    im.pixels.foreach_set(px.ravel());im.update();im.pack();im.use_fake_user=True
    return im


def pixels(im):
    a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a)
    return a.reshape(SIZE,SIZE,4)


def raster(objects, strict=True):
    """Sample actual LOD0 triangles into their UV islands, preserving position and paint region."""
    atlas=np.zeros((SIZE,SIZE,4),np.float32);covered=np.zeros((SIZE,SIZE),bool)
    overlap=0;tris=0;bad_faces={}
    for o in objects:
        overlap_before=overlap
        me=o.data;me.calc_loop_triangles()
        attr=me.attributes['paint_region'];uv=me.uv_layers.active.data
        co=np.array([tuple(o.matrix_world@v.co) for v in me.vertices],np.float32)
        for t in me.loop_triangles:
            if attr.data[t.polygon_index].value in (4,5):continue
            xy=np.array([tuple(uv[i].uv) for i in t.loops],np.float32)*SIZE-.5
            x0,y0=np.maximum(0,np.ceil(xy.min(0))).astype(int);x1,y1=np.minimum(SIZE-1,np.floor(xy.max(0))).astype(int)
            if x1<x0 or y1<y0:continue
            a,b,c=xy;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-8:continue
            yy,xx=np.mgrid[y0:y1+1,x0:x1+1].astype(np.float32)
            u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w=1-u-v
            inside=(u>=-1e-5)&(v>=-1e-5)&(w>=-1e-5)
            pos=u[:,:,None]*co[t.vertices[0]]+v[:,:,None]*co[t.vertices[1]]+w[:,:,None]*co[t.vertices[2]]
            view=atlas[y0:y1+1,x0:x1+1];mask=covered[y0:y1+1,x0:x1+1]
            hits=int(np.count_nonzero(inside&mask&(np.linalg.norm(view[:,:,:3]-pos,axis=2)>.02)))
            overlap+=hits
            if hits:bad_faces.setdefault(o.name,set()).add(t.polygon_index)
            view[:,:,:3][inside]=pos[inside];view[:,:,3][inside]=attr.data[t.polygon_index].value;mask[inside]=True;tris+=1
        print('rasterized',o.name,'overlap',overlap-overlap_before,flush=True)
    original=covered.copy()
    # Eight pixels of island padding; never overwrite another island's samples.
    for _ in range(8):
        for axis,shift in ((0,1),(0,-1),(1,1),(1,-1)):
            valid=np.roll(covered,shift,axis)&~covered
            atlas[valid]=np.roll(atlas,shift,axis)[valid];covered[valid]=True
    print('raster coverage',int(original.sum()),'triangles',tris,'overlap',overlap,flush=True)
    if strict:assert overlap==0, f'overlapping UV islands: {overlap} texels'
    return atlas,original,{'coveredTexels':int(original.sum()),'surfaceFraction':float(original.mean()),'overlapTexels':overlap,'trianglesSampled':tris,'overlappingFaces':{k:sorted(v) for k,v in bad_faces.items()}}


def pack_surface(objects):
    # Triangulate the editable faces before packing, so local chart repairs are unambiguous.
    import bmesh
    for o in objects:
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    select(objects);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=.85,island_margin=.00002,area_weight=0,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
    a,m,report=raster(objects,strict=False);del a,m
    bad={(name,i) for name,ids in report['overlappingFaces'].items() for i in ids}
    if bad:
        # Reserve a strip for the few folded legacy charts. Each offending triangle gets its own island.
        width=.08;columns=8;dx=width/columns;dy=1/64
        for o in objects:
            for uv in o.data.uv_layers.active.data:uv.uv.x*=1-width
        for attempt in range(5):
            assert len(bad)<=512, f'too many folded charts for a local repair: {len(bad)}'
            for i,(name,face) in enumerate(sorted(bad)):
                o=bpy.data.objects[name];x=1-width+(i%columns)*dx;y=(i//columns)*dy;inset=2/SIZE
                uv=o.data.uv_layers.active.data
                for li,xy in zip(o.data.polygons[face].loop_indices,[(x+inset,y+inset),(x+dx-inset,y+inset),(x+inset,y+dy-inset)]):uv[li].uv=xy
            a,m,check=raster(objects,strict=False);del a,m
            if not check['overlapTexels']:break
            bad|={(name,i) for name,ids in check['overlappingFaces'].items() for i in ids}
    for o in objects:
        for p in o.data.polygons:
            if o.data.attributes['paint_region'].data[p.index].value in (4,5):
                for li in p.loop_indices:o.data.uv_layers.active.data[li].uv=(0,0)
    a,m,final=raster(objects)
    assert final['surfaceFraction']>=.25,final
    final['repairedFoldedTriangles']=len(bad)
    return a,m,final


def fields(atlas):
    x,y,z,region=np.moveaxis(atlas,2,0)
    def oval(cx,cy,cz,sx,sy,sz):return np.exp(-2*((x-cx)/sx)**2-2*((y-cy)/sy)**2-2*((z-cz)/sz)**2)
    hand=oval(-.87,1.96,.76,.20,1.1,.38)+oval(.54,2.6,.51,.18,.5,.18)
    leading=np.exp(-((y-(1.1-.55*np.abs(x)))/.20)**2)*(np.abs(x)>1.1)*(z>.05)
    nose=np.clip((y-4.2)/2.5,0,1)
    lichen=oval(1.2,-.65,.0,.65,1.0,.4)+oval(-1.2,-.65,.0,.65,1.0,.4)+oval(0,-4.7,.2,.8,1.6,.35)
    exhaust=oval(1.5,-5.9,-.2,.55,1.6,.7)+oval(-1.5,-5.9,-.2,.55,1.6,.7)
    tread=(region==8)*np.exp(-((y-1.96)/.36)**4)
    feet=(region==2)*oval(0,2.8,-.14,.45,.55,.12)
    patch=(region==10).astype(np.float32)
    # Chitin has restrained growth ridges, membrane has tension folds near its leading attachment.
    height=.5+.025*np.sin(y*19+x*3)*(region==1)*(leading+.25*nose)
    height+=.020*np.sin(y*28+x*6)*(region==0)*leading
    height-=.025*(hand+tread+feet)*(np.sin(x*87+y*113)**10)
    height+=.012*(region==7)*np.cos(y*150)*np.cos(x*150)
    height+=.03*patch
    rough=.58+.10*lichen+.10*exhaust-.19*np.minimum(hand+tread+feet,1)+.06*leading
    rough=np.where(region==7,.78-.08*np.exp(-((x/.2)**2)),rough)
    rough=np.where(region==6,.42+.10*leading,rough)
    rough=np.where(region==9,.38+.12*np.sin(y*8)**2,rough)
    return dict(hand=hand,leading=leading,nose=nose,lichen=lichen,exhaust=exhaust,tread=tread,feet=feet,patch=patch,height=height,rough=rough)


def paint(atlas, f, livery, state='base'):
    region=atlas[:,:,3];x,y,z=np.moveaxis(atlas[:,:,:3],2,0)
    palette=list(map(linear,PALETTES[livery]));rgb=np.zeros((SIZE,SIZE,3),np.float32)
    colours={0:palette[0],1:palette[1],2:linear('#323B34'),3:palette[2],4:linear('#172116'),5:linear('#C7F06A'),6:linear('#73532A'),7:linear('#6D7057'),8:linear('#625D4D'),9:linear('#B9C2A2'),10:linear('#F2EAD3')*.95}
    for r,c in colours.items():rgb[region==r]=c
    # Use wear is directional and localized, not sprinkled over every face.
    weather=np.clip(.35*f['leading']+.20*f['nose'],0,.5)*(region<4)
    rgb=rgb*(1-weather[:,:,None])+linear('#ADA78E')*weather[:,:,None]
    shelter=np.clip(f['lichen']*.30,0,.5)*(region<4)
    rgb=rgb*(1-shelter[:,:,None])+linear('#58634B')*shelter[:,:,None]
    rgb*=1-.48*f['exhaust'][:,:,None]
    polish=np.clip(.15*f['hand']+.16*f['tread']+.12*f['feet'],0,.25)
    rgb=rgb*(1-polish[:,:,None])+linear('#C0B59B')*polish[:,:,None]
    # Stairs wear through in the centre; tread rims carry the selected yard's trim colour.
    rim=(region==8)*(np.abs(y-1.96)>.56)
    rgb[rim]=palette[2]
    if state=='damaged':
        scorch=np.exp(-((x-3.8)/1.3)**2-((y+2.8)/.9)**2)+np.exp(-((x+.9)/.6)**2-((y+2.7)/1.1)**2)
        scorch=np.clip(scorch,0,.93)
        rgb=rgb*(1-scorch[:,:,None])+linear('#30271F')*scorch[:,:,None]
    elif state=='husked':
        # Traces of each old livery remain under char; sheltered edges bleed dark rust.
        char=linear('#121416');rust=linear('#5A3B2E')
        rgb=rgb*.13+char*.87
        bleed=np.clip(f['lichen']*.45+f['exhaust']*.30,0,.65)
        rgb=rgb*(1-bleed[:,:,None])+rust*bleed[:,:,None]
        rgb[region==6]=linear('#171A18')
    return np.clip(rgb,0,1)


def targets(objects, image):
    materials={s.material for o in objects for s in o.material_slots if s.material}
    nodes=[]
    for m in materials:
        n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;m.node_tree.nodes.active=n;nodes.append((m,n))
    return nodes


def bake_image(objects, name, kind, mask):
    im=bpy.data.images.new(name,SIZE,SIZE,alpha=False)
    im.colorspace_settings.name='Non-Color';im.generated_color=(1,0,1,1)
    nodes=targets(objects,im)
    hidden=bake._isolate(objects)
    try:
        select(objects)
        bpy.ops.object.bake(type=kind,use_clear=False,normal_space='TANGENT')
        px=pixels(im);sentinel=np.all(np.abs(px[:,:,:3]-np.array([1,0,1]))<.01,axis=2)
        missed=int(np.count_nonzero(sentinel&mask))
        assert missed<int(mask.sum()*.001)+1,(kind,'bake left surface texels unwritten',missed)
        px[sentinel,:3]=(.5,.5,1) if kind=='NORMAL' else (1,1,1)
        im.pixels.foreach_set(px.ravel());im.update();im.pack();im.use_fake_user=True
    finally:
        for m,n in nodes:m.node_tree.nodes.remove(n)
        for o,was in hidden:o.hide_render=was
    return im


def wire(material, colour, orm, normal):
    nt=material.node_tree;nt.nodes.clear()
    bs=nt.nodes.new('ShaderNodeBsdfPrincipled');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    for image,key in [(colour,'Base Color'),(orm,None),(normal,'Normal')]:
        tex=nt.nodes.new('ShaderNodeTexImage');tex.image=image;tex.label=image.name
        if key=='Base Color':nt.links.new(tex.outputs['Color'],bs.inputs[key])
        elif key=='Normal':
            n=nt.nodes.new('ShaderNodeNormalMap');nt.links.new(tex.outputs['Color'],n.inputs['Color']);nt.links.new(n.outputs['Normal'],bs.inputs['Normal'])
        else:
            sep=nt.nodes.new('ShaderNodeSeparateColor');nt.links.new(tex.outputs['Color'],sep.inputs['Color']);nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']);nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
            grp=nt.nodes.new('ShaderNodeGroup');grp.node_tree=bake._gltf_group();nt.links.new(sep.outputs['Red'],grp.inputs['Occlusion'])
    bs.inputs['Specular IOR Level'].default_value=.28
    material['atlas_source']='kestrel_LOD0'
    material['atlas_size']=SIZE


def main():
    before=hashlib.sha256(SRC.read_bytes()).hexdigest();core.load(SRC)
    assert bpy.context.scene.get('kestrel_stage') in ('authored','base_atlas_baked')
    bpy.context.preferences.filepaths.save_version=0
    sc=bpy.context.scene;bake.ensure_cycles(sc,16);sc.render.threads_mode='FIXED';sc.render.threads=2
    objects=[o for o in bpy.data.collections['kestrel_LOD0'].objects if o.type=='MESH' and not o.name.startswith('SporeNavigation')]
    atlas,mask,raster_report=pack_surface(objects);f=fields(atlas)
    # Rebakes replace old image routes before installing a new height target.
    for mat in {s.material for o in objects for s in o.material_slots if s.material and s.material.get('engine_name')!='EngineGlow'}:
        nt=mat.node_tree;nt.nodes.clear();bs=nt.nodes.new('ShaderNodeBsdfPrincipled');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    for name in ('Kestrel_R3_LOD0_Normal_4096','Kestrel_R3_LOD0_AO_4096'):
        if bpy.data.images.get(name):bpy.data.images.remove(bpy.data.images[name])
    height=make_image('Kestrel_R3_AuthoredRelief_4096',f['height'])
    materials={s.material for o in objects for s in o.material_slots if s.material and s.material.get('engine_name')!='EngineGlow'}
    for mat in materials:
        nt=mat.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED');tex=nt.nodes.new('ShaderNodeTexImage');tex.image=height;bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.12;nt.links.new(tex.outputs['Color'],bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    normal=bake_image(objects,'Kestrel_R3_LOD0_Normal_4096','NORMAL',mask)
    ao=bake_image(objects,'Kestrel_R3_LOD0_AO_4096','AO',mask)
    orm_px=np.zeros((SIZE,SIZE,3),np.float32);orm_px[:,:,0]=pixels(ao)[:,:,0];orm_px[:,:,1]=f['rough'];orm=make_image('Kestrel_R3_base_ORM_4096',orm_px)
    colours={name:make_image('Kestrel_R3_base_'+name+'_Color_4096',paint(atlas,f,name),True) for name in PALETTES}
    for mat in materials:wire(mat,colours['ulgani'],orm,normal)
    bpy.data.images.remove(ao)
    # Remove old rejected 1K masks and orphan materials; retain only editable, packed round3 maps.
    for im in list(bpy.data.images):
        if not im.name.startswith('Kestrel_R3_'):bpy.data.images.remove(im)
    for mat in list(bpy.data.materials):
        if not mat.users:bpy.data.materials.remove(mat)
    sc['kestrel_stage']='base_atlas_baked'
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    report={'inputSha256':before,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'resolution':SIZE,'CPU_Cycles':True,'threads':2,'samples':16,'raster':raster_report,'paintSites':['leading attachment weathering','cockpit hand contacts','centre of boarding treads','pedal contact','sheltered root-joint lichen','aft nozzle soot','paler right-wing membrane patch'],'normalMethod':'Cycles tangent-normal bake of authored relief on actual LOD0 UVs','aoMethod':'Cycles AO from actual LOD0 geometry only','images':[{ 'name':im.name,'size':list(im.size),'packedSha256':hashlib.sha256(im.packed_file.data).hexdigest()} for im in bpy.data.images if im.name.startswith('Kestrel_R3_')]}
    (OUT/'atlas-base.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))


if __name__=='__main__':main()
