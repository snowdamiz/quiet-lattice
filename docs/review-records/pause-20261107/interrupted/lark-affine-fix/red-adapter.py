"""Pure-Python ports exercising the actual pinned adapter. NO Blender/native modules.

Adapted from the sealed a6a0237 independent harness (original SHA256
cc901211eec1cd6aecbb78913afef4405d63049762cb80b467256b2375d4b579).
Imports target this checkout; pins identify the corrected source. Outputs use a
fresh temporary directory. The original defect observation is retained unchanged
in the correction evidence bundle; here it is a refusal-contract control.
Ports model ownership/call boundaries, not Blender evaluation or decomposition.
"""
import contextlib, copy, hashlib, importlib.util, io, json, math, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(tempfile.mkdtemp(prefix="lark-adapter-ports-"))
SRC = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
for filename, expected in {
    'capture.py': '45919b8335333f93c1e0de28f77bc1e5c344a3275c8349c19ae89a1e30aa78f7',
    'capture_plan.py': '5a5655fc846171fda0e77109b55cebe8686b857e978423279f6749255e34c858',
}.items():
    actual = hashlib.sha256((SRC / filename).read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f'reproduction requires reviewed source: {filename}: {actual}')
sys.path.insert(0, str(SRC))
import capture_plan as plan
N = types.SimpleNamespace
OBS = {}

def adapter():
    spec = importlib.util.spec_from_file_location('capture_review_port', SRC / 'capture.py')
    m = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'bpy': types.ModuleType('bpy'), 'mathutils': N(Vector=tuple)}):
        spec.loader.exec_module(m)
    return m

class Matrix(list):
    def copy(self): return Matrix([row[:] for row in self])
    @property
    def translation(self): return tuple(row[3] for row in self[:3])

def matrix(x=0, y=0, z=0):
    return Matrix([[1,0,0,x],[0,1,0,y],[0,0,1,z],[0,0,0,1]])

class Items(list):
    def get(self, name): return next((x for x in self if x.name == name), None)
    def link(self, obj): self.append(obj)

class Inputs(dict):
    def __iter__(self): return iter(self.values())

class Node:
    def __init__(self, name, kind, inputs=None, image=None, active=False):
        self.name, self.type = name, kind
        self.inputs, self.image = Inputs(inputs or {}), image
        self.is_active_output = active

def socket(node): return N(links=[N(from_node=node)])

def img(name, data, **kw):
    return N(**dict(name=name, packed_file=N(data=data), source='FILE', is_dirty=False,
                   size=(512,512), colorspace_settings=N(name='sRGB'), alpha_mode='STRAIGHT') | kw)

class Material:
    def __init__(self, name, image):
        self.name, self.use_nodes = name, True
        color = Node('Paint', 'TEX_IMAGE', image=image)
        shader = Node('Shader', 'BSDF_PRINCIPLED', {'Base Color': socket(color)})
        output = Node('Output', 'OUTPUT_MATERIAL', {'Surface': socket(shader)}, active=True)
        self.node_tree = N(nodes=[color, shader, output], animation_data_clear=lambda: None)
    def copy(self):
        images = {id(n.image): n.image for n in self.node_tree.nodes if n.image}
        value = copy.deepcopy(self, images)
        value.name += '.capture'
        return value
    def animation_data_clear(self): pass

class Mesh:
    def __init__(self, vertices, indices=(), materials=(), edges=()):
        self.vertices = [N(co=tuple(p)) for p in vertices]
        self.polygons = [N(material_index=i) for i in indices]
        self.edges = [N(vertices=tuple(e)) for e in edges]
        polygons = self.polygons
        class Slots(list):
            def clear(self):
                super().clear()
                for p in polygons: p.material_index = 0
        self.materials = Slots(materials)
    def copy(self):
        return Mesh([v.co for v in self.vertices], [p.material_index for p in self.polygons],
                    list(self.materials), [e.vertices for e in self.edges])

class Obj:
    def __init__(self, name, data=None, world=None):
        self.name, self.data = name, data
        self.type = 'MESH' if data else 'EMPTY'
        self.matrix_world = world or matrix()
        self.parent, self.children, self.users_collection = None, [], []
        self._evaluated = self
        self.hide_render = False
    @property
    def material_slots(self): return [N(material=m) for m in self.data.materials] if self.data else []
    def evaluated_get(self, graph): return self._evaluated

