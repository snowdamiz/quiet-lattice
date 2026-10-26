"""Exports cutscenes from assets/blend/cutscenes/*.blend to packages/client/public/cutscenes/<id>.json (DESIGN 19.2:
"cutscene camera paths are authored in Blender and exported as curves the engine's camera-glide system follows";
docs/ARCHITECTURE.md "Cutscenes").

Run: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/export_cutscene.py -- [--only test]
         [--src assets/blend/cutscenes] [--out packages/client/public/cutscenes]
     ... -- --selftest     (builds a small cutscene in memory, exports it and checks the JSON)

A source holds one cutscene, laid out the way Blender already edits cameras:
- Scene custom properties: `cutscene` (its id), `frame` (station | home | body:<n> | inertial | player: the frame the
  scene is authored in), `anchor` (origin: the frame's own coordinates; player: relative to the player's pose when it
  starts, the player's ship at the origin with its nose along +Y), and optional `title`, `enter` (glide | dip | cut),
  `exit` (glide | dip). The frame range at the scene's frame rate is the cutscene's length; the render resolution is
  the framing the cameras compose for (the engine letterboxes to it).
- Shots: camera objects named CAM_<cutscene>_<shot>, each driven however the artist likes (a Follow Path constraint on
  its curve CAM_<cutscene>_<shot>_path, a Track To target, keys on the lens). Timeline markers bound to cameras
  (Ctrl+B) cut between them, as in Blender's own playback; with none, the scene camera plays throughout. A camera's
  custom property `transition` = "dip" opens its shot behind a dip from black instead of a cut.
- Dialogue and events: timeline markers `line:<key>` (a line starts), `end:<key>` (it ends; default: its reading time,
  cut short by the next line) and `event:<name>`; their words in a Text block `CUT_<cutscene>` holding JSON
  {"lines": {<key>: {"speaker", "voice", "text"}}, "banners": {<name>: {"title", "sub"}}}.
- Optional staging: an empty STAGE_player where the player's ship is put for the cutscene (dev scenarios, quest steps).

What is written: per shot, the evaluated camera at every frame of its range (and the frame it cuts on), converted to
the engine's axes (Y up; Blender's +Y forward is the engine's -Z), with the vertical field of view of the render
framing. The engine plays the samples on a spline (packages/client/src/cutscene/curve.js). The .blend is never saved.
"""
import argparse
import json
import math
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
FORMAT = "astra.cutscene"
VERSION = 1
FRAMES = ("station", "home", "inertial", "player")
VOICES = ("compact", "reaches", "chorus", "thalune", "ixari", "ulgani", "hollow", "cartographer", "self")
# Blender (Z up) to the engine (Y up): a quarter turn about X; (x, y, z) -> (x, z, -y)
AXES_Q = Matrix.Rotation(-math.pi / 2, 4, "X").to_quaternion()
# reading time of a line with no end marker: a beat plus 16 characters a second
READ_BASE = 1.2
READ_CPS = 16.0
# a line given no end stops this long before the next one starts
LINE_GAP = 0.25


class CutsceneError(Exception):
    pass


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


def words(scene, cid):
    text = bpy.data.texts.get(f"CUT_{cid}")
    if text is None:
        return {"lines": {}, "banners": {}}
    try:
        data = json.loads(text.as_string() or "{}")
    except json.JSONDecodeError as e:
        raise CutsceneError(f"Text block CUT_{cid} is not JSON: {e}")
    return {"lines": data.get("lines", {}), "banners": data.get("banners", {})}


def shots_of(scene, cid, f0, f1):
    """[(camera, first frame, last frame)]: markers bound to cameras cut between them; else the scene camera."""
    bound = sorted((m for m in scene.timeline_markers if m.camera is not None), key=lambda m: m.frame)
    cuts = []
    for m in bound:
        if m.frame >= f1:
            continue
        frame = max(m.frame, f0)
        if cuts and cuts[-1][1] == frame:
            cuts[-1] = (m.camera, frame)
        else:
            cuts.append((m.camera, frame))
    if not cuts or cuts[0][1] > f0:
        cam = cuts[0][0] if cuts and scene.camera is None else scene.camera
        if cam is None:
            raise CutsceneError("no camera: bind markers to cameras or set the scene camera")
        cuts.insert(0, (cam, f0))
    out = []
    for i, (cam, start) in enumerate(cuts):
        end = cuts[i + 1][1] if i + 1 < len(cuts) else f1
        out.append((cam, start, end))
    prefix = f"CAM_{cid}_"
    for cam, _, _ in out:
        if cam.type != "CAMERA":
            raise CutsceneError(f"{cam.name} is not a camera")
        if not cam.name.startswith(prefix) or len(cam.name) == len(prefix):
            raise CutsceneError(f"camera {cam.name} is not named {prefix}<shot>")
        if cam.data.type != "PERSP":
            raise CutsceneError(f"camera {cam.name} is not a perspective camera")
    return out


