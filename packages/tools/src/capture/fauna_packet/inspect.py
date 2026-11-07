"""Independent CPU decoder/receipt inspector. Does not import the caller or launch APIs."""
import hashlib
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def check(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path, limit=2 * 1024 * 1024):
    p = Path(path)
    check(p.is_file() and not p.is_symlink() and p.stat().st_size <= limit, 'Unsafe/oversized receipt: ' + str(p))
    return json.loads(p.read_bytes())


def finite(values, count):
    check(isinstance(values, list) and len(values) == count and all(isinstance(v, (int, float)) and math.isfinite(v) for v in values), 'Invalid numeric pose')
    return values


def flyer_oracle(receipt, viewport):
    check(receipt['offlineReplay'] is True and receipt['target'] == 606 and receipt['speciesKind'] == 'flyer', 'Wrong flyer/replay identity')
    check(receipt['beforeMode'] != 'dead' and receipt['mode'] == 'dead' and receipt['viewport'] == viewport, 'Flyer death/viewport absent')
    m = finite(receipt['instanceMatrix'], 16)
    camera = finite(receipt['cameraWorld'], 3)
    up = finite(receipt['worldUp'], 3)
    source = finite(receipt['sourcePosition'], 3)
    after = finite(receipt['sourcePositionAfter'], 3)
    check(max(abs(a - b) for a, b in zip(source, after)) < 1e-9, 'Authoritative local position changed')
    point = [m[12 + i] + camera[i] + up[i] * receipt['size'] * 0.5 for i in range(3)]
    published = finite(receipt['publishedAnchor'], 3)
    check(max(abs(a - b) for a, b in zip(point, published)) < 0.001, 'Published point differs from actual instance')
    # Quaternion rotation and perspective projection only. No death/fall formula is reproduced.
    qx, qy, qz, qw = finite(receipt['cameraInverseQuaternion'], 4)
    x, y, z = [point[i] - camera[i] for i in range(3)]
    tx, ty, tz = 2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)
    x, y, z = x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx
    p = finite(receipt['projectionMatrix'], 16)
    w = p[3] * x + p[7] * y + p[11] * z + p[15]
    check(w > 0, 'Flyer anchor is behind camera')
    sx = ((p[0] * x + p[4] * y + p[8] * z + p[12]) / w * 0.5 + 0.5) * viewport[0]
    sy = (-(p[1] * x + p[5] * y + p[9] * z + p[13]) / w * 0.5 + 0.5) * viewport[1]
    number = receipt['number']
    check(0 < sx < viewport[0] and 0 < sy < viewport[1], 'Flyer target is not visible')
    check(max(abs(number['left'] - sx), abs(number['top'] - sy)) < 0.05, 'Gold number differs from actual displayed point')
    check(number['sameRecord'] is True and number['value'] == '26' and number['fontSize'] == '26px' and number['color'] == 'var(--accent-hi)', 'Gold killing-blow treatment/identity lost')
    check(abs(number['ageMs'] - 700) < 0.1 and 690 <= receipt['fallAgeMs'] < 750, 'Flyer/live-number sample is not near 700 ms')


