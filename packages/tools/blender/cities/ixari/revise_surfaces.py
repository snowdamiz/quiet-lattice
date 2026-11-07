"""Edit saved T06 surfaces; leave canonical network glyph application to E10.T08."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[5]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'packages/tools/blender'))
sys.path.insert(0, str(Path(__file__).parent))
from artlib import core, lods, rules as R, scene as S
from refine_sources import members, remove_islands

TASK = ROOT / 'assets/blend/cities/ixari'
TARGETS = {'anchor_quavel', 'prop_ixari_terminal', 'prop_ixari_board'}
OLD = ('GlyphStem', 'GlyphFork', 'RecordedStroke')


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def mesh_signature(ob):
    return sha(dict(vertices=[list(v.co) for v in ob.data.vertices],
                    faces=[list(p.vertices) for p in ob.data.polygons],
                    matrix=[list(r) for r in ob.matrix_world]))


def groups(ob):
    result = {}
    for group in ob.vertex_groups:
        if group.name.startswith(OLD):
            continue
        ids = sorted(members(ob, group.name)); lookup = {v: i for i, v in enumerate(ids)}
        faces = [p for p in ob.data.polygons if all(v in lookup for v in p.vertices)]
        result[group.name] = sha(dict(vertices=[list(ob.data.vertices[v].co) for v in ids],
            faces=[[lookup[v] for v in p.vertices] for p in faces],
            uv=[[list(ob.data.uv_layers.active.data[i].uv) for i in p.loop_indices] for p in faces]))
    return result


def add_growth(ob, name, position, radius, length, direction, tile, collar=False):
    """An unequal rhombic crystal with stepped growth and a chipped tip, or socket bed."""
    axis = Vector(direction).normalized()
    u = axis.cross(Vector((1, 0, .17))).normalized()
    v = axis.cross(u).normalized()
    section = [(1, .05), (.2, .66), (-.85, -.03), (-.11, -.58)]
    if collar:
        rings = [(0, 1.42), (.12, 1.52), (.20, 1.05)]
    else:
        rings = [(0, 1), (.38, 1.08), (.40, .78), (.73, .81), (.76, .47), (1, .06)]
    vertices = []
    for z, scale in rings:
        for x, y in section:
            vertices.append(Vector(position) + axis * (z * length) +
                            u * (radius * scale * x + .09 * radius * z) + v * radius * scale * y)
    faces = [(3, 2, 1, 0), tuple(range((len(rings)-1)*4, len(rings)*4))]
    for i in range(len(rings)-1):
        for j in range(4):
            faces.append((i*4+j, i*4+(j+1)%4, (i+1)*4+(j+1)%4, (i+1)*4+j))
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    uv = data.uv_layers.new(name=ob.data.uv_layers.active.name)
    for p in data.polygons:
        for k, li in enumerate(p.loop_indices):
            uv.data[li].uv = ((tile % 4 + .10 + .8 * (k % 2)) / 4,
                             (tile // 4 + .08 + .84 * ((k // 2) % 2)) / 2)
    data.materials.append(ob.data.materials[0])
    piece = bpy.data.objects.new(name, data); ob.users_collection[0].objects.link(piece)
    group = piece.vertex_groups.new(name=name); group.add(list(range(len(vertices))), 1, 'REPLACE')
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); piece.select_set(True)
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.join()


def replace_unused_reserved_tile():
    changes = []
    for image in bpy.data.images:
        if not image.name.startswith('Ixari_Atlas_'):
            continue
        w, h = image.size; pixels = np.empty(w*h*4, dtype=np.float32)
        image.pixels.foreach_get(pixels); pixels = pixels.reshape(h, w, 4)
        # Tile 6 formerly contained exclusive glyph light. Replace only this cell
        # with existing violet crystal data; no surface uses it after the edit.
        outside_before = hashlib.sha256(pixels[:h//2].tobytes() + pixels[h//2:, :w//2].tobytes() + pixels[h//2:, 3*w//4:].tobytes()).hexdigest()
        pixels[h//2:, w//2:3*w//4] = pixels[:h//2, 3*w//4:w]
        image.pixels.foreach_set(pixels.ravel()); image.update(); image.pack()
        outside_after = hashlib.sha256(pixels[:h//2].tobytes() + pixels[h//2:, :w//2].tobytes() + pixels[h//2:, 3*w//4:].tobytes()).hexdigest()
        assert outside_before == outside_after
        changes.append(dict(image=image.name,unchangedOutsideTile6=outside_before))
    for material in list(bpy.data.materials):
        if material.name.startswith('LIB_GlyphLight'):
            assert material.users <= 1
            bpy.data.materials.remove(material)
    return changes


def main():
    out = ROOT / sys.argv[sys.argv.index('--')+1]
    assert not out.exists()
    baseline = json.loads((TASK/'revision-r1/baseline.json').read_text())
    rules = R.load(); records = []
    for family in ('anchor', 'props'):
        path = ROOT / f'assets/blend/cities/ixari_{family}.blend'
        before_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        assert before_hash == baseline['files'][str(path.relative_to(ROOT))]['sha256']
        core.load(path); bpy.context.preferences.filepaths.save_version = 0
        model = S.collect_source(rules); S.assign_classes(rules, 'cities', model)
        preserved = {o.name: mesh_signature(o) for o in bpy.data.objects if o.type == 'MESH' and
                     (o.name.startswith(('COL_', 'REF_')) or o.name.startswith(('prop_ixari_basin_', 'prop_ixari_seat_', 'prop_ixari_stall_')))}
        markers = {o.name: dict(position=list(o.location), properties=dict(o.items())) for o in bpy.data.objects if o.type == 'EMPTY'}
        assets = []
        for asset in model.assets:
            for variant in asset.variants.values():
                if variant.id not in TARGETS:
                    continue
                ob = S.render_meshes(rules, variant.lods[0])[0]
                before_groups = groups(ob); bounds = [list(v) for v in S.bounds([ob])]
                removed = [g.name for g in ob.vertex_groups if g.name.startswith(OLD)]
                assert len(removed) == (185 if family == 'anchor' else 8)
                remove_islands(ob, removed)
                for name in removed: ob.vertex_groups.remove(ob.vertex_groups[name])
                bvh = BVHTree.FromPolygons([v.co for v in ob.data.vertices], [p.vertices[:] for p in ob.data.polygons])
                if family == 'anchor':
                    # Widely spaced geological colonies following separate fault beds.
                    # No columns of letters, repeated stroke code, or network-light colour.
                    centres = [(-2.1, 4.5, .26), (-2.6, 9.4, .39), (-3.3, 16.2, .31),
                               (-3.78, 22.0, .35), (-4.1, 27.7, .24), (2.3, 7.3, .32),
                               (3.5, 18.8, .29), (4.7, 30.1, .25), (.3, 37.2, .20)]
                else:
                    # Three tactile rhombic pressure facets seated in the lectern stone.
                    centres = [(-.37, .69, .075), (.02, .84, .09), (.36, .73, .065)]
                for i, (x, z, radius) in enumerate(centres):
                    hit, normal, face, distance = bvh.ray_cast(Vector((x, -40, z)), Vector((0, 1, 0)), 60)
                    assert hit is not None, (variant.id, x, z)
                    direction = Vector((.27 if i % 2 else -.18, -.35, 1)).normalized()
                    if family == 'props': direction = Vector((.15, -1, .35)).normalized()
                    name = ('FaultColony' if family == 'anchor' else 'PressureFacet') + str(i)
                    base = hit + Vector((0, .012, 0))
                    add_growth(ob, name+'Socket', base, radius, .18 if family=='anchor' else .10, (0,-1,.1), 1, True)
                    add_growth(ob, name+'Prism', base, radius*.72, radius*2.9 if family=='anchor' else .12, direction, 2 if i%2 else 3)
                    if family == 'anchor':
                        add_growth(ob, name+'Fracture', base+Vector((radius*.42,-.018,.025)), radius*.15,
                                   radius*1.2, direction, 4)
                after_groups = groups(ob)
                assert all(after_groups[k] == h for k,h in before_groups.items()), 'architecture mesh or UV changed'
                S.clear_cache()
                assert bounds == [list(v) for v in S.bounds([ob])], 'silhouette envelope changed'
                for level in (1,2,3):
                    for obj in variant.lods[level]: bpy.data.objects.remove(obj, do_unlink=True)
                    bpy.data.collections.remove(bpy.data.collections[f'{variant.id}_LOD{level}'])
                variant.lods={0:variant.lods[0]}; variant.decl={0:variant.decl[0]}
                work=bpy.data.collections.new('_Derived');asset.holder.children.link(work)
                lods.generate(rules,variant,work)
                for level in (1,2,3):
                    collection=bpy.data.collections.new(f'{variant.id}_LOD{level}');asset.holder.children.link(collection)
                    for obj in variant.lods[level]:
                        for old in list(obj.users_collection):old.objects.unlink(obj)
                        collection.objects.link(obj);obj.name=f'{variant.id}_Facets_L{level}';obj.data.name=obj.name
                        obj.data.validate();assert not obj.data.validate();obj.hide_render=True
                bpy.data.collections.remove(work)
                ob['surface_scope']='Ixari decorative crystal growth/pressure facets; canonical alphabet deferred to E10.T08'
                assets.append(dict(asset=variant.id,removedGroups=removed,preservedArchitectureGroups=before_groups,
                                   newGroups=[g.name for g in ob.vertex_groups if g.name not in before_groups],bounds=bounds))
        if family == 'anchor': bpy.data.objects['Light_Anchor_anchor_quavel']['color']='#B9A6FF'
        for name, signature in preserved.items():assert mesh_signature(bpy.data.objects[name])==signature, name
        for name, data in markers.items():
            now=dict(position=list(bpy.data.objects[name].location), properties=dict(bpy.data.objects[name].items()))
            if name=='Light_Anchor_anchor_quavel':data['properties']['color']='#B9A6FF'
            assert now==data, name
        atlas=replace_unused_reserved_tile()
        bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
        records.append(dict(source=str(path.relative_to(ROOT)),beforeSha256=before_hash,
                            afterSha256=hashlib.sha256(path.read_bytes()).hexdigest(),assets=assets,
                            preservedMeshHashes=preserved,preservedMarkers=markers,atlas=atlas))
    out.write_text(json.dumps(records,indent=2)+'\n')
    print('SAVED: removed false ribbons; authored Ixari fault colonies and pressure facets; architecture/COL/markers preserved')


if __name__=='__main__':main()
