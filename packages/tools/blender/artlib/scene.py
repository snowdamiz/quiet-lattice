"""Reads a loaded file into assets, variants and LODs, the same way for a .blend source and an imported .glb.

Source layout (.blend), DESIGN 19.1 "named collections per variant and LOD":
  Scene Collection
    REF                         scale references, never exported (REF_Grid*, REF_Biped*)
    <asset>                     one top-level collection per asset (collections starting with '_' are ignored)
      <asset>[_<variant>]_LOD0  one collection per LOD of each variant (LOD0..LOD3); an object named
      ...                       <variant>_LOD<n> works too (its children belong to that LOD)
      COL_*, Interact, ...      colliders and point markers sit beside the LODs (they are not per LOD)
  An asset with no LOD collections is one variant whose geometry is all LOD0 (the export generates LOD1-3).

Export layout (.glb), written by the export:
  <asset>                       root node (asset_class extra optional)
    [<variant>]                 a node per extra variant
      <variant>_LOD<n>          a node per LOD holding that LOD's meshes, pivots and animated parts
      COL_*, Interact, Light_*  colliders and point markers
"""
import bpy
import numpy as np

from . import rules as R


class Variant:
    def __init__(self, asset, vid):
        self.asset = asset
        self.id = vid
        self.lods = {}  # n -> [objects] in that LOD (meshes, empties, armatures)
        self.decl = {}  # n -> {"kind": collection|object|implicit, "name": str, "legacy": bool}
        self.extras = []  # variant-level objects outside the LODs (colliders, point markers, strays)
        self.implicit = False  # no LOD naming at all: everything is LOD0
        self.collection = None
        self.cls = None
        self.class_from = None

    def all_objects(self):
        seen, out = set(), []
        for n in sorted(self.lods):
            for o in self.lods[n]:
                if o.name not in seen:
                    seen.add(o.name)
                    out.append(o)
        for o in self.extras + self.asset.extras:
            if o.name not in seen:
                seen.add(o.name)
                out.append(o)
        return out


class Asset:
    def __init__(self, name, holder):
        self.name = name
        self.holder = holder  # source: the asset collection; export: the root object (or None)
        self.variants = {}
        self.extras = []  # objects outside any variant
        self.class_override = None
        self.notes = []  # (level, message) naming problems found while reading the layout

    def variant(self, vid):
        if vid not in self.variants:
            self.variants[vid] = Variant(self, vid)
        return self.variants[vid]


class Model:
    def __init__(self, mode):
        self.mode = mode
        self.assets = []
        self.ref = None  # source: the REF collection
        self.loose = []  # source: objects directly in the scene collection
        self.ignored = []  # source: collections starting with '_'
        self.ref_leaks = []  # export: REF_ objects that reached the .glb


def name_of(o, mode):
    return R.strip(o.name) if mode == "export" else o.name


def marker_spec(rules, name):
    for m in rules["markers"]:
        if R.match(R.strip(name), m["patterns"]):
            return m
    return None


def is_collider(rules, o):
    m = marker_spec(rules, o.name)
    return bool(m and m["role"] == "collider")


def is_point_marker(rules, o):
    m = marker_spec(rules, o.name)
    return bool(m and m["role"] in ("collider", "point"))


def subtree(o):
    return [o] + list(o.children_recursive)


# ---------------------------------------------------------------------------------------------- geometry
_tris = {}


def tri_count(o):
    """Triangles of the evaluated mesh (modifiers applied, as the exporter writes it)."""
    if o.type != "MESH":
        return 0
    key = o.as_pointer()
    if key not in _tris:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        _tris[key] = len(me.loops) - 2 * len(me.polygons) if me else 0
        ev.to_mesh_clear()
    return _tris[key]


def clear_cache():
    _tris.clear()


