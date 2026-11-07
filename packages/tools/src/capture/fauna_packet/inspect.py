"""Independent CPU decoder/receipt inspector. Does not import the caller or launch APIs."""
import hashlib
import importlib.util
import io
import struct
import zlib
import json
import math
from pathlib import Path
import sys

sys.dont_write_bytecode = True
_file_spec = importlib.util.spec_from_file_location('fauna_inspector_file_io', Path(__file__).with_name('file_io.py'))
file_io = importlib.util.module_from_spec(_file_spec)
_file_spec.loader.exec_module(file_io)


def check(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path, limit=2 * 1024 * 1024):
    return file_io.bounded_read(path, limit, keep=True, finish=lambda data, _: json.loads(data))


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


def png_container(data, dimensions):
    check(data[:8] == b'\x89PNG\r\n\x1a\n', 'Invalid PNG signature')
    offset, palette, idat_started, idat_ended = 8, False, False, False
    header, compressed = None, []
    while offset < len(data):
        check(offset + 12 <= len(data), 'Truncated PNG chunk')
        size = int.from_bytes(data[offset:offset + 4], 'big')
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        check(end <= len(data) and all(65 <= c <= 90 or 97 <= c <= 122 for c in kind) and not kind[2] & 32, 'Invalid PNG chunk length/type')
        body = memoryview(data)[offset + 8:end - 4]
        check(zlib.crc32(memoryview(data)[offset + 4:end - 4]) & 0xffffffff == int.from_bytes(data[end - 4:end], 'big'), 'PNG CRC mismatch')
        check(header is not None or kind == b'IHDR', 'PNG IHDR must be first')
        if kind == b'IHDR':
            check(header is None and offset == 8 and size == 13, 'Duplicate/invalid PNG IHDR')
            header = struct.unpack('>IIBBBBB', body)
            width, height, depth, color, compression, filtering, interlace = header
            check((width, height) == dimensions and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0, 'Unexpected PNG screenshot header')
        elif kind == b'PLTE':
            check(not palette and not idat_started and size > 0 and size % 3 == 0 and size <= 256 * 3, 'Invalid/duplicate/out-of-order PNG PLTE')
            palette = True
        elif kind == b'IDAT':
            check(not idat_ended, 'Noncontiguous PNG IDAT')
            idat_started = True
            compressed.append(body)
        elif kind == b'IEND':
            check(size == 0 and idat_started and end == len(data), 'Invalid PNG IEND')
            row_bytes = dimensions[0] * (3 if header[3] == 2 else 4) + 1
            expected = row_bytes * dimensions[1]
            decoder = zlib.decompressobj()
            pixels = decoder.decompress(b''.join(compressed), expected + 1)
            check(len(pixels) == expected and decoder.eof and not decoder.unconsumed_tail and not decoder.unused_data, 'Invalid/oversized PNG pixel stream')
            check(all(pixels[i] <= 4 for i in range(0, expected, row_bytes)), 'Invalid PNG row filter')
            return
        else:
            check(kind[0] & 32, 'Unknown critical PNG chunk')
        if idat_started and kind != b'IDAT':
            idat_ended = True
        offset = end
    check(False, 'Missing PNG IEND')


def decode_image(file, dimensions, image_format, data=None):
    from PIL import Image
    if data is None:
        data, _ = file_io.bounded_read(file, 16 * 1024 * 1024, keep=True)
    check(data.endswith(b'\xff\xd9') if image_format == 'JPEG' else data.endswith(bytes.fromhex('0000000049454e44ae426082')), 'Malformed image terminal bytes')
    if image_format == 'PNG':
        png_container(data, dimensions)
    with Image.open(io.BytesIO(data)) as image:
        check(image.size == dimensions and image.format == image_format, 'Decoded image dimensions/format differ')
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        check(image.mode in ('RGB', 'RGBA'), 'Unexpected screenshot pixel mode')


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def close(actual, expected, message):
    check(number(actual) and abs(actual - expected) < 0.00001, message)


