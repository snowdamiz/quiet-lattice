"""The five checks: naming, triangle budget, LODs, materials, scale references (IMPLEMENTATION_PLAN 0.4)."""
import re
from pathlib import Path

import bpy
import numpy as np

from . import ktx
from . import materials as M
from . import rules as R
from . import scene as S

DESIGN_CLASSES = {"hero", "creature", "prop"}  # budgets DESIGN 19.2 states; the rest are families.json choices


def _vname(v):
    return v.id if v.id == v.asset.name else f"{v.asset.name}/{v.id}"


def _fmt(n):
    return f"{n:,}"


def _src(rules, cls):
    return "DESIGN 19.2" if cls in DESIGN_CLASSES else "families.json"


# ---------------------------------------------------------------------------------------------- naming
def naming(rules, family, model, report):
    c = report["naming"]
    ident = re.compile(rules["names"]["identifier"])
    spec = rules["families"][family]
    mode = model.mode

    if mode == "source":
        for o in model.loose:
            c.fail(o.name, "sits in the Scene Collection; put it in an asset collection or REF")
        for name in model.ignored:
            c.info(name, "collection starts with '_': ignored and never exported")
        for name in model.misplaced_lods:
            base = R.lod_parts(name)[0]
            c.fail(
                name,
                f"LOD collection at the top level: LODs nest inside their asset collection (Scene Collection > {base} > {name}; "
                f"a variant is {base}_<variant>_LOD<n> inside {base})",
            )
        if not model.assets and family != "library":
            c.fail(Path(report.path).name, "no asset collections (one top-level collection per asset)")

    bad = set()

    def check_name(kind, name):
        base = R.strip(name) if mode == "export" else name
        if mode == "source" and R.SUFFIX.search(name) and name not in bad:
            bad.add(name)
            c.warn(name, f"{kind} name carries Blender's duplicate suffix; give it a real name")
            base = R.strip(name)
        if not ident.match(base) and base not in bad:
            bad.add(base)
            c.fail(base, f"{kind} name is not an identifier ({rules['names']['identifier']})")

    if mode == "source":
        skip = rules["names"]["ignoredCollectionPrefix"]
        hidden = {c.name for c in bpy.data.collections if c.name.startswith(skip)}
        hidden |= {d.name for c in bpy.data.collections if c.name in hidden for d in c.children_recursive}
        for coll in bpy.data.collections:
            if coll.name not in hidden and coll.library is None:
                check_name("collection", coll.name)
    for a in model.assets:
        for lvl, msg in a.notes:
            getattr(c, lvl)(a.name, msg)
        for v in a.variants.values():
            for o in v.all_objects():
                check_name("object", o.name)
            for m in _materials_of(rules, v):
                check_name("material", R.material_name(m))
            _naming_variant(rules, spec, model, a, v, c)
    if family == "library":
        for m in bpy.data.materials:
            if m.users and not m.is_grease_pencil:
                check_name("material", R.material_name(m))
    if mode == "export":
        for o in model.ref_leaks:
            c.fail(R.strip(o.name), "reference object reached the export (REF_ objects stay in the .blend)")
    if c.status == "PASS" and model.assets:
        c.ok(Path(report.path).name, f"{sum(len(a.variants) for a in model.assets)} variant(s) in {len(model.assets)} asset(s) follow the {family} rules")