def export_scene(scene, source=""):
    cid = scene.get("cutscene")
    if not isinstance(cid, str) or not cid:
        raise CutsceneError("the scene has no `cutscene` id (a custom property)")
    frame = scene.get("frame", "")
    if frame not in FRAMES and not (isinstance(frame, str) and frame.startswith("body:") and frame[5:].isdigit()):
        raise CutsceneError(f"frame {frame!r}: one of {', '.join(FRAMES)} or body:<n>")
    anchor = scene.get("anchor", "origin")
    if anchor not in ("origin", "player"):
        raise CutsceneError(f"anchor {anchor!r}: origin or player")
    fps = scene.render.fps / scene.render.fps_base
    f0, f1 = scene.frame_start, scene.frame_end
    if f1 <= f0:
        raise CutsceneError("the frame range is empty")
    t = lambda f: r((f - f0) / fps, 4)  # noqa: E731
    rs = scene.render
    aspect = (rs.resolution_x * rs.pixel_aspect_x) / (rs.resolution_y * rs.pixel_aspect_y)

    shots = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for cam, start, end in shots_of(scene, cid, f0, f1):
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
        shot = {"name": cam.name[len(f"CAM_{cid}_") :], "start": t(start), "end": t(end), "fps": r(fps, 6), "pos": pos, "quat": quat, "fov": fov}
        tr = cam.get("transition")
        if tr is not None:
            if tr not in ("cut", "dip"):
                raise CutsceneError(f"camera {cam.name} transition {tr!r}: cut or dip")
            shot["transition"] = tr
        shots.append(shot)

    text = words(scene, cid)
    starts, ends, events = {}, {}, []
    for m in scene.timeline_markers:
        kind, _, key = m.name.partition(":")
        if not key:
            continue
        if kind == "line":
            starts[key] = m.frame
        elif kind == "end":
            ends[key] = m.frame
        elif kind == "event":
            events.append((m.frame, key))
    duration = t(f1)
    lines = []
    order = sorted(starts.items(), key=lambda kv: kv[1])
    for i, (key, f) in enumerate(order):
        w = text["lines"].get(key)
        if not w or not w.get("text") or not w.get("speaker"):
            raise CutsceneError(f"line {key} has no speaker and text in CUT_{cid}")
        voice = w.get("voice", "self")
        if voice not in VOICES:
            raise CutsceneError(f"line {key} voice {voice!r}: one of {', '.join(VOICES)}")
        begin = t(f)
        nxt = t(order[i + 1][1]) if i + 1 < len(order) else duration
        if key in ends:
            stop = t(ends[key])
            if stop <= begin or stop > nxt + 1e-6:
                raise CutsceneError(f"line {key} ends at {stop} s, outside {begin}–{nxt} s")
        else:
            stop = min(begin + READ_BASE + len(w["text"]) / READ_CPS, nxt - (LINE_GAP if i + 1 < len(order) else 0))
        lines.append({"id": key, "t": begin, "dur": r(stop - begin, 4), "speaker": w["speaker"], "voice": voice, "text": w["text"]})
    for key in text["lines"]:
        if key not in starts:
            raise CutsceneError(f"line {key} in CUT_{cid} has no line:{key} marker")

    out_events = []
    for f, name in sorted(events):
        e = {"t": t(f), "name": name}
        b = text["banners"].get(name)
        if b:
            e["banner"] = {"title": b["title"], "sub": b.get("sub", "")}
        out_events.append(e)

    out = {
        "format": FORMAT,
        "version": VERSION,
        "id": cid,
        "title": scene.get("title", cid),
        "source": source,
        "space": {"frame": frame, "anchor": anchor},
        "duration": duration,
        "aspect": r(aspect, 4),
    }
    for k in ("enter", "exit"):
        if scene.get(k):
            out[k] = scene[k]
    stage = bpy.data.objects.get("STAGE_player")
    if stage is not None:
        scene.frame_set(f0)
        mw = stage.matrix_world
        q = obj_quat(mw)
        out["stage"] = {"player": {"pos": vec(mw.to_translation()), "quat": [r(q.x, 6), r(q.y, 6), r(q.z, 6), r(q.w, 6)]}}
    out["shots"] = shots
    out["lines"] = lines
    out["events"] = out_events
    return out


def write(data, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{data['id']}.json"
    body = json.dumps(data, separators=(",", ":"))
    path.write_text(body + "\n")
    return path


def main(argv):
    p = argparse.ArgumentParser(prog="export_cutscene.py")
    p.add_argument("--src", default=str(SRC))
    p.add_argument("--out", default=str(OUT))
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
            data = export_scene(bpy.context.scene, str(rel))
            path = write(data, Path(args.out))
            n = sum(len(s["fov"]) for s in data["shots"])
            print(f"export cutscenes: {src.name} -> {path} ({len(data['shots'])} shots, {n} samples, {len(data['lines'])} lines, {len(data['events'])} events, {data['duration']} s)")
        except CutsceneError as e:
            failed += 1
            print(f"export cutscenes: {src.name}: {e}")
        except Exception:
            failed += 1
            traceback.print_exc()
    return 1 if failed else 0


# ---------- self-test ----------


def selftest():
    """A two-shot cutscene built in memory: a camera on a path with keyed lens, a second keyed camera bound by a marker,
    two lines and a banner event; exported, then checked against what Blender says at the same frames."""
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
    txt = bpy.data.texts.new("CUT_selftest")
    txt.write(
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

    data = export_scene(scene, "selftest")
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
    p0 = Vector(ride["pos"][0:3])
    to = (Vector((0, 0, -50)) - p0).normalized()
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

    # a broken source says what is wrong
    scene.timeline_markers.new("line:c", frame=90)
    try:
        export_scene(scene)
        expect(False, "a line marker with no words is refused")
    except CutsceneError as err:
        expect("line c" in str(err), f"a line marker with no words is refused ({err})")

    with tempfile.TemporaryDirectory() as d:
        path = write(data, Path(d))
        expect(json.loads(path.read_text())["id"] == "selftest", "writes <id>.json")
    ok = all(results)
    print(f"export_cutscene selftest: {sum(results)}/{len(results)} passed")
    return 0 if ok else 1


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    sys.exit(main(argv))
