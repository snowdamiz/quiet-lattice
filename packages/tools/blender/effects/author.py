"""One-time P1.E07.T14 source authoring. Never imported or called by export_effects.py.

Refuses to overwrite editable sources unless --replace is explicitly supplied.
Blender -b --factory-startup -t 2 --python-exit-code 1 -P .../author.py
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from catalog import BEATS, PALETTES, PUBLIC, ROOT, SOURCES, nodes, sha, signs

TAU = math.tau
MANIFEST = SOURCES / 'manifest.json'

def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.unit_settings.scale_length = 1
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.render.threads_mode = 'FIXED'
    s.render.threads = 2
    s.view_settings.view_transform = 'AgX'
    with bpy.data.libraries.load(str(ROOT / 'assets/blend/_library.blend'), link=False) as (src, dst):
        dst.collections = ['REF']
        dst.materials = ['LIB_EngineGlow', 'LIB_GlyphLight']
    ref = dst.collections[0]
    s.collection.children.link(ref)
    ref.hide_render = True
    for obj in ref.all_objects:
        obj.hide_render = True

def rgb(hexcode):
    return np.array([int(hexcode[i:i+2], 16) / 255 for i in (1, 3, 5)])

def save_image(name, pixels, path):
    im = bpy.data.images.new(name, width=1024, height=1024, alpha=True)
    im.colorspace_settings.name = 'sRGB'
    # A byte-backed sRGB image stores sRGB channel values; do not linearize twice.
    p = pixels.astype(np.float32).copy()
    im.pixels.foreach_set(p.ravel())
    im.file_format = 'PNG'
    im.filepath_raw = str(path)
    im.save()
    im.pack()
    return im

def textures(branch):
    pal = PALETTES[branch]
    lo, hi = rgb(pal['primary']), rgb(pal['light'])
    y, x = np.mgrid[0:1024, 0:1024] / 1023
    # Authored directional filament values, not noise: the centre has a restrained core.
    shade = .22 + .62 * np.exp(-((y-.5)/.23)**2) + .10 * np.sin(x*TAU*3)**2
    p = np.ones((1024,1024,4), np.float32)
    p[:,:,:3] = lo + (hi-lo) * shade[:,:,None]
    p[:,:,3] = .72 + .26 * np.exp(-((y-.5)/.3)**2)
    folder = PUBLIC / 'particles/effects'
    folder.mkdir(parents=True, exist_ok=True)
    surf = save_image(f'FX_{branch}_filament', p, folder / f'{branch}_filament.png')
    atlas = np.zeros((1024,1024,4), np.float32)
    yy, xx = np.mgrid[0:256,0:256]
    xx, yy = (xx-127.5)/112, (yy-127.5)/112
    r = np.sqrt(xx*xx+yy*yy)
    angle = np.arctan2(yy,xx)
    for row in range(4):
        for frame in range(4):
            age = frame/3
            if branch == 'gravitic':
                dist = np.abs(np.sqrt((xx/(.85-.12*age))**2+(yy/.46)**2)-(.55+.12*row))
                a = np.exp(-(dist/.10)**2) * (.35+.65*np.cos(angle*2)**2)
            elif branch == 'thermal':
                width = np.maximum(.035, .38*(1-(yy+.9)/1.9))
                a = np.exp(-((xx-.10*np.sin(yy*5+row))/width)**2) * np.clip(1-np.abs(yy+.1),0,1)
            elif branch == 'resonance':
                a = np.exp(-((r-(.42+.10*row+.12*age))/.045)**2) * (np.abs(angle)<2.4)
                a += .6*np.exp(-((r-.22)/.055)**2)*(np.abs(angle)>.8)
            elif branch == 'symbiotic':
                capx=.50+.10*row
                capy=.28+.05*row
                a = np.exp(-((np.sqrt((xx/capx)**2+(yy/capy)**2)-.6)/.12)**2)*(yy>-.05)
                a += .65*np.exp(-((xx-.05*row*yy)/.055)**2)*np.clip(1-np.abs(yy+.22+.04*row)*2,0,1)
            elif branch == 'void':
                a = np.exp(-((xx-.25*yy)/.065)**2)*np.clip(1-np.abs(yy),0,1)
                a *= (np.abs(yy+.12*row-.2)>.12)
            else:
                # Dissolution particles are lattice stroke fragments, not invented letters.
                slope=[.577,0,-.577,.577][row]
                a = np.exp(-((xx+slope*yy)/.07)**2)*np.clip(1-np.abs(yy)*(1.3+.15*row),0,1)
                if row==3:
                    a += .5*np.exp(-((xx-.577*yy)/.07)**2)*np.clip(1-np.abs(yy)*1.5,0,1)
            a = np.clip(a*(1-.72*age), 0, 1)
            a *= np.clip((.97-r)/.12,0,1)
            a[(np.abs(xx)>1.02)|(np.abs(yy)>1.02)] = 0
            tile = atlas[row*256:(row+1)*256,frame*256:(frame+1)*256]
            tile[:,:,:3] = lo + (hi-lo)*(.4+.6*np.clip(a,0,1)[:,:,None])
            tile[:,:,3] = a
    particles = save_image(f'FX_{branch}_particles', atlas, folder / f'{branch}_particles.png')
    return surf, particles

def material(branch, image, particle=False):
    base = bpy.data.materials['LIB_GlyphLight' if branch=='recall' else 'LIB_EngineGlow']
    mat = base.copy()
    mat.name = ('LIB_GlyphLight_Recall' if branch=='recall' else 'LIB_FX_'+branch.title()) + ('_Particle' if particle else '')
    mat['engine_name'] = mat.name
    mat['library_source'] = base.name
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.extension = 'CLIP'
    nt.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    nt.links.new(tex.outputs['Color'],bs.inputs['Emission Color'])
    nt.links.new(tex.outputs['Alpha'],bs.inputs['Alpha'])
    bs.inputs['Emission Strength'].default_value = .8 if branch=='void' else (1.4 if branch=='recall' else 1.0)
    bs.inputs['Roughness'].default_value = 1
    bs.inputs['Metallic'].default_value = 0
    nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
    mat.surface_render_method = 'BLENDED'
    mat.use_backface_culling = False
    return mat

class Sculpture:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def face(self, pts, uv):
        n = len(self.v)
        self.v.extend(pts)
        self.f.append(tuple(range(n,n+len(pts))))
        self.uv.extend(uv)

    def ribbon(self, pts, width=.04, axis=(0,0,1), taper=True):
        pts = [Vector(p) for p in pts]
        sides = []
        for i,p in enumerate(pts):
            tangent = pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]
            side = tangent.cross(Vector(axis)).normalized()
            if side.length < .1:
                side = tangent.cross(Vector((0,1,0))).normalized()
            t = i/(len(pts)-1)
            w = width * (.16+.84*math.sin(math.pi*t)**.6 if taper else 1)
            sides.append((p-side*w/2,p+side*w/2))
        for i in range(len(pts)-1):
            u, un = i/(len(pts)-1), (i+1)/(len(pts)-1)
            a,b = sides[i]
            c,d = sides[i+1]
            # Diamond section makes the ribbon readable off-axis, with physical thickness.
            n = Vector(axis).normalized()*width*.12
            self.face([a, c, d+n, b+n],[(u,.05),(un,.05),(un,.5),(u,.5)])
            self.face([b+n,d+n,c+n*2,a+n*2],[(u,.5),(un,.5),(un,.95),(u,.95)])
            self.face([a+n*2,c+n*2,c,a],[(u,.95),(un,.95),(un,.05),(u,.05)])

    def arc(self, radius, start, end, z=0, width=.04, plane='xy', centre=(0,0,0), steps=40):
        pts=[]
        for i in range(steps+1):
            a=start+(end-start)*i/steps
            p=(radius*math.cos(a),radius*math.sin(a),z)
            if plane=='xz': p=(p[0],z,p[1])
            pts.append(tuple(p[k]+centre[k] for k in range(3)))
        self.ribbon(pts,width,axis=(0,1,0) if plane=='xz' else (0,0,1))

    def leaf(self, a, b, bend, width=.10):
        a,b,bend=Vector(a),Vector(b),Vector(bend)
        self.ribbon([a.lerp(b,t)+bend*math.sin(t*math.pi) for t in np.linspace(0,1,18)],width)

    def ball(self, centre, radius, rings=6, sides=12):
        c=Vector(centre)
        for j in range(rings):
            lo=-math.pi/2+j*math.pi/rings
            hi=lo+math.pi/rings
            for i in range(sides):
                a=i*TAU/sides; b=(i+1)*TAU/sides
                def p(t,q): return c+Vector((radius*math.cos(t)*math.cos(q),radius*math.cos(t)*math.sin(q),radius*math.sin(t)))
                if j==0:
                    self.face([p(lo,a),p(hi,b),p(hi,a)],[(.5,.05),((i+1)/sides,.9),(i/sides,.9)])
                elif j==rings-1:
                    self.face([p(lo,a),p(lo,b),p(hi,a)],[(i/sides,.05),((i+1)/sides,.05),(.5,.9)])
                else:
                    self.face([p(lo,a),p(lo,b),p(hi,b),p(hi,a)],[(i/sides,.05),((i+1)/sides,.05),((i+1)/sides,.9),(i/sides,.9)])

    def object(self, name, mat, parent):
        mesh=bpy.data.meshes.new(name+'_Mesh')
        mesh.from_pydata(self.v,[],self.f)
        mesh.update()
        uv=mesh.uv_layers.new(name='UVMap')
        for i, value in enumerate(self.uv): uv.data[i].uv=value
        obj=bpy.data.objects.new(name,mesh)
        parent.objects.link(obj)
        obj.data.materials.append(mat)
        return obj

def shape(branch, ident):
    s=Sculpture()
    if ident in ('pull','tractor_beam','lance','drain'):
        count={'pull':3,'tractor_beam':4,'lance':5,'drain':2}[ident]
        for j in range(count):
            a=j*TAU/count
            pts=[]
            for t in np.linspace(0,1,33):
                phase=a+t*(TAU*1.4 if ident=='tractor_beam' else 3)
                r=(.14 if ident!='lance' else .08)*(1-.7*t)
                pts.append((r*math.cos(phase),t-.5,r*math.sin(phase)))
            if ident=='drain':
                for k in range(3): s.ribbon(pts[k*10:k*10+8],.035,axis=(0,0,1))
            else: s.ribbon(pts,.035 if ident!='lance' else .05,axis=(0,0,1))
        if ident=='tractor_beam':
            for y in (-.4,.35):
                for k in range(3): s.arc(.18,k*TAU/3,k*TAU/3+1.5,y,.025,'xz')
    elif ident in ('slam','vent','pulse'):
        layers=3 if ident=='pulse' else 2
        for j in range(layers):
            for k in range(6):
                a=k*TAU/6+j*.12
                s.arc(.48+j*.24,a,a+(.88 if ident=='pulse' else .66),j*.035,.025 if ident=='pulse' else .11)
                if ident=='vent':
                    s.leaf((.6*math.cos(a),.6*math.sin(a),0),(math.cos(a+.2),math.sin(a+.2),.2),(0,0,.25),.09)
    elif ident=='well':
        for z,r in [(-.65,.75),(0,1),(.65,.75)]:
            for k in range(3): s.arc(r,k*TAU/3,k*TAU/3+1.65,z,.026)
        for k in range(4):
            a=k*TAU/4
            s.ribbon([(math.sin(t)*math.cos(a),math.sin(t)*math.sin(a),math.cos(t)) for t in np.linspace(.15,math.pi-.15,30)],.035)
    elif ident=='inertial_brake':
        for sign in (-1,1):
            for j in range(3): s.leaf((sign*.25,-.6+j*.22,-.2),(sign*(1-j*.14),.5,.2),(sign*.35,-.2,.15),.12-j*.025)
    elif ident in ('flare','deep_sweep'):
        for j in range(5):
            a=(j-2)*math.pi/12
            s.leaf((0,-.5,0),(math.sin(a),math.cos(a)-.5,.03),(.12*math.sin(a),0,.14 if ident=='flare' else -.22),.18 if ident=='flare' else .04)
        if ident=='deep_sweep':
            for r in (.4,.7,1): s.arc(r,math.pi/3,2*math.pi/3,-.15,.018,centre=(0,-.5,0))
    elif ident=='sear':
        for j in range(4):
            a=j*TAU/4
            s.arc(.45,a,a+.9,0,.07,'xz')
            s.leaf((.45*math.cos(a),0,.45*math.sin(a)),(.22*math.cos(a+.6),0,.22*math.sin(a+.6)),(0,-.09,0),.06)
    elif ident=='harmonic':
        for j in range(3):
            x=(j-1)*.35
            s.ribbon([(x-.14,0,-.4),(x-.14,0,.2),(x,0,.42),(x+.14,0,.2),(x+.14,0,-.4)],.038,axis=(0,1,0))
    elif ident in ('shatter','blink_strike'):
        n=9 if ident=='shatter' else 3
        for j in range(n):
            a=j*TAU/n
            s.leaf((.15*math.cos(a),0,.15*math.sin(a)),(.9*math.cos(a),.08,.9*math.sin(a)),(.06,-.2,.06),.13 if ident=='shatter' else .21)
    elif ident=='veil':
        for j in range(6):
            a=j*TAU/6
            s.ribbon([(.43*math.cos(a+t*.35),.30*math.sin(a+t*.35),t*1.85-.925) for t in np.linspace(0,1,28)],.028)
    elif ident=='jammer':
        for z in (-.35,0,.35):
            for sign in (-1,1): s.ribbon([(sign*.12,0,z),(sign*.45,0,z+.18),(sign*.9,0,z+.18)],.065,axis=(0,1,0))
    elif ident=='bond':
        for sign in (-1,1):
            for j in range(2):
                s.arc(.55+j*.08,.2,TAU-.4,.02*j,.035,centre=(sign*.27,0,0))
                s.leaf((sign*.8,0,0),(sign*.3,.6,.25),(0,.12,.16),.10)
    elif ident in ('regrow','call'):
        for j in range(3):
            a=j*TAU/3
            if ident=='regrow':
                trunk=[(.25*math.cos(a+t),.25*math.sin(a+t),t*1.85-.925) for t in np.linspace(0,1,25)]
                s.ribbon(trunk,.04)
                for h in (.3,.55,.75):
                    p=Vector((.25*math.cos(a+h),.25*math.sin(a+h),h*1.85-.925))
                    for sign in (-1,1): s.leaf(p,p+Vector((sign*.23,.13,.24)),(0,0,.10),.07)
            else:
                y=(j-1)*.48
                for sign in (-1,1): s.leaf((sign*.55,y-.2,0),(0,y+.22,0),(sign*.1,0,.07),.10)
    elif ident in ('repair_drones','spore'):
        n=3 if ident=='repair_drones' else 7
        for j in range(n):
            a=j*2.39996
            radius=.65 if ident=='repair_drones' else .15+.1*j
            c=Vector((radius*math.cos(a),radius*math.sin(a),.16*math.sin(j*2)))
            cap=.16 if ident=='repair_drones' else .24
            gills=6 if ident=='repair_drones' else 5
            for k in range(gills):
                b=k*TAU/gills
                s.leaf(c+Vector((0,0,.12)),c+Vector((cap*math.cos(b),cap*math.sin(b),0)),(0,0,.08),.04)
            s.arc(cap,0,TAU-.08,c.z,.022,centre=(c.x,c.y,0),steps=24)
    elif ident in ('phase','micro_jump','cloak'):
        wide=.44 if ident=='phase' else 1
        high=.925 if ident=='phase' else .45
        for sign in (-1,1):
            for j in range(3):
                x=sign*(wide-j*.055)
                s.ribbon([(x*.4,-j*.08,-high),(x,-j*.08,-high*.4),(x*1.08,-j*.08,high*.5),(x*.6,-j*.08,high)],.055 if ident!='cloak' else .018,axis=(0,1,0))
    elif ident=='rift':
        for j in range(3):
            for part in range(2):
                pts=[]
                for t in np.linspace(.08+part*.48,.40+part*.48,25):
                    a=j*TAU/3+t*4
                    pts.append((t*math.cos(a),t*math.sin(a),-.10*(1-t)))
                s.ribbon(pts,.09)
    elif ident=='eclipse':
        for j in range(8):
            a=j*TAU/8
            pts=[(math.sin(t)*math.cos(a),math.sin(t)*math.sin(a),math.cos(t)*.65) for t in np.linspace(.18,1.5,20)]
            s.ribbon(pts,.075)
        for k in range(4): s.arc(1,k*TAU/4,k*TAU/4+1.1,0,.06)
    elif ident=='dissolve':
        for j in range(30):
            a=j*2.39996; z=(j/29-.5)*1.85
            r=.14+.24*math.sin((j/29)*math.pi)
            p=Vector((r*math.cos(a),r*math.sin(a),z))
            s.ribbon([p,p+Vector((.035,0,.06)),p+Vector((.035,0,.10))],.018,axis=(0,1,0),taper=False)
    elif ident=='flash':
        for j in range(6):
            a=j*TAU/6
            s.leaf((0,0,0),(math.sin(a),0,math.cos(a)),(0,-.08,0),.08)
        s.ball((0,0,0),.12)
    else:
        raise ValueError((branch,ident))
    return s

def glyph(strokes):
    s=Sculpture()
    def node(i):
        if i=='C': return Vector((0,0,0))
        a=math.pi/2-int(i)*math.pi/3
        return Vector((.5*math.cos(a),0,.5*math.sin(a)))
    endpoints=set()
    for code in strokes:
        i=int(code[1]); a='C' if code[0]=='S' else i; b=i if code[0]=='S' else (i+1)%6
        s.ribbon([node(a),node(b)],.08,axis=(0,1,0),taper=False)
        endpoints.update((a,b))
    for p in endpoints or {'C'}: s.ball(node(p),.04,rings=4,sides=12)
    return s

def make_asset(name, sculpt, mat, **props):
    asset=collection(name)
    lod=collection(name+'_LOD0',asset)
    obj=sculpt.object(name+'_Surface',mat,lod)
    for k,v in props.items(): obj[k]=v
    obj.data.calc_loop_triangles()
    bounds=np.array([v.co[:] for v in obj.data.vertices])
    return dict(id=name, root=name, lod=name+'_LOD0', mesh=obj.name, material=mat['engine_name'],
                triangles=len(obj.data.loop_triangles), boundsBlender=[bounds.min(0).tolist(),bounds.max(0).tolist()],
                drawCalls=1, assetClass='effect')

def main():
    SOURCES.mkdir(parents=True,exist_ok=True)
    if list(SOURCES.glob('*.blend')) and '--replace' not in sys.argv:
        raise RuntimeError('Editable sources exist; use a deliberate source edit or explicit --replace.')
    manifest=dict(task='P1.E07.T14',base='634c51d2378748c6a514af2a792ee4500b912643',palettes=PALETTES,nodes=nodes(),assets=[],sheets=[],
                  sourceInputs={p:sha(ROOT/p) for p in ['packages/shared/src/art/glyphs.ts','packages/tools/blender/families.json','assets/blend/_library.blend']},
                  contract=dict(loader='packages/client/src/core/Engine.js:gltfLoader; select named root and its LOD0',
                    coordinates='Blender metres +Z up -> glTF metres +Y up. Beams: Blender +Y -> glTF -Z.',
                    material='glTF PBR emissive, BLEND, double-sided, straight alpha; depthWrite=false for particle playback',
                    animation='No GLB animation authored. Timeline/visibility/UV stepping/body dissolve shader belong to playback tasks.',
                    particleBudget=dict(perCast=64,scene=512,drawCallsPerCast=4,sceneDrawCalls=64,enforcement='integration requirement, not a runtime performance claim')))
    for branch, beats in BEATS.items():
        reset()
        surf,particles=textures(branch)
        mat=material(branch,surf)
        pm=material(branch,particles,True)
        for ident,(silhouette,duration,cap,placement) in beats.items():
            row=make_asset(branch+'_'+ident,shape(branch,ident),mat)
            row.update(branch=branch,role='beat',silhouette=silhouette,envelopeSeconds=duration,maxParticles=cap,placement=placement,
                       source=f'assets/blend/effects/{branch}.blend',glb=f'/models/effects/{branch}.glb',particle=f'{branch}_particle')
            manifest['assets'].append(row)
        # A dished 12-triangle carrier with real UVs; not an opaque placeholder quad.
        s=Sculpture()
        for i in range(12):
            a=i*TAU/12; b=(i+1)*TAU/12
            s.face([(0,-.008,0),(.5*math.cos(a),0,.5*math.sin(a)),(.5*math.cos(b),0,.5*math.sin(b))],
                   [(.125,.125),(.125+.109*math.cos(a),.125+.109*math.sin(a)),(.125+.109*math.cos(b),.125+.109*math.sin(b))])
        row=make_asset(branch+'_particle',s,pm)
        row.update(branch=branch,role='particle',source=f'assets/blend/effects/{branch}.blend',glb=f'/models/effects/{branch}.glb',maxParticles=0)
        manifest['assets'].append(row)
        manifest['sheets'].append(dict(branch=branch,path=f'/particles/effects/{branch}_particles.png',size=[1024,1024],grid=[4,4],
          rowOrigin='bottom',frameDirection='left-to-right',frameUVSize=[.25,.25],templateUVCell=[0,0],
          gutterPixels=14,alpha='straight',frames=4,rows=4,uvStep='add (frame/4,row/4) to the template UV; no additional scale',
          playback='four decay frames across each row, choose one of four shapes; clamp texture, never wrap; pool and batch by branch'))
        if branch=='recall':
            for letter,strokes in signs():
                name='recall_glyph_'+('divider' if letter=='·' else letter)
                row=make_asset(name,glyph(strokes),mat,glyph_letter=letter,glyph_strokes=','.join(strokes),glyph_diameter=1.0,glyph_stroke_width=.08)
                row.update(branch=branch,role='glyph',letter=letter,strokes=strokes,source='assets/blend/effects/recall.blend',glb='/models/effects/recall.glb',maxParticles=0,
                           placement='upright in Blender XZ / glTF XY; N0 stays up; arrange clockwise without rotating signs')
                manifest['assets'].append(row)
        bpy.context.scene['task']='P1.E07.T14'
        bpy.context.scene['source_of_truth']='Editable sculpted meshes; export must not call author.py'
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCES/f'{branch}.blend'),compress=True)
    manifest['recall']=dict(sequence=['glyph light','dissolve','flash'],glyphs=24,exampleWord=['r','e','k','a','l','l'],
         maxGlyphInstances=6,maxParticles=48,maxDrawCalls=3,
         batching='Merge at most six selected glyph meshes into one geometry/material draw (different signs cannot share ordinary instancing); dissolve one draw, flash one draw, particles one draw. Glyph+dissolve+particles then flash+particles; no all-stage overlap.',
         proposedTiming=[dict(stage='glyph light',start=0,end=.45),dict(stage='dissolve',start=.3,end=.95),dict(stage='flash',start=.95,end=1.07)])
    MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n')
    print('AUTHORED',len(manifest['assets']),'assets;',len(manifest['nodes']),'nodes; 6 editable source collections')

if __name__=='__main__': main()