def _naming_variant(rules, spec, model, a, v, c):
    name = _vname(v)
    mode = model.mode
    if v.id != a.name and not v.id.startswith(a.name + "_"):
        c.fail(name, f"variant '{v.id}' must be named '{a.name}' or '{a.name}_<variant>'")
    for n, d in sorted(v.decl.items()):
        if d.get("unsuffixed"):
            c.fail(d["name"], f"LOD0 must be named {v.id}_LOD0 (the demo's flora left LOD0 unsuffixed)")
        elif d.get("legacy"):
            c.fail(d["name"], f"legacy LOD suffix; name it {v.id}_LOD{n}")
    if mode == "source":
        reserved = {a.name, v.id} | {f"{v.id}_LOD{n}" for n, d in v.decl.items() if d["kind"] == "collection"}
        for o in v.all_objects():
            if o.name in reserved:
                c.fail(o.name, "object name is reserved for the node the export creates (asset, variant or LOD)")
    if not v.implicit:
        for o in v.extras:
            if o.type == "MESH" and not S.is_collider(rules, o):
                c.fail(S.name_of(o, mode), f"mesh sits outside {v.id}'s LODs; move it into a {v.id}_LOD<n>")
    objs = v.all_objects()
    # markers the engine reads (DESIGN 19.4)
    for o in objs:
        m = S.marker_spec(rules, o.name)
        if not m:
            continue
        nm = S.name_of(o, mode)
        if o.type != m["type"]:
            c.fail(nm, f"{' / '.join(m['patterns'])} must be an {m['type']} ({m['why']}), found {o.type}")
        missing = [p for p in m.get("props", []) if p not in o.keys()]
        if missing:
            c.fail(nm, f"missing custom properties {', '.join(missing)} ({m['why']})")
        if m.get("childMesh") and not any(ch.type == "MESH" for ch in o.children):
            c.fail(nm, f"needs a child mesh ({m['why']})")
        if m["role"] == "collider" and o.type == "MESH" and S.tri_count(o) > m["maxTris"]:
            c.warn(nm, f"collider has {_fmt(S.tri_count(o))} triangles (keep under {m['maxTris']}: {m['why']})")
    for req in spec.get("requiredMarkers", []):
        pats = req["pattern"] if isinstance(req["pattern"], list) else [req["pattern"]]
        found = [o for o in objs if R.match(S.name_of(o, mode), pats, ci=True) and o.type == req.get("type", o.type)]
        if len(found) < req.get("min", 1):
            kind = f" {req['type'].lower()}" if req.get("type") else ""
            c.fail(name, f"no {' / '.join(pats)}{kind} ({req['why']})")
    # materials export under their engine_name (or their own name): two different materials must not collide
    by_name = {}
    for m in _materials_of(rules, v):
        by_name.setdefault(R.material_name(m), []).append(m)
    for final, ms in sorted(by_name.items()):
        if len(ms) > 1:
            c.fail(name, f"materials {', '.join(m.name for m in ms)} would all export as '{final}'; give them distinct engine_name values")
    mats = spec.get("materials", {})
    if mats.get("required"):
        for pat in mats["required"]:
            if not any(R.match(n, pat) for n in by_name):
                c.fail(name, f"material '{pat}' missing, by name or engine_name ({mats.get('why', 'the engine reads it by name')})")
    meshes = [o for n in sorted(v.lods) for o in S.render_meshes(rules, v.lods[n])]
    for att in spec.get("attributes", []):
        for o in meshes:
            have = {x.name.lower(): x for x in o.data.attributes}
            x = have.get(att["name"].lower())
            if x is None:
                c.fail(S.name_of(o, mode), f"mesh lacks the {att['name']} attribute ({att['type']}, {att['domain']}); {spec.get('why', '')}".rstrip("; "))
            elif x.data_type != att["type"] or x.domain != att["domain"]:
                c.fail(S.name_of(o, mode), f"{att['name']} is {x.data_type}/{x.domain}, expected {att['type']}/{att['domain']}")
    if spec.get("colorMask"):
        for o in meshes:
            msg = _color_mask_problem(o)
            if msg:
                c.fail(S.name_of(o, mode), msg)
    if v.cls in spec.get("armature", []):
        arms = [o for o in objs if o.type == "ARMATURE"]
        if not arms:
            c.fail(name, "no armature: this class is fully skinned (DESIGN 19.2)")
        else:
            for o in meshes:
                skinned = o.parent_type == "ARMATURE" or any(md.type == "ARMATURE" and md.object in arms for md in o.modifiers)
                if not skinned:
                    c.fail(S.name_of(o, mode), "mesh is not skinned to the variant's armature")


