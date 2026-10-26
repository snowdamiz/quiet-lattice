"""Exports cutscenes from assets/blend/cutscenes/*.blend (DESIGN 19.2: "cutscene camera paths are authored in Blender
and exported as curves the engine's camera-glide system follows"; docs/ARCHITECTURE.md "Cutscenes"), and checks them for
validate.py (families.json `cutscenes`, kind "cutscene").

Run: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/export_cutscene.py -- [--only test]
         [--src assets/blend/cutscenes] [--out packages/client/public/cutscenes]
         [--server-out packages/server/src/cutscenes/placements]
     ... -- --selftest     (builds small cutscenes in memory, exports them and checks the JSON and every refusal)

A source holds one cutscene, laid out the way Blender already edits cameras:
- Scene custom properties: `cutscene` (its id: a-z, 0-9 and _), `frame` (station | home | body:<n> | inertial | player:
  the frame the scene is authored in), `anchor` (origin: the frame's own coordinates; player: relative to the player's
  pose when it starts, the player's ship at the origin with its nose along +Y; inertial and player frames anchor on the
  player), and optional `title`, `enter` (glide | dip | cut), `exit` (glide | dip), `radius` (m, the story phase's
  volume, 3000 by default). The frame range at the scene's frame rate is the cutscene's length; the render resolution
  is the framing the cameras compose for (the engine letterboxes to it).
- Shots: camera objects named CAM_<cutscene>_<shot>, each driven however the artist likes (a Follow Path constraint on
  its curve CAM_<cutscene>_<shot>_path, a Track To target, keys on the lens). Timeline markers bound to cameras
  (Ctrl+B) cut between them, as in Blender's own playback; with none, the scene camera plays throughout. A camera's
  custom property `transition` = "dip" opens its shot behind a dip from black instead of a cut.
- Dialogue and events: timeline markers `line:<key>` (a line starts), `end:<key>` (it ends; default: its reading time,
  cut short by the next line) and `event:<name>`; their words in a Text block `CUT_<cutscene>` holding JSON
  {"lines": {<key>: {"speaker", "voice", "text"}}, "banners": {<name>: {"title", "sub"}}}. Any other unbound marker is
  refused, as is an `end:` with no line, a key used twice, a banner with no title or no event, and a marker outside the
  frame range.
- Actors: empties ACTOR_<name> with custom properties `kind` (npc | ship | prop), `label` (the name players see) and
  optionally `hull`: the server spawns them into the cutscene's phase, in its frame and anchor.
- Optional staging: an empty STAGE_player where the player's ship is put for the cutscene (dev scenarios, quest steps;
  only in a cutscene anchored on its frame's origin).

What is written: to --out, <id>.json for the client: per shot, the evaluated camera at every frame of its range (and the
frame it cuts on), converted to the engine's axes (Y up; Blender's +Y forward is the engine's -Z), with the vertical
field of view of the render framing; the lines, events and stage. To --server-out, <id>.json for the server: the
cutscene's space, its phase radius and its actors. Every rule the client's parseCutscene applies is applied here first,
and every problem in a source is listed, not only the first. The .blend is never saved.
"""
import argparse
import json
import math
import re
import sys
import tempfile
import traceback
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SRC = ROOT / "assets/blend/cutscenes"
OUT = ROOT / "packages/client/public/cutscenes"
SERVER_OUT = ROOT / "packages/server/src/cutscenes/placements"
FORMAT = "astra.cutscene"
PLACE_FORMAT = "astra.cutscene.place"
VERSION = 1
# the grammar the client (timeline.js parseCutscene), the protocol (CutsceneId) and the server share
ID = re.compile(r"^[a-z0-9][a-z0-9_]{0,47}$")
FRAME = re.compile(r"^(station|player|inertial|home|body:(0|[1-9]\d{0,2}))$")
KEY = re.compile(r"^[a-z0-9][a-z0-9_]{0,47}$")
VOICES = ("compact", "reaches", "chorus", "thalune", "ixari", "ulgani", "hollow", "cartographer", "self")
ACTOR_KINDS = ("npc", "ship", "prop")
MARKER_KINDS = ("line", "end", "event")
MAX_DURATION = 600
DEFAULT_RADIUS = 3000
# Blender (Z up) to the engine (Y up): a quarter turn about X; (x, y, z) -> (x, z, -y)
AXES_Q = Matrix.Rotation(-math.pi / 2, 4, "X").to_quaternion()
# reading time of a line with no end marker: a beat plus 16 characters a second
READ_BASE = 1.2
READ_CPS = 16.0
# a line given no end stops this long before the next one starts
LINE_GAP = 0.25


class CutsceneError(Exception):
    """A source that cannot be exported: `problems` lists every reason."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("\n  ".join(self.problems))


def r(x, nd):
    v = round(float(x), nd)
    return 0.0 if v == 0 else v


def vec(v):
    """A Blender position in the engine's axes."""
    return [r(v.x, 4), r(v.z, 4), r(-v.y, 4)]


