"""Continue the preserved Ulgani pre-bake checkpoint without rebuilding geometry.

Blender -b <ulgani_before_bake.blend> -t 2 --python-exit-code 1 -P this.py --
    <authoring-dir> <output.blend> <textures-dir> <release-file> <report.json>
    [--inspect-only]

The original build's bake/assembly suffix is reused. Only transient facial
landmarks and fabric coverage are reconstructed; saved geometry, UVs and weights
must remain byte-identical until the explicit GPU release arrives.
"""
import argparse
import ast
import datetime
import hashlib
import json
import math
from pathlib import Path
import runpy
import sys
import time

import bpy
import numpy as np


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def mesh_hashes():
    result = {}
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        digest = hashlib.sha256()
        for collection, field, width, dtype in (
            (mesh.vertices, 'co', 3, np.float32),
            (mesh.edges, 'vertices', 2, np.int32),
            (mesh.loops, 'vertex_index', 1, np.int32),
            (mesh.polygons, 'loop_total', 1, np.int32),
        ):
            values = np.empty(len(collection) * width, dtype=dtype)
            collection.foreach_get(field, values)
            digest.update(values.tobytes())
        for layer in mesh.uv_layers:
            values = np.empty(len(layer.data) * 2, np.float32)
            layer.data.foreach_get('uv', values)
            digest.update(layer.name.encode())
            digest.update(values.tobytes())
        digest.update(json.dumps([group.name for group in obj.vertex_groups]).encode())
        for vertex in mesh.vertices:
            digest.update(np.array([(group.group, group.weight) for group in vertex.groups], np.float64).tobytes())
        result[obj.name] = {'vertices': len(mesh.vertices), 'sha256': digest.hexdigest()}
    return result