def _color_mask_problem(o):
    me = o.data
    ca = me.color_attributes.active_color or (me.color_attributes[0] if len(me.color_attributes) else None)
    if ca is None:
        return "no colour-region mask (colour attribute: R primary, G secondary, B accent weights summing to 1, A occlusion)"
    n = len(ca.data)
    if n == 0:
        return "colour-region mask is empty"
    arr = np.empty(n * 4, np.float32)
    ca.data.foreach_get("color", arr)
    s = arr.reshape(-1, 4)[:, :3].sum(1)
    ok = float(np.mean(np.abs(s - 1.0) < 0.05))
    if ok < 0.95:
        return f"colour-region mask weights sum to 1 on only {ok:.0%} of elements (R+G+B must be 1)"
    return None


def _materials_of(rules, v, lods=None):
    """Distinct materials on the variant's meshes (a linked library material and a local one may share a name)."""
    seen, out = set(), []
    for n in sorted(v.lods) if lods is None else lods:
        for o in S.render_meshes(rules, v.lods.get(n, [])):
            for slot in o.material_slots:
                if slot.material and slot.material.as_pointer() not in seen:
                    seen.add(slot.material.as_pointer())
                    out.append(slot.material)
    return out


# ---------------------------------------------------------------------------------------------- triangles
def lod_tris(rules, v):
    return {n: sum(S.tri_count(o) for o in S.render_meshes(rules, objs)) for n, objs in v.lods.items()}


def triangles(rules, family, model, report):
    c = report["triangles"]
    for a in model.assets:
        for v in a.variants.values():
            cls = rules["classes"][v.cls]
            if cls["tris"] is None:
                c.skip(f"class {v.cls} has no triangle budget")
                continue
            lo, hi = cls["tris"]
            t = lod_tris(rules, v)
            name = _vname(v)
            if 0 not in t:
                c.fail(name, "no LOD0")
                continue
            budget = f"the {v.cls} budget {_fmt(lo)}-{_fmt(hi)} ({_src(rules, v.cls)})"
            if t[0] > hi:
                c.fail(name, f"LOD0 has {_fmt(t[0])} triangles, over {budget}")
            elif t[0] < lo:
                c.fail(name, f"LOD0 has {_fmt(t[0])} triangles, under {budget}")
            else:
                c.ok(name, f"LOD0 {_fmt(t[0])} triangles within {budget}")
    if not model.assets:
        c.skip("no assets")