class Collection:
    def __init__(self, name, objects=(), children=()):
        self.name, self.objects, self.children = name, Items(objects), Items(children)
        for o in objects: o.users_collection.append(self)
    @property
    def all_objects(self):
        return Items(dict.fromkeys(list(self.objects) + [o for c in self.children for o in c.all_objects]))

def fixture():
    m = adapter()
    default = img('lark_baseColor', b'default')
    images = Items([default, img('lark_livery_compact', b'compact'), img('lark_livery_working', b'working')])
    mats = [Material(n, default) for n in plan.MATERIALS]
    body = Obj('Body', Mesh([(0,0,0),(1,0,0),(0,1,0)], [0,1,2], mats))
    collider = Obj('COL_Body', Mesh([(0,0,0),(2,0,0),(0,2,0)], [0]))
    hp, boarding = Obj('HP_S_1'), Obj('BoardingFoot', world=matrix(-3,1,-.2))
    biped = Obj('REF_Biped', Mesh([(0,0,0),(.1,.1,1.85)]))
    vertices, edges = [], []
    for i in range(3):
        for a,b in (((0,i,0),(2,i,0)),((i,0,0),(i,2,0))):
            edges.append((len(vertices),len(vertices)+1)); vertices.extend([a,b])
    grid = Obj('REF_Grid', Mesh(vertices, edges=edges))
    lod = Collection('lark_LOD0', [body])
    asset = Collection('lark', [collider,hp,boarding], [lod])
    refs = Collection('REF', [biped,grid])
    scene = N(collection=Collection('Scene', children=[asset,refs]), frame_current=17, frame_subframe=.25,
              unit_settings=N(system='METRIC', scale_length=1.0))
    dest = N(collection=Collection('Capture'))
    graph = object()
    calls = []
    def new_mesh(evaluated, **kwargs):
        calls.append((evaluated, kwargs))
        return evaluated.data.copy()
    m.bpy.context = N(evaluated_depsgraph_get=lambda: graph)
    m.bpy.data = N(meshes=N(new_from_object=new_mesh), objects=N(new=Obj), images=images)
    return N(m=m, scene=scene, dest=dest, body=body, collider=collider, hp=hp, boarding=boarding,
             biped=biped, grid=grid, lod=lod, asset=asset, refs=refs, images=images, mats=mats,
             graph=graph, calls=calls)

def extracted(f): return f.m.extract(f.scene, f.dest)

def fake_scene():
    return N(cycles=N(device='GPU', denoising_use_gpu=True, preview_denoising_use_gpu=True,
                      use_denoising=True, denoiser='OPTIX', samples=8),
             render=N(engine='BLENDER_EEVEE_NEXT', resolution_x=640, resolution_y=480,
                      resolution_percentage=200, threads=64, threads_mode='AUTO',
                      image_settings=N(file_format='JPEG')))