def cam_quat(m):
    """A Blender camera's world rotation in the engine's axes (both look down their own -Z with +Y up)."""
    return (AXES_Q @ m.to_quaternion()).normalized()


def obj_quat(m):
    """An object's world rotation in the engine's axes: its own axes turn with the world's, as the .glb export turns
    a model (Blender's +Y nose becomes the engine's -Z)."""
    return (AXES_Q @ m.to_quaternion() @ AXES_Q.inverted()).normalized()


def qlist(q, prev=None):
    """[x, y, z, w], kept in the previous sample's hemisphere so neighbours never flip sign."""
    if prev is not None and q.dot(prev) < 0:
        q = -q
    return q, [r(q.x, 6), r(q.y, 6), r(q.z, 6), r(q.w, 6)]


def pose_of(obj):
    mw = obj.matrix_world
    q = obj_quat(mw)
    return {"pos": vec(mw.to_translation()), "quat": [r(q.x, 6), r(q.y, 6), r(q.z, 6), r(q.w, 6)]}


def vertical_fov(cam, scene):
    """The camera's vertical field of view (degrees) for the scene's render framing."""
    d = cam.data
    rs = scene.render
    w = rs.resolution_x * rs.pixel_aspect_x
    h = rs.resolution_y * rs.pixel_aspect_y
    aspect = w / h
    fit = d.sensor_fit
    if fit == "AUTO":
        fit = "HORIZONTAL" if w >= h else "VERTICAL"
    if fit == "VERTICAL":
        half = math.atan(d.sensor_height / (2 * d.lens))
    else:
        half = math.atan(d.sensor_width / (2 * d.lens) / aspect)
    return math.degrees(2 * half)


def is_text(v, n):
    return isinstance(v, str) and 0 < len(v.strip()) and len(v) <= n


class Checker:
    """Collects every problem in a source; `done()` raises them all at once."""

    def __init__(self):
        self.problems = []

    def bad(self, msg):
        self.problems.append(msg)

    def done(self):
        if self.problems:
            raise CutsceneError(self.problems)


def words(scene, cid, chk):
    text = bpy.data.texts.get(f"CUT_{cid}")
    if text is None:
        return {"lines": {}, "banners": {}}
    try:
        data = json.loads(text.as_string() or "{}")
    except json.JSONDecodeError as e:
        chk.bad(f"Text block CUT_{cid} is not JSON: {e}")
        return {"lines": {}, "banners": {}}
    if not isinstance(data, dict):
        chk.bad(f"Text block CUT_{cid} holds {type(data).__name__}, not an object")
        return {"lines": {}, "banners": {}}
    for k in data:
        if k not in ("lines", "banners"):
            chk.bad(f"Text block CUT_{cid} has an unknown section {k!r} (lines, banners)")
    out = {}
    for k in ("lines", "banners"):
        v = data.get(k, {})
        if not isinstance(v, dict):
            chk.bad(f"CUT_{cid} {k} is not an object of entries by key")
            v = {}
        out[k] = v
    return out


def shots_of(scene, cid, f0, f1, chk):
    """[(camera, first frame, last frame)]: markers bound to cameras cut between them; else the scene camera."""
    bound = sorted((m for m in scene.timeline_markers if m.camera is not None), key=lambda m: m.frame)
    cuts = []
    for m in bound:
        if m.frame < f0 or m.frame > f1:
            chk.bad(f"marker {m.name!r} (camera {m.camera.name}) at frame {m.frame} is outside the frame range {f0}–{f1}")
            continue
        if m.frame == f1:
            continue
        if cuts and cuts[-1][1] == m.frame:
            chk.bad(f"two cameras are bound at frame {m.frame} ({cuts[-1][0].name}, {m.camera.name})")
            continue
        cuts.append((m.camera, m.frame))
    if not cuts or cuts[0][1] > f0:
        cam = scene.camera
        if cam is None:
            chk.bad("no camera at the first frame: bind a marker to a camera there, or set the scene camera")
            return []
        cuts.insert(0, (cam, f0))
    out = []
    for i, (cam, start) in enumerate(cuts):
        end = cuts[i + 1][1] if i + 1 < len(cuts) else f1
        out.append((cam, start, end))
    prefix = f"CAM_{cid}_"
    usable = []
    for cam, s, e in out:
        ok = True
        if cam.type != "CAMERA":
            chk.bad(f"{cam.name} is bound as a shot but is not a camera")
            ok = False
        elif cam.data.type != "PERSP":
            chk.bad(f"camera {cam.name} is not a perspective camera")
            ok = False
        if not cam.name.startswith(prefix) or not KEY.match(cam.name[len(prefix) :]):
            chk.bad(f"camera {cam.name} is not named {prefix}<shot> (the shot in a-z, 0-9 and _)")
            ok = False
        tr = cam.get("transition")
        if tr is not None and tr not in ("cut", "dip"):
            chk.bad(f"camera {cam.name} transition {tr!r}: cut or dip")
        if ok:
            usable.append((cam, s, e))
    return usable


