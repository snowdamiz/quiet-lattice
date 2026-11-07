"""Restore existing Head2 spore nodules only; no resculpt,generation,bake or render.

LOD1/2 retain every source nodule vertex. LOD3 uses a convex hull of existing
world-extreme/axial-extreme vertices (at most8 per nodule), keeping source bounds,
UV coordinates and weights within the strict whole-variant triangle budget.
"""
from pathlib import Path
import ast, datetime, hashlib, json, os, sys
import bmesh
import bpy
import numpy as np

source, output, report_path = map(lambda p: Path(p).resolve(), sys.argv[sys.argv.index('--') + 1:])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source) == 'b332440a309c2c555ca5c8726ed05ab572e7e788e0fffa0938cd9ee018a4c919'
assert source != output and not output.exists() and not report_path.exists()
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'
scene.render.threads = 2
utility = Path(__file__).with_name('cleanup_ulgani5_source.py')
tree = ast.parse(utility.read_text())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('array_digest', 'snapshot')]
assert len(functions) == 2
exec(compile(ast.Module(body=functions, type_ignores=[]), str(utility), 'exec'), globals())
original = snapshot()
high = bpy.data.objects['UL_Head2_head2_L0']
targets = [bpy.data.objects[f'UL_Head2_head2_L{i}'] for i in (1, 2, 3)]
target_names = {o.name for o in targets}

def coordinates(me):
    a = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)

def mask(me):
    a = np.empty(len(me.vertices), np.float32)
    me.attributes['gpart'].data.foreach_get('value', a)
    return (a > 2.5) & (a < 3.5)

def groups(me):
    selected = mask(me)
    parent = np.arange(len(me.vertices))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in me.edges:
        a, b = e.vertices
        if selected[a] and selected[b]:
            parent[find(a)] = find(b)
    result = {}
    for i in np.flatnonzero(selected):
        result.setdefault(int(find(i)), []).append(int(i))
    return list(result.values())

def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)

def non_nodule_surface(obj):
    me = obj.data
    selected = mask(me)
    uv = me.uv_layers.active
    P = coordinates(me)
    records = []
    for polygon in me.polygons:
        chosen = selected[list(polygon.vertices)]
        assert chosen.all() or not chosen.any(), 'Nodule unexpectedly shares a face with other geometry'
        if chosen.any():
            continue
        corners = []
        for i in polygon.loop_indices:
            vertex = me.loops[i].vertex_index
            weights = tuple((obj.vertex_groups[g.group].name, g.weight) for g in me.vertices[vertex].groups)
            corners.append((tuple(P[vertex].tolist()), tuple(uv.data[i].uv), weights))
        cycles = [tuple(corners[i:] + corners[:i]) for i in range(len(corners))]
        records.append((me.materials[polygon.material_index].name, min(cycles)))
    return hashlib.sha256(repr(sorted(records)).encode()).hexdigest()

source_groups = groups(high.data)
assert len(source_groups) == 127 and all(len(ids) == 20 for ids in source_groups)
source_P = coordinates(high.data)
source_bounds = [(source_P[ids].min(0), source_P[ids].max(0)) for ids in source_groups]
report = {'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': os.getpid(), 'pgid': os.getpgrp(), 'threads': 2, 'before_sha256': sha(source), 'scope': 'Head2 gpart3 nodule LOD restoration only;no body/jaw/morph patch replay,no sculpt,bake,export or render.', 'source_nodules': 127, 'source_vertices_per_nodule': 20, 'steps': [], 'recognition_at100m_unverified': True}

def subset(obj, nodes):
    copy = obj.copy()
    copy.data = obj.data.copy()
    scene.collection.objects.link(copy)
    copy.parent = None
    copy.matrix_world = obj.matrix_world.copy()
    copy.hide_viewport = False
    copy.hide_set(False)
    if copy.data.shape_keys:
        copy.shape_key_clear()
    selected = mask(copy.data)
    bm = bmesh.new()
    bm.from_mesh(copy.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if bool(selected[v.index]) != nodes], context='VERTS')
    bm.to_mesh(copy.data)
    bm.free()
    return copy

