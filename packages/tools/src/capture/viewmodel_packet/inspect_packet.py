"""CPU-only validation of a captured packet; this module never publishes acceptance."""

import argparse
from contextlib import contextmanager
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import sys
import zlib


PNG_CAP = 16 * 1024 * 1024
READOUT_CAP = 16384
VIEW_READOUT_CAP = 32768
METADATA_CAP = 65536
RESULT_CAP = 16384
PEOPLE = {"thalune", "ixari", "ulgani"}
SLOTS = {"map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"}
REVIEW_STILLS = [
    "noon-lush_lod0.png", "noon-lush_lod2.png", "wireframe_lod0.png",
    "wireframe_lod2.png", "overlay.png", "far_lod2.png",
    "night-exotic_lod0.png", "night-exotic_lod2.png",
    "open-space_lod0.png", "open-space_lod2.png",
]
POSES = ["neutral", "sway-left", "sway-right", "sway-up", "sway-down",
         "raise-0", "raise-0.4", "fire", "overheat", "underwater"]


class InspectionError(ValueError):
    """The primary failure and unmodified observations remain available to callers."""

    def __init__(self, message, evidence=None):
        super().__init__(message)
        self.evidence = evidence if evidence is not None else {}
        self.raw = self.evidence


def require(condition, message):
    if not condition:
        raise InspectionError(message)


def number(value, where):
    require(type(value) in (int, float), f"{where}: expected finite number")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    require(finite, f"{where}: expected finite number")
    return value


def integer(value, where):
    require(type(value) is int, f"{where}: expected integer")
    return value


def vector(value, length, where):
    require(type(value) is list and len(value) == length, f"{where}: expected {length}-vector")
    for part in value:
        number(part, where)
    return value


def dimensions(value, expected, where):
    vector(value, 2, where)
    require(all(type(v) is int for v in value) and value == list(expected), f"{where}: wrong dimensions")


def basename(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value))


@contextmanager
def directory(path):
    """Pin every directory component, refusing symlinks including ancestors."""
    path = Path(path)
    require(".." not in path.parts, "Parent traversal is forbidden")
    path = Path(os.path.abspath(path))
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:]:
            following = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = following
        yield fd
    finally:
        os.close(fd)


def bounded_read(fd, name, cap, expected=None):
    before = os.stat(name, dir_fd=fd, follow_symlinks=False)
    require(stat.S_ISREG(before.st_mode), f"{name}: not a regular file")
    require(0 < before.st_size <= cap, f"{name}: size exceeds cap or is empty")
    if expected is not None:
        require(before.st_size == expected, f"{name}: manifest size mismatch")
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        opened = os.fstat(handle)
        require(stat.S_ISREG(opened.st_mode) and 0 < opened.st_size <= cap, f"{name}: opened file is not capped/regular")
        require((before.st_dev, before.st_ino, before.st_size) ==
                (opened.st_dev, opened.st_ino, opened.st_size), f"{name}: changed before read")
        with os.fdopen(handle, "rb", closefd=False) as stream:
            raw = stream.read(cap + 1)
    finally:
        os.close(handle)
    require(len(raw) <= cap, f"{name}: grew beyond cap")
    require(len(raw) == before.st_size, f"{name}: size changed during read")
    return raw


def parse_json(raw, where):
    def pairs(items):
        obj = {}
        for key, value in items:
            require(key not in obj, f"{where}: duplicate JSON key {key}")
            obj[key] = value
        return obj

    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise InspectionError(f"{where}: invalid JSON: {exc}", {"rawText": raw.decode("utf-8", errors="replace")}) from exc
    return value


def finite_json(value, where):
    if isinstance(value, dict):
        for key, child in value.items():
            finite_json(child, f"{where}.{key}")
    elif isinstance(value, list):
        for child in value:
            finite_json(child, where)
    elif type(value) in (float, int):
        number(value, where)


