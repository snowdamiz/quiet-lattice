"""One-time editable Kestrel revision from the verified R2 source; never called at export."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "packages/tools/blender"))
from artlib import core, scene as S

SRC = ROOT / "assets/blend/hulls/kestrel.blend"
OUT = ROOT / "assets/renders/hulls/kestrel-round3-current"
EXPECTED = "ea45999c7d204b5d04ee6bfa8789c69c8f0e25cb686f8efaeaa86d95301f51dc"


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def relocate(o, collection):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    collection.objects.link(o)


def region(o, value):
    a = o.data.attributes.get('paint_region') or o.data.attributes.new('paint_region', 'INT', 'FACE')
    for d in a.data:
        d.value = value


def finish(o, name, mat, paint, parent=None):
    o.name = name
    relocate(o, COLL)
    select([o])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.materials.clear()
    o.data.materials.append(mat)
    region(o, paint)
    for p in o.data.polygons:
        p.use_smooth = True
    if parent:
        world = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = world
    return o


def tube(name, points, radii, mat, paint=1, parent=None):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 6
    cu.bevel_depth = 1
    cu.bevel_resolution = 2
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points)-1)
    for bp, pos, rad in zip(sp.bezier_points, points, radii):
        bp.co = pos
        bp.radius = rad
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu)
    COLL.objects.link(o)
    select([o])
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, name, mat, paint, parent)


def cushion(name, center, size, mat, paint=7, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=center)
    o = bpy.context.object
    for v in o.data.vertices:
        q = v.co
        # Flatten the middle and curl the edges into a sewn, crescent-shaped support.
        q.x *= 1 - .10*q.y
        q.z += .13*q.x*q.x
    o.scale = size
    return finish(o, name, mat, paint, parent)


def leaf(name, rings, mat, paint, parent=None, sections=24):
    verts, faces = [], []
    for y, halfwidth, z, camber in rings:
        for j in range(sections+1):
            t = j/sections*2-1
            verts.append((halfwidth*t, y, z + camber*t*t))
    for i in range(len(rings)-1):
        for j in range(sections):
            a=i*(sections+1)+j
            faces.append((a,a+1,a+sections+2,a+sections+1))
    me=bpy.data.meshes.new(name)
    me.from_pydata(verts,[],faces)
    me.update()
    o=bpy.data.objects.new(name,me);COLL.objects.link(o)
    select([o])
    md=o.modifiers.new('Membrane_thickness','SOLIDIFY');md.thickness=.018
    bpy.ops.object.modifier_apply(modifier=md.name)
    return finish(o,name,mat,paint,parent)


def join(objects, name, parent=None):
    select(objects)
    bpy.ops.object.join()
    o=bpy.context.object;o.name=name
    world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world
    # Remove unused material slots, which otherwise inflate source inventory.
    used=sorted({p.material_index for p in o.data.polygons})
    mats=[o.material_slots[i].material for i in used]
    indices=[used.index(p.material_index) for p in o.data.polygons]
    o.data.materials.clear()
    for m in mats:o.data.materials.append(m)
    for slot,m in zip(o.material_slots,mats):slot.link='DATA';slot.material=m
    for p,i in zip(o.data.polygons,indices):p.material_index=i
    return o


def empty(name, loc, parent=None):
    o=bpy.data.objects.new(name,None);COLL.objects.link(o);o.location=loc
    if parent:
        world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world
    return o


def collider(name, lo, hi):
    bpy.ops.mesh.primitive_cube_add(size=1, location=[(a+b)/2 for a,b in zip(lo,hi)])
    o=bpy.context.object;o.name=name;o.scale=[b-a for a,b in zip(lo,hi)]
    relocate(o,ASSET);select([o]);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    o.hide_render=True;o.display_type='WIRE'
    return o


def open_cabin(body):
    bm=bmesh.new();bm.from_mesh(body.data)
    doomed=[f for f in bm.faces if abs(f.calc_center_median().x)<.73 and 1.10<f.calc_center_median().y<3.25 and -.22<f.calc_center_median().z<1.1]
    count=len(doomed);bmesh.ops.delete(bm,geom=doomed,context='FACES');bm.to_mesh(body.data);bm.free()
    return count


def prepare():
    global COLL, ASSET
    assert hashlib.sha256(SRC.read_bytes()).hexdigest()==EXPECTED, 'authoring requires the exact recovered source'
    core.load(SRC)
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.render.threads_mode='FIXED';sc.render.threads=2
    bpy.context.preferences.filepaths.save_version=0
    ASSET=bpy.data.collections['kestrel'];COLL=bpy.data.collections['kestrel_LOD0']
    for c in list(bpy.data.collections):
        if c.name not in ('kestrel','kestrel_LOD0','REF'):
            for o in list(c.objects):bpy.data.objects.remove(o,do_unlink=True)
            bpy.data.collections.remove(c)
    mats={k:bpy.data.materials['Kestrel_'+k] for k in ('Hull','Accent','Trim','Dark','Glass','EngineGlow')}
    for key,m in mats.items():
        m.node_tree.nodes.clear();nt=m.node_tree
        bs=nt.nodes.new('ShaderNodeBsdfPrincipled');out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(bs.outputs['BSDF'],out.inputs['Surface'])
        bs.inputs['Base Color'].default_value={'Hull':(.74,.68,.51,1),'Accent':(.48,.24,.07,1),'Trim':(.13,.085,.05,1),'Dark':(.075,.09,.075,1),'Glass':(.16,.10,.035,1),'EngineGlow':(.01,.018,.008,1)}[key]
        bs.inputs['Roughness'].default_value=.52 if key!='Glass' else .38
        bs.inputs['Metallic'].default_value=0
        if key=='EngineGlow':
            bs.inputs['Emission Color'].default_value=(.36,.52,.12,1);bs.inputs['Emission Strength'].default_value=.7
        m['round3_surface']='grown chitin or membrane, no exterior metal or glass'
    nav=bpy.data.materials['LIB_NavWhite'];nav.name='Kestrel_NavSpore';nav['engine_name']='NavWhite'
    bs=next(n for n in nav.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Emission Color'].default_value=(.57,.78,.19,1);bs.inputs['Emission Strength'].default_value=1.2
    oldroles={'Hull':0,'Accent':1,'Spore':1,'Dark':2,'Trim':3,'EngineGlow':4}
    for o in list(COLL.objects):
        if o.type!='MESH':continue
        roles=[oldroles.get(s.material.name.split('_')[-1],6 if 'Glass' in s.material.name else 5) for s in o.material_slots]
        a=o.data.attributes.get('paint_region') or o.data.attributes.new('paint_region','INT','FACE')
        for p in o.data.polygons:a.data[p.index].value=roles[p.material_index]
    body=bpy.data.objects['Body']
    # Keep the grown lattice. Only the port boarding aperture is cut; its ends receive a grown jamb.
    bm=bmesh.new();bm.from_mesh(body.data)
    doomed=[f for f in bm.faces if -.1>f.calc_center_median().x> -1.05 and 1.15<f.calc_center_median().y<2.78 and -.23<f.calc_center_median().z<.86 and f.calc_center_median().x<-.64]
    removed=len(doomed);bmesh.ops.delete(bm,geom=doomed,context='FACES');bm.to_mesh(body.data);bm.free()
    open_cabin(body)
    oldm=list(body.data.materials)
    indices=[0 if oldm[p.material_index].get('engine_name')=='Hull' else 2 if oldm[p.material_index].get('engine_name')=='EngineGlow' else 1 for p in body.data.polygons]
    body.data.materials.clear()
    for k in ('Hull','Accent','EngineGlow'):body.data.materials.append(mats[k])
    for p,i in zip(body.data.polygons,indices):p.material_index=i
    # Delete the blockout cockpit, retaining the exact screen/control/pivot marker transforms.
    bpy.data.objects.remove(bpy.data.objects['CockpitInteriorMesh'],do_unlink=True)
    interior=bpy.data.objects['CockpitInterior'];parts=[]
    parts.append(leaf('SuspendedCockpitFloor',[(1.12,.60,-.20,.07),(1.4,.73,-.20,.035),(2.2,.72,-.20,.025),(2.9,.57,-.17,.08),(3.35,.38,-.08,.12)],mats['Dark'],2,interior))
    parts.append(leaf('SeatCradle',[(1.62,.20,.82,.13),(1.73,.32,.63,.16),(1.86,.34,.27,.12),(2.0,.33,.23,.10),(2.25,.30,.25,.08),(2.48,.21,.20,.08)],mats['Dark'],3,interior))
    parts.append(cushion('SeatCushion',(0,2.18,.25),(.29,.25,.065),mats['Dark'],7,interior))
    back=cushion('SporeCrestBackrest',(0,1.85,.64),(.27,.075,.36),mats['Dark'],7,interior);parts.append(back)
    for z in (.42,.51,.60,.69,.78):
        parts.append(tube('SeatSewnRib',[(-.22,1.93,z), (0,1.94,z-.025),(.22,1.93,z)],[.009,.012,.009],mats['Dark'],3,interior))
    for s in (-1,1):
        parts.append(tube('SeatHarness',[(s*.18,1.86,.92),(s*.13,1.98,.66),(s*.19,2.12,.31),(s*.11,2.38,.30)],[.027,.024,.022,.025],mats['Dark'],7,interior))
        parts.append(tube('FootWellRim',[(s*.27,2.46,-.14),(s*.28,2.77,-.13),(s*.19,3.04,-.10)],[.025,.027,.02],mats['Dark'],3,interior))
        parts.append(cushion('FootPedal',(s*.19,2.98,-.05),(.095,.17,.035),mats['Dark'],2,interior))
        for y in (2.90,2.97,3.04):parts.append(tube('PedalGrip',[(s*.19-.07,y,-.01),(s*.19+.07,y,-.01)],[.008,.008],mats['Dark'],3,interior))
    # Organic consoles wrap the exact live-screen markers; no closed rectangular tub.
    for s in (-1,1):
        console=cushion('GrownConsole',(s*.53,2.73,.40),(.17,.44,.13),mats['Dark'],2,interior);parts.append(console)
        parts.append(tube('ConsoleEdge',[(s*.53,2.29,.48),(s*.66,2.59,.50),(s*.60,2.99,.55),(s*.36,3.13,.56)],[.027,.035,.025,.019],mats['Dark'],3,interior))
        for i in range(5):
            parts.append(cushion('TactileControl',(s*(.48+.028*(i%2)),2.43+i*.085,.54),(.025,.025,.015),mats['Dark'],9,interior))
    for name in ('ScreenLeft','ScreenCenter','ScreenRight'):
        marker=bpy.data.objects[name];mw=marker.matrix_world.copy()
        width=.27 if name=='ScreenCenter' else .30;height=.27 if name=='ScreenCenter' else .19
        local=[(-width/2,-height/2,0),(width/2,-height/2,0),(width/2,height/2,0),(-width/2,height/2,0),(-width/2,-height/2,0)]
        parts.append(tube('InstrumentGrownBezel',[tuple(mw@Vector(p)) for p in local],[.025]*5,mats['Dark'],3,interior))
        # Recessed physical backing, behind the engine's live screen plane.
        pts=[mw@Vector((-width/2,-height/2,-.015)),mw@Vector((width/2,-height/2,-.015)),mw@Vector((width/2,height/2,-.015)),mw@Vector((-width/2,height/2,-.015))]
        me=bpy.data.meshes.new('InstrumentRecess');me.from_pydata(pts,[],[(0,1,2,3)]);o=bpy.data.objects.new('InstrumentRecess',me);COLL.objects.link(o);parts.append(finish(o,'InstrumentRecess',mats['Dark'],9,interior))
    for s in (-1,1):
        parts.append(tube('SeatSuspension',[(s*.31,1.77,.67),(s*.46,1.39,.37),(s*.58,1.19,-.12)],[.03,.045,.06],mats['Dark'],3,interior))
    cockpit=join(parts,'CockpitInteriorMesh',interior)
    cockpit['seat_height_m']=.45;cockpit['seat_depth_m']=.50;cockpit['floor_z_m']=-.20
    empty('SeatReference',(0,2.18,1.0),interior)['above_floor_m']=1.2
    # Each independently animated control keeps one textured mesh.
    for control,child in [('CockpitStick','CockpitStick_grip'),('CockpitThrottle','CockpitThrottle_lever')]:
        o=bpy.data.objects[child];o.data.materials.clear();o.data.materials.append(mats['Dark']);region(o,2)
    # Closed canopy remains engine-compatible Glass but is satin, translucent-looking membrane.
    bpy.data.objects['CanopyGlass']['physical_material']='amber membrane; Glass is the engine slot only'
    canopy=bpy.data.objects['Canopy'];canopy['open_angle_degrees']=72.0
    # Consolidate gear within the preserved pivots. Landing/contact pads are shaped, not boxes.
    for name in ('GearFront','GearLeft','GearRight'):
        pivot=bpy.data.objects[name];objs=[o for o in pivot.children if o.type=='MESH']
        for o in objs:
            o.data.materials.clear();o.data.materials.append(mats['Trim'])
            for p in o.data.polygons:p.material_index=0
        join(objs,name+'_Assembly',pivot)
    stairparts=[]
    for i in range(9):
        x=-3.45+i*.30;z=-1.71+(i+1)*.18
        o=cushion('BoardingTread',(x,1.96,z-.035),(.175,.72,.035),mats['Trim'],8)
        o['rise_m']=.18;o['going_m']=.30;stairparts.append(o)
        for y in (1.31,2.61):
            stairparts.append(tube('TreadLipping',[(x-.13,y,z),(x+.13,y,z)],[.012,.012],mats['Trim'],3))
    for y in (1.24,2.68):
        stairparts.append(tube('BoardingStringer',[(-3.6,y,-1.70),(-2.45,y,-1.00),(-.85,y,-.13)],[.055,.065,.08],mats['Trim'],3))
        stairparts.append(tube('BoardingHandrail',[(-3.6,y,-.48),(-2.45,y,.05),(-.85,y,.92)],[.023,.03,.04],mats['Trim'],3))
        for x,z in [(-3.45,-1.53),(-2.25,-.81),(-1.05,-.09)]:
            stairparts.append(tube('HandrailStanchion',[(x,y,z),(x+.05,y,z+1.05)],[.02,.018],mats['Trim'],3))
    front=bpy.data.objects['GearFront_Assembly'];join([front,*stairparts],'GearFront_Assembly',bpy.data.objects['GearFront'])
    # New small-hardpoint grown collars align with the existing exact mount planes.
    additions=[]
    for name in ('HP_S_1','HP_S_2','HP_M_1'):
        p=bpy.data.objects[name].matrix_world.translation
        radius=.22 if '_S_' in name else .31
        pts=[tuple(p+Vector((radius*math.cos(t),radius*math.sin(t),-.015))) for t in [i*2*math.pi/24 for i in range(25)]]
        additions.append(tube('MountCollar_'+name,pts,[.045]*25,mats['Accent'],3))
        for a in (-2.3,-.8,.8,2.3):
            d=Vector((math.cos(a),math.sin(a),0))
            additions.append(tube('MountRoot_'+name,[tuple(p+d*.20),tuple(p+d*.31+Vector((0,0,.10))),tuple(p+d*.48+Vector((0,0,.20)))],[.055,.08,.02],mats['Accent'],3))
    additions.append(tube('PortEntryJamb',[(-.89,1.12,-.22),(-.97,1.10,.27),(-.85,1.10,.88),(-.72,1.13,1.05)],[.09,.075,.06,.04],mats['Accent'],1))
    additions.append(tube('PortEntrySill',[(-.91,1.12,-.20),(-.87,1.97,-.20),(-.80,2.80,-.15)],[.065,.06,.075],mats['Accent'],1))
    # An asymmetric new membrane repair follows the right wing's original panel, raised 15 mm.
    patch=leaf('StarboardMembranePatch',[(-2.05,.19,.575,.005),(-1.83,.31,.594,.015),(-1.46,.25,.59,.01),(-1.25,.10,.57,.005)],mats['Hull'],10)
    for v in patch.data.vertices:v.co.x+=3.8
    additions.append(patch)
    body=join([body,*additions],'Body')
    # One soft spore navigation circuit, with three spatially distinct lenses and one blink pivot.
    lenses=[bpy.data.objects[n] for n in ('Lens_NavPort','Lens_NavStarboard','Lens_StrobeTail')]
    for o in lenses:o.data.materials.clear();o.data.materials.append(nav)
    for o in lenses:
        world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
    pivot=bpy.data.objects['Blink_NavPort'];pivot.name='Blink_NavSpore'
    for name in ('Blink_NavStarboard','Blink_StrobeTail'):bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
    join(lenses,'SporeNavigationLenses',pivot)
    # The former single solid collider blocked the entire cockpit and boarding aperture.
    bpy.data.objects.remove(bpy.data.objects['COL_Body'],do_unlink=True)
    collider('COL_BodyAft',(-1.0,-7.68,-.68),(1.0,1.10,1.02))
    collider('COL_Nose',(-.9,3.38,-.60),(.9,6.89,.85))
    collider('COL_CockpitFloor',(-.85,1.10,-.68),(.85,3.38,-.23))
    collider('COL_CockpitStarboard',(.73,1.1,-.23),(1.0,3.38,.52))
    collider('COL_CockpitForward',(-.85,2.82,-.23),(.85,3.38,.48))
    empty('Interact',(-3.78,1.96,-.55))
    empty('BoardingEntry',(-.90,1.96,-.18))
    # UVs are authored once over LOD0. Every later state/livery/LOD inherits these exact islands.
    pbr=[o for o in COLL.objects if o.type=='MESH' and any(s.material in [mats[k] for k in ('Hull','Accent','Dark','Trim')] for s in o.material_slots)]
    select(pbr);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.003,area_weight=.25,correct_aspect=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    ASSET['round3']='geometry authored; atlas bake pending'
    ASSET['liveries']='ulgani,compact,working'
    sc['kestrel_stage']='authored'
    tris=sum(S.tri_count(o) for o in COLL.objects if o.type=='MESH')
    assert 60000<=tris<=150000,tris
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    report={'inputSha256':EXPECTED,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'lod0Triangles':tris,'portOpeningRemovedFaces':removed,'notes':['Original grown lattice retained outside the fitted port entry','No export-time modelling','Cockpit and articulated fittings editable; packed atlas bake is a separate saved-source step'],'sourceStage':'authored'}
    (OUT/'authoring.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


def refine_current():
    global COLL,ASSET
    expected='3448515d3d8c1ea1a6dc96d6977c578dea2a5ed0502589a2a2361427b36ba134'
    assert hashlib.sha256(SRC.read_bytes()).hexdigest()==expected
    core.load(SRC);COLL=bpy.data.collections['kestrel_LOD0'];ASSET=bpy.data.collections['kestrel']
    count=open_cabin(bpy.data.objects['Body'])
    bpy.data.objects.remove(bpy.data.objects['SporeNavigationLenses'],do_unlink=True)
    nav=bpy.data.materials['Kestrel_NavSpore']
    lenses=[cushion('NavigationBud',p,(.06,.06,.06),nav,5) for p in [(-7.06,-2.9,.12),(7.06,-2.9,.12),(0,-7.78,.38)]]
    join(lenses,'SporeNavigationLenses',bpy.data.objects['Blink_NavSpore'])
    objs=[o for o in COLL.objects if o.type=='MESH' and not o.name.startswith(('CanopyGlass','SporeNavigation'))]
    select(objs);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.003,area_weight=.25);bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(SRC),compress=True)
    (OUT/'cabin-refinement.json').write_text(json.dumps({'inputSha256':expected,'outputSha256':hashlib.sha256(SRC.read_bytes()).hexdigest(),'removedInteriorCoreFaces':count,'reason':'CPU closeup exposed the retained internal spine crossing the new cockpit floor; opened the real cabin volume, preserved external lattice'},indent=2)+'\n')


if __name__=='__main__':
    refine_current() if '--refine-cabin' in sys.argv else prepare()
