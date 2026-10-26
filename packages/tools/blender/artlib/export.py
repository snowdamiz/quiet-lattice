"""Shared core of export_<family>.py (DESIGN 19.1: validate, bake, build missing LODs, write .glb).

For every assets/blend/<family>/*.blend: validate the source (stop on failure); give each variant local copies of its
linked library materials and of every material it must bake; bake procedural channels and AO; decimate LOD1-3 for
variants without hand-made LODs; turn collections into the node layout the engine reads (<asset> / [<variant>] /
<variant>_LOD<n>, colliders and markers beside the LODs); export a .glb with materials named by their engine_name;
validate that .glb, and only then move it to packages/client/public/models/<family>/<name>.glb. A source that fails (or
crashes the export) leaves no model behind: a stale .glb is removed. The .blend is never saved.
"""
import argparse
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

from . import bake, core, glb, lods
from . import checks as C
from . import materials as M
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
    done = []
    for src in sources:
        out = out_root / rules["output"].format(family=family, stem=src.stem)
        try:
            ok = export_one(rules, family, src, out, args)
        except Exception:  # one broken source must not stop the rest of the family
            traceback.print_exc()
            print(f"  exporting {src.name} crashed")
            ok = False
            _drop_stale(out)
        if ok:
            done.append(src)
    print(f"\nexport {family}: {len(done)} of {len(sources)} source(s) exported")
    return 0 if len(done) == len(sources) else 1


def _drop_stale(out):
    """A model whose source no longer exports is removed, so the game reports it missing instead of loading art that
    no longer matches its source (DESIGN 19.1: no fallbacks)."""
    if out.exists():
        out.unlink()
        print(f"  removed the stale {R.rel(out)}")


def export_one(rules, family, src, out, args):
    print(f"\nexport {R.rel(src)} -> {R.rel(out)}")
    report = core.validate_path(rules, src, family=family)
    core.write_and_print(report, core.report_path(family, src, args.report_dir), verbose=args.verbose, quiet=args.quiet)
    if report.status != "PASS":
        print(f"  {src.name} failed validation: nothing written")
        if not report.error:  # an unreadable source (LFS pointer, missing file) says nothing about the model
            _drop_stale(out)
        return False
    model = report.model
    _bake(rules, family, model, args.bake_res)
    _make_lods(rules, model)
    _stamp_skins(rules, model)
    names = _material_names(rules, model)
    roots = _build_nodes(rules, model)
    tmpdir = Path(tempfile.mkdtemp(prefix="art-export-"))
    try:
        tmp = tmpdir / out.name
        _write(roots, tmp)
        glb.finalize(tmp, names)
        core.load(tmp)
        check = core.run_checks(rules, out, family, "export", source=src)
        core.write_and_print(check, core.report_path(family, out, args.report_dir), verbose=args.verbose, quiet=args.quiet)
        if check.status != "PASS":
            rejected = core.report_path(family, out, args.report_dir).with_suffix(".rejected.glb")
            rejected.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tmp, rejected)
            print(f"  the export of {src.name} failed validation: nothing written to the models (inspect {R.rel(rejected)})")
            _drop_stale(out)
            return False
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tmp), str(out))
        print(f"  wrote {R.rel(out)} ({out.stat().st_size:,} bytes)")
        return True
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _bake(rules, family, model, bake_res):
    """Gives each variant local copies of its linked or to-be-baked materials, then bakes their procedural channels and
    AO over the variant's LOD0 meshes."""
    ready = False
    for a in model.assets:
        for v in a.variants.values():
            meshes = {n: S.render_meshes(rules, objs) for n, objs in v.lods.items()}
            res = bake_res or rules["classes"][v.cls]["texture"]
            copies = {}
            for m in C._materials_of(rules, v):
                info = M.MaterialInfo(m)
                ao = C.ao_to_bake(rules, family, v.cls, info)
                todo = bake.channels_to_bake(info, ao) if info.bsdf is not None else []
                if m.library is not None or todo:
                    copies[m.as_pointer()] = (m.copy(), ao, bool(todo), f"{v.id}_{R.material_name(m)}")
            for objs in meshes.values():
                for o in objs:
                    for slot in o.material_slots:
                        if slot.material is not None and slot.material.as_pointer() in copies:
                            copy = copies[slot.material.as_pointer()][0]
                            slot.link = "OBJECT"  # the mesh may be shared with another variant
                            slot.material = copy
            for copy, ao, needed, label in copies.values():
                if not needed:
                    continue
                users = []
                for n in sorted(meshes):
                    users = [o for o in meshes[n] if any(s.material == copy for s in o.material_slots)]
                    if users:
                        break
                if not ready:
                    bake.ensure_cycles(bpy.context.scene)
                    ready = True
                bake.bake_material(copy, users, res, ao=ao, label=label, occluders=meshes[n])


def _stamp_skins(rules, model):
    """The glTF importer moves every skinned mesh under its armature, out of its <variant>_LOD<n> node. Each skinned mesh
    carries its variant and LOD as extras, so re-validation (and the engine) can put it back."""
    for a in model.assets:
        for v in a.variants.values():
            for n, objs in v.lods.items():
                for o in S.render_meshes(rules, objs):
                    if o.parent_type == "ARMATURE" or any(md.type == "ARMATURE" and md.object is not None for md in o.modifiers):
                        o[S.STAMP_VARIANT] = v.id
                        o[S.STAMP_LOD] = n


def _material_names(rules, model):
    """Blender material name -> the name the .glb carries (engine_name, else the name without its .001 suffix)."""
    names = {}
    for a in model.assets:
        for v in a.variants.values():
            seen = {}
            for m in C._materials_of(rules, v):
                final = R.material_name(m)
                if final in seen and seen[final] != m.name:
                    raise RuntimeError(f"{v.id}: materials {seen[final]} and {m.name} would both export as '{final}'")
                seen[final] = m.name
                names[m.name] = final
    return names


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