def markers_of(scene, f0, f1, chk):
    """The unbound markers by kind: {'line': {key: frame}, 'end': {key: frame}, 'event': [(frame, name)]}."""
    out = {"line": {}, "end": {}, "event": []}
    seen_events = set()
    for m in scene.timeline_markers:
        if m.camera is not None:
            continue
        kind, colon, key = m.name.partition(":")
        if not colon or kind not in MARKER_KINDS:
            chk.bad(f"marker {m.name!r} at frame {m.frame}: an unbound marker is line:<key>, end:<key> or event:<name>")
            continue
        if not KEY.match(key):
            chk.bad(f"marker {m.name!r} at frame {m.frame}: its {('key' if kind != 'event' else 'name')} must be a-z, 0-9 and _ (not empty)")
            continue
        if m.frame < f0 or m.frame > f1:
            chk.bad(f"marker {m.name!r} at frame {m.frame} is outside the frame range {f0}–{f1}")
            continue
        if kind == "event":
            if key in seen_events:
                chk.bad(f"event {key} is marked twice")
                continue
            seen_events.add(key)
            out["event"].append((m.frame, key))
        elif key in out[kind]:
            chk.bad(f"{kind}:{key} is marked twice (frames {out[kind][key]} and {m.frame})")
        else:
            out[kind][key] = m.frame
    for key, f in out["end"].items():
        if key not in out["line"]:
            chk.bad(f"end:{key} at frame {f} ends no line (there is no line:{key})")
    return out