def packet_files(spec):
    require(type(spec) is dict, "spec: expected object")
    kind, people = spec.get("kind"), spec.get("people")
    require(kind in ("review", "view", "return") and people in PEOPLE, "spec: invalid kind/people")
    expected_cap = VIEW_READOUT_CAP if kind == "view" else READOUT_CAP
    require(type(spec.get("readoutCap")) is int and spec["readoutCap"] == expected_cap, "spec: incorrect readoutCap")
    require(spec.get("id") == f"{kind}-{people}", "spec: invalid unit id")
    previous = None if kind == "review" else {"thalune": None, "ixari": "thalune", "ulgani": "ixari"}[people]
    if kind == "return":
        require(people == "thalune", "spec: only return-thalune is defined")
        previous = "ulgani"
    require("fromPeople" in spec and spec["fromPeople"] == previous, "spec: wrong fromPeople")
    if kind == "review":
        stills, readout = REVIEW_STILLS[:], "perf.json"
    else:
        stills = ["16x9-switch-gap.png", "16x9-switch-settled.png"] if previous else []
        if kind == "view":
            stills += [f"16x9-{pose}.png" for pose in POSES]
            stills += [f"21x9-{pose}.png" for pose in POSES if pose not in ("sway-right", "sway-up", "sway-down")]
        readout = "observations.json"
    names = stills + ["sheet.png", readout]
    files = spec.get("files")
    require(type(files) is list and all(basename(n) for n in files) and
            len(files) == len(names) and set(files) == set(names), "spec: incorrect file inventory")
    require(type(spec.get("pngCount")) is int and spec["pngCount"] == len(stills) + 1, "spec: incorrect pngCount")
    return stills, readout


def image_size(spec, name, stills):
    if name == "sheet.png":
        return (1920, 36 + math.ceil(len(stills) / 2) * (540 + 28)) if spec["kind"] == "review" else (1920, 48 + math.ceil(len(stills) / 4) * 294)
    return (2520 if name.startswith("21x9-") else 1920, 1080)


