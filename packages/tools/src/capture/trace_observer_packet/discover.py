"""Read-only local pin discovery. Writes one disabled binding, never a grant or runtime output."""
import ctypes
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from metadata import atomic, encode
from freeze import NODE, ROOT, bind_file


def discover():
    if subprocess.check_output([NODE, '--version'], text=True).strip() != 'v22.23.3':
        raise RuntimeError('Pinned Node version missing')
    lib = ctypes.CDLL('/usr/lib/libproc.dylib')
    buffer = ctypes.create_string_buffer(4096)
    if lib.proc_pidpath(os.getpid(), buffer, len(buffer)) <= 0:
        raise RuntimeError('Python kernel executable unobserved')
    python_kernel = str(Path(os.fsdecode(buffer.value)).resolve())
    script = "const {createRequire}=require('node:module');const r=createRequire(process.cwd()+'/packages/tools/package.json');console.log(JSON.stringify({browser:r('@playwright/test').chromium.executablePath(),tsx:r.resolve('tsx')}));"
    import json
    resolved = json.loads(subprocess.check_output([NODE, '-e', script], cwd=ROOT, text=True))
    browser = Path(resolved['browser']).resolve(strict=True)
    display = json.loads(subprocess.check_output(['/usr/sbin/system_profiler', 'SPDisplaysDataType', '-json'], text=True))
    model = display['SPDisplaysDataType'][0]['sppci_model']
    paths = {Path(NODE), Path(sys.executable).resolve(), Path(python_kernel), Path(resolved['tsx']), browser}
    for tool in ['/opt/homebrew/bin/git', '/usr/sbin/lsof', '/bin/ps', '/bin/launchctl', '/usr/bin/caffeinate', '/usr/bin/pmset']:
        paths.add(Path(tool).resolve(strict=True))
    app = browser.parents[2]
    for directory, dirs, files in os.walk(app):
        for name in files:
            p = Path(directory)/name
            if not p.is_symlink(): paths.add(p)
    # Native esbuild/Vite descendants must be in StageReceipts' executable allowlist too.
    for directory, dirs, files in os.walk(ROOT/'node_modules/.pnpm'):
        for name in files:
            p=Path(directory)/name
            if not p.is_symlink() and p.stat().st_mode & 0o111: paths.add(p)
    return {'kind':'T13_OBSERVER_DISABLED_LOCAL_PATHS_V1', 'runtimeAuthorized':False,
            'node':NODE, 'pythonLauncher':str(Path(sys.executable).resolve()), 'pythonKernel':python_kernel,
            'browser':str(browser), 'tsx':resolved['tsx'], 'binaries':[bind_file(p, system=True) for p in sorted(paths)],
            'assetPath':str(ROOT/'packages/client/public/models/characters/thalune.glb'),
            'prefix':'bwt-7b836b7ae1754aac9d95e3b74a980efd',
            'output':'/private/tmp/t13-observer-native-7b836b7a',
            'fallback':'/private/tmp/t13-observer-fallback-7b836b7a',
            'consumption':'/private/tmp/t13-observer-consumed-7b836b7a',
            'grant':'/private/tmp/t13-observer-grant-7b836b7a.json',
            'launchPath':str(Path(NODE).parent)+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'expectedDevice':{'backend':'metal','rendererContains':model,'provenance':'read-only system_profiler; actual GL device must still be observed'},
            'controlledLoad':{'logicalCores':os.cpu_count(),'maxLoad':[7.5,10,15],
                'externalContenders':'unknown-not-excluded','requiresParentGPUReservation':True,'requiresOurHeavyCPUJobsQuiesced':True},
            'osBuild':subprocess.check_output(['/usr/sbin/sysctl','-n','kern.osversion'],text=True).strip(),
            'decoder':None, 'decoderReason':'No PNG/video encoding or decoding in this protocol; Basis transcoder is source-pinned with client public/basis'}


if __name__ == '__main__':
    if len(sys.argv)!=2:raise SystemExit('usage: discover.py <fresh-binding.json>')
    atomic(Path(sys.argv[1]),encode(discover()))
