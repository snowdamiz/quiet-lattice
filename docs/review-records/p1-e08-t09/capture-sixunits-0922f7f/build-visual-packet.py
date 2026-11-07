import datetime
import hashlib
import json
from pathlib import Path
import struct

packet = Path('/private/tmp/fauna-visual-packet-current-xmd3v6d9')
parents = [Path(p) for p in [
    '/private/tmp/space-fauna-parent-unit1-r4-uiweok3o',
    '/private/tmp/space-fauna-parent-unit2-r4-fhmsxpm9',
    '/private/tmp/space-fauna-parent-unit3-r4-wknexcns',
    '/private/tmp/space-fauna-parent-unit4-r4-5g8yyq9s',
    '/private/tmp/space-fauna-parent-unit5-r4-2o4fqqkb',
    '/private/tmp/space-fauna-parent-unit6-r4-idxzcjn5',
]]

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()

def dimensions(p):
    with p.open('rb') as f:
        header = f.read(24)
        if header[:8] == b'\x89PNG\r\n\x1a\n':
            assert header[12:16] == b'IHDR'
            return struct.unpack('>II', header[16:24])
        assert header[:2] == b'\xff\xd8', p
        f.seek(2)
        for _ in range(10000):
            b = f.read(1)
            assert b == b'\xff', (p, b)
            while b == b'\xff':
                b = f.read(1)
            marker = b[0]
            assert marker not in (0xDA, 0xD9), p
            if marker == 0x01 or 0xD0 <= marker <= 0xD8:
                continue
            length = struct.unpack('>H', f.read(2))[0]
            assert length >= 2
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                _, height, width = struct.unpack('>BHH', f.read(5))
                return width, height
            f.seek(length - 2, 1)
    raise AssertionError(p)

manifest = {'sourceHead': '0922f7fc3df310cbdd624d8fa5846b73a9cfe533',
            'sourceTree': 'baa2cd37e8e767e73612161bca28fc425d87cde1', 'units': []}
lines = ['# Fauna presentation artifacts', '',
         'Read TASK.md, DESIGN-REFERENCES.md, art-bible.md, RUBRIC.md and scope.json. '
         'This index identifies the original captured bytes; it contains no visual verdict.', '',
         'Frame sequences are ordered zero-based JPEGs sampled at deterministic 1/60-second simulation steps. '
         'This is not evidence of observed real-time 60 fps. Readouts describe their measured scope.', '',
         'Every still, sheet, frame and readout is bound in artifacts.json. '
         'Inspect originals at full resolution where needed; sheets are navigation aids.', '']
audits = []
for parent in parents:
    audit_path = parent / 'parent-terminal-audit.json'
    audit = json.loads(audit_path.read_text())
    assert audit['outcome'] == 'PASS_OFFLINE_CAPTURE_UNIT' and audit['released']
    assert audit['head'] == manifest['sourceHead'] and audit['tree'] == manifest['sourceTree']
    result_path = Path(audit['receipt']['result']['path'])
    assert digest(result_path) == audit['receipt']['result']['sha256']
    result = json.loads(result_path.read_text())
    root = Path(audit['output'])
    rows = []
    for entry in result['raw']['outputManifest']:
        p = root / entry['path']
        assert p.is_file() and not p.is_symlink()
        assert p.stat().st_size == entry['bytes'] and digest(p) == entry['sha256']
        row = {**entry, 'absolutePath': str(p)}
        if p.suffix in ('.png', '.jpg'):
            row['width'], row['height'] = dimensions(p)
            row['kind'] = 'frame' if entry['path'].startswith('_frames/') else ('sheet' if p.name == 'clip-sheet.png' else 'still')
        else:
            assert p.name == 'readout.txt'
            row['kind'] = 'readout'
        rows.append(row)
    unit = {'unit': audit['unit'], 'root': str(root), 'files': rows}
    manifest['units'].append(unit)
    lines.extend(['## ' + audit['unit'], '', 'Original directory: `' + str(root) + '`', '',
                  '| Artifact | Dimensions |', '|---|---|'])
    for row in rows:
        if row['kind'] != 'frame':
            size = str(row['width']) + 'x' + str(row['height']) if 'width' in row else 'text'
            lines.append('| [' + row['path'] + '](' + row['absolutePath'] + ') | ' + size + ' |')
    frames = [r for r in rows if r['kind'] == 'frame']
    lines.extend(['', str(len(frames)) + ' ordered frames: `' + str(root / '_frames') + '/000.jpg` onward.', ''])
    audits.append({'parent': str(parent), 'auditSha256': digest(audit_path), 'exit': audit['exit'],
                   'inspection': audit['inspection'], 'receipt': audit['receipt']})
all_rows = [r for u in manifest['units'] for r in u['files']]
counts = {k: sum(r['kind'] == k for r in all_rows) for k in ('frame', 'still', 'sheet', 'readout')}
assert counts == {'frame': 696, 'still': 60, 'sheet': 6, 'readout': 6}, counts
manifest['counts'] = counts
manifest['totalFiles'] = len(all_rows)
manifest['totalBytes'] = sum(r['bytes'] for r in all_rows)
assert len(all_rows) == 768
with (packet / 'artifacts.json').open('x') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
with (packet / 'INDEX.md').open('x') as f:
    f.write('\n'.join(lines) + '\n')
seal = {p.name: {'sha256': digest(p), 'bytes': p.stat().st_size} for p in packet.iterdir() if p.is_file()}
with (packet / 'SEAL.json').open('x') as f:
    json.dump(seal, f, indent=2)
    f.write('\n')
summary = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'outcome': 'PASS_SIX_OFFLINE_CAPTURE_UNITS',
           'sourceHead': manifest['sourceHead'], 'sourceTree': manifest['sourceTree'], 'counts': counts,
           'totalFiles': len(all_rows), 'totalBytes': manifest['totalBytes'], 'parentAudits': audits,
           'packet': str(packet), 'indexSha256': digest(packet / 'INDEX.md'), 'sealSha256': digest(packet / 'SEAL.json'),
           'scope': 'Offline replay capture and parent-observed exits/releases. Visual and real-time performance are separate.'}
with (parents[0] / 'six-unit-summary.json').open('x') as f:
    json.dump(summary, f, indent=2)
    f.write('\n')
print(json.dumps({k: v for k, v in summary.items() if k != 'parentAudits'}))