def export_scene(scene, source=""):
    """The client definition and the server placement of the scene's cutscene. Raises CutsceneError with every problem."""
    chk = Checker()
    cid = scene.get("cutscene")
    if not isinstance(cid, str) or not ID.match(cid):
        chk.bad(f"the scene's `cutscene` id {cid!r} must be 1–48 characters of a-z, 0-9 and _, starting with a letter or digit")
        chk.done()
    frame = scene.get("frame", "")
    if not isinstance(frame, str) or not FRAME.match(frame):
        chk.bad(f"frame {frame!r}: station, home, inertial, player or body:<n> (n without leading zeros)")
    anchor = scene.get("anchor", "origin")
    if anchor not in ("origin", "player"):
        chk.bad(f"anchor {anchor!r}: origin or player")
    elif frame in ("inertial", "player") and anchor != "player":
        chk.bad(f"a cutscene in the {frame} frame is anchored on the player (anchor = player), not {anchor!r}")
    for k, allowed in (("enter", ("glide", "dip", "cut")), ("exit", ("glide", "dip"))):
        v = scene.get(k)
        if v is not None and v not in allowed:
            chk.bad(f"{k} {v!r}: one of {', '.join(allowed)}")
    radius = scene.get("radius", DEFAULT_RADIUS)
    if not isinstance(radius, (int, float)) or not 10 <= radius <= 50000:
        chk.bad(f"radius {radius!r}: the phase's volume in metres, 10–50000")
        radius = DEFAULT_RADIUS
    title = scene.get("title", cid)
    if not is_text(title, 80):
        chk.bad(f"title {title!r}: 1–80 characters")
    fps = scene.render.fps / scene.render.fps_base
    f0, f1 = scene.frame_start, scene.frame_end
    t = lambda f: r((f - f0) / fps, 4)  # noqa: E731
    duration = t(f1)
    if not 0 < duration <= MAX_DURATION:
        chk.bad(f"the frame range {f0}–{f1} lasts {duration} s: more than 0 and at most {MAX_DURATION}")
    rs = scene.render
    aspect = (rs.resolution_x * rs.pixel_aspect_x) / (rs.resolution_y * rs.pixel_aspect_y)
    if not 1 <= aspect <= 4:
        chk.bad(f"the render framing {aspect:.3f}:1 is outside 1:1–4:1")

    shots = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for cam, start, end in shots_of(scene, cid, f0, f1, chk):
        pos, quat, fov = [], [], []
        prev = None
        for f in range(start, end + 1):
            scene.frame_set(f)
            ev = cam.evaluated_get(depsgraph)
            q, ql = qlist(cam_quat(ev.matrix_world), prev)
            prev = q
            pos += vec(ev.matrix_world.to_translation())
            quat += ql
            fov.append(r(vertical_fov(ev, scene), 4))
        bad_fov = [v for v in fov if not 1 < v < 170]
        if bad_fov:
            chk.bad(f"camera {cam.name} has a field of view of {bad_fov[0]} deg (1–170)")
        if not all(math.isfinite(v) for v in pos + quat):
            chk.bad(f"camera {cam.name} has a pose that is not a number")
        shot = {"name": cam.name[len(f"CAM_{cid}_") :], "start": t(start), "end": t(end), "fps": r(fps, 6), "pos": pos, "quat": quat, "fov": fov}
        if cam.get("transition") in ("cut", "dip"):
            shot["transition"] = cam["transition"]
        shots.append(shot)

    text = words(scene, cid, chk)
    marks = markers_of(scene, f0, f1, chk)
    lines = []
    order = sorted(marks["line"].items(), key=lambda kv: kv[1])
    for i, (key, f) in enumerate(order):
        w = text["lines"].get(key)
        if not isinstance(w, dict):
            chk.bad(f"line {key} has no words in CUT_{cid} lines")
            continue
        if not is_text(w.get("speaker"), 48):
            chk.bad(f"line {key}: speaker {w.get('speaker')!r} must be 1–48 characters")
        if not is_text(w.get("text"), 280):
            chk.bad(f"line {key}: text must be 1–280 characters")
        voice = w.get("voice", "self")
        if voice not in VOICES:
            chk.bad(f"line {key} voice {voice!r}: one of {', '.join(VOICES)}")
        begin = t(f)
        nxt = t(order[i + 1][1]) if i + 1 < len(order) else duration
        if key in marks["end"]:
            stop = t(marks["end"][key])
            if stop <= begin or stop > nxt + 1e-6:
                chk.bad(f"line {key} ends at {stop} s, outside its span {begin}–{nxt} s (it may not run into the next line)")
                continue
        else:
            stop = min(begin + READ_BASE + len(str(w.get("text", ""))) / READ_CPS, nxt - (LINE_GAP if i + 1 < len(order) else 0))
            if stop <= begin:
                chk.bad(f"line {key} has no time to show before the next line")
                continue
        lines.append({"id": key, "t": begin, "dur": r(stop - begin, 4), "speaker": w.get("speaker"), "voice": voice, "text": w.get("text")})
    for key in text["lines"]:
        if key not in marks["line"]:
            chk.bad(f"line {key} in CUT_{cid} has no line:{key} marker")

    events = []
    names = {name for _, name in marks["event"]}
    for f, name in sorted(marks["event"]):
        e = {"t": t(f), "name": name}
        b = text["banners"].get(name)
        if b is not None:
            if not isinstance(b, dict) or not is_text(b.get("title"), 64):
                chk.bad(f"event {name}'s banner has no title (1–64 characters)")
            elif b.get("sub") is not None and not isinstance(b.get("sub"), str):
                chk.bad(f"event {name}'s banner sub is not text")
            else:
                e["banner"] = {"title": b["title"], "sub": b.get("sub") or ""}
        events.append(e)
    for name in text["banners"]:
        if name not in names:
            chk.bad(f"banner {name} in CUT_{cid} has no event:{name} marker")

    scene.frame_set(f0)
    stage = bpy.data.objects.get("STAGE_player")
    stage_out = None
    if stage is not None:
        if anchor != "origin":
            chk.bad("STAGE_player places the player in the frame's coordinates: only in a cutscene anchored on its origin")
        else:
            stage_out = {"player": pose_of(stage)}

    actors = []
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if not o.name.startswith("ACTOR_"):
            continue
        aid = o.name[len("ACTOR_") :]
        if not KEY.match(aid):
            chk.bad(f"actor {o.name} is not named ACTOR_<name> (the name in a-z, 0-9 and _)")
            continue
        if o.type != "EMPTY":
            chk.bad(f"actor {o.name} is a {o.type.lower()}, not an empty (the engine draws its model)")
        kind = o.get("kind")
        if kind not in ACTOR_KINDS:
            chk.bad(f"actor {o.name} kind {kind!r}: one of {', '.join(ACTOR_KINDS)}")
        label = o.get("label")
        if not is_text(label, 32):
            chk.bad(f"actor {o.name} label {label!r}: the name players see, 1–32 characters")
        hull = o.get("hull")
        if hull is not None and not (isinstance(hull, str) and KEY.match(hull) and len(hull) <= 24):
            chk.bad(f"actor {o.name} hull {hull!r}: a hull id")
        a = {"id": aid, "kind": kind, "name": label, **pose_of(o)}
        if hull is not None:
            a["hull"] = hull
        actors.append(a)

    chk.done()
    space = {"frame": frame, "anchor": anchor}
    client = {"format": FORMAT, "version": VERSION, "id": cid, "title": title, "source": source, "space": space, "duration": duration, "aspect": r(aspect, 4)}
    for k in ("enter", "exit"):
        if scene.get(k):
            client[k] = scene[k]
    if stage_out:
        client["stage"] = stage_out
    client["shots"] = shots
    client["lines"] = lines
    client["events"] = events
    place = {"format": PLACE_FORMAT, "version": VERSION, "id": cid, "source": source, "space": space, "radius": radius, "actors": actors}
    return client, place