def turn_oracle(observations, trace):
    frames = [r['after'] for r in observations if r['path'].startswith('_frames/')]
    check(len(frames) == len(trace['frames']) == 72, 'Turn requires 72 actual frames')
    check([r['traceFrame'] for r in frames] == trace['frames'], 'Actual observations/readout frame receipts differ')
    check([f['frame'] for f in trace['frames']] == list(range(72)), 'Readout frame sequence differs')
    incarnation = frames[0]['target']['incarnation']
    lost = None
    for i, raw in enumerate(frames):
        values = [n['value'] for n in raw['numbers']]
        check(values == raw['traceFrame']['values'] and raw['target']['visible'] == raw['traceFrame']['targetVisible'], 'Live HUD/readout values or visibility disagree')
        check(raw['target']['incarnation'] == incarnation and all(n['target'] == 602 and n['incarnation'] == incarnation and n['sameRecord'] is True for n in raw['numbers']), 'Turn changed target incarnation')
        if not raw['target']['visible'] and lost is None:
            lost = i
        if lost is not None:
            check(not any(v in ('17', '23', '9') for v in values), 'Old/offscreen numbers returned after losing their anchor')
    check(lost is not None and 12 <= lost < 30 and trace['frames'][lost]['ms'] < 900, 'Target was not lost during the bounded early turn')
    for i, visible, values in ((10, True, ['17', '23', '9']), (30, False, []), (52, True, []), (60, True, ['11'])):
        check(frames[i]['target']['visible'] == visible and [n['value'] for n in frames[i]['numbers']] == values, 'Turn checkpoint differs at frame ' + str(i))
    final = frames[-1]
    events = [x for x in final['events'] if x['phase'] == 'turn' and x['event']['kind'] == 'combat']
    expected_events = [(0, 17), (4, 23), (8, 9), (30, 17), (30, 23), (30, 9), (54, 11)]
    check([(e['frame'], e['event']['amount']) for e in events] == expected_events and all(e['event']['target'] == 602 and abs(e['clipTime'] - e['frame'] / 60) < 0.000001 for e in events), 'Actual CombatFeed turn timing/targets differ')
    consumed = [x for take in final['takes'] if take['phase'] == 'turn' for x in take['returned']['dealt']]
    check([x['amount'] for x in consumed] == [v for _, v in expected_events] and all(x['target'] == 602 for x in consumed), 'Actual turn feed consumption differs')
    check([(e['frame'], e['amount']) for e in trace['events']] == expected_events and all(e['consumed'] is True for e in trace['events']), 'Readout/event receipts disagree')


def decode_image(file, dimensions, image_format):
    from PIL import Image
    data = file.read_bytes()
    check(data.endswith(b'\xff\xd9') if image_format == 'JPEG' else data.endswith(bytes.fromhex('0000000049454e44ae426082')), 'Malformed image terminal bytes')
    with Image.open(file) as image:
        check(image.size == dimensions and image.format == image_format, 'Decoded image dimensions/format differ')
        image.verify()
    with Image.open(file) as image:
        image.load()
        check(image.mode in ('RGB', 'RGBA'), 'Unexpected screenshot pixel mode')


def broad_oracle(observations, readout):
    frames = [row['after'] for row in observations if row['path'].startswith('_frames/')]
    check(len(frames) == 204, 'Broad fight requires 204 actual frames')
    for i, raw in enumerate(frames):
        check(raw['phase'] == 'fight' and abs(raw['clipTime'] - (i + 1) / 60) < 0.000001, 'Broad actual frame clock/order differs')
    final = frames[-1]
    events = [row['event'] for row in final['events'] if row['phase'] == 'fight']
    check([event['kind'] for event in events] == ['combat'] * 8 + ['xp', 'loot', 'loot'], 'Broad fight event sequence differs')
    dealt = [event for event in events if event['kind'] == 'combat' and event['target'] in (602, 603)]
    check([(event['target'], event['amount'], event['killed']) for event in dealt] ==
          [(603, 12, False), (603, 18, False), (603, 9, False), (602, 21, False), (603, 15, False), (603, 24, False), (603, 31, True)], 'Broad fight hits differ')
    consumed = [event for take in final['takes'] if take['phase'] == 'fight' for event in take['returned']['dealt']]
    check([(event['target'], event['amount'], event['killed']) for event in consumed] ==
          [(event['target'], event['amount'], event['killed']) for event in dealt], 'Broad fight consumption differs')
    taken = [event for take in final['takes'] if take['phase'] == 'fight' for event in take['returned']['taken']]
    gained = [event for take in final['takes'] if take['phase'] == 'fight' for event in take['returned']['gained']]
    check([(event['source'], event['amount']) for event in taken] == [(602, 11)], 'Broad incoming damage consumption differs')
    check([(event['what'], event['count']) for event in gained] == [('xp', 30), ('units', 7), ('units', 7)], 'Broad XP/loot consumption differs')
    check(readout.startswith('HUD frame cost over 204 frames:') and '\nframes over 1 ms:' in readout, 'Broad HUD readout missing')