parser = argparse.ArgumentParser()
parser.add_argument('authoring', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('textures', type=Path)
parser.add_argument('release', type=Path)
parser.add_argument('report', type=Path)
parser.add_argument('--inspect-only', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
checkpoint = Path(bpy.data.filepath).resolve()
authoring, output, textures, release, report = (getattr(args, name).resolve()
                                              for name in ('authoring', 'output', 'textures', 'release', 'report'))
assert checkpoint.name == 'ulgani_before_bake.blend'
assert checkpoint != output and not output.exists(), 'Preserve existing authored outputs'
assert not release.exists(), 'Start behind a closed GPU gate; refuse a stale release marker'
assert not bpy.data.materials and not bpy.data.shape_keys, 'Expected the unbaked, unassembled checkpoint'
before = mesh_hashes()
build = authoring / 'build.py'
program = ast.parse(build.read_text(), filename=str(build))
main = next(node for node in program.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
boundaries = [index for index, node in enumerate(main.body)
              if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
              and ast.unparse(node.value.func) == 'bake.cycles']
assert len(boundaries) == 1, 'Authoring bake boundary changed; inspect before recovery'
suffix = ast.Module(body=main.body[boundaries[0]:], type_ignores=[])
sys.argv = [str(build), '--', 'ulgani', str(output), '--res', '4096',
            '--heads', '1,2,3,4,5,6', '--suits', '1,2,3,4', '--tex', str(textures)]
session = runpy.run_path(str(build), run_name='checkpoint_recovery')
head, heads, mesh, skel = (session[key] for key in ('head', 'heads', 'mesh', 'skel'))
bs = skel.bones('ulgani')
s = skel.PEOPLE['ulgani']['scale']
ctx = session['anatomy'].Ctx(bs, s)
S, P = session['peoples'].body_sdf(ctx, 'ulgani')
body, body_hi, rig = (bpy.data.objects[name] for name in ('UL_Body', 'UL_Body_hi', 'RIG_ulgani'))
for name, bone in bs.items():
    assert np.allclose(rig.data.bones[name].head_local, bone['head'], atol=1e-6)
    assert np.allclose(rig.data.bones[name].tail_local, bone['tail'], atol=1e-6)

heads_ = {}
landmarks = {}
for k in range(1, 7):
    H = heads.head_def('ulgani', k)
    HS = head.head_sdf(ctx, P, H, S)
    eyes = []
    for spec in H['eyes']:
        for side in (1, -1):
            bone = spec['bone'] if side > 0 else spec['bone'][:-2] + '_R'
            E, n, u, v = head._eye_frame(ctx, bone, spec['yaw'], spec.get('pitch', 0.0), side)
            E = E + np.array([side * spec.get('dx', 0.0), 0.0, spec.get('dz', 0.0)]) * s - n * spec.get('depth', 0.0) * s
            tilt = math.radians(spec.get('tilt', 0.0))
            u, v = u * math.cos(tilt) + v * math.sin(tilt), -u * math.sin(tilt) + v * math.cos(tilt)
            eyes.append(dict(E=E, n=n, u=u, v=v, r=spec['r'] * s, open_up=spec['open'][1],
                             open_lo=spec['open'][2], upper=spec.get('upper', False), spec=spec))
    eyeobs = [(bpy.data.objects[f'UL_Eye{k}_{i}'], eye) for i, eye in enumerate(eyes)]
    for obj, eye in eyeobs:
        assert np.allclose(obj.data.vertices[0].co, eye['E'] + eye['n'] * eye['r'] * 1.06, atol=1e-6), obj.name
    zc = bs['eye_L']['head'][2] + (H['mouth']['z'] - 0.085) * s
    M = head.place(HS, head._axis_point(ctx, zc), np.array([[0, -1.0, 0]]), 0.3)[0]
    mo = dict(M=M, zc=zc, w=H['mouth']['w'] * s)
    accs = sorted((obj for obj in bpy.data.objects if obj.name.startswith(f'UL_Acc{k}_')), key=lambda obj: obj.name)
    assert accs, f'Missing saved head accessories: {k}'
    heads_[k] = (bpy.data.objects[f'UL_Head{k}'], eyeobs, eyes, mo, H, accs)
    landmarks[str(k)] = {'mouth': M.tolist(), 'mouth_z': zc, 'eyes': [eye['E'].tolist() for eye in eyes]}

suits_, coverage = {}, {}
for k in range(1, 5):
    suit = bpy.data.objects[f'UL_Suit{k}']
    indices = np.empty(len(suit.data.vertices), np.int32)
    suit.data.attributes['bidx'].data.foreach_get('value', indices)
    # Only the original fabric carries body part masks. Grown webs may also
    # have kind=0, but their missing body masks distinguish them unambiguously.
    masks = sum(mesh.attr(suit.data, 'p_' + part) for part in
                ('torso', 'arm', 'hand', 'leg', 'foot', 'finger', 'thumb', 'toe'))
    fabric = masks > 0.5
    assert fabric.any() and np.allclose(masks[fabric], 1.0, atol=1e-5)
    assert np.all(indices[~fabric] == 0), 'Unexpected non-fabric body indices'
    assert np.allclose(mesh.attr(suit.data, 'kind')[fabric], 0.0)
    assert indices[fabric].min() >= 0 and indices[fabric].max() < len(body.data.vertices)
    covered = np.zeros(len(body.data.vertices), bool)
    covered[indices[fabric]] = True
    suits_[k] = (suit, covered)
    coverage[str(k)] = {'fabric_vertices': int(fabric.sum()), 'covered_body_vertices': int(covered.sum()),
                        'coverage_sha256': hashlib.sha256(covered.tobytes()).hexdigest()}

body_acc = sorted((obj for obj in bpy.data.objects if obj.name.startswith('UL_BodyAcc')), key=lambda obj: obj.name)
expected = {body.name, body_hi.name, rig.name}
for ob, eyeobs, _, _, _, accs in heads_.values():
    expected.update([ob.name] + [eye.name for eye, _ in eyeobs] + [obj.name for obj in accs])
expected.update(obj.name for obj in body_acc)
expected.update(suit.name for suit, _ in suits_.values())
assert expected == set(bpy.data.objects.keys()), 'Unaccounted checkpoint objects'
assert before == mesh_hashes(), 'CPU recovery altered prepared geometry, UVs or weights'
evidence = {'prepared_utc': utc(), 'checkpoint': str(checkpoint), 'checkpoint_sha256': sha(checkpoint),
            'recovery_script_sha256': sha(Path(__file__)),
            'authoring_scripts': {str(path.relative_to(authoring)): sha(path)
                                  for path in sorted(authoring.glob('*.py')) + sorted((authoring / 'lib').glob('*.py'))},
            'mesh_hashes_unchanged': before, 'landmarks': landmarks, 'suit_coverage': coverage,
            'resume_boundary': 'Original build.main body from bake.cycles(sc, 16) onward',
            'authored_texture_size': [4096, 4096], 'ao_bake_size': [2048, 2048], 'ao_storage_size': [4096, 4096]}
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps(evidence, indent=2) + '\n')
print('CHECKPOINT_RECOVERY_VERIFIED', report, flush=True)
if args.inspect_only:
    print('INSPECTION_ONLY_NO_GPU', flush=True)
else:
    print('WAITING_FOR_GPU_RELEASE', release, flush=True)
    while not release.exists():
        time.sleep(2)
    assert before == mesh_hashes() and sha(checkpoint) == evidence['checkpoint_sha256']
    assert all(sha(authoring / name) == digest for name, digest in evidence['authoring_scripts'].items()), 'Authoring library changed while waiting'
    evidence['gpu_begin_utc'] = utc()
    report.write_text(json.dumps(evidence, indent=2) + '\n')
    print('ULGANI_GPU_BEGIN', evidence['gpu_begin_utc'], flush=True)
    cycles = session['bake'].cycles

    def record_device(*args, **kwargs):
        cycles(*args, **kwargs)
        prefs = bpy.context.preferences.addons['cycles'].preferences
        evidence['configured_device'] = {'scene': args[0].cycles.device, 'backend': prefs.compute_device_type,
                                         'devices': [(device.name, device.type, device.use) for device in prefs.devices]}
        assert args[0].cycles.device == 'GPU' and prefs.compute_device_type == 'METAL'
        report.write_text(json.dumps(evidence, indent=2) + '\n')
        print('BAKE_DEVICE', json.dumps(evidence['configured_device']), flush=True)

    session['bake'].cycles = record_device
    bake_suit = session['bake_suit']

    def record_suit(*args, **kwargs):
        result = bake_suit(*args, **kwargs)
        if args[0] == 'SuitB':
            evidence['gpu_bake_end_utc'] = utc()
            report.write_text(json.dumps(evidence, indent=2) + '\n')
            print('ULGANI_BAKE_END', evidence['gpu_bake_end_utc'], flush=True)
        return result

    session['bake_suit'] = record_suit
    session.update(sc=bpy.context.scene, ctx=ctx, s=s, body=body, body_hi=body_hi, rig=rig,
                   heads_=heads_, headobs=[entry[0] for entry in heads_.values()], suits_=suits_,
                   body_acc=body_acc, allacc=[obj for entry in heads_.values() for obj in entry[5]] + body_acc,
                   sets={'SuitA': [1, 2], 'SuitB': [3, 4]})
    exec(compile(suffix, str(build), 'exec'), session)
    for path in sorted(authoring.glob('*.py')) + sorted((authoring / 'lib').glob('*.py')):
        block = bpy.data.texts.new('authoring/' + str(path.relative_to(authoring)))
        block.write(path.read_text())
    block = bpy.data.texts.new('authoring/checkpoint_recovery.py')
    block.write(Path(__file__).read_text())
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    evidence.update(completed_utc=utc(), output_sha256=sha(output))
    report.write_text(json.dumps(evidence, indent=2) + '\n')
    print('AUTHORING_SAVED', output, evidence['completed_utc'], flush=True)