def pretty(v, indent=0, room=160, tail=0):
    """JSON laid out as Prettier lays it out (printWidth 160): a value on one line when it fits, else one entry a
    line, so the server's placement files pass `prettier --check` as written."""
    flat = json.dumps(v, separators=(", ", ": "))
    if isinstance(v, dict) and v:
        flat = "{ " + ", ".join(f"{json.dumps(k)}: {pretty(x, 0, 10**9)}" for k, x in v.items()) + " }"
    elif isinstance(v, list):
        flat = "[" + ", ".join(pretty(x, 0, 10**9) for x in v) + "]"
    if indent + len(flat) + tail <= room or not isinstance(v, (dict, list)) or not v:
        return flat
    pad = " " * (indent + 2)
    if isinstance(v, dict):
        items = list(v.items())
        body = ",\n".join(f"{pad}{json.dumps(k)}: {pretty(x, indent + 2, room, len(json.dumps(k)) + 2 + (1 if i < len(items) - 1 else 0))}" for i, (k, x) in enumerate(items))
        return "{\n" + body + "\n" + " " * indent + "}"
    body = ",\n".join(f"{pad}{pretty(x, indent + 2, room, 1 if i < len(v) - 1 else 0)}" for i, x in enumerate(v))
    return "[\n" + body + "\n" + " " * indent + "]"


def write(data, out_dir, layout="compact"):
    """Writes <id>.json into `out_dir`, and nowhere else: compact (the client's, under public/, which Prettier skips)
    or laid out as Prettier would (the server's, in its source tree)."""
    out_dir = Path(out_dir).resolve()
    if not ID.match(str(data.get("id", ""))):
        raise CutsceneError([f"refusing to write a cutscene with the id {data.get('id')!r}"])
    path = (out_dir / f"{data['id']}.json").resolve()
    if path.parent != out_dir:
        raise CutsceneError([f"refusing to write {path} outside {out_dir}"])
    out_dir.mkdir(parents=True, exist_ok=True)
    body = pretty(data) if layout == "pretty" else json.dumps(data, separators=(",", ":"))
    path.write_text(body + "\n")
    return path


# ---------- validate.py (families.json `cutscenes`) ----------


def validate_into(report):
    """validate.py's checks for a cutscene source (the .blend already open): naming and the marker grammar, through the
    same rules as the export; the mesh checks do not apply to a file of cameras, curves and empties."""
    naming = report["naming"]
    try:
        client, place = export_scene(bpy.context.scene, report.path)
    except CutsceneError as e:
        for p in e.problems:
            naming.fail("cutscene", p)
        client = None
    if client is not None:
        n = sum(len(s["fov"]) for s in client["shots"])
        naming.ok("cutscene", f"{client['id']}: {len(client['shots'])} shots ({n} samples), {len(client['lines'])} lines, {len(client['events'])} events, {len(place['actors'])} actors, {client['duration']} s")
    for cid in ("triangles", "lods", "materials", "scale"):
        report[cid].skip("a cutscene holds cameras, curves and empties; nothing in it is exported as a model")


# ---------- the command ----------


def main(argv):
    p = argparse.ArgumentParser(prog="export_cutscene.py")
    p.add_argument("--src", default=str(SRC))
    p.add_argument("--out", default=str(OUT))
    p.add_argument("--server-out", default=str(SERVER_OUT))
    p.add_argument("--only", help="comma-separated .blend names (without extension)")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args(argv)
    if args.selftest:
        return selftest()
    sources = sorted(Path(args.src).glob("*.blend"))
    if args.only:
        keep = set(args.only.split(","))
        sources = [s for s in sources if s.stem in keep]
    if not sources:
        print(f"export cutscenes: no .blend sources in {args.src}")
        return 0
    failed = 0
    for src in sources:
        try:
            bpy.ops.wm.open_mainfile(filepath=str(src))
            rel = src.resolve().relative_to(ROOT) if src.resolve().is_relative_to(ROOT) else src
            client, place = export_scene(bpy.context.scene, str(rel))
            path = write(client, Path(args.out))
            spath = write(place, Path(args.server_out), "pretty")
            n = sum(len(s["fov"]) for s in client["shots"])
            print(
                f"export cutscenes: {src.name} -> {path} ({len(client['shots'])} shots, {n} samples, {len(client['lines'])} lines,"
                f" {len(client['events'])} events, {client['duration']} s) and {spath} ({len(place['actors'])} actors)"
            )
        except CutsceneError as e:
            failed += 1
            print(f"export cutscenes: {src.name}:\n  {e}")
        except Exception:
            failed += 1
            traceback.print_exc()
    return 1 if failed else 0


# ---------- self-test ----------