# ---------------------------------------------------------------------------------------------- LODs
def lods(rules, family, model, report):
    c = report["lods"]
    ratio = rules["lod"]["lastMaxRatio"]
    for a in model.assets:
        for v in a.variants.values():
            want = rules["classes"][v.cls]["lods"]
            name = _vname(v)
            if want == 0:
                c.skip(f"class {v.cls} has no LODs")
                continue
            have = sorted(v.lods)
            beyond = [n for n in have if n >= want]
            if beyond:
                c.fail(name, f"LOD{beyond[0]} is beyond the {want} LOD(s) class {v.cls} uses")
            if want == 1:
                if v.implicit or have == [0]:
                    c.ok(name, f"class {v.cls} uses one LOD ({rules['classes'][v.cls]['why']})")
                continue
            generated = v.implicit or have == [0]
            if generated:
                if model.mode == "source":
                    c.info(name, f"no hand-made LODs: the export generates LOD1-LOD{want - 1} by decimation")
                    c.ok(name, f"LOD1-LOD{want - 1} generated at export")
                elif v.implicit:
                    c.fail(name, f"1 of {want} LODs: no {v.id}_LOD0..{v.id}_LOD{want - 1} nodes (DESIGN 19.2: four LODs per asset)")
                else:
                    c.fail(name, f"1 of {want} LODs: only {v.id}_LOD0 (DESIGN 19.2: four LODs per asset)")
                continue
            missing = [n for n in range(want) if n not in v.lods]
            if missing:
                tail = " (hand-make all of them, or only LOD0 and let the export generate the rest)" if model.mode == "source" else ""
                c.fail(name, f"{len([n for n in have if n < want])} of {want} LODs: missing {', '.join(f'LOD{n}' for n in missing)}{tail}")
                continue
            t = lod_tris(rules, v)
            ok = True
            for n in range(1, want):
                if t[n] == 0:
                    c.fail(name, f"LOD{n} has no geometry")
                    ok = False
                elif t[n] >= t[n - 1]:
                    c.fail(name, f"LOD{n} ({_fmt(t[n])}) is not lighter than LOD{n - 1} ({_fmt(t[n - 1])})")
                    ok = False
            last = want - 1
            if t[0] and t[last] / t[0] >= ratio:
                c.fail(name, f"LOD{last} is {t[last] / t[0]:.1%} of LOD0 ({_fmt(t[last])} of {_fmt(t[0])}); must be under {ratio:.0%} (DESIGN 19.2)")
                ok = False
            if ok:
                c.ok(name, " > ".join(_fmt(t[n]) for n in range(want)) + f" triangles; LOD{last} {t[last] / max(t[0], 1):.1%} of LOD0")
    if not model.assets:
        c.skip("no assets")


# ---------------------------------------------------------------------------------------------- materials
def material_set(rules, family, model, report):
    c = report["materials"]
    users = {}  # material pointer -> (material, [variants])
    for a in model.assets:
        for v in a.variants.values():
            for m in _materials_of(rules, v):
                users.setdefault(m.as_pointer(), (m, []))[1].append(v)
            for n in sorted(v.lods):
                for o in S.render_meshes(rules, v.lods[n]):
                    if not o.material_slots or any(s.material is None for s in o.material_slots):
                        c.fail(S.name_of(o, model.mode), "mesh has an empty material slot")
    lib_cls = rules["families"]["library"]["class"]
    if family == "library":
        for m in bpy.data.materials:
            if m.users and m.as_pointer() not in users and not m.is_grease_pencil:
                users[m.as_pointer()] = (m, [])
    if not users:
        c.skip("no materials")
        return
    infos = {}
    for key, (m, vs) in sorted(users.items(), key=lambda kv: kv[1][0].name):
        cls = max((v.cls for v in vs), key=lambda k: rules["classes"][k]["texture"]) if vs else lib_cls
        info = M.MaterialInfo(m)
        infos[key] = info
        meshes = [o for v in vs for n in sorted(v.lods) for o in S.render_meshes(rules, v.lods[n])]
        _check_material(rules, family, model, c, info, cls, meshes)
    # UV maps: textured materials need them, and so does every material whose AO the export bakes
    for a in model.assets:
        for v in a.variants.values():
            for n in sorted(v.lods):
                for o in S.render_meshes(rules, v.lods[n]):
                    textured = any(s.material and _needs_uvs(rules, family, v.cls, infos.get(s.material.as_pointer())) for s in o.material_slots)
                    if textured and not o.data.uv_layers:
                        c.fail(S.name_of(o, model.mode), "mesh has no UV map, which its material's texture maps (and the baked AO) need")


def _needs_uvs(rules, family, cls, info):
    if info is None:
        return False
    if any(ch.textured() for ch in info.channels.values()):
        return True
    return "occlusion" in rules["materialProfiles"][profile_of(rules, family, cls, info.mat)]["maps"]


def profile_of(rules, family, cls, mat):
    return R.profile_for(rules, family, cls, R.material_name(mat), R.strip(mat.name))