for level, target in zip((1, 2, 3), targets):
    assert np.allclose(np.array(target.matrix_world), np.array(high.matrix_world))
    before_surface = non_nodule_surface(target)
    before_count = triangles(target)
    base = subset(target, False)
    nodes = subset(high, True)
    node_groups = groups(nodes.data)
    assert len(node_groups) == 127
    ids = nodes.data.attributes.new('review5_nodule_id', 'INT', 'POINT')
    labels = np.zeros(len(nodes.data.vertices), np.int32)
    for number, indices in enumerate(node_groups):
        labels[indices] = number
    ids.data.foreach_set('value', labels)
    if level == 3:
        bm = bmesh.new()
        bm.from_mesh(nodes.data)
        bm.verts.ensure_lookup_table()
        uv_layer = bm.loops.layers.uv.active
        uv_by_vertex = {}
        for vertex in bm.verts:
            choices = {tuple(loop[uv_layer].uv) for loop in vertex.link_loops}
            assert len(choices) == 1, 'Compact nodule UV must be one projected coordinate per source vertex'
            uv_by_vertex[vertex] = next(iter(choices))
        for indices in node_groups:
            vertices = [bm.verts[i] for i in indices]
            P = np.array([v.co[:] for v in vertices])
            axis = np.linalg.eigh(np.cov((P - P.mean(0)).T))[1][:, -1]
            axial = P @ axis
            keep = set(np.argmin(P, axis=0)) | set(np.argmax(P, axis=0)) | {int(axial.argmin()), int(axial.argmax())}
            assert 4 <= len(keep) <= 8
            retained = [vertices[i] for i in sorted(keep)]
            edges = {e for v in vertices for e in v.link_edges}
            bmesh.ops.delete(bm, geom=list(edges), context='EDGES_FACES')
            bmesh.ops.delete(bm, geom=[v for i, v in enumerate(vertices) if i not in keep], context='VERTS')
            hull = bmesh.ops.convex_hull(bm, input=retained, use_existing_faces=False)
            for face in [g for g in hull['geom'] if isinstance(g, bmesh.types.BMFace)]:
                face.material_index = high.data.materials.find('UL_Frond')
                face.smooth = True
                for loop in face.loops:
                    loop[uv_layer].uv = uv_by_vertex[loop.vert]
        bm.normal_update()
        bm.to_mesh(nodes.data)
        bm.free()
        if nodes.data.attributes.get('custom_normal'):
            nodes.data.attributes.remove(nodes.data.attributes['custom_normal'])
    bpy.ops.object.select_all(action='DESELECT')
    base.select_set(True)
    nodes.select_set(True)
    bpy.context.view_layer.objects.active = base
    bpy.ops.object.join()
    target.data = base.data
    target.data.name = f'UL_Head2_head2_L{level}_review5_nodules'
    bpy.data.objects.remove(base)
    assert non_nodule_surface(target) == before_surface, 'Stalk,skin,eyes,UVs or weights changed outside nodules'
    restored = groups(target.data)
    assert len(restored) == 127
    P = coordinates(target.data)
    labels = np.empty(len(target.data.vertices), np.int32)
    target.data.attributes['review5_nodule_id'].data.foreach_get('value', labels)
    details = []
    for indices in restored:
        number = int(labels[indices[0]])
        assert np.all(labels[indices] == number)
        low, high_bound = source_bounds[number]
        assert np.allclose(P[indices].min(0), low, atol=1e-7) and np.allclose(P[indices].max(0), high_bound, atol=1e-7)
        if level in (1, 2):
            assert len(indices) == 20
            order = lambda x: x[np.lexsort(x.T[::-1])]
            assert np.array_equal(order(P[indices]), order(source_P[source_groups[number]]))
        details.append({'nodule': number, 'vertices': len(indices), 'extent_m': np.ptp(P[indices], axis=0).tolist()})
    report['steps'].append({'lod': level, 'old_triangles': before_count, 'new_triangles': triangles(target), 'nodules': details, 'nodule_count': 127, 'source_bounds_retained': True, 'source_vertices_exact': level in (1, 2), 'non_nodule_surface_unchanged': True})
    print('HEAD2_NODULE_LOD_RESTORED', level, triangles(target), flush=True)

after = snapshot()
assert original['rig'] == after['rig'] and original['packed_images'] == after['packed_images']
assert {k: v for k, v in original['meshes'].items() if k not in target_names} == {k: v for k, v in after['meshes'].items() if k not in target_names}, 'LOD0 or another head/body/suit changed'
totals = [sum(triangles(o) for o in bpy.data.collections[f'ulgani_head2_LOD{i}'].objects if o.type == 'MESH') for i in range(4)]
assert totals[0] == 97842 and totals[0] > totals[1] > totals[2] > totals[3] and totals[3] < totals[0] * .05, totals
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
report.update(completed_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), after_sha256=sha(output), head2_variant_triangles=totals, other_meshes_lod0_rig_packed_images_unchanged=True, material_bake_still_pending=True, status='HEAD2_SOURCE_GEOMETRY_RESTORED_PENDING_VALIDATION_AND_VISUAL_REVIEW')
report_path.write_text(json.dumps(report, indent=2) + '\n')
print('ULGANI5_HEAD2_SOURCE_SAVED', report['completed_utc'], report['after_sha256'], flush=True)