def broad_oracle(observations, readout):
    frames = [row for row in observations if row['path'].startswith('_frames/')]
    check(len(frames) == 204, 'Broad fight requires 204 actual frames')
    # Independent schedule from the unchanged fightClip fixture: dispatch before frame(), take during frame().
    schedule = [
        (9, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 12, 'killed': False, 'hp': 0.5}),
        (18, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 18, 'killed': False, 'hp': 0.5}),
        (22, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 9, 'killed': False, 'hp': 0.5}),
        (33, {'kind': 'combat', 'source': 1, 'target': 602, 'amount': 21, 'killed': False, 'hp': 0.5}),
        (51, {'kind': 'combat', 'source': 602, 'target': 1, 'amount': 11, 'killed': False, 'hp': 0.9}),
        (66, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 15, 'killed': False, 'hp': 0.5}),
        (87, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 24, 'killed': False, 'hp': 0.5}),
        (96, {'kind': 'combat', 'source': 1, 'target': 603, 'amount': 31, 'killed': True, 'hp': 0}),
        (105, {'kind': 'xp', 'amount': 30, 'level': 1}),
        (108, {'kind': 'loot', 'item': 'units', 'count': 7}),
        (180, {'kind': 'loot', 'item': 'units', 'count': 7}),
    ]
    first = frames[0]['after']
    check(number(first.get('gameTime')) and number(first.get('hudTime')), 'Nonfinite broad clock origin')
    game_base, hud_base = first['gameTime'] - 1 / 60, first['hudTime'] - 1000 / 60
    previous = None
    event_base = take_base = None
    for i, row in enumerate(frames):
        before, raw = row['before'], row['after']
        for sample in (before, raw):
            check(sample.get('phase') == 'fight' and sample.get('actor') == 1, 'Wrong broad phase/actor')
            close(sample.get('clipTime'), (i + 1) / 60, 'Broad actual frame clock/order differs')
            close(sample.get('gameTime'), game_base + (i + 1) / 60, 'Broad game clock differs')
            close(sample.get('hudTime'), hud_base + (i + 1) * 1000 / 60, 'Broad HUD clock differs')
            check(number(sample.get('feedTime')), 'Nonfinite feed clock')
            check(isinstance(sample.get('events'), list) and isinstance(sample.get('takes'), list), 'Missing broad cumulative feed journal')
        check(before['events'] == raw['events'] and before['takes'] == raw['takes'], 'Feed changed during screenshot')
        check(before['feedTime'] <= raw['feedTime'], 'Feed clock went backwards during screenshot')
        if previous is None:
            event_base, take_base = len(raw['events']), len(raw['takes'])
            check(all(e.get('phase') != 'fight' for e in raw['events'] + raw['takes']), 'Unexpected first-frame fight entries')
        else:
            check(previous['feedTime'] <= before['feedTime'], 'Feed clock went backwards between frames')
            for key in ('events', 'takes'):
                check(raw[key][:len(previous[key])] == previous[key], 'Cumulative feed history changed: ' + key)
        due = [(frame, payload) for frame, payload in schedule if frame <= i]
        check(len(raw['events']) == event_base + len(due) and len(raw['takes']) == take_base + len(due), 'Incomplete/extra broad feed journal')
        for j, (frame, payload) in enumerate(due):
            event, take = raw['events'][event_base + j], raw['takes'][take_base + j]
            for stamped, is_take in ((event, False), (take, True)):
                check(stamped.get('phase') == 'fight' and stamped.get('frame', 'missing') is None, 'Wrong broad feed phase/frame')
                close(stamped.get('clipTime'), frame / 60, 'Broad feed clip stamp differs')
                close(stamped.get('gameTime'), game_base + (frame + int(is_take)) / 60, 'Broad feed game stamp differs')
                close(stamped.get('hudTime'), hud_base + frame * 1000 / 60, 'Broad feed HUD stamp differs')
            check(all(event['event'].get(k) == v for k, v in payload.items()), 'Broad incoming event payload differs')
            if payload['kind'] == 'combat':
                channel = 'taken' if payload['target'] == 1 else 'dealt'
                feedback = {k: payload[k] for k in ('amount', 'killed', 'hp')}
                feedback['source' if channel == 'taken' else 'target'] = payload['source' if channel == 'taken' else 'target']
            else:
                channel = 'gained'
                feedback = {'what': 'xp', 'count': 30, 'level': 1} if payload['kind'] == 'xp' else {'what': 'units', 'count': 7}
            queues = event.get('queues')
            check(isinstance(queues, dict) and set(queues) == {'dealt', 'taken', 'gained'}, 'Incomplete queued feed contract')
            check(all(isinstance(queues[key], list) and len(queues[key]) == int(key == channel) for key in queues), 'Wrong queued feed channels')
            value = queues[channel][0]
            check(all(value.get(k) == v for k, v in feedback.items()) and number(value.get('at')), 'Queued payload/clock differs')
            event_frame = frames[frame]
            low = frames[frame - 1]['after']['feedTime']
            check(low <= value['at'] <= event_frame['before']['feedTime'], 'Queued event outside its actual frame interval')
            check(take.get('returned') == queues, 'Complete event-to-consumption contract differs')
        previous = raw
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
    inventory = file_io.tree_plan(output, (stills + frames + 1) * 16 * 1024 * 1024 + 16384, entry_cap=len(expected) + 1)
    actual = [row['path'] for row in inventory['files']]
    check(inventory['directories'] == {'_frames'}, 'Unexpected output directory')
    check(sorted(actual) == sorted(expected) and len(actual) == stills + frames + 2, 'Missing/extra output/count')
    result = load(evidence / 'entry-result.json')
    check(result['accepted'] is True and result['primaryFailure'] is None and not result.get('cleanupFailures') and not result.get('persistenceFailures') and result['unit'] == unit and result['pages'] == 2 and result['launched'] == 1, 'Raw entry outcome refused')
    check([x['path'] for x in result['writes']] == expected, 'Output writes reordered/incomplete')
    sources = load(evidence / 'source-methods.json')
    check(sources['unit'] == unit and sources['productBindings'] == ready['productBindings'], 'Source bindings differ')
    check(set(sources['expectedMethods']) == {'HUD.hitNumber', 'HUD.hitAnchor', 'Fauna.update', 'Fauna.hitAnchor', 'CombatFeed.event', 'CombatFeed.take'}, 'Source method set differs')
    check(all(isinstance(h, str) and len(h) == 64 and all(c in '0123456789abcdef' for c in h) for h in sources['expectedMethods'].values()), 'Source method hash malformed')
    for page in (1, 2):
        methods = load(evidence / ('page-source-%d.json' % page))
        check(methods['actual'] == methods['expectedMethods'] == sources['expectedMethods'], 'Actual page/source method mismatch')
    observations_path = evidence / 'capture-observations.jsonl'
    journal, _ = file_io.bounded_read(observations_path, (16 if broad else 2) * 1024 * 1024, keep=True)
    observations = [json.loads(row) for row in journal.splitlines()]
    photo_paths = [name for name in expected if name not in ('clip-sheet.png', 'readout.txt')]
    check([r['path'] for r in observations] == photo_paths and len(observations) == stills + frames, 'Missing/reordered actual observations')
    total, digests, readout = 0, {}, None
    for index, name in enumerate(expected):
        file = output / name
        limit = 16384 if name == 'readout.txt' else 16 * 1024 * 1024
        size = inventory['pins'][str(file.absolute())].st_size
        check(0 < size <= limit, 'Per-file cap exceeded')
        data, digests[name] = file_io.bounded_read(file, size, inventory['pins'], keep=True)
        check(result['writes'][index] == {'path': name, 'bytes': size, 'sha256': digests[name]}, 'Raw output bytes/index mismatch')
        total += size
        if name == 'readout.txt':
            readout = data.decode('utf-8')
            continue
        if name == 'clip-sheet.png':
            dimensions = (2400, 1526 if broad else 1228 if spec['aspect'] == '16x9' else 972)
        else:
            width = 2520 if name.startswith('21x9') or name.startswith('_frames/') and spec['aspect'] == '21x9' else 1920
            dimensions = (width, 1080)
        decode_image(file, dimensions, 'JPEG' if name.endswith('.jpg') else 'PNG', data)
    for row in observations:
        name, raw = row['path'], row['after']
        if broad:
            for sample in (row['before'], raw):
                check(all(number(sample.get(clock)) for clock in ('gameTime', 'hudTime', 'feedTime')), 'Nonfinite broad sample clock')
                check(sample.get('actor') == 1 and isinstance(sample.get('events'), list) and isinstance(sample.get('takes'), list), 'Incomplete broad sample journal')
        width = 2520 if name.startswith('21x9') or name.startswith('_frames/') and spec['aspect'] == '21x9' else 1920
        viewport = [width, 1080]
        check(row['ordinal'] == expected.index(name) and row['sourceBindings'] == ready['productBindings'], 'Observation source/order differs')
        check(row['sha256'] == digests[name], 'Observation image binding differs')
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
        print(json.dumps({'accepted': False, 'failure': file_io.failure(error)}), file=sys.stderr)
        raise SystemExit(1)
