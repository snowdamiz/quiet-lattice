"""Freeze the one protected Apple compiler actually observed on the pinned browser route."""
from pathlib import Path
import stat
import subprocess

from bindings import file_binding
from contract import require

PATH = '/System/Library/Frameworks/Metal.framework/Versions/A/XPCServices/MTLCompilerService.xpc/Contents/MacOS/MTLCompilerService'
SHA256 = '65af927ce641351e604bf36da7a664e5350d583483c7e5f3fe799e0d0db7a78b'
CODESIGN = '/usr/bin/codesign'
CODESIGN_SHA256 = 'd517c9be608ffd266ec106c685e880cda71abc94001450e36d2476016406dd1e'
REQUIREMENT = 'identifier "com.apple.MTLCompilerService" and anchor apple'
CDHASH = '0564f4ea2063dbc3a9de0ac47ded14661384d230'


def protected_route(path):
    path, rows = Path(path), []
    for component in [*reversed(path.parents), path]:
        info = component.lstat()
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'MTL binding requires root-protected route')
        require(stat.S_ISREG(info.st_mode) if component == path else stat.S_ISDIR(info.st_mode),
                'MTL binding refuses symlink/special route')
        if component == path:
            require(info.st_mode & 0o111, 'MTL binding requires executable leaf')
        rows.append({'path': str(component), **{k: getattr(info, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')}})
    require(path.resolve(strict=True) == path, 'MTL binding requires canonical route')
    return rows


def binding():
    route, verifier_route = protected_route(PATH), protected_route(CODESIGN)
    executable, verifier = file_binding(PATH), file_binding(CODESIGN)
    require(executable['sha256'] == SHA256 and executable['bytes'] == 389760, 'MTL executable differs from reviewed exact bytes')
    require(verifier['sha256'] == CODESIGN_SHA256 and verifier['bytes'] == 973408, 'MTL codesign differs from reviewed exact bytes')
    observations = []
    for args in (['--verify', '--strict', '-R', '=' + REQUIREMENT], ['-d', '--verbose=4', '-r-']):
        argv = [CODESIGN, *args, PATH]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        require(len(result.stdout.encode()) + len(result.stderr.encode()) <= 64 * 1024, 'MTL signature observation cap')
        observations.append({'argv': argv, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        require(result.returncode == 0, 'MTL signature verification failed')
    metadata = observations[-1]['stdout'] + observations[-1]['stderr']
    fields = dict(line.split('=', 1) for line in metadata.splitlines() if '=' in line)
    require(fields.get('Identifier') == 'com.apple.MTLCompilerService' and fields.get('Platform identifier') == '26',
            'MTL Apple platform identity differs from review')
    require('designated => ' + REQUIREMENT in metadata.splitlines() and fields.get('CDHash') == CDHASH,
            'MTL designated requirement/CDHash differs from review')
    require(protected_route(PATH) == route and protected_route(CODESIGN) == verifier_route,
            'MTL protected route changed during signature observation')
    require(file_binding(PATH) == executable and file_binding(CODESIGN) == verifier,
            'MTL executable/verifier changed during signature observation')
    return {'executable': executable, 'codesign': verifier, 'requirement': REQUIREMENT,
            'route': route, 'codesignRoute': verifier_route, 'observations': observations,
            'scope': 'Exact executable only; unchanged current UID/birth/coalition checks still required. Future effects membership and external XPC ownership unqualified.'}