def ao_to_bake(rules, family, cls, info):
    """True when the export must bake AO for this material: its profile needs AO and no AO map is painted or wired."""
    profile = rules["materialProfiles"][profile_of(rules, family, cls, info.mat)]
    return "occlusion" in profile["maps"] and info.channels["occlusion"].kind == "constant"


def _check_material(rules, family, model, c, info, cls, meshes=()):
    m = info.mat
    name = R.material_name(m)
    if name != R.strip(m.name):
        name = f"{name} ({m.name})"
    profile_name = profile_of(rules, family, cls, m)
    profile = rules["materialProfiles"][profile_name]
    res = rules["classes"][cls]["texture"]
    source = model.mode == "source"
    if info.problem:
        c.fail(name, info.problem)
        return
    ch = info.channels
    if profile.get("mustEmit") and not info.emitting:
        c.fail(name, f"{profile_name} material emits nothing: the engine scales its glow but takes the colour from the model")
        return
    needed = list(profile["maps"]) + (["emissive"] if profile["emissiveMap"] and info.emitting else [])
    if not needed:
        c.ok(name, f"{profile_name} material ({profile['why']})")
        return
    images = info.images()
    textured = [k for k, x in ch.items() if x.textured()]
    if not textured:
        base = ch["baseColor"]
        what = "vertex colours only" if base.kind == "attribute" else f"uniform colour {_rgb(base.value)}"
        maps = [M.LABELS[k] for k in needed if not (source and k == "occlusion")]
        c.fail(name, f"untextured ({what}); missing maps: {', '.join(maps) or 'none'}")
        return
    missing, notes = [], []
    for k in needed:
        x = ch[k]
        if x.kind == "image":
            continue
        if x.kind == "procedural":
            if source:
                notes.append(M.LABELS[k])
            else:
                missing.append(f"{M.LABELS[k]} (procedural)")
            continue
        if k == "metallic" and x.kind == "constant" and ch["roughness"].textured():
            continue  # glTF packs metallic with roughness: a constant metallic becomes the map's factor
        if k == "occlusion" and source:
            notes.append("AO (baked from the geometry)")
            continue
        if k == "emissive":
            missing.append(f"emissive (emits a uniform {_rgb(x.value)})")
        elif x.kind == "attribute":
            missing.append(f"{M.LABELS[k]} (vertex attribute, not a map)")
        else:
            missing.append(M.LABELS[k] + (f" (constant {_rgb(x.value)})" if x.value is not None else ""))
    if missing:
        c.fail(name, "missing maps: " + ", ".join(missing))
    if notes:
        c.info(name, "baked at export: " + ", ".join(notes))
    # the images themselves
    for img, used in images:
        label = "/".join(M.LABELS[k] for k in used)
        if M.image_missing(img):
            c.fail(name, f"image {img.name} ({label}) has no pixels (missing file?)")
            continue
        w, h = img.size
        if max(w, h) > res:
            c.fail(name, f"{label} map {img.name} is {w}x{h}; class {cls} textures are at most {res} px (DESIGN 19.2)")
        elif "baseColor" in used and max(w, h) < res // 2:
            c.warn(name, f"{label} map {img.name} is {w}x{h}; class {cls} targets {res} px")
        if w & (w - 1) or h & (h - 1):
            c.warn(name, f"{label} map {img.name} is {w}x{h}, not a power of two")
    uvs = M.surface_uvs(m, meshes) if meshes else None  # only the texels the surface shows
    for k in ("baseColor", "roughness", "normal", "occlusion", "emissive"):
        x = ch[k]
        if x.kind != "image" or k not in needed:
            continue
        std = M.channel_std(x.image, x.index, uvs, tag=m.as_pointer())
        if std is not None and std < M.UNIFORM_STD:
            where = "under the surface's UVs" if uvs is not None else "over the image"
            msg = f"{M.LABELS[k]} map {x.image.name} is uniform {where} (std {std:.4f} < {M.UNIFORM_STD:.4f}): paint or bake real detail"
            (c.fail if k in ("baseColor", "roughness", "normal") else c.warn)(name, msg)
    if not missing:
        c.ok(name, f"{profile_name}: " + (", ".join(M.LABELS[k] for k in textured) or "constants"))