class AdapterTests(unittest.TestCase):
    def test_evaluated_geometry_world_parent_and_material_indices(self):
        f=fixture()
        original_vertices=[v.co for v in f.body.data.vertices]
        ev=Obj('Body-eval', Mesh([(0,0,0),(2,0,0),(0,2,0)], [2,0,1], f.mats), matrix(4,5,6))
        f.body._evaluated=ev
        f.body.parent=Obj('Parent', world=matrix(9,8,7))
        e,h=extracted(f)
        self.assertEqual(f.m.world_vertices(h['lod0'][0]), [(4,5,6),(6,5,6),(4,7,6)])
        self.assertEqual([p.material_index for p in h['lod0'][0].data.polygons], [2,0,1])
        self.assertEqual([v.co for v in f.body.data.vertices], original_vertices)
        fact=next(x for x in e['observations']['objects'] if x['name']=='Body')
        self.assertEqual(fact['parent_chain'][0]['matrix_world'], matrix(9,8,7))
        self.assertEqual((e['observations']['frame'],e['observations']['subframe']), (17,.25))
        self.assertTrue(all(k['preserve_all_data_layers'] and k['depsgraph'] is f.graph for _,k in f.calls))

    def test_shared_mesh_users_are_copied_without_source_or_cross_copy_mutation(self):
        f=fixture(); second=Obj('Wing', f.body.data, matrix(10,0,0)); f.lod.objects.append(second)
        e,h=extracted(f)
        first,second=h['lod0']
        self.assertIsNot(first.data,second.data)
        self.assertIsNot(first.data,f.body.data)
        self.assertIs(first.data.materials[0],second.data.materials[0])
        self.assertIsNot(first.data.materials[0],f.mats[0])
        first.data.vertices[0].co=(99,99,99)
        self.assertEqual(second.data.vertices[0].co,(0,0,0))
        self.assertEqual(f.body.data.vertices[0].co,(0,0,0))

    def test_actual_collection_walk_refuses_multilod_object_and_shared_collection(self):
        for use_shared_collection in (False,True):
            f=fixture()
            if use_shared_collection:
                group=Collection('Parts',[f.body]); f.lod.objects.clear(); f.lod.children.append(group)
                wrong=Collection('lark_LOD1',children=[group])
            else: wrong=Collection('lark_LOD1',[f.body])
            f.asset.children.append(wrong)
            with self.assertRaisesRegex(ValueError,'conflicting'): extracted(f)

    def test_variant_and_wip_meshes_do_not_leak_into_base(self):
        f=fixture()
        for name in ('lark_damaged_LOD0','lark_husked_LOD0','lark_LOD2','_draft'):
            f.asset.children.append(Collection(name,[Obj(name+'_body',f.body.data)]))
        e,h=extracted(f)
        self.assertEqual(e['lod0_meshes'],['Body'])
        self.assertEqual(len(h['lod0']),1)

    def test_missing_exact_reference_has_no_duplicate_fallback(self):
        f=fixture(); f.biped.name='REF_Biped.001'
        e,h=extracted(f)
        self.assertIsNone(e['biped'])
        self.assertNotIn('standing-reference-scale',[s['id'] for s in plan.plan_shots(e,plan.assemble_report(e))['shots']])

    def test_required_material_must_be_on_evaluated_faces(self):
        f=fixture(); f.body.data.polygons=[N(material_index=0),N(material_index=1)]
        e,h=extracted(f)
        r=plan.assemble_report(e)
        self.assertFalse(r['liveries']['lineup'])
        self.assertTrue(any('Lark_Trim' in x for x in r['liveries']['missing']))

    def test_active_output_ignores_disconnected_dirty_image_and_refuses_groups(self):
        f=fixture(); dirty=Node('Unused','TEX_IMAGE',image=img('dead',b'dead',is_dirty=True))
        f.mats[0].node_tree.nodes.append(dirty)
        e,h=extracted(f)
        self.assertTrue(plan.assemble_report(e)['liveries']['lineup'])
        group=Node('Group','GROUP')
        f.mats[0].node_tree.nodes[-2].inputs['Volume']=socket(group)
        with self.assertRaisesRegex(ValueError,'nested material'): extracted(f)

    def test_active_dependencies_refused_for_dirty_unpacked_movie_and_zero_size(self):
        for change in ({'is_dirty':True},{'packed_file':None},{'source':'MOVIE'},{'size':(0,0)}):
            f=fixture(); bad=img('normal',b'normal',**change)
            node=Node('Normal','TEX_IMAGE',image=bad)
            f.mats[0].node_tree.nodes[1].inputs['Normal']=socket(node)
            with self.assertRaisesRegex(ValueError,'clean packed bytes'): extracted(f)

    def test_ambiguous_outputs_fail_closed(self):
        f=fixture(); f.mats[0].node_tree.nodes.append(Node('Other','OUTPUT_MATERIAL',active=True))
        with self.assertRaisesRegex(ValueError,'ambiguous active'): extracted(f)

    def test_livery_identity_uses_bytes_and_interpretation(self):
        f=fixture(); f.images[2].packed_file.data=f.images[1].packed_file.data
        e,h=extracted(f); self.assertFalse(plan.assemble_report(e)['liveries']['lineup'])
        f=fixture(); alternate_default=img('another_baseColor',b'default',colorspace_settings=N(name='Non-Color'))
        f.mats[2].node_tree.nodes[0].image=alternate_default
        e,h=extracted(f); self.assertFalse(plan.assemble_report(e)['liveries']['lineup'])

    def test_units_refusal_and_nonfinite_evaluated_reference(self):
        f=fixture(); f.scene.unit_settings.scale_length=.01
        with self.assertRaisesRegex(ValueError,'metre conversion'): extracted(f)
        f=fixture(); f.biped.data.vertices[0].co=(float('nan'),0,0)
        with self.assertRaisesRegex(ValueError,'nonfinite'): extracted(f)

    def test_flags_and_attestations_cannot_enable_unsupported_proofs(self):
        f=fixture(); e,h=extracted(f)
        e.update(seated_pose='verified',canopy_closed=True,closed_headroom=1.0,mounted_module=True)
        r=plan.assemble_report(e)
        self.assertEqual(r['seated_pose'],'not_verified')
        self.assertEqual(r['canopy_closed'],'not_verified')
        self.assertEqual(r['closed_headroom'],'not_measured')
        self.assertEqual(r['hardpoints'][0]['mounted_module'],'not_verified')
        for flag in ('--seated','--closed-canopy','--verify-clearance','--actor-verified'):
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                plan.parse_args(['--blend','source','--out','dest',flag])

    def test_cpu_gate_precedes_each_render_and_disables_gpu_paths(self):
        m=adapter(); scene=fake_scene(); observations=[]
        m.bpy.ops=N(render=N(render=lambda **kw: observations.append(m.observe(scene,0))))
        m.render_pixels(scene,ROOT/'never-rendered.png',640,480,0,8)
        self.assertEqual(observations[0]['device'],'CPU')
        self.assertFalse(observations[0]['denoising_use_gpu'])
        self.assertFalse(scene.cycles.preview_denoising_use_gpu)
        self.assertFalse(scene.cycles.use_denoising)
        self.assertEqual(scene.render.threads_mode,'FIXED')
        for width,height,count,samples in ((961,480,0,8),(640,541,0,8),(640,480,3,8),(640,480,0,17)):
            with self.assertRaises(SystemExit): m.render_pixels(scene,ROOT/'never-rendered.png',width,height,count,samples)
        self.assertEqual(len(observations),1)
        del scene.cycles.denoising_use_gpu
        with self.assertRaises(SystemExit): m.require_cpu(scene,0)

    def test_lineup_three_cells_preserve_settings_and_restore_on_midrun_failure(self):
        for fail in (False,True):
            f=fixture(); e,h=extracted(f); r=plan.assemble_report(e)
            shot=next(s for s in plan.plan_shots(e,r)['shots'] if s['id']=='livery-lineup')
            out=ROOT/('lineup-fail' if fail else 'lineup-ok'); out.mkdir(exist_ok=False)
            orig=[n.image for n in h['swap_nodes']]; calls=[]
            def render(scene,path,width,height,count,samples):
                calls.append((str(path),width,height,count,samples,[n.image.name for n in h['swap_nodes']]))
                if fail and len(calls)==2: raise RuntimeError('injected second-cell failure')
                path.write_bytes(b'FAKE PORT OUTPUT - NOT PNG')
                return {'port_only':True}
            with patch.object(f.m,'render_pixels',render), patch.object(f.m,'stitch') as stitch:
                if fail:
                    with self.assertRaises(RuntimeError): f.m.render_lineup(None,shot,r,h,out,2,8)
                    stitch.assert_not_called()
                else:
                    f.m.render_lineup(None,shot,r,h,out,2,8)
                    self.assertEqual(len(calls),3); stitch.assert_called_once()
            self.assertEqual([n.image for n in h['swap_nodes']],orig)
            self.assertTrue(all(c[1:5]==(320,320,2,8) for c in calls))
            self.assertTrue(all(n.image is f.images[0] for mat in f.mats for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'))
            OBS['lineup-'+str(fail)]=calls

    def test_receipts_success_exception_interrupt_and_source_change_or_disappearance(self):
        for mode in ('ok','exception','interrupt','gpu-refusal','mutated','deleted'):
            m=adapter(); root=ROOT/('receipt-'+mode); root.mkdir(exist_ok=False)
            source=root/'synthetic.blend'; source.write_bytes(b'NOT BLENDER; isolated test bytes')
            before=m.file_sha256(source)
            def run(args,blend,out):
                (out/'partial.fake').write_bytes(b'not evidence')
                if mode=='exception': raise RuntimeError('synthetic failure')
                if mode=='interrupt': raise KeyboardInterrupt('synthetic interruption')
                if mode=='gpu-refusal': raise SystemExit('CPU gate refused')
                if mode=='mutated': blend.write_bytes(b'changed test bytes')
                if mode=='deleted': blend.unlink()
                return {'status':'complete_with_gaps','images':[]}
            code=None
            with patch.object(plan,'SOURCE_SHA256',before), patch.object(m,'capture',run), contextlib.redirect_stdout(io.StringIO()):
                try: m.main(['--blend',str(source),'--out',str(root/'out')])
                except (Exception,SystemExit,KeyboardInterrupt) as exc: code=getattr(exc,'code',type(exc).__name__)
            receipt=json.loads((root/'out/receipt.json').read_text())
            expected='complete_with_gaps' if mode=='ok' else 'invalid_source_changed' if mode in ('mutated','deleted') else 'failed'
            self.assertEqual(receipt['status'],expected)
            self.assertEqual(receipt['images'],[])
            self.assertEqual(receipt['blend']['bytes_unchanged'],mode not in ('mutated','deleted'))
            if mode in ('mutated','deleted'): self.assertEqual(code,3)
            OBS['receipt-'+mode]={'status':receipt['status'],'caught':code}

    def test_wrong_source_and_existing_outputs_never_reach_capture(self):
        m=adapter(); root=ROOT/'preservation'; root.mkdir(exist_ok=False)
        source=root/'synthetic.blend'; source.write_bytes(b'fixture')
        old=root/'old'; old.mkdir(); (old/'receipt.json').write_bytes(b'keep old')
        (old/'.cells').mkdir(); (old/'.cells/custom').write_bytes(b'keep custom')
        file=root/'file'; file.write_bytes(b'keep file')
        link=root/'link'; link.symlink_to(old,target_is_directory=True)
        broken=root/'broken'; broken.symlink_to(root/'absent')
        with patch.object(m,'capture') as render:
            with self.assertRaises(SystemExit): m.main(['--blend',str(source),'--out',str(root/'wrong-pin')])
            self.assertFalse((root/'wrong-pin').exists())
            with patch.object(plan,'SOURCE_SHA256',m.file_sha256(source)):
                for out in (old,file,link,broken):
                    with self.assertRaises(FileExistsError): m.main(['--blend',str(source),'--out',str(out)])
            render.assert_not_called()
        self.assertEqual((old/'receipt.json').read_bytes(),b'keep old')
        self.assertEqual((old/'.cells/custom').read_bytes(),b'keep custom')
        self.assertEqual(file.read_bytes(),b'keep file')
        self.assertTrue(link.is_symlink() and broken.is_symlink())
        with self.assertRaises(FileExistsError): m.write_json(old/'receipt.json',{'overwrite':True})

    def test_shear_and_rotated_child_of_nonuniform_parent_refused(self):
        c = math.sqrt(.5)
        parent = Matrix([[2,0,0,4],[0,1,0,5],[0,0,3,6],[0,0,0,1]])
        rotation = Matrix([[c,-c,0,0],[c,c,0,0],[0,0,1,0],[0,0,0,1]])
        child_world = Matrix([[sum(parent[i][k]*rotation[k][j] for k in range(4))
                               for j in range(4)] for i in range(4)])
        shear = Matrix([[1,1,0,4],[0,1,0,5],[0,0,1,6],[0,0,0,1]])
        for world in (shear, child_world):
            for selected in ('body', 'collider', 'biped', 'grid'):
                with self.subTest(world=world, selected=selected):
                    f = fixture(); obj = getattr(f, selected)
                    obj.matrix_world = world
                    obj.parent = Obj('NonuniformParent', world=parent)
                    with self.assertRaisesRegex(ValueError, 'shear'):
                        extracted(f)
        OBS['shear'] = {'contract': 'refuse before preparation/render',
                        'native_executed': False, 'pinned_asset_has_shear': 'unknown'}

    def test_observe_boundary_contracts_without_claiming_asset_failure(self):
        f=fixture(); f.refs.objects.remove(f.biped); f.refs.children.append(Collection('_draft',[f.biped]))
        e,h=extracted(f)
        OBS['reference_in_REF_WIP_selected']=e['biped'] is not None
        root=ROOT/'nested-output'; root.mkdir(exist_ok=False); source=root/'synthetic.blend'; source.write_bytes(b'fixture')
        nested=plan.claim_output(root/'new-output',source)
        OBS['new_output_below_source_parent_allowed']=nested.is_dir()
        f=fixture(); f.grid.data=Mesh([(0,0,0),(1,0,0)],edges=[(0,1)])
        e,h=extracted(f); r=plan.assemble_report(e)
        OBS['single_edge_grid']={'lattice_qualified':r['grid']['matches_1m_lattice'],
            'standing_shot_planned':any(x['id']=='standing-reference-scale' for x in plan.plan_shots(e,r)['shots'])}

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT/'adversarial-observations.json').write_text(json.dumps(OBS,indent=2,allow_nan=False)+'\n')
    print('PORT_OUTPUT', ROOT)
    raise SystemExit(0 if result.wasSuccessful() else 1)
