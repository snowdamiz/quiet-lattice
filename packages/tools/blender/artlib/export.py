"""Shared core of export_<family>.py (DESIGN 19.1: validate, bake, build missing LODs, write .glb).

For every assets/blend/<family>/*.blend: validate the source (stop on failure), bake procedural material channels,
decimate LOD1-3 for variants without hand-made LODs, turn collections into the node layout the engine reads
(<asset> / [<variant>] / <variant>_LOD<n>, colliders and markers beside the LODs), export a .glb, validate that .glb,
and only then move it to packages/client/public/models/<family>/<name>.glb. The .blend is never saved.
"""
import argparse
import shutil
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

from . import bake, core, glb, lods
from . import rules as R
from . import scene as S


def parse(argv):
    p = argparse.ArgumentParser(prog="export_<family>.py")
    p.add_argument("--src-root", help="directory holding <family>/*.blend (default assets/blend)")
    p.add_argument("--out-dir", help="models directory (default packages/client/public/models)")
    p.add_argument("--report-dir", help="directory for JSON reports (default packages/tools/blender/reports)")
    p.add_argument("--only", help="comma-separated .blend names (without extension) to export")
    p.add_argument("--bake-res", type=int, help="bake size in px instead of the class texture size (tests)")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--quiet", action="store_true")
    return p.parse_args(argv)


def main(family, argv=None):
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = parse(argv)
    rules = R.load()
    if family not in rules["families"]:
        print(f"export: unknown family {family} ({', '.join(R.family_names(rules))})")
        return 2
    if not rules["families"][family].get("export", True):
        print(f"export {family}: this family is not exported")
        return 0
    src_dir = Path(args.src_root or R.SOURCES) / family
    sources = sorted(p for p in src_dir.glob("*.blend")) if src_dir.is_dir() else []
    if args.only:
        keep = set(args.only.split(","))
        sources = [s for s in sources if s.stem in keep]
    if not sources:
        print(f"export {family}: nothing to export (no .blend sources in {R.rel(src_dir)})")
        return 0
    out_root = Path(args.out_dir) if args.out_dir else R.MODELS
    done = [src for src in sources if export_one(rules, family, src, out_root, args)]
    print(f"\nexport {family}: {len(done)} of {len(sources)} source(s) exported")
    return 0 if len(done) == len(sources) else 1


def export_one(rules, family, src, out_root, args):
    out = out_root / rules["output"].format(family=family, stem=src.stem)
    print(f"\nexport {R.rel(src)} -> {R.rel(out)}")
    report = core.validate_path(rules, src, family=family)
    core.write_and_print(report, core.report_path(family, src, args.report_dir), verbose=args.verbose, quiet=args.quiet)
    if report.status != "PASS":
        print(f"  {src.name} failed validation: nothing written")
        return False
    model = report.model
    _bake(rules, model, args.bake_res)
    _make_lods(rules, model)
    roots = _build_nodes(rules, model)
    tmpdir = Path(tempfile.mkdtemp(prefix="art-export-"))
    try:
        tmp = tmpdir / out.name
        _write(roots, tmp)
        glb.strip_suffixes(tmp)
        core.load(tmp)
        check = core.run_checks(rules, out, family, "export", source=src)
        core.write_and_print(check, core.report_path(family, out, args.report_dir), verbose=args.verbose, quiet=args.quiet)
        if check.status != "PASS":
            rejected = core.report_path(family, out, args.report_dir).with_suffix(".rejected.glb")
            rejected.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tmp, rejected)
            print(f"  the export of {src.name} failed validation: nothing written to the models (inspect {R.rel(rejected)})")
            return False
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tmp), str(out))
        print(f"  wrote {R.rel(out)} ({out.stat().st_size:,} bytes)")
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _bake(rules, model, bake_res):
    users = {}
    for a in model.assets:
        for v in a.variants.values():
            for o in S.render_meshes(rules, v.lods.get(0, [])):
                for s in o.material_slots:
                    if s.material:
                        objs, classes = users.setdefault(s.material.name, ([], set()))
                        if o not in objs:
                            objs.append(o)
                        classes.add(v.cls)
    ready = False
    for name, (objs, classes) in sorted(users.items()):
        mat = bpy.data.materials[name]
        res = bake_res or max(rules["classes"][c]["texture"] for c in classes)
        info_needed = bake.M.MaterialInfo(mat)
        if not info_needed.procedural() and not (info_needed.bake_ao and info_needed.channels["occlusion"].kind == "constant"):
            continue
        if not ready:
            bake.ensure_cycles(bpy.context.scene)
            ready = True
        bake.bake_material(mat, objs, res)


def _make_lods(rules, model):
    scratch = bpy.data.collections.new("_lod_generated")
    bpy.context.scene.collection.children.link(scratch)
    for a in model.assets:
        for v in a.variants.values():
            want = rules["classes"][v.cls]["lods"]
            if want > 1 and sorted(v.lods) == [0]:
                lods.generate(rules, v, scratch)


def _offset(*colls):
    for c in colls:
        if c is not None and Vector(c.instance_offset).length > 0:
            return Vector(c.instance_offset)
    return Vector((0.0, 0.0, 0.0))


def _empty(name, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    return e


def _attach(objs, node, offset):
    """Parents the top-level objects of `objs` to `node` (at the origin), keeping their world placement minus the
    collection's instance offset (an artist can lay variants out side by side and give each collection its origin)."""
    names = {o.name for o in objs}
    bpy.context.view_layer.update()
    tops = [o for o in objs if o.parent is None or o.parent.name not in names]
    worlds = [(o, o.matrix_world.copy()) for o in tops]
    for o, mw in worlds:
        o.parent = node
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = Matrix.Translation(-offset) @ mw


def _build_nodes(rules, model):
    roots = []
    for a in model.assets:
        root = _empty(a.name)
        if a.class_override:
            root["asset_class"] = str(a.class_override)
        acoll = a.holder
        _attach(a.extras, root, _offset(acoll))
        for v in a.variants.values():
            vnode = root if v.id == a.name else _empty(v.id, root)
            for n in sorted(v.lods):
                d = v.decl[n]
                lcoll = bpy.data.collections.get(d["name"]) if d["kind"] == "collection" else None
                if d["kind"] == "generated":
                    d0 = v.decl[0]
                    lcoll = bpy.data.collections.get(d0["name"]) if d0["kind"] == "collection" else None
                off = _offset(lcoll, v.collection, acoll)
                if d["kind"] == "object":
                    lod_obj = bpy.data.objects[d["name"]]
                    _attach([lod_obj], vnode, off)
                else:
                    _attach(v.lods[n], _empty(f"{v.id}_LOD{n}", vnode), off)
            _attach(v.extras, vnode, _offset(v.collection, acoll))
        roots.append(root)
    return roots


def _write(roots, path):
    keep = []
    for r in roots:
        keep += [r] + list(r.children_recursive)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in keep:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_attributes=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_skins=True,
        export_morph=True,
        export_animations=True,
    )