# ---------------------------------------------------------------------------------------------- textures (export)
def textures(rules, family, model, report, path, compressed, legacy=False):
    """An export's textures (P1.E14.T12), reported under the materials check: when `compressed`, every map a material
    uses must be KTX2 Basis Universal behind KHR_texture_basisu with a full mip chain, normal maps in UASTC, colour maps
    sRGB and data maps linear; and each variant's maps must fit its class's GPU memory budget (families.json
    gpuTextureMB) once transcoded. Returns {variant id: GPU bytes} for the summary."""
    c = report["materials"]
    try:
        images, required = ktx.inspect(path)
    except Exception as e:  # a .glb the importer read but whose images cannot be parsed
        c.fail(Path(path).name, f"cannot read its images: {e}")
        return {}
    by_name = {im["name"]: im for im in images}
    s = ktx.settings(rules, family)
    if legacy:
        c.info("textures", "a demo export: exempt from texture compression until its family is rebuilt")
    elif not compressed:
        c.info("textures", "PNG textures: this family (families.json textures.compress) or this export keeps them uncompressed")
    else:
        bad = 0
        for im in images:
            name, slots, h = im["name"], im["slots"], im["ktx"]
            label = "/".join(slots)
            if im["mime"] != ktx.KTX2 or h is None:
                c.fail(name, f"{label} map is {im['mime'] or 'an unknown type'}, not KTX2 (Basis Universal); re-export with `pnpm art:export -- {family}`")
                bad += 1
                continue
            if not im["basisu"]:
                c.fail(name, f"{label} map is KTX2 but its texture does not reach it through {ktx.EXT}")
                bad += 1
            if h["codec"] is None:
                c.fail(name, f"{label} map is KTX2 but not Basis Universal (ETC1S or UASTC), which is all the client transcodes")
                bad += 1
                continue
            want = ktx.CODECS[ktx.codec_for(slots, s)]
            if "normal" in slots and h["codec"] != "UASTC":
                c.fail(name, f"normal map in {h['codec']}: normal maps are UASTC (ETC1S bands their gradients)")
                bad += 1
            elif h["codec"] != want:
                c.warn(name, f"{label} map in {h['codec']}; families.json asks for {want}")
            if not h["fullChain"]:
                full = int(np.floor(np.log2(max(h["width"], h["height"], 1)))) + 1
                c.fail(name, f"{label} map has {h['levels']} mip level(s) of the {full} a {h['width']}x{h['height']} map needs")
                bad += 1
            colour = bool(set(slots) & ktx.COLOUR)
            if colour != h["srgb"]:
                c.fail(name, f"{label} map is stored {'sRGB' if h['srgb'] else 'linear'}; {'colour maps are sRGB' if colour else 'data maps are linear'}")
                bad += 1
        if any(im["basisu"] for im in images) and ktx.EXT not in required:
            c.fail(Path(path).name, f"{ktx.EXT} is not in extensionsRequired (the textures have no PNG fallback)")
            bad += 1
        if images and not bad:
            n = {k: sum(1 for im in images if im["ktx"] and im["ktx"]["codec"] == k) for k in ("UASTC", "ETC1S")}
            mb = sum(im["bytes"] for im in images) / 1e6
            c.ok("textures", f"{len(images)} KTX2 map(s) ({n['UASTC']} UASTC, {n['ETC1S']} ETC1S) with full mip chains, {mb:.1f} MB")
    # GPU memory: each variant's maps (every LOD) once transcoded
    gpu = {}
    for a in model.assets:
        for v in a.variants.values():
            seen, total = set(), 0
            for m in _materials_of(rules, v):
                for img, _used in M.MaterialInfo(m).images():
                    im = by_name.get(img.name) or by_name.get(R.strip(img.name))
                    key = im["index"] if im else img.name
                    if key in seen:
                        continue
                    seen.add(key)
                    h = im["ktx"] if im else None
                    w, hh = (h["width"], h["height"]) if h else tuple(img.size)
                    total += ktx.gpu_bytes(w, hh, compressed=h is not None)
            gpu[v.id] = total
            budget = rules["classes"][v.cls].get("gpuTextureMB")
            if budget is None or not total:
                continue
            msg = f"textures take {total / 2**20:.0f} MB of GPU memory once transcoded (8 bits a texel compressed, 32 uncompressed, mips included)"
            if total > budget * 2**20:
                c.fail(_vname(v), f"{msg}, over the {v.cls} budget of {budget} MB (families.json gpuTextureMB)")
            else:
                c.ok(_vname(v), f"{msg}, within the {v.cls} budget of {budget} MB")
    return gpu


