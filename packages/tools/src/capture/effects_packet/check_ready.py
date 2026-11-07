"""Read-only CPU readiness audit. Does not import native helpers or create a grant."""
import sys
sys.dont_write_bytecode = True
import json
import struct
from pathlib import Path
from bindings import verify
from cache_owners import check_cache_owners
from contract import HERE, ledger, plan, require, snapshot
import caller


def check():
    snap = snapshot(HERE / 'readiness.json')
    r = snap['value']
    require(r['runtimeEnabled'] is False and caller.RUNTIME_ENABLED is False, 'Python/readiness must remain disabled')
    require('export const RUNTIME_ENABLED = false;' in (HERE / 'entry.mjs').read_text(), 'Node entry must remain disabled')
    require(r['pilot']['files'] == plan() and r['budget'] == ledger(), 'Pilot/ledger drift')
    current = verify(r)
    cache_owners = []
    check_cache_owners(r, cache_owners, 'disabled-readiness-audit')
    manifest = snapshot(Path(r['root']) / 'assets/blend/effects/manifest.json')['value']
    asset = next(a for a in manifest['assets'] if a['id'] == r['pilot']['asset'])
    require(asset == r['asset'], 'Manifest mapping changed')
    glb = (Path(r['root']) / 'packages/client/public' / asset['glb'].lstrip('/')).read_bytes()
    require(glb[:4] == b'glTF' and struct.unpack_from('<I', glb, 8)[0] == len(glb), 'Actual GLB container')
    size = struct.unpack_from('<I', glb, 12)[0]
    model = json.loads(glb[20:20 + size])
    mesh_node = next(n for n in model['nodes'] if n.get('name') == asset['mesh'])
    primitive = model['meshes'][mesh_node['mesh']]['primitives']
    require(len(primitive) == 1 and model['materials'][primitive[0]['material']]['name'] == asset['material'], 'Actual filament material mapping')
    require(model['accessors'][primitive[0]['indices']]['count'] == asset['triangles'] * 3, 'Actual exported triangles')
    require(any(i.get('name') == 'gravitic_filament' and i.get('mimeType') == 'image/ktx2' for i in model['images']), 'Actual compressed filament image absent')
    for key in ('output', 'evidence', 'consumption', 'grant'):
        p = Path(r['pilot'][key])
        require(not p.exists() and not p.is_symlink(), 'Unused real identity no longer absent: ' + key)
    return {'status': 'PASS_SOURCE_ONLY_DISABLED', 'source': current, 'readinessSha256': snap['sha256'],
            'bindings': len(r['bindings']), 'dependencyTrees': r['dependencyTrees'],
            'runtimeEnabled': False, 'realGrantCreated': False, 'nativeCaptureStarted': False,
            'assetHead': r['assetHead'], 'budget': r['budget']['admissionBytes'], 'outputCap': r['budget']['outputCapBytes'],
            'cacheOwnerChecks': cache_owners}


if __name__ == '__main__':
    print(json.dumps(check(), indent=2, sort_keys=True))
