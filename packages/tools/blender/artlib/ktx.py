"""KTX2 (Basis Universal) textures in exported .glb files (P1.E14.T12).

The export writes PNG textures with Blender's glTF exporter, then `compress()` rewrites the .glb: every texture a material
uses becomes a KTX2 image with a full mip chain behind `KHR_texture_basisu` (no PNG fallback), normal and other data
maps in UASTC (rate-distortion optimised, Zstandard), colour and AO in ETC1S (BasisLZ); byte-identical images are
stored once. Blender's glTF importer cannot read KTX2, so the validator imports `decoded_copy()` (the same .glb with each
KTX2 image transcoded back to PNG: what the client sees, not the PNG before encoding) and checks the KTX2 images
themselves with `inspect()`.

The encoder is Khronos' KTX-Software `ktx` tool, pinned to one release: `pnpm art:*` fetches it into
node_modules/.cache/ktx-software-<version>/ (packages/tools/src/art/ktx.ts); KTX in the environment overrides it.
"""
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import glb
from . import rules as R

VERSION = "4.4.2"
EXT = "KHR_texture_basisu"
KTX2 = "image/ktx2"
MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"
MODELS = {163: "ETC1S", 166: "UASTC"}  # KHR_DF_MODEL_ETC1S, KHR_DF_MODEL_UASTC
CODECS = {"etc1s": "ETC1S", "uastc": "UASTC"}
SCHEMES = {0: "none", 1: "BasisLZ", 2: "Zstandard", 3: "ZLIB"}
TRANSFER_SRGB = 2
# sRGB slots (the core's colour maps, and the extensions' colour textures); every other slot is linear data
COLOUR = {"baseColor", "emissive", "sheenColor", "specularColor"}
SLOTS = {
    "baseColorTexture": "baseColor",
    "metallicRoughnessTexture": "metallicRoughness",
    "normalTexture": "normal",
    "occlusionTexture": "occlusion",
    "emissiveTexture": "emissive",
}
# textures inside material extensions that hold colour (KHR_materials_sheen, KHR_materials_specular); other extension
# textures are slot "other" (data)
EXTENSION_COLOUR = {"sheenColorTexture": "sheenColor", "specularColorTexture": "specularColor"}
PNG_CHANNELS = {0: 1, 2: 3, 3: 4, 4: 2, 6: 4}  # PNG colour type -> channels (a palette may carry alpha)
SOURCE_SUFFIX = {"png": ".png", "jpeg": ".jpg"}
FORMATS = {1: "R8G8B8", 2: "R8G8B8A8", 3: "R8G8B8", 4: "R8G8B8A8"}  # never one- or two-channel: glTF reads .g and .b


class KtxError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------- the tool
def binary():
    """The `ktx` tool: KTX, else the pinned release `pnpm art:*` fetched into node_modules/.cache."""
    env = os.environ.get("KTX")
    if env:
        return env
    fetched = R.REPO / "node_modules" / ".cache" / f"ktx-software-{VERSION}" / "bin" / "ktx"
    if fetched.exists():
        return str(fetched)
    raise KtxError(
        f"no ktx tool (KTX-Software {VERSION}) at {R.rel(fetched)}: run the export through `pnpm art:export` (or "
        "`pnpm art:test`), which fetches it, or set KTX to a ktx binary"
    )


def _run(args):
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()[-6:]
        raise KtxError(f"{Path(args[0]).name} {args[1]} failed ({p.returncode}): " + " | ".join(tail))
    return p.stdout