def decode_png(raw, expected, name):
    # Pillow alone does not require every CRC or a complete, single zlib stream.
    require(raw.startswith(b"\x89PNG\r\n\x1a\n"), f"{name}: invalid PNG signature")
    offset, chunks, ended = 8, 0, False
    palette, idat_ended, idats = False, False, []
    scanline_bytes = 0
    while offset < len(raw):
        require(chunks < 4096 and offset + 12 <= len(raw), f"{name}: malformed PNG chunks")
        length = struct.unpack_from(">I", raw, offset)[0]
        end = offset + 12 + length
        require(end <= len(raw), f"{name}: truncated PNG chunk")
        kind = raw[offset + 4:offset + 8]
        require(chunks != 0 or (kind == b"IHDR" and length == 13), f"{name}: missing PNG IHDR")
        require(all(65 <= byte <= 90 or 97 <= byte <= 122 for byte in kind) and
                65 <= kind[2] <= 90, f"{name}: invalid PNG chunk type")
        crc = zlib.crc32(memoryview(raw)[offset + 4:end - 4]) & 0xffffffff
        require(crc == struct.unpack_from(">I", raw, end - 4)[0], f"{name}: PNG CRC mismatch")
        require(kind not in (b"acTL", b"fcTL", b"fdAT"), f"{name}: animated PNG is forbidden")
        require(kind[0] & 32 or kind in (b"IHDR", b"PLTE", b"IDAT", b"IEND"),
                f"{name}: unknown critical PNG chunk {kind!r}")
        if kind == b"IHDR":
            require(chunks == 0, f"{name}: duplicate PNG IHDR")
            width, height, depth, color, compression, filtering, interlace = struct.unpack_from(">IIBBBBB", raw, offset + 8)
            require((width, height) == expected, f"{name}: wrong PNG dimensions: {(width, height)}, expected {expected}")
            require(color in (2, 6) and depth in (8, 16), f"{name}: expected RGB/RGBA PNG")
            require(compression == filtering == 0 and interlace in (0, 1), f"{name}: invalid PNG IHDR format")
            bits = (3 if color == 2 else 4) * depth
            passes = ([(0, 0, 1, 1)] if interlace == 0 else
                      [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
                       (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)])
            for x, y, dx, dy in passes:
                columns = max(0, (width - x + dx - 1) // dx)
                rows = max(0, (height - y + dy - 1) // dy)
                if columns and rows:
                    scanline_bytes += rows * (1 + (columns * bits + 7) // 8)
        elif kind == b"PLTE":
            require(not palette and not idats and 0 < length <= 768 and length % 3 == 0,
                    f"{name}: invalid/duplicate/late PNG PLTE")
            palette = True
        elif kind == b"IDAT":
            require(not idat_ended, f"{name}: nonconsecutive PNG IDAT")
            idats.append(memoryview(raw)[offset + 8:end - 4])
        if idats and kind != b"IDAT":
            idat_ended = True
        chunks += 1
        offset = end
        if kind == b"IEND":
            require(length == 0 and offset == len(raw), f"{name}: data after PNG end")
            ended = True
            break
    require(ended, f"{name}: missing PNG end")
    require(idats, f"{name}: missing PNG IDAT")
    stream, inflated = zlib.decompressobj(), 0
    for data in idats:
        while True:
            limit = min(65536, scanline_bytes - inflated + 1)
            try:
                block = stream.decompress(data, limit)
            except zlib.error as exc:
                raise OSError(f"{name}: invalid PNG zlib stream: {exc}") from exc
            inflated += len(block)
            require(inflated <= scanline_bytes, f"{name}: wrong PNG scanline byte count")
            require(not stream.unused_data, f"{name}: extra PNG zlib stream/data")
            data = stream.unconsumed_tail
            if not data and len(block) < limit:
                break
    require(stream.eof, f"{name}: incomplete PNG zlib stream")
    require(inflated == scanline_bytes, f"{name}: wrong PNG scanline byte count")
    from PIL import Image

    with Image.open(io.BytesIO(raw), formats=["PNG"]) as decoded:
        require(decoded.format == "PNG" and decoded.mode in ("RGB", "RGBA"), f"{name}: expected RGB/RGBA PNG")
        require(decoded.size == expected, f"{name}: wrong PNG dimensions: {decoded.size}, expected {expected}")
        decoded.load()


def material_names(people):
    return {"Skin", f"VM_{people}_Tool"} | ({"Bio"} if people != "ulgani" else set())


def materials(value, people, where):
    expected = material_names(people)
    require(type(value) is list and len(value) == len(expected), f"{where}: incorrect materials")
    seen = set()
    for material in value:
        require(type(material) is dict, f"{where}: material must be an object")
        name = material.get("name")
        require(isinstance(name, str) and name in expected and name not in seen, f"{where}: wrong/duplicate material name")
        seen.add(name)
        slots = material.get("slots")
        required = SLOTS | ({"emissiveMap"} if name != "Skin" else set())
        require(type(slots) is dict and required <= slots.keys(), f"{where}.{name}: missing texture slots")
        for slot, facts in slots.items():
            vector(facts, 3, f"{where}.{name}.{slot}")
            require(all(type(n) is int for n in facts) and facts == [2048, 2048, 12], f"{where}.{name}.{slot}: requires 2048x2048 with 12 mips")


def projection(value, viewport, where):
    require(type(value) is dict, f"{where}: missing projection")
    for name in ("view", "world", "beam", "viewMuzzle", "worldMuzzle"):
        vector(value.get(name), 3, f"{where}.{name}")
    for name in ("viewCamera", "worldCamera"):
        camera = value.get(name)
        require(type(camera) is dict, f"{where}.{name}: missing camera")
        for key in ("fov", "aspect", "near", "far"):
            number(camera.get(key), f"{where}.{name}.{key}")
        require(0 < camera["fov"] < 180 and 0 < camera["near"] < camera["far"], f"{where}.{name}: invalid camera frustum")
        require(camera["aspect"] == viewport[0] / viewport[1], f"{where}.{name}: viewport aspect mismatch")
    for axis in (0, 1):
        coords = [value[name][axis] for name in ("view", "world", "beam")]
        require(max(coords) - min(coords) <= 1e-5, f"{where}: view/world/beam projection misaligned")


def observations(value, spec, stills):
    require(type(value) is dict, "observations: expected object")
    require(type(value.get("version")) is int and value["version"] == 1, "observations: invalid version")
    for field in ("people", "fromPeople"):
        require(field in value and value[field] == spec[field], f"observations: wrong {field}")
    require(value.get("unit") == spec["id"] and value.get("fixture") == "offline-dev-first-person", "observations: wrong unit/fixture")
    require(value.get("serverAuthority") is False and value.get("errors") == [], "observations: server authority or capture errors")
    incoming = value.get("incoming")
    require(type(incoming) is dict and incoming.get("people") == (spec["fromPeople"] or spec["people"]) and
            incoming.get("visible") is True and incoming.get("modelAttached") is True, "observations: incoming people never visible/attached")
    materials(incoming.get("materials"), incoming["people"], "observations.incoming")
    frames = value.get("frames")
    require(type(frames) is list and len(frames) == len(stills), "observations: wrong frame count")
    last_frame, last_elapsed = -1, 0
    previous = None
    for entry, filename in zip(frames, stills):
        require(type(entry) is dict and entry.get("file") == filename, "observations: wrong frame inventory/order")
        require(entry.get("people") == spec["people"], f"{filename}: wrong people")
        size = image_size(spec, filename, stills)
        dimensions(entry.get("viewport"), size, f"{filename}.viewport")
        dimensions(entry.get("canvas"), size, f"{filename}.canvas")
        frame = integer(entry.get("frame"), f"{filename}.frame")
        dt = number(entry.get("dt"), f"{filename}.dt")
        elapsed = number(entry.get("elapsed"), f"{filename}.elapsed")
        require(frame > last_frame and dt >= 0 and elapsed >= last_elapsed and elapsed - last_elapsed + 1e-8 >= dt,
                f"{filename}: contradictory frame/time sequence")
        last_frame, last_elapsed = frame, elapsed
        for flag in ("visible", "modelAttached", "loaderPending", "overheated", "firing", "beamVisible", "underwater"):
            require(type(entry.get(flag)) is bool, f"{filename}.{flag}: expected boolean")
        raised = number(entry.get("raise"), f"{filename}.raise")
        heat = number(entry.get("heat"), f"{filename}.heat")
        sway = vector(entry.get("sway"), 2, f"{filename}.sway")
        require(0 <= raised <= 1 and 0 <= heat <= 1, f"{filename}: raise/heat out of range")
        require(abs(sway[0]) <= 0.035 + 1e-10 and abs(sway[1]) <= 0.03 + 1e-10, f"{filename}: sway out of range")
        pose = filename.split("-", 1)[1][:-4]
        gap, underwater, fire, overheat = pose == "switch-gap", pose == "underwater", pose == "fire", pose == "overheat"
        require(entry["loaderPending"] == gap and entry["modelAttached"] == (not gap), f"{filename}: contradictory loader/attachment")
        require(entry["visible"] == (not gap and not underwater) and entry["underwater"] == underwater, f"{filename}: contradictory visibility/underwater")
        require(entry["firing"] == fire and entry["beamVisible"] == fire, f"{filename}: contradictory firing/beam")
        require(entry["overheated"] == overheat, f"{filename}: contradictory overheat")
        if gap:
            require(entry.get("materials") == [], f"{filename}: gap must have no materials")
        else:
            materials(entry.get("materials"), spec["people"], filename)
        if gap or underwater or pose == "raise-0":
            require(raised == 0, f"{filename}: expected zero raise")
        elif pose != "raise-0.4":
            require(abs(raised - 1) <= 1e-6, f"{filename}: expected settled raise")
        if pose == "raise-0":
            require(dt == 0 and number(entry.get("raiseSeconds"), filename) == 0, f"{filename}: raise-0 requires a zero dt/reset frame")
        if pose == "raise-0.4":
            require(abs(raised - 1) <= 1e-6 and abs(number(entry.get("raiseSeconds"), filename) - 0.4) <= 1e-8, f"{filename}: raise did not settle in 0.4s")
            require(previous is not None and previous["file"] == filename.replace("raise-0.4", "raise-0"),
                    f"{filename}: missing preceding raise-0 endpoint")
            duration, updates = elapsed - previous["elapsed"], frame - previous["frame"]
            # Cooling and zero-dt resets can separate the two saved endpoints.
            require(duration + 1e-8 >= 24 / 60 and updates >= 24 and
                    abs(duration * 60 - round(duration * 60)) <= 1e-6 and
                    duration <= updates / 60 + 1e-8 and abs(dt - 1 / 60) <= 1e-10,
                    f"{filename}: raise requires 24 updates at 1/60 with consistent elapsed/frame/last dt")
        if pose.startswith("sway-"):
            axis, sign = {"sway-left": (0, -1), "sway-right": (0, 1), "sway-up": (1, 1), "sway-down": (1, -1)}[pose]
            require(abs(sway[axis] * sign - (0.035 if axis == 0 else 0.03)) <= 1e-6, f"{filename}: sway did not reach extreme")
        if overheat:
            require(heat >= 0.8, f"{filename}: insufficient overheat")
        if fire or "projection" in entry:
            projection(entry.get("projection"), size, filename)
        previous = entry


def perf(value, spec, stills):
    require(type(value) is dict, "perf: expected object")
    require(value.get("errors") == [], "perf: capture errors")
    require(value.get("class") == "viewmodel", "perf: wrong native class")
    require(value.get("file") == spec.get("asset"), "perf: wrong native file")
    dimensions(value.get("viewport"), (1920, 1080), "perf.viewport")
    stats = value.get("stats")
    require(type(stats) is dict and stats.get("lods") == [0] and
            type(stats["lods"][0]) is int and type(stats.get("shown")) is int and stats["shown"] == 0,
            "perf: native LOD inventory/selection mismatch")
    require(type(stats.get("lod")) is int and stats["lod"] == 0, "perf: native requested LOD mismatch")
    if "materials" in stats:
        names = stats["materials"]
        require(type(names) is list and all(isinstance(n, str) for n in names) and
                len(names) == len(material_names(spec["people"])) and set(names) == material_names(spec["people"]),
                "perf: native material names mismatch")
    far = value.get("far")
    require(type(far) is list and len(far) == 1 and type(far[0]) is dict, "perf: wrong native far captures")
    require(number(far[0].get("range"), "perf.far.range") == 100 and
            integer(far[0].get("lod"), "perf.far.lod") == 2 and integer(far[0].get("shown"), "perf.far.shown") == 0,
            "perf: native far/LOD contradiction")
    packet = value.get("packet")
    require(type(packet) is dict, "perf: missing packet observations")
    require(type(packet.get("version")) is int and packet["version"] == 1 and packet.get("unit") == spec["id"] and packet.get("people") == spec["people"], "perf: wrong packet identity")
    require(packet.get("overlayMarkers") == ["Muzzle"] and packet.get("gripOverlay") is False, "perf: incorrect overlay claims")
    overlay = value.get("overlay")
    require(type(overlay) is dict and overlay.get("labelled") == packet["overlayMarkers"],
            "perf: native/packet overlay contradiction")
    materials(packet.get("materials"), spec["people"], "perf.packet.materials")
    captures = packet.get("captures")
    require(type(captures) is list and len(captures) == 10, "perf: wrong capture count")
    seen = set()
    for capture in captures:
        require(type(capture) is dict, "perf: capture must be an object")
        name = capture.get("file")
        require(isinstance(name, str) and name in stills and name not in seen, "perf: wrong/duplicate capture file")
        seen.add(name)
        requested = 2 if name.endswith("_lod2.png") else 0
        require(integer(capture.get("requestedLOD"), name) == requested and integer(capture.get("selectedLOD"), name) == 0, f"{name}: requested/selected LOD contradiction")
        require("far" in capture, f"{name}: missing far observation")
        if name == "far_lod2.png":
            require(number(capture["far"], name) == far[0]["range"], f"{name}: native/packet far contradiction")
        else:
            require(capture["far"] is None, f"{name}: unexpected far distance")


def inspect_packet(spec: dict, output: Path, manifest: list[dict]) -> dict:
    """Read each artifact once, authenticate and decode those bytes, return CPU PASS."""
    evidence = {"spec": spec, "manifest": manifest}
    try:
        stills, readout = packet_files(spec)
        require(type(manifest) is list and len(manifest) == len(spec["files"]), "manifest: wrong row count")
        rows = {}
        for row in manifest:
            require(type(row) is dict and set(row) == {"path", "bytes", "sha256"}, "manifest: invalid row keys")
            name = row["path"]
            require(basename(name) and name in spec["files"] and name not in rows, "manifest: unexpected/duplicate basename")
            cap = spec["readoutCap"] if name == readout else PNG_CAP
            require(type(row["bytes"]) is int and 0 < row["bytes"] <= cap, f"{name}: invalid manifest byte count")
            require(isinstance(row["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is not None, f"{name}: invalid manifest hash")
            rows[name] = row
        with directory(output) as fd:
            found = set()
            with os.scandir(fd) as entries:
                for entry in entries:
                    require(entry.name in rows and entry.is_file(follow_symlinks=False), f"{entry.name}: extra/nonregular artifact")
                    found.add(entry.name)
            require(found == set(rows), "output: missing artifacts")
            # Preserve the readout even when a subsequent image fails inspection.
            for name in [readout] + stills + ["sheet.png"]:
                evidence["file"] = name
                row = rows[name]
                raw = bounded_read(fd, name, spec["readoutCap"] if name == readout else PNG_CAP, row["bytes"])
                digest = hashlib.sha256(raw).hexdigest()
                evidence["observedFile"] = {"path": name, "bytes": len(raw), "sha256": digest}
                require(digest == row["sha256"], f"{name}: manifest hash mismatch")
                if name == readout:
                    value = parse_json(raw, name)
                    evidence[readout[:-5]] = value
                    finite_json(value, name)
                    (perf if spec["kind"] == "review" else observations)(value, spec, stills)
                else:
                    decode_png(raw, image_size(spec, name, stills), name)
        return {"valid": True, "status": "PASS", "unit": spec["id"], "pngCount": len(stills) + 1, readout[:-5]: value}
    except Exception as exc:
        if isinstance(exc, InspectionError):
            exc.evidence.update(evidence)
            raise
        raise InspectionError(f"{type(exc).__name__}: {exc}", evidence) from exc


def read_metadata(path):
    path = Path(path)
    with directory(path.parent) as fd:
        raw = bounded_read(fd, path.name, METADATA_CAP)
    value = parse_json(raw, str(path))
    finite_json(value, str(path))
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--unit", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--result", type=Path)
    args = parser.parse_args(argv)
    result = None
    try:
        inventory = read_metadata(args.inventory)
        require(type(inventory) is dict and type(inventory.get("units")) is list, "inventory: missing units")
        specs = [spec for spec in inventory["units"] if type(spec) is dict and spec.get("id") == args.unit]
        require(len(specs) == 1, "inventory: unit absent or duplicated")
        manifest = read_metadata(args.manifest)
        if type(manifest) is dict:
            require(set(manifest) == {"files"}, "manifest: expected object with files")
            manifest = manifest["files"]
        result = inspect_packet(specs[0], args.output, manifest)
        encoded = (json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
        if args.result:
            require(len(encoded) <= RESULT_CAP, "result: exceeds 16384 byte cap")
            with directory(args.result.parent) as fd:
                handle = os.open(args.result.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                with os.fdopen(handle, "wb") as stream:
                    stream.write(encoded)
        else:
            sys.stdout.write(encoded.decode("utf-8"))
        return 0
    except Exception as exc:
        # No success receipt is synthesized when inspection or its result write fails.
        evidence = getattr(exc, "evidence", {}).copy()
        if result is not None:
            evidence["inspection"] = result
        failure = {"status": "FAIL", "primaryFailure": f"{type(exc).__name__}: {exc}", "evidence": evidence}
        sys.stderr.write(json.dumps(failure, separators=(",", ":")) + "\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