def inspect(ready, unit):
    from PIL import Image, ImageFile
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    Image.MAX_IMAGE_PIXELS = 4_000_000
    spec = ready['units'][unit]
    output, evidence = Path(spec['output']), Path(spec['evidence'])
    broad = spec['kind'] == 'broad'
    check(spec['kind'] in ('broad', 'correction'), 'Wrong capture kind')
    if broad:
        check(unit == ('fauna-combat' if spec['light'] == 'day' else 'fauna-combat-night') and spec['aspect'] == '16x9', 'Wrong broad screen identity')
    else:
        check(unit == 'fauna-hit-turn-' + spec['light'] + '-' + spec['aspect'], 'Wrong screen identity')
    frames, stills = (204, 14) if broad else (72, 8)
    expected = []
    # Construct independently of the entry's outputPlan.
    for aspect in ('16x9', '21x9'):
        suffixes = ('', '-numbers', '-kill', '-flash', '-analysis', '-offscreen', '-start') if broad else ('', '-kill', '-offscreen', '-start')
        expected.extend(aspect + suffix + '.png' for suffix in suffixes)
        if aspect == spec['aspect']:
            expected.extend('_frames/%03d.jpg' % i for i in range(frames))
            expected.extend(('readout.txt', 'clip-sheet.png'))
    actual = []
    for p in output.rglob('*'):
        check(not p.is_symlink() and (p.is_file() or p.is_dir()), 'Unsafe output entry')
        if p.is_dir():
            check(p == output / '_frames', 'Unexpected output directory')
        if p.is_file():
            actual.append(str(p.relative_to(output)))
    check(sorted(actual) == sorted(expected) and len(actual) == stills + frames + 2, 'Missing/extra output/count')
    result = load(evidence / 'entry-result.json')
    check(result['accepted'] is True and result['primaryFailure'] is None and result['unit'] == unit and result['pages'] == 2 and result['launched'] == 1, 'Raw entry outcome refused')
    check([x['path'] for x in result['writes']] == expected, 'Output writes reordered/incomplete')
    sources = load(evidence / 'source-methods.json')
    check(sources['unit'] == unit and sources['productBindings'] == ready['productBindings'], 'Source bindings differ')
    check(set(sources['expectedMethods']) == {'HUD.hitNumber', 'HUD.hitAnchor', 'Fauna.update', 'Fauna.hitAnchor', 'CombatFeed.event', 'CombatFeed.take'}, 'Source method set differs')
    check(all(isinstance(h, str) and len(h) == 64 and all(c in '0123456789abcdef' for c in h) for h in sources['expectedMethods'].values()), 'Source method hash malformed')
    for page in (1, 2):
        methods = load(evidence / ('page-source-%d.json' % page))
        check(methods['actual'] == methods['expectedMethods'] == sources['expectedMethods'], 'Actual page/source method mismatch')
    observations_path = evidence / 'capture-observations.jsonl'
    check(observations_path.stat().st_size <= (16 if broad else 2) * 1024 * 1024, 'Observation journal exceeds cap')
    observations = [json.loads(row) for row in observations_path.read_text().splitlines()]
    photo_paths = [name for name in expected if name not in ('clip-sheet.png', 'readout.txt')]
    check([r['path'] for r in observations] == photo_paths and len(observations) == stills + frames, 'Missing/reordered actual observations')
    total = 0
    for index, name in enumerate(expected):
        file = output / name
        limit = 16384 if name == 'readout.txt' else 16 * 1024 * 1024
        size = file.stat().st_size
        check(0 < size <= limit, 'Per-file cap exceeded')
        data = file.read_bytes()
        check(result['writes'][index] == {'path': name, 'bytes': size, 'sha256': digest(data)}, 'Raw output bytes/index mismatch')
        total += size
        if name == 'readout.txt':
            continue
        if name == 'clip-sheet.png':
            dimensions = (2400, 1526 if broad else 1228 if spec['aspect'] == '16x9' else 972)
        else:
            width = 2520 if name.startswith('21x9') or name.startswith('_frames/') and spec['aspect'] == '21x9' else 1920
            dimensions = (width, 1080)
        decode_image(file, dimensions, 'JPEG' if name.endswith('.jpg') else 'PNG')
    for row in observations:
        name, raw = row['path'], row['after']
        width = 2520 if name.startswith('21x9') or name.startswith('_frames/') and spec['aspect'] == '21x9' else 1920
        viewport = [width, 1080]
        check(row['ordinal'] == expected.index(name) and row['sourceBindings'] == ready['productBindings'], 'Observation source/order differs')
        check(row['sha256'] == digest((output / name).read_bytes()), 'Observation image binding differs')
        check(raw['viewport'] == raw['canvas'] == viewport and row['before']['gameTime'] == raw['gameTime'] and row['before']['clipTime'] == raw['clipTime'], 'Actual viewport/time changed during screenshot')
        check(all(n['sameRecord'] is True and isinstance(n['incarnation'], int) for n in raw['numbers']), 'HUD number changed incarnation')
        if '-kill' in name and not broad:
            flyer_oracle(raw['flyer'], viewport)
            events = [x for x in raw['events'] if x['phase'] == 'kill' and x['event']['kind'] == 'combat']
            consumed = [x for take in raw['takes'] if take['phase'] == 'kill' for x in take['returned']['dealt']]
            check(len(events) == len(consumed) == 1 and events[0]['event']['target'] == consumed[0]['target'] == 606 and events[0]['event']['killed'] is True and consumed[0]['killed'] is True, 'Actual flyer CombatFeed event/consumption absent')
        if '-offscreen' in name:
            events = [x for x in raw['events'] if x['phase'] == 'offscreen' and x['event']['kind'] == 'combat']
            consumed = [x for take in raw['takes'] if take['phase'] == 'offscreen' for x in take['returned']['dealt']]
            check([(x['event']['target'], x['event']['amount']) for x in events] == [(602, 17), (603, 23), (602, 9)] and [(x['target'], x['amount']) for x in consumed] == [(602, 17), (603, 23), (602, 9)] and not raw['numbers'] and not raw['target']['visible'], 'Offscreen event/take/suppression differs')
        if name.startswith('_frames/') and not broad:
            i = int(Path(name).stem)
            check(raw['phase'] == 'turn' and raw['traceFrame']['frame'] == i and abs(raw['traceFrame']['ms'] - (i + 1) * 1000 / 60) < 0.001, 'Actual frame clock/order differs')
            check(raw['target']['id'] == 602 and (raw['target']['visible'] or not raw['numbers']), 'Actual turn target association lost')
    readout = (output / 'readout.txt').read_text()
    if broad:
        broad_oracle(observations, readout)
    else:
        turn_oracle(observations, json.loads(readout.splitlines()[1]))
    return {'accepted': True, 'unit': unit, 'stills': stills, 'frames': frames, 'sheets': 1, 'readouts': 1, 'decodedImages': stills + frames + 1,
            'outputBytes': total, 'scope': 'OFFLINE_VISUAL_REPLAY_ONLY', 'realTimeOrServerQualification': False}


if __name__ == '__main__':
    try:
        ready = load(sys.argv[1])
        check(sys.flags.isolated == 1, 'Inspector requires isolated Python')
        sys.path.insert(0, ready['decoderSite'])
        print(json.dumps(inspect(ready, sys.argv[2]), sort_keys=True))
    except BaseException as error:
        print(json.dumps({'accepted': False, 'failure': {'type': type(error).__name__, 'message': str(error)}}), file=sys.stderr)
        raise SystemExit(1)
