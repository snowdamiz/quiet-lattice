"""Generates LOD1..LOD3 by decimation for variants whose LODs were not hand-made (DESIGN 19.1)."""
import bpy

from . import scene as S


def _copy_subtree(objects, collection):
    mapping = {}
    for o in objects:
        c = o.copy()
        if o.data is not None and o.type == "MESH":
            c.data = o.data.copy()
        collection.objects.link(c)
        mapping[o.name] = c
    for o in objects:
        c = mapping[o.name]
        if o.parent is not None and o.parent.name in mapping:
            c.parent = mapping[o.parent.name]
            c.matrix_parent_inverse = o.matrix_parent_inverse.copy()
        for md in c.modifiers:  # a copied skin deforms with the copied skeleton
            if md.type == "ARMATURE" and md.object is not None and md.object.name in mapping:
                md.object = mapping[md.object.name]
    return [mapping[o.name] for o in objects]


def _evaluated_tris(objects):
    S.clear_cache()
    return sum(S.tri_count(o) for o in objects)


def _decimate(meshes, target):
    """Collapse-decimates `meshes` together until their triangles reach `target`, then applies the decimation."""
    mods = []
    for o in meshes:
        if o.data.shape_keys is not None:
            o.shape_key_clear()  # facial blendshapes stay on LOD0
        md = o.modifiers.new("LOD_decimate", "DECIMATE")
        md.decimate_type = "COLLAPSE"
        md.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
        mods.append(md)
    start = _evaluated_tris(meshes)
    ratio = min(1.0, target / max(start, 1))
    total = start
    for _ in range(10):
        for md in mods:
            md.ratio = ratio
        total = _evaluated_tris(meshes)
        if total <= target or ratio < 1e-4:
            break
        ratio *= max(0.2, min(0.95, target / total * 0.97))
    for o in meshes:
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier="LOD_decimate")
    S.clear_cache()
    return total


def generate(rules, variant, collection, log=print):
    """Adds LOD1..LOD(n-1) to `variant` from its LOD0, decimated to the families.json ratios."""
    want = rules["classes"][variant.cls]["lods"]
    ratios = rules["lod"]["generateRatios"]
    lod0 = variant.lods[0]
    meshes0 = S.render_meshes(rules, lod0)
    t0 = _evaluated_tris(meshes0)
    made = []
    for k in range(1, want):
        objs = _copy_subtree(lod0, collection)
        meshes = S.render_meshes(rules, objs)
        target = max(int(t0 * ratios[k]), 4)
        got = _decimate(meshes, target)
        variant.lods[k] = objs
        variant.decl[k] = {"kind": "generated", "name": f"{variant.id}_LOD{k}", "legacy": False}
        made.append(got)
    log(f"    generated LODs for {variant.id}: {t0:,} > " + " > ".join(f"{t:,}" for t in made) + " triangles")
    return made
