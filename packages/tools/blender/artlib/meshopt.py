"""Geometry compression in exported .glb files (P1.E14.T12): EXT_meshopt_compression over KHR_mesh_quantization, both
required, applied after the KTX2 texture rewrite (artlib/ktx.py) by packages/tools/src/art/meshopt.ts (glTF-Transform's
meshopt() with meshoptimizer's encoder, pinned in packages/tools/package.json), run with Node: ART_NODE (which `pnpm
art:*` sets), else `node` on PATH. Blender's glTF importer decodes the result itself, so validation and the turntable read
it as they read any export; three's GLTFLoader decodes it with MeshoptDecoder.
"""
import json
import os
import shutil
import subprocess

from . import glb
from . import rules as R

EXT = "EXT_meshopt_compression"
QUANTIZATION = "KHR_mesh_quantization"
SCRIPT = R.BLENDER_DIR.parent / "src" / "art" / "meshopt.ts"


class MeshoptError(RuntimeError):
    pass


def settings(rules, family):
    """The family's geometry settings: families.json "geometry", overridden by the family's own "geometry"."""
    base = dict(rules.get("geometry", {"compress": False}))
    base.update(rules["families"].get(family, {}).get("geometry", {}))
    return base


def _command():
    node = os.environ.get("ART_NODE") or shutil.which("node")
    if not node:
        raise MeshoptError("no Node to run the geometry compression with: run the export through `pnpm art:export`, or set ART_NODE")
    tsx = R.REPO / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if not tsx.exists():
        raise MeshoptError(f"no tsx at {R.rel(tsx)}: run `pnpm install`")
    return [node, str(tsx), str(SCRIPT)]


def compress(src, dst, s, log=print):
    """Writes `dst`: `src` with its meshes reordered, quantized and meshopt-compressed at `s["level"]` (medium: no
    filters; high: octahedral normals and the like). Every marker, pivot and LOD node keeps its world transform (the
    script refuses otherwise). Returns the script's summary."""
    level = s.get("level", "high")
    p = subprocess.run(_command() + [str(src), str(dst), level], capture_output=True, text=True, cwd=str(R.REPO))
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()[-6:]
        raise MeshoptError(f"meshopt.ts failed ({p.returncode}): " + " | ".join(tail))
    summary = json.loads(p.stdout.strip().splitlines()[-1])
    log(
        f"  meshopt ({level}): geometry {summary['geometryBefore'] / 1e6:.1f} -> {summary['geometryAfter'] / 1e6:.1f} MB;"
        f" file {summary['bytesBefore'] / 1e6:.1f} -> {summary['bytesAfter'] / 1e6:.1f} MB"
    )
    return summary


def inspect(path):
    """(compressed, required, stream bytes, mesh count) of a .glb's geometry."""
    js, _ = glb.read(path)
    used, required = js.get("extensionsUsed", []), js.get("extensionsRequired", [])
    streams = sum(bv.get("extensions", {}).get(EXT, {}).get("byteLength", 0) for bv in js.get("bufferViews", []))
    return {
        "compressed": EXT in used,
        "required": EXT in required and (QUANTIZATION in required or QUANTIZATION not in used),
        "streams": streams,
        "meshes": len(js.get("meshes", [])),
    }