def jobs():
    """Encodes run side by side (each `ktx create` keeps only one or two cores busy); ART_KTX_JOBS overrides."""
    if os.environ.get("ART_KTX_JOBS"):
        return max(1, int(os.environ["ART_KTX_JOBS"]))
    return max(1, min(6, (os.cpu_count() or 2) // 2))


# ---------------------------------------------------------------------------------------------- settings
def settings(rules, family):
    """The family's texture settings: families.json "textures", overridden by the family's own "textures"."""
    base = dict(rules.get("textures", {"compress": False}))
    base.update(rules["families"].get(family, {}).get("textures", {}))
    return base


def codec_for(slots, s):
    """'uastc' when any slot the image fills wants UASTC (a normal map shared as anything stays UASTC), else 'etc1s'."""
    table = s.get("codec", {})
    return "uastc" if any(table.get(sl, table.get("other", "uastc")) == "uastc" for sl in slots) else "etc1s"


# ---------------------------------------------------------------------------------------------- the glTF side
def _image_of(tex):
    src = tex.get("extensions", {}).get(EXT, {}).get("source")
    return tex.get("source") if src is None else src


def _texture_refs(material):
    """(slot, textureInfo) for every texture a material uses, extensions included (their colour textures as sheenColor
    and specularColor, the rest as slot 'other')."""
    pbr = material.get("pbrMetallicRoughness", {})
    out = [(SLOTS[k], pbr[k]) for k in ("baseColorTexture", "metallicRoughnessTexture") if k in pbr]
    out += [(SLOTS[k], material[k]) for k in ("normalTexture", "occlusionTexture", "emissiveTexture") if k in material]

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if isinstance(v, dict) and k.endswith("Texture") and "index" in v:
                    out.append((EXTENSION_COLOUR.get(k, "other"), v))
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(material.get("extensions", {}))
    return out


def image_slots(js):
    """{image index: set of slots} over every material's textures."""
    textures = js.get("textures", [])
    out = {}
    for m in js.get("materials", []):
        for slot, info in _texture_refs(m):
            i = info.get("index")
            if i is None or i >= len(textures):
                continue
            img = _image_of(textures[i])
            if img is not None:
                out.setdefault(img, set()).add(slot)
    return out


def _view_bytes(js, bin_data, view):
    bv = js["bufferViews"][view]
    if bv.get("buffer", 0) != 0:
        raise KtxError(f"buffer view {view} is not in the .glb's binary chunk")
    off = bv.get("byteOffset", 0)
    return bytes(bin_data[off : off + bv["byteLength"]])


def _append(js, bin_data, replace):
    """The binary chunk with each image view in `replace` ({view: bytes}) pointed at its new bytes, appended at the end:
    no other offset moves, so any layout survives (meshopt streams, fallback buffers). For throwaway copies only (the
    old bytes stay behind, unused)."""
    if not replace:
        return bin_data
    out = bytearray(bin_data)
    for view, data in replace.items():
        bv = js["bufferViews"][view]
        out += b"\0" * ((-len(out)) % 8)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
    js["buffers"][0]["byteLength"] = len(out)
    return bytes(out)


def _image_bytes(js, bin_data, i):
    im = js["images"][i]
    if "bufferView" not in im:
        raise KtxError(f"image {im.get('name', i)} is an external file ({im.get('uri', '?')}); exports embed their images")
    return _view_bytes(js, bin_data, im["bufferView"])


def _repack(js, bin_data, replace):
    """Rebuilds the binary chunk from the buffer views still referenced (accessors, sparse accessors, images), each
    from `replace[view]` when given; drops the rest and renumbers. Returns the new binary chunk."""
    if len(js.get("buffers", [])) > 1 or any(bv.get("buffer", 0) != 0 for bv in js.get("bufferViews", [])):
        raise KtxError("the .glb has more than one buffer; Blender writes one")
    refs = []  # (dict, key) holding a buffer view index
    for a in js.get("accessors", []):
        if "bufferView" in a:
            refs.append((a, "bufferView"))
        for part in ("indices", "values"):
            if part in a.get("sparse", {}):
                refs.append((a["sparse"][part], "bufferView"))
    for im in js.get("images", []):
        if "bufferView" in im:
            refs.append((im, "bufferView"))
    known = {id(d) for d, _ in refs}

    def stray(x, where):
        if isinstance(x, dict):
            if "bufferView" in x and id(x) not in known:
                raise KtxError(f"a buffer view is referenced from {where}, which the texture rewrite does not know")
            for k, v in x.items():
                stray(v, f"{where}/{k}")
        elif isinstance(x, list):
            for n, v in enumerate(x):
                stray(v, f"{where}/{n}")

    stray({k: v for k, v in js.items() if k not in ("bufferViews", "buffers")}, "")
    views = js.get("bufferViews", [])
    keep = sorted({d[k] for d, k in refs})
    out = bytearray()
    remap, new_views = {}, []
    for old in keep:
        bv = dict(views[old])
        data = replace[old] if old in replace else _view_bytes(js, bin_data, old)
        out += b"\0" * ((-len(out)) % 8)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(data)
        out += data
        remap[old] = len(new_views)
        new_views.append(bv)
    for d, k in refs:
        d[k] = remap[d[k]]
    js["bufferViews"] = new_views
    if new_views:
        js.setdefault("buffers", [{}])
        js["buffers"][0]["byteLength"] = len(out)
    return bytes(out)


def _set_extension(js, used):
    for key in ("extensionsUsed", "extensionsRequired"):
        names = [n for n in js.get(key, []) if n != EXT] + ([EXT] if used else [])
        if names:
            js[key] = names
        else:
            js.pop(key, None)


def _drop_images(js, unused):
    """Removes the images in `unused` (no texture points at them any more) and renumbers the textures' sources."""
    if not unused:
        return
    remap, kept = {}, []
    for i, im in enumerate(js.get("images", [])):
        if i not in unused:
            remap[i] = len(kept)
            kept.append(im)
    js["images"] = kept
    for t in js.get("textures", []):
        if "source" in t:
            t["source"] = remap[t["source"]]
        ext = t.get("extensions", {}).get(EXT)
        if ext is not None:
            ext["source"] = remap[ext["source"]]


# ---------------------------------------------------------------------------------------------- KTX2 headers
def png_channels(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return PNG_CHANNELS.get(data[25])


def jpeg_channels(data):
    """Components of a JPEG (1 grey, 3 colour), read from its start-of-frame segment; None when `data` is not one
    (or is CMYK, which no map should be)."""
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # markers without a length
            i += 2
            continue
        length = struct.unpack_from(">H", data, i + 2)[0]
        # SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            n = data[i + 9] if i + 9 < len(data) else None
            return n if n in (1, 3) else None
        if marker == 0xDA:  # start of scan before any frame header
            return None
        i += 2 + length
    return None


def source_image(data):
    """('png' | 'jpeg', channels) of an image Blender wrote, or None for anything else."""
    n = png_channels(data)
    if n is not None:
        return "png", n
    n = jpeg_channels(data)
    return ("jpeg", n) if n is not None else None


def header(data):
    """The facts the validator needs from a KTX2 file, or None when `data` is not one."""
    if len(data) < 80 or data[:12] != MAGIC:
        return None
    vk, _type, w, h, _d, _layers, _faces, levels, scheme = struct.unpack_from("<9I", data, 12)
    dfd_off, _dfd_len = struct.unpack_from("<II", data, 48)
    model = transfer = None
    if dfd_off + 16 <= len(data):
        model, _primaries, transfer = data[dfd_off + 12], data[dfd_off + 13], data[dfd_off + 14]
    return {
        "vkFormat": vk,
        "width": w,
        "height": h,
        "levels": max(1, levels),
        "fullChain": levels == math.floor(math.log2(max(w, h, 1))) + 1,
        "supercompression": SCHEMES.get(scheme, str(scheme)),
        "codec": MODELS.get(model),
        "srgb": transfer == TRANSFER_SRGB,
    }


def gpu_bytes(width, height, compressed, mips=True):
    """GPU memory of one texture once uploaded: Basis transcodes to 4x4 blocks of 16 bytes at most (BC7, ASTC 4x4 and
    ETC2 RGBA: 8 bits a texel, the size we budget for), an uncompressed map is 4 bytes a texel; mips add their levels."""
    total, w, h = 0, max(1, width), max(1, height)
    while True:
        total += ((w + 3) // 4) * ((h + 3) // 4) * 16 if compressed else w * h * 4
        if not mips or (w == 1 and h == 1):
            return total
        w, h = max(1, w // 2), max(1, h // 2)


def inspect(path):
    """Every image a material uses: name, slots, mime type, whether it is reached through KHR_texture_basisu, and its
    KTX2 header (None for anything else). Returns (images, extensionsRequired)."""
    js, bin_data = glb.read(path)
    slots = image_slots(js)
    textures = js.get("textures", [])
    through_ext = {t.get("extensions", {}).get(EXT, {}).get("source") for t in textures} - {None}
    plain = {t["source"] for t in textures if "source" in t and EXT not in t.get("extensions", {})}
    out = []
    for i in sorted(slots):
        im = js["images"][i]
        data = _image_bytes(js, bin_data, i) if "bufferView" in im else b""
        out.append(
            {
                "index": i,
                "name": im.get("name") or f"image{i}",
                "slots": sorted(slots[i]),
                "mime": im.get("mimeType"),
                "basisu": i in through_ext and i not in plain,
                "ktx": header(data),
                "bytes": len(data),
            }
        )
    return out, list(js.get("extensionsRequired", []))


# ---------------------------------------------------------------------------------------------- encode
def encode_args(tool, src, dst, codec, srgb, normal, channels, s, threads):
    """`ktx create` for one map. The input's own transfer function is ignored (assigned, never converted), so the bytes
    Blender wrote are the bytes encoded: sRGB values for colour, raw values for data."""
    fmt = FORMATS.get(channels, "R8G8B8A8") + ("_SRGB" if srgb else "_UNORM")
    a = [tool, "create", "--format", fmt, "--assign-tf", "srgb" if srgb else "linear", "--generate-mipmap", "--threads", str(threads)]
    if codec == "uastc":
        u = s.get("uastc", {})
        a += ["--encode", "uastc", "--uastc-quality", str(u.get("quality", 2))]
        if u.get("rdoLambda"):
            a += ["--uastc-rdo", "--uastc-rdo-l", str(u["rdoLambda"])]
        if u.get("zstd"):
            a += ["--zstd", str(u["zstd"])]
    else:
        e = s.get("etc1s", {})
        a += ["--encode", "basis-lz", "--clevel", str(e.get("effort", 2)), "--qlevel", str(e.get("quality", 128))]
    if normal and not srgb:
        a.append("--normalize")  # every mip level holds unit normals, not the shortened average of the level above
    return a + [str(src), str(dst)]


def _split_mixed(js, slots):
    """An image used as colour by one material and as data by another (Blender writes one image for two of its images
    on the same file) becomes two: the data uses get a copy (its own image, buffer view and texture) to encode linear.
    Returns how many were split."""
    images, textures, views = js.get("images", []), js.get("textures", []), js.get("bufferViews", [])
    mixed = [i for i, sl in slots.items() if sl & COLOUR and sl - COLOUR and images[i].get("mimeType") != KTX2]
    clones = {}  # colour image -> its data copy's image index
    for i in mixed:
        im = dict(images[i], name=f"{images[i].get('name', f'image{i}')}_linear")
        if "bufferView" in im:
            views.append(dict(views[im["bufferView"]]))
            im["bufferView"] = len(views) - 1
        images.append(im)
        clones[i] = len(images) - 1
    texture_clone = {}
    for m in js.get("materials", []):
        for slot, info in _texture_refs(m):
            t = info.get("index")
            if slot in COLOUR or t is None or t >= len(textures) or _image_of(textures[t]) not in clones:
                continue
            if t not in texture_clone:
                copy = json.loads(json.dumps(textures[t]))
                copy["source"] = clones[_image_of(textures[t])]
                copy.get("extensions", {}).pop(EXT, None)
                textures.append(copy)
                texture_clone[t] = len(textures) - 1
            info["index"] = texture_clone[t]
    return len(mixed)


def compress(src, dst, s, log=print):
    """Writes `dst`: `src` with every material texture in KTX2 behind KHR_texture_basisu (see the module doc). Images
    already in KTX2 are kept; an image used as both colour and data is encoded twice (sRGB for the colour uses, linear for
    the data ones). Returns a summary dict."""
    js, bin_data = glb.read(src)
    split = _split_mixed(js, image_slots(js))
    slots = image_slots(js)
    images = js.get("images", [])
    # byte-identical images (a livery variant whose bakes of an unchanged material came out the same) are kept once, if
    # they are read the same way (the same bytes as a colour map and as a data map are two encodes)
    keeper, seen = {}, {}
    for i in sorted(slots):
        key = (hashlib.sha256(_image_bytes(js, bin_data, i)).hexdigest(), bool(slots[i] & COLOUR))
        if key in seen:
            keeper[i] = seen[key]
        else:
            seen[key] = i
    for t in js.get("textures", []):
        if t.get("source") in keeper:
            t["source"] = keeper[t["source"]]
    for i, k in keeper.items():
        slots[k] |= slots.pop(i)
    todo = []
    for i in sorted(slots):
        if images[i].get("mimeType") == KTX2:
            continue
        sl = slots[i]
        srgb = bool(sl & COLOUR)
        if srgb and sl - COLOUR:
            raise KtxError(f"image {images[i].get('name', i)} is both colour ({', '.join(sorted(sl & COLOUR))}) and data ({', '.join(sorted(sl - COLOUR))})")
        data = _image_bytes(js, bin_data, i)
        source = source_image(data)
        if source is None:
            raise KtxError(f"image {images[i].get('name', i)} is {images[i].get('mimeType', 'unknown')}; the export encodes PNG and JPEG (grey or colour)")
        todo.append((i, data, codec_for(sl, s), srgb, "normal" in sl, source))
    tool = binary() if todo else None
    n = jobs()
    threads = max(1, (os.cpu_count() or 2) // n)
    tmp = Path(tempfile.mkdtemp(prefix="art-ktx-"))
    replace = {}
    try:

        def one(job):
            i, data, codec, srgb, normal, (kind, channels) = job
            source, out = tmp / f"{i}{SOURCE_SUFFIX[kind]}", tmp / f"{i}.ktx2"
            source.write_bytes(data)
            _run(encode_args(tool, source, out, codec, srgb, normal, channels, s, threads))
            return i, out.read_bytes()

        with ThreadPoolExecutor(max_workers=n) as pool:
            for i, ktx2 in pool.map(one, todo):
                replace[images[i]["bufferView"]] = ktx2
                images[i]["mimeType"] = KTX2
                images[i].pop("uri", None)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for t in js.get("textures", []):
        src_i = t.get("source")
        if src_i is not None and images[src_i].get("mimeType") == KTX2:
            t.pop("source")
            t.setdefault("extensions", {})[EXT] = {"source": src_i}
    _drop_images(js, set(keeper))
    _set_extension(js, any(EXT in t.get("extensions", {}) for t in js.get("textures", [])))
    before = len(bin_data)
    out = _repack(js, bin_data, replace)
    glb.write(dst, js, out)
    summary = {
        "images": len(todo),
        "deduplicated": len(keeper),
        "split": split,
        "uastc": sum(1 for j in todo if j[2] == "uastc"),
        "etc1s": sum(1 for j in todo if j[2] == "etc1s"),
        "binBefore": before,
        "binAfter": len(out),
    }
    log(
        f"  compressed {summary['images']} texture(s) to KTX2 ({summary['uastc']} UASTC, {summary['etc1s']} ETC1S"
        + (f", {summary['deduplicated']} duplicate(s) stored once" if keeper else "")
        + (f", {split} shared by colour and data encoded twice" if split else "")
        + f"): {before / 1e6:.1f} -> {len(out) / 1e6:.1f} MB of buffers"
    )
    return summary


# ---------------------------------------------------------------------------------------------- decode
def is_compressed(path):
    js, _ = glb.read(path)
    return any(im.get("mimeType") == KTX2 for im in js.get("images", []))


def decoded_copy(src, dst):
    """Writes `dst`: `src` with each KTX2 image transcoded to an RGBA PNG (level 0) and KHR_texture_basisu removed, so
    Blender's importer (which cannot read KTX2) loads exactly the texels the client will show. The geometry is left as it
    is (meshopt-compressed or not: Blender's importer decodes EXT_meshopt_compression itself)."""
    js, bin_data = glb.read(src)
    images = js.get("images", [])
    todo = [i for i, im in enumerate(images) if im.get("mimeType") == KTX2]
    tool = binary() if todo else None
    tmp = Path(tempfile.mkdtemp(prefix="art-unktx-"))
    replace = {}
    try:

        def one(i):
            k, png = tmp / f"{i}.ktx2", tmp / f"{i}.png"
            k.write_bytes(_image_bytes(js, bin_data, i))
            _run([tool, "extract", "--transcode", "rgba8", str(k), str(png)])
            return i, png.read_bytes()

        with ThreadPoolExecutor(max_workers=max(2, jobs())) as pool:
            for i, png in pool.map(one, todo):
                replace[images[i]["bufferView"]] = png
                images[i]["mimeType"] = "image/png"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for t in js.get("textures", []):
        ext = t.get("extensions", {}).pop(EXT, None)
        if ext is not None:
            t["source"] = ext["source"]
        if "extensions" in t and not t["extensions"]:
            del t["extensions"]
    _set_extension(js, False)
    glb.write(dst, js, _append(js, bin_data, replace))
    return len(todo)