def _base_scene(cid="selftest", frame="station", anchor="origin"):
    """A small valid cutscene: one camera, one line, one bannered event."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = 24
    sc.render.resolution_x, sc.render.resolution_y = 1920, 804
    sc.frame_start, sc.frame_end = 1, 49
    sc["cutscene"] = cid
    sc["frame"] = frame
    sc["anchor"] = anchor
    cam = bpy.data.objects.new(f"CAM_{cid}_a" if ID.match(cid) else "CAM_x_a", bpy.data.cameras.new("a"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.data.texts.new(f"CUT_{cid}").write(json.dumps({"lines": {"a": {"speaker": "S", "text": "hi"}}, "banners": {"ev": {"title": "T", "sub": "s"}}}))
    sc.timeline_markers.new("line:a", frame=5)
    sc.timeline_markers.new("event:ev", frame=10)
    return sc


def selftest():
    """A two-shot cutscene built in memory (a camera on a path with keyed lens, a second keyed camera bound by a marker,
    two lines, a banner event, an actor), exported, then checked against what Blender says at the same frames; then
    every kind of broken source, each refused with its reason."""
    results = []

    def expect(cond, msg):
        results.append(bool(cond))
        print(("  ok    " if cond else "  FAIL  ") + msg)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.render.resolution_x, scene.render.resolution_y = 1920, 804
    scene.frame_start, scene.frame_end = 1, 97
    scene["cutscene"] = "selftest"
    scene["frame"] = "station"
    scene["anchor"] = "origin"
    scene["radius"] = 1200

    # shot 1: a camera riding a straight path, tracking an empty, lens keyed 35 -> 50 mm
    bpy.ops.curve.primitive_bezier_curve_add(location=(0, 0, 0))
    path = bpy.context.object
    path.name = "CAM_selftest_ride_path"
    path.data.path_duration = 48
    pts = path.data.splines[0].bezier_points
    pts[0].co, pts[1].co = (0, -100, 10), (40, -20, 10)
    for b in pts:
        b.handle_left_type = b.handle_right_type = "VECTOR"
    look = bpy.data.objects.new("look", None)
    scene.collection.objects.link(look)
    look.location = (0, 50, 0)
    cam1 = bpy.data.objects.new("CAM_selftest_ride", bpy.data.cameras.new("ride"))
    scene.collection.objects.link(cam1)
    fp = cam1.constraints.new("FOLLOW_PATH")
    fp.target = path
    fp.use_fixed_location = True
    fp.offset_factor = 0.0
    fp.keyframe_insert("offset_factor", frame=1)
    fp.offset_factor = 1.0
    fp.keyframe_insert("offset_factor", frame=49)
    tt = cam1.constraints.new("TRACK_TO")
    tt.target = look
    tt.track_axis, tt.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
    cam1.data.lens = 35
    cam1.data.keyframe_insert("lens", frame=1)
    cam1.data.lens = 50
    cam1.data.keyframe_insert("lens", frame=49)
    # shot 2: a keyed camera, opening on a dip
    cam2 = bpy.data.objects.new("CAM_selftest_hold", bpy.data.cameras.new("hold"))
    scene.collection.objects.link(cam2)
    cam2["transition"] = "dip"
    cam2.location = (5, 5, 5)
    cam2.rotation_euler = (math.radians(80), 0, math.radians(30))
    cam2.keyframe_insert("location", frame=49)
    cam2.location = (15, 5, 8)
    cam2.keyframe_insert("location", frame=97)
    scene.camera = cam1
    scene.timeline_markers.new("ride", frame=1).camera = cam1
    scene.timeline_markers.new("hold", frame=49).camera = cam2
    scene.timeline_markers.new("line:a", frame=13)
    scene.timeline_markers.new("line:b", frame=61)
    scene.timeline_markers.new("end:b", frame=85)
    scene.timeline_markers.new("event:arrive", frame=55)
    stage = bpy.data.objects.new("STAGE_player", None)
    scene.collection.objects.link(stage)
    stage.location = (1, 2, 3)
    stage.rotation_euler = (0, 0, math.radians(90))
    tug = bpy.data.objects.new("ACTOR_tug", None)
    scene.collection.objects.link(tug)
    tug.location = (-40, 160, 12)
    tug["kind"], tug["label"], tug["hull"] = "ship", "Waystation tug", "mule"
    bpy.data.texts.new("CUT_selftest").write(
        json.dumps(
            {
                "lines": {
                    "a": {"speaker": "Waystation Control", "voice": "compact", "text": "Hold where you are."},
                    "b": {"speaker": "Quartermaster", "voice": "compact", "text": "Bring her in."},
                },
                "banners": {"arrive": {"title": "{station}", "sub": "Inbound"}},
            }
        )
    )

    data, place = export_scene(scene, "selftest")
    expect(data["format"] == FORMAT and data["version"] == VERSION and data["id"] == "selftest", "header")
    expect(abs(data["duration"] - 4.0) < 1e-6, f"duration 96 frames at 24 fps = 4 s ({data['duration']})")
    expect(abs(data["aspect"] - 1920 / 804) < 1e-3, "aspect from the render resolution")
    ride, hold = data["shots"]
    expect(ride["name"] == "ride" and hold["name"] == "hold", "shots named from CAM_<id>_<shot>, cut by bound markers")
    expect(ride["start"] == 0 and ride["end"] == 2 and hold["start"] == 2 and hold["end"] == 4, "shot spans 0-2 s and 2-4 s")
    expect(len(ride["fov"]) == 49 and len(ride["pos"]) == 49 * 3 and len(ride["quat"]) == 49 * 4, "one sample a frame, the cut frame included")
    expect(hold.get("transition") == "dip" and "transition" not in ride, "transition from the camera's property")

    # the samples match what Blender evaluates, in the engine's axes
    worst = 0.0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for i, f in enumerate(range(1, 50)):
        scene.frame_set(f)
        ev = cam1.evaluated_get(depsgraph)
        loc = ev.matrix_world.to_translation()
        exp = (loc.x, loc.z, -loc.y)
        got = ride["pos"][i * 3 : i * 3 + 3]
        worst = max(worst, max(abs(a - b) for a, b in zip(exp, got)))
    expect(worst < 1e-3, f"positions match the evaluated camera (worst {worst:.2e} m)")
    expect(abs(ride["pos"][0] - 0) < 1e-3 and abs(ride["pos"][1] - 10) < 1e-3 and abs(ride["pos"][2] - 100) < 1e-3, "Blender (0,-100,10) is the engine's (0,10,100)")
    exp_fov = math.degrees(2 * math.atan(36 / (2 * 35) / (1920 / 804)))
    expect(abs(ride["fov"][0] - exp_fov) < 1e-3, f"35 mm on a 36 mm sensor at 2.39:1 is {exp_fov:.3f} deg vertical ({ride['fov'][0]})")
    exp_fov = math.degrees(2 * math.atan(36 / (2 * 50) / (1920 / 804)))
    expect(abs(ride["fov"][48] - exp_fov) < 1e-3, "keyed lens reaches 50 mm on the cut frame")
    # the camera looks at the empty: its -Z, turned into the engine's axes, points from it to (0, 0, -50)
    q = Quaternion((ride["quat"][3], ride["quat"][0], ride["quat"][1], ride["quat"][2]))
    fwd = q @ Vector((0, 0, -1))
    to = (Vector((0, 0, -50)) - Vector(ride["pos"][0:3])).normalized()
    expect(fwd.dot(to) > 0.9999, f"the camera looks down its -Z at the tracked empty (cos {fwd.dot(to):.6f})")
    signs = all(sum(a * b for a, b in zip(ride["quat"][i * 4 : i * 4 + 4], ride["quat"][i * 4 + 4 : i * 4 + 8])) > 0 for i in range(48))
    expect(signs, "neighbouring rotations share a hemisphere")

    a, b = data["lines"]
    expect(a["id"] == "a" and abs(a["t"] - 0.5) < 1e-6 and a["voice"] == "compact", "line a at its marker (0.5 s)")
    # (its reading time, 1.2 + 19/16 = 2.39 s, would run into line b: it stops a beat before b starts)
    expect(abs(a["dur"] - (2.5 - LINE_GAP - 0.5)) < 1e-3, f"a line with no end marker stops short of the next ({a['dur']} s)")
    expect(abs(b["t"] - 2.5) < 1e-6 and abs(b["dur"] - 1.0) < 1e-6, "an end marker ends a line (2.5 s + 1 s)")
    (e,) = data["events"]
    expect(e == {"t": 2.25, "name": "arrive", "banner": {"title": "{station}", "sub": "Inbound"}}, "the event with its banner")
    st = data["stage"]["player"]
    expect(st["pos"] == [1, 3, -2], f"stage position in the engine's axes ({st['pos']})")
    sq = Quaternion((st["quat"][3], st["quat"][0], st["quat"][1], st["quat"][2]))
    nose = sq @ Vector((0, 0, -1))
    # Blender +Y turned 90 deg about Z is -X; the engine's -X
    expect((nose - Vector((-1, 0, 0))).length < 1e-4, f"the staged nose (Blender +Y turned 90 deg) is the engine's -X ({tuple(round(v, 4) for v in nose)})")
    expect(place["format"] == PLACE_FORMAT and place["space"] == {"frame": "station", "anchor": "origin"} and place["radius"] == 1200, "the server placement: space and radius")
    expect(place["actors"] == [{"id": "tug", "kind": "ship", "name": "Waystation tug", "pos": [-40, 12, -160], "quat": [0, 0, 0, 1], "hull": "mule"}], f"the actor in the engine's axes ({place['actors']})")

    with tempfile.TemporaryDirectory() as d:
        path = write(data, Path(d))
        expect(json.loads(path.read_text())["id"] == "selftest" and path.parent == Path(d).resolve(), "writes <id>.json in --out")
        spath = write(place, Path(d) / "server", "pretty")
        laid = spath.read_text()
        expect(json.loads(laid) == place and max(len(x) for x in laid.splitlines()) <= 160 and laid.startswith("{\n"), "the server's placement, laid out within 160 columns")
        try:
            write({**data, "id": "../escape"}, Path(d))
            expect(False, "a write outside --out is refused")
        except CutsceneError as err:
            expect("refusing" in str(err) and not (Path(d).parent / "escape.json").exists(), "a write outside --out is refused")

    # every kind of broken source is refused, saying why (each built from a valid one)
    def refused(label, change, needle, **kw):
        sc = _base_scene(**kw)
        change(sc)
        try:
            export_scene(sc)
            expect(False, f"{label}: refused")
        except CutsceneError as err:
            expect(any(needle in p for p in err.problems), f"{label}: refused ({'; '.join(err.problems)})")

    def marker(name, frame):
        return lambda sc: sc.timeline_markers.new(name, frame=frame)

    sc = _base_scene()
    export_scene(sc)
    expect(True, "the base scene the refusals start from exports")
    refused("an unknown marker kind", marker("evnt:x", 10), "unbound marker is line:<key>")
    refused("a kind in the wrong case", marker("Line:b", 10), "unbound marker is line:<key>")
    refused("a marker with no kind", marker("hello", 10), "unbound marker is line:<key>")
    refused("an orphan end", marker("end:zz", 10), "end:zz at frame 10 ends no line")
    refused("an empty event name", marker("event:", 12), "must be a-z, 0-9 and _ (not empty)")
    refused("a key with a capital", marker("event:Big", 12), "must be a-z, 0-9 and _")
    refused("a line marked twice", marker("line:a", 20), "line:a is marked twice")
    refused("an event marked twice", marker("event:ev", 20), "event ev is marked twice")
    refused("a marker past the last frame", marker("event:late", 60), "outside the frame range")
    refused("a line past the last frame", lambda sc: setattr(sc.timeline_markers["line:a"], "frame", 60), "outside the frame range")
    refused("a banner without a title", lambda sc: bpy.data.texts["CUT_selftest"].from_string(json.dumps({"lines": {"a": {"speaker": "S", "text": "hi"}}, "banners": {"ev": {"sub": "no title"}}})), "banner has no title")
    refused("a banner with no event", lambda sc: bpy.data.texts["CUT_selftest"].from_string(json.dumps({"lines": {"a": {"speaker": "S", "text": "hi"}}, "banners": {"ev": {"title": "T"}, "zz": {"title": "T"}}})), "banner zz in CUT_selftest has no event:zz")
    refused("a line with no words", marker("line:b", 30), "line b has no words")
    refused("words with no line", lambda sc: bpy.data.texts["CUT_selftest"].from_string(json.dumps({"lines": {"a": {"speaker": "S", "text": "hi"}, "q": {"speaker": "S", "text": "?"}}, "banners": {"ev": {"title": "T"}}})), "line q in CUT_selftest has no line:q marker")
    refused("a voice no palette has", lambda sc: bpy.data.texts["CUT_selftest"].from_string(json.dumps({"lines": {"a": {"speaker": "S", "text": "hi", "voice": "pirate"}}, "banners": {"ev": {"title": "T"}}})), "voice 'pirate'")
    refused("an id with a space", lambda sc: None, "the scene's `cutscene` id", cid="Bad Id")
    refused("an id with a hyphen", lambda sc: None, "the scene's `cutscene` id", cid="cold-open")
    refused("an id that climbs out of --out", lambda sc: None, "the scene's `cutscene` id", cid="../../x")
    refused("the inertial frame anchored on its origin", lambda sc: None, "anchored on the player", frame="inertial")
    refused("the player's frame anchored on its origin", lambda sc: None, "anchored on the player", frame="player")
    refused("a body with a leading zero", lambda sc: None, "frame 'body:01'", frame="body:01")
    refused("an unknown frame", lambda sc: None, "frame 'moon'", frame="moon")
    refused("an unknown anchor", lambda sc: sc.__setitem__("anchor", "ship"), "anchor 'ship'")
    refused("a camera not named for the cutscene", lambda sc: setattr(sc.camera, "name", "Camera"), "is not named CAM_selftest_<shot>")
    refused("an unknown transition", lambda sc: sc.camera.__setitem__("transition", "wipe"), "transition 'wipe'")
    refused("a stage in a player-anchored cutscene", lambda sc: sc.collection.objects.link(bpy.data.objects.new("STAGE_player", None)), "only in a cutscene anchored on its origin", frame="player", anchor="player")

    def bad_actor(sc):
        o = bpy.data.objects.new("ACTOR_tug", None)
        sc.collection.objects.link(o)
        o["kind"] = "boss"

    refused("an actor of an unknown kind", bad_actor, "kind 'boss'")
    refused("an actor with no label", bad_actor, "label None")

    sc = _base_scene()
    for name, frame in (("evnt:x", 10), ("end:zz", 11)):
        sc.timeline_markers.new(name, frame=frame)
    try:
        export_scene(sc)
        expect(False, "every problem is listed")
    except CutsceneError as err:
        expect(len(err.problems) == 2, f"every problem is listed, not only the first ({len(err.problems)})")

    ok = all(results)
    print(f"export_cutscene selftest: {sum(results)}/{len(results)} passed")
    return 0 if ok else 1


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    sys.exit(main(argv))
