"""Export saved T05 geometry through unchanged artlib, restoring exact float RGBA masks.

Blender 5.2 emits RGBA COLOR_0 as UNORM16. Four temporary FLOAT attributes carry
its authored bits through vertex splitting, then replace COLOR_0 before KTX2/meshopt.
No authoring module is imported and no .blend is saved.
"""

import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from artlib import core, export, glb, ktx, rules
from export_transaction import export_transaction
from receipts import DEFAULT_EVIDENCE, ROOT

_original_write = export._write
_original_encode_args = ktx.encode_args


def cpu_encode_args(tool, src, dst, codec, srgb, normal, channels, settings, threads):
    return _original_encode_args(
        tool, src, dst, codec, srgb, normal, channels, settings, 2
    )


def restore_float_masks(path):
    doc, raw = glb.read(path)
    data = bytearray(raw)
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            components = []
            for suffix in "RGBA":
                key = "_T05_MASK_" + suffix
                if key not in attrs:
                    raise RuntimeError(
                        f"{mesh['name']}: missing lossless mask carrier {key}"
                    )
                acc = doc["accessors"][attrs.pop(key)]
                if (
                    acc["componentType"] != 5126
                    or acc["type"] != "SCALAR"
                    or acc.get("normalized")
                ):
                    raise RuntimeError("Mask carrier is not FLOAT SCALAR")
                view = doc["bufferViews"][acc["bufferView"]]
                offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
                stride = view.get("byteStride", 4)
                components.append(
                    [
                        struct.unpack_from("<f", raw, offset + i * stride)[0]
                        for i in range(acc["count"])
                    ]
                )
            values = np.stack(components, axis=1).astype("<f4")
            if (
                not np.isfinite(values).all()
                or (values < 0).any()
                or (values > 1).any()
                or not np.allclose(values[:, :3].sum(1), 1, atol=2e-6)
            ):
                raise RuntimeError("Invalid authored colour-region mask")
            data.extend(b"\0" * ((-len(data)) % 4))
            offset = len(data)
            payload = values.tobytes()
            data.extend(payload)
            vi = len(doc["bufferViews"])
            doc["bufferViews"].append(
                {
                    "buffer": 0,
                    "byteOffset": offset,
                    "byteLength": len(payload),
                    "target": 34962,
                }
            )
            ai = len(doc["accessors"])
            doc["accessors"].append(
                {
                    "bufferView": vi,
                    "componentType": 5126,
                    "count": len(values),
                    "type": "VEC4",
                }
            )
            attrs["COLOR_0"] = ai
    doc["buffers"][0]["byteLength"] = len(data)
    glb.write(path, doc, data)


def write_exact(roots, path):
    for root in roots:
        for ob in [root, *root.children_recursive]:
            if ob.type != "MESH":
                continue
            me = ob.data
            mask = me.color_attributes.active_color
            if (
                mask is None
                or mask.data_type != "FLOAT_COLOR"
                or mask.domain != "POINT"
            ):
                raise RuntimeError(f"{ob.name}: expected POINT FLOAT_COLOR saved mask")
            rgba = np.empty(len(mask.data) * 4, dtype=np.float32)
            mask.data.foreach_get("color", rgba)
            rgba = rgba.reshape(-1, 4)
            for i, suffix in enumerate("RGBA"):
                att = me.attributes.new("_t05_mask_" + suffix, "FLOAT", "POINT")
                att.data.foreach_set("value", rgba[:, i])
    _original_write(roots, path)
    restore_float_masks(path)


def main(argv):
    args = export.parse(argv)
    if args.only or args.compress is False:
        raise ValueError(
            "T05 exports the fixed complete source set with required compression"
        )
    export._write = write_exact
    ktx.encode_args = cpu_encode_args
    extra = []
    if args.bake_res:
        extra += ["--bake-res", str(args.bake_res)]
    if args.verbose:
        extra += ["--verbose"]
    if args.quiet:
        extra += ["--quiet"]
    # Stock validation is mandatory. The old local tracer is deliberately not installed.
    return export_transaction(
        Path(args.src_root) if args.src_root else ROOT / "assets/blend",
        Path(args.out_dir) if args.out_dir else ROOT / "packages/client/public/models",
        Path(args.report_dir) if args.report_dir else DEFAULT_EVIDENCE / "export",
        export.main,
        lambda path: core.validate_path(rules.load(), path, family="flora"),
        extra,
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []))