def world_coords(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        n = len(me.vertices)
        if n == 0:
            return np.zeros((0, 3))
        co = np.empty(n * 3, np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        mw = np.array(o.matrix_world)
        return co @ mw[:3, :3].T + mw[:3, 3]
    finally:
        ev.to_mesh_clear()


def bounds(objects):
    pts = [world_coords(o) for o in objects if o.type == "MESH"]
    pts = [p for p in pts if len(p)]
    if not pts:
        return None
    allp = np.concatenate(pts)
    return allp.min(0), allp.max(0)


def render_meshes(rules, objects):
    """Meshes that are drawn: everything but colliders and reference objects."""
    return [o for o in objects if o.type == "MESH" and not is_collider(rules, o) and not R.strip(o.name).startswith("REF_")]


# ---------------------------------------------------------------------------------------------- source (.blend)
def collect_source(rules):
    model = Model("source")
    sc = bpy.context.scene
    ref_name = rules["reference"]["collection"]
    ignored = rules["names"]["ignoredCollectionPrefix"]
    model.loose = list(sc.collection.objects)
    for coll in sc.collection.children:
        if coll.name == ref_name:
            model.ref = coll
        elif coll.name.startswith(ignored):
            model.ignored.append(coll.name)
        else:
            model.assets.append(_source_asset(rules, coll))
    return model


def _walk_collections(coll):
    yield coll
    for c in coll.children:
        yield from _walk_collections(c)


def _source_asset(rules, coll):
    asset = Asset(coll.name, coll)
    asset.class_override = coll.get("asset_class")
    in_lod = {}  # object name -> (base, n)
    # LOD collections
    for c in _walk_collections(coll):
        parts = R.lod_parts(c.name)
        if c is coll or not parts:
            continue
        base, n, legacy = parts
        v = asset.variant(base)
        if n in v.lods:
            asset.notes.append(("fail", f"two LOD{n} entries for variant {base}"))
        v.lods[n] = list(c.all_objects)
        v.decl[n] = {"kind": "collection", "name": c.name, "legacy": legacy}
        for o in c.all_objects:
            in_lod[o.name] = (base, n)
    # LOD objects (<variant>_LOD<n> names)
    for o in coll.all_objects:
        parts = R.lod_parts(o.name)
        if not parts or o.name in in_lod:
            continue
        base, n, legacy = parts
        v = asset.variant(base)
        if n in v.lods:
            asset.notes.append(("fail", f"two LOD{n} entries for variant {base}"))
        objs = [x for x in subtree(o) if x.name not in in_lod]
        v.lods[n] = objs
        v.decl[n] = {"kind": "object", "name": o.name, "legacy": legacy}
        for x in objs:
            in_lod[x.name] = (base, n)
    rest = [o for o in coll.all_objects if o.name not in in_lod]
    if not asset.variants:
        v = asset.variant(coll.name)
        v.implicit = True
        v.collection = coll
        v.extras = [o for o in rest if is_point_marker(rules, o)]
        v.lods[0] = [o for o in rest if not is_point_marker(rules, o)]
        v.decl[0] = {"kind": "implicit", "name": coll.name, "legacy": False}
        return asset
    variant_colls = {c.name: c for c in _walk_collections(coll) if c.name in asset.variants}
    for vid, c in variant_colls.items():
        asset.variants[vid].collection = c
    for o in rest:
        home = next((vid for vid, c in variant_colls.items() if o.name in c.all_objects), None)
        if home:
            asset.variants[home].extras.append(o)
        elif len(asset.variants) == 1:
            next(iter(asset.variants.values())).extras.append(o)
        else:
            asset.extras.append(o)
    return asset


# ---------------------------------------------------------------------------------------------- export (.glb)
def collect_export(rules):
    model = Model("export")
    roots = [o for o in bpy.data.objects if o.parent is None]
    model.ref_leaks = [o for o in bpy.data.objects if R.strip(o.name).startswith("REF_")]
    roots = [o for o in roots if not R.strip(o.name).startswith("REF_")]
    lod_roots = {}
    plain = []
    for r in roots:
        parts = R.lod_parts(r.name)
        if parts:
            lod_roots.setdefault(parts[0], []).append((parts[1], r, parts[2]))
        else:
            plain.append(r)
    for r in sorted(plain, key=lambda o: o.name):
        name = R.strip(r.name)
        asset = Asset(name, r)
        asset.class_override = r.get("asset_class")
        _export_tree(rules, asset, r)
        if name in lod_roots:
            # demo flora: '<name>' is LOD0 and '<name>_lod1' sits beside it at the top level
            v = asset.variants.get(name)
            if v is not None and v.implicit:
                v.implicit = False
                v.decl[0] = {"kind": "object", "name": name, "legacy": True, "unsuffixed": True}
                for n, lr, legacy in lod_roots.pop(name):
                    v.lods[n] = subtree(lr)
                    v.decl[n] = {"kind": "object", "name": R.strip(lr.name), "legacy": legacy}
        model.assets.append(asset)
    for base, items in sorted(lod_roots.items()):
        asset = Asset(base, None)
        v = asset.variant(base)
        for n, lr, legacy in items:
            v.lods[n] = subtree(lr)
            v.decl[n] = {"kind": "object", "name": R.strip(lr.name), "legacy": legacy}
            asset.class_override = asset.class_override or lr.get("asset_class")
        model.assets.append(asset)
    return model


def _export_tree(rules, asset, root):
    in_lod = set()

    def visit(o):
        parts = R.lod_parts(o.name)
        if parts and o is not root:
            base, n, legacy = parts
            v = asset.variant(base)
            if n in v.lods:
                asset.notes.append(("fail", f"two LOD{n} nodes for variant {base}"))
            objs = subtree(o)
            v.lods[n] = objs
            v.decl[n] = {"kind": "object", "name": R.strip(o.name), "legacy": legacy}
            in_lod.update(x.name for x in objs)
            return
        for c in o.children:
            visit(c)

    visit(root)
    rest = [o for o in subtree(root) if o.name not in in_lod]
    if not asset.variants:
        v = asset.variant(asset.name)
        v.implicit = True
        v.extras = [o for o in rest if is_point_marker(rules, o)]
        v.lods[0] = [o for o in rest if not is_point_marker(rules, o)]
        v.decl[0] = {"kind": "implicit", "name": asset.name, "legacy": False}
        return
    for o in rest:
        if o is root:
            continue
        home = None
        p = o
        while p is not None and home is None:
            if R.strip(p.name) in asset.variants and p is not root:
                home = R.strip(p.name)
            p = p.parent
        if home:
            asset.variants[home].extras.append(o)
        elif len(asset.variants) == 1:
            next(iter(asset.variants.values())).extras.append(o)
        else:
            asset.extras.append(o)


# ---------------------------------------------------------------------------------------------- classes
def assign_classes(rules, family, model, cli_class=None, legacy_class=None):
    classes = rules["classes"]
    for a in model.assets:
        for v in a.variants.values():
            if cli_class:
                v.cls, v.class_from = cli_class, "--class"
            elif a.class_override:
                v.cls, v.class_from = str(a.class_override), "asset_class property"
            elif legacy_class:
                v.cls, v.class_from = legacy_class, "legacy entry in families.json"
            else:
                v.cls = R.class_of(rules, family, v.id)
                v.class_from = "family default" if v.cls == rules["families"][family]["class"] else "family classRules"
            if v.cls not in classes:
                a.notes.append(("fail", f"unknown asset_class '{v.cls}' (classes: {', '.join(classes)})"))
                v.cls = rules["families"][family]["class"]