def _rgb(v):
    if v is None:
        return "-"
    if isinstance(v, tuple):
        return "(" + ", ".join(f"{x:.2f}" for x in v[:3]) + ")"
    return f"{v:.2f}"


# ---------------------------------------------------------------------------------------------- scale references
def scale(rules, family, model, report, source=None):
    c = report["scale"]
    ref = rules["reference"]
    if model.mode == "source":
        us = bpy.context.scene.unit_settings
        if us.system != "METRIC" or abs(us.scale_length - 1.0) > 1e-6:
            c.fail("scene", f"units must be metric at scale 1.0 (found {us.system}, {us.scale_length}); 1 Blender unit = 1 m")
        _source_refs(rules, model, c)
    else:
        if source is not None and Path(source).exists():
            c.ok("source", f"{R.rel(source)} holds the 1 m grid and 1.85 m biped (validated with the source)")
        else:
            where = R.rel(source) if source else "assets/blend/<family>/<name>.blend"
            c.fail("source", f"no source .blend at {where}: the 1 m grid and {ref['biped']['height']} m biped references cannot be checked (DESIGN 19.1: the .blend is the source of truth)")
    for a in model.assets:
        for v in a.variants.values():
            _size(rules, family, model, c, v)
            for o in [o for n in sorted(v.lods) for o in S.render_meshes(rules, v.lods[n])]:
                for fit in ref.get("fits", []):
                    if R.match(S.name_of(o, model.mode), fit["pattern"], ci=True):
                        b = S.bounds([o])
                        if b is None:
                            continue
                        d = b[1] - b[0]
                        width = max(d[0], d[1])
                        if d[2] < fit["minHeight"] or width < fit["minWidth"]:
                            c.fail(S.name_of(o, model.mode), f"{width:.2f} x {d[2]:.2f} m; {fit['why']} (at least {fit['minWidth']} x {fit['minHeight']} m)")


def _size(rules, family, model, c, v):
    rule = R.size_rule(rules, family, v.cls)
    if not rule or 0 not in v.lods:
        return
    b = S.bounds(S.render_meshes(rules, v.lods[0]))
    if b is None:
        return
    d = b[1] - b[0]
    val = float(d.max()) if rule["axis"] == "max" else float(d["xyz".index(rule["axis"])])
    lo, hi = rule["range"]
    label = "longest side" if rule["axis"] == "max" else f"{rule['axis']} extent"
    name = _vname(v)
    if not lo <= val <= hi:
        c.fail(name, f"{label} {val:.2f} m is outside {lo}-{hi} m for class {v.cls} in {family}; check the scale against the 1 m grid")
    else:
        c.ok(name, f"{label} {val:.2f} m within {lo}-{hi} m")


