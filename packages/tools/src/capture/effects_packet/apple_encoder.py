"""Pin only the Apple executable actually observed inside this pilot's owned coalition."""
import stat
import subprocess
from pathlib import Path
from bindings import file_binding
from contract import require

PATH = '/System/Library/Frameworks/VideoToolbox.framework/Versions/A/XPCServices/VTEncoderXPCService.xpc/Contents/MacOS/VTEncoderXPCService'
REQUIREMENT = 'identifier "com.apple.coremedia.videoencoder" and anchor apple'


def binding():
    path = Path(PATH)
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'Apple encoder canonical protected executable required')
    before = file_binding(path)
    observations = []
    for args in (['--verify', '--strict', '-R', '=' + REQUIREMENT], ['-d', '--verbose=4', '-r-']):
        argv = ['/usr/bin/codesign', *args, str(path)]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        require(len(result.stdout.encode()) + len(result.stderr.encode()) <= 64 * 1024, 'Encoder signature observation cap')
        observations.append({'argv': argv, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
        require(result.returncode == 0, 'Apple encoder signature verification failed')
    metadata = observations[-1]['stdout'] + observations[-1]['stderr']
    fields = dict(line.split('=', 1) for line in metadata.splitlines() if '=' in line)
    require(fields.get('Identifier') == 'com.apple.coremedia.videoencoder' and fields.get('Platform identifier', '').isdigit() and int(fields['Platform identifier']) > 0, 'Apple platform encoder identity required')
    require('designated => ' + REQUIREMENT in metadata.splitlines() and fields.get('CDHash'), 'Apple encoder designated requirement')
    require(file_binding(path) == before, 'Apple encoder changed during signature observation')
    return {'executable': before, 'codesign': file_binding('/usr/bin/codesign'), 'requirement': REQUIREMENT,
            'observations': observations, 'scope': 'Exact kernel-owned executable only; no external XPC ownership inferred.'}