def _source_refs(rules, model, c):
    ref = rules["reference"]
    coll_name = ref["collection"]
    coll = model.ref
    if coll is None:
        nested = bpy.data.collections.get(coll_name)
        if nested is not None:
            c.fail(coll_name, "the reference collection must be a top-level collection (not inside an asset)")
        else:
            c.fail(coll_name, f"no '{coll_name}' collection with the 1 m grid ({ref['grid']['pattern']}) and the {ref['biped']['height']} m biped ({ref['biped']['pattern']}) (DESIGN 19.2)")
        return
    objs = list(coll.all_objects)
    grids = [o for o in objs if R.match(o.name, ref["grid"]["pattern"])]
    bipeds = [o for o in objs if R.match(o.name, ref["biped"]["pattern"])]
    if not grids:
        c.fail(coll_name, f"no 1 m grid ({ref['grid']['pattern']}) in {coll_name}")
    for g in grids:
        sp = _grid_spacing(g)
        want, tol = ref["grid"]["spacing"], ref["grid"]["tolerance"]
        if sp is None:
            c.fail(g.name, "the grid reference must be a mesh with edges")
        elif abs(sp - want) > tol * want:
            c.fail(g.name, f"grid spacing is {sp:.3f} m, must be {want} m")
        else:
            c.ok(g.name, f"grid spacing {sp:.3f} m")
    if not bipeds:
        c.fail(coll_name, f"no {ref['biped']['height']} m biped ({ref['biped']['pattern']}) in {coll_name}")
    ground = float(grids[0].matrix_world.translation.z) if grids else 0.0
    for b in bipeds:
        box = S.bounds([o for o in S.subtree(b) if o.type == "MESH"])
        want, tol = ref["biped"]["height"], ref["biped"]["tolerance"]
        if box is None:
            c.fail(b.name, "the biped reference must be (or parent) a mesh")
            continue
        feet, top = float(box[0][2]), float(box[1][2])
        hgt = top - feet
        if abs(hgt - want) > tol or abs(feet - ground) > tol:
            c.fail(b.name, f"biped is {hgt:.3f} m tall (feet at z {feet:.3f}, top at z {top:.3f}); it must be {want} m standing on the grid plane (z {ground:.3f})")
        else:
            c.ok(b.name, f"biped {hgt:.3f} m tall, feet on the grid plane")
    asset_objs = {o.name for a in model.assets if a.holder is not None for o in a.holder.all_objects}
    for o in objs:
        if o.name in asset_objs:
            c.fail(o.name, f"reference object is also linked into an asset collection and would be exported")


def _grid_spacing(o):
    """Median edge length of the grid's own mesh in world space (modifiers such as Wireframe, which only give the lines
    thickness for the viewport, are ignored)."""
    if o.type != "MESH" or not o.data.edges:
        return None
    me = o.data
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    mw = np.array(o.matrix_world)
    co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    ev = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    return float(np.median(np.linalg.norm(co[ev[:, 0]] - co[ev[:, 1]], axis=1)))


# ---------------------------------------------------------------------------------------------- summary
def asset_summary(rules, model, gpu=None):
    """Per asset and variant: class, LODs and triangles, size, materials, and (for an export) the GPU memory its maps
    take once transcoded."""
    out = []
    for a in model.assets:
        vs = []
        for v in a.variants.values():
            b = S.bounds(S.render_meshes(rules, v.lods.get(0, [])))
            dims = [round(float(x), 3) for x in (b[1] - b[0])] if b else [0.0, 0.0, 0.0]
            vs.append(
                {
                    "id": v.id,
                    "class": v.cls,
                    "classFrom": v.class_from,
                    "lods": sorted(v.lods),
                    "lodTris": {str(n): t for n, t in sorted(lod_tris(rules, v).items())},
                    "implicitLods": v.implicit,
                    "dims": dims,
                    "materials": [R.strip(m.name) for m in _materials_of(rules, v)],
                }
            )
            if gpu is not None and v.id in gpu:
                vs[-1]["gpuTextureMB"] = round(gpu[v.id] / 2**20, 1)
        out.append({"asset": a.name, "variants": vs})
    return out
