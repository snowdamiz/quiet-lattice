"""Freeze installed Thalune routes without importing native helpers or launching media/browser code."""
import sys
sys.dont_write_bytecode = True
from assertion_guard import require_assertions
require_assertions(__debug__)
import datetime, hashlib, importlib.util, json, os, shutil, subprocess
from pathlib import Path
import contract
from inventory_boundary import paths as inventory_paths

HERE, ROOT = contract.HERE, contract.ROOT

def binding(path):
    path = Path(path).resolve(strict=True)
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): digest.update(block)
    return dict(path=str(path), bytes=path.stat().st_size, sha256=digest.hexdigest())

def files(directory):
    # Installed package dependencies are separate roots; never follow directory links here.
    return [p for p in inventory_paths(directory) if p.is_file() and not p.is_symlink() and '__pycache__' not in p.parts]

def main():
    node = str(Path(shutil.which('node')).resolve(strict=True))
    commands = []
    def pure(argv):
        value = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True, timeout=30, check=True)
        commands.append(dict(argv=argv, exitCode=value.returncode, stderr=value.stderr))
        return json.loads(value.stdout)
    routes = pure([node, '--experimental-import-meta-resolve', str(HERE/'resolve-bindings.mjs')])
    browser = pure([node, str(HERE/'resolve-browser.cjs'), str(ROOT), routes['bundle']])
    assert routes['root'] == str(ROOT) and routes['forbiddenCalls'] == [] and browser['spawnCalls'] == []
    assert browser['validatedHeadless'] is True and browser['selectedRegistryName'] == 'chromium-headless-shell'
    package_roots = {Path(row['packageJson']['resolved']).parent for row in routes['modules']}
    pending, packages, missing = list(package_roots), {}, []
    while pending:
        directory = pending.pop().resolve()
        if str(directory) in packages: continue
        package = json.loads((directory/'package.json').read_text())
        packages[str(directory)] = dict(name=package['name'], version=package.get('version'))
        required = package.get('dependencies', {})
        optional = {**package.get('optionalDependencies', {}), **package.get('peerDependencies', {})}
        for name in sorted(set(required) | set(optional)):
            found = next((p/'node_modules'/name for p in [directory, *directory.parents]
                          if (p/'node_modules'/name/'package.json').is_file()), None)
            if found is None:
                assert name in optional, 'Missing required installed dependency: '+name
                missing.append(dict(package=package['name'], optionalOrPeer=name))
            else: pending.append(found)
    paths = {Path(row['resolved']) for row in routes['files']}
    for directory in packages: paths.update(files(Path(directory)))
    for relative in ['packages/client/src', 'packages/shared/src']:
        paths.update(p for p in files(ROOT/relative) if p.suffix in ['.js', '.ts', '.json'])
    paths.update(files(Path(browser['selectedExecutable']['path']).parent))
    # Pillow's installed decoder code and native extension are identities only; no decode occurs here.
    pillow = Path(importlib.util.find_spec('PIL').origin).parent
    paths.update(files(pillow))
    paths.update(files(pillow.parent/'pillow.libs') if (pillow.parent/'pillow.libs').is_dir() else [])
    kernel_python = subprocess.run(['/bin/ps', '-p', str(os.getpid()), '-o', 'comm='],
                                   capture_output=True, text=True, timeout=3, check=True).stdout.strip()
    executables = dict(git=str(Path(shutil.which('git')).resolve(strict=True)), node=node, pythonLauncher=str(Path(sys.executable).resolve(strict=True)),
        pythonKernel=str(Path(kernel_python).resolve(strict=True)), esbuild=routes['esbuildBinary'],
        browser=browser['selectedExecutable']['path'], ffmpeg=str(Path(shutil.which('ffmpeg')).resolve(strict=True)),
        ffprobe=str(Path(shutil.which('ffprobe')).resolve(strict=True)), caffeinate='/usr/bin/caffeinate')
    assert all(Path(p).is_file() and os.access(p, os.X_OK) for p in executables.values())
    software = {Path(p) for p in executables.values()} | {Path('/bin/launchctl'), Path('/bin/ps'), Path('/usr/sbin/lsof'), Path('/System/Library/Kernels/kernel')}
    source_rows = [binding(p) for p in sorted(paths)]
    software_rows = [binding(p) for p in sorted(software)]
    process_map = {row['path']: row['sha256'] for row in software_rows if row['path'] in executables.values()}
    result = dict(schema='thalune-installed-bindings/v1', observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        runtimeAuthorization=False, nativeFixtureAuthorization=False, root=str(ROOT), pathEnvironment=os.environ['PATH'],
        routes=routes, browser=browser, resolver=browser, tsxImport=routes['tsxImport'], executables=executables,
        process_binary_sha256=process_map, bindings=source_rows, softwareBindings=software_rows,
        packageRoots=packages, absentOptionalOrPeerDependencies=missing, commands=commands,
        pythonIdentity=dict(launcher=executables['pythonLauncher'], kernelReportedExecutable=executables['pythonKernel'],
                            version=sys.version, evidence='ps comm for this running CPU binding interpreter'),
        kernelIdentity=dict(uname=list(os.uname()), file=binding('/System/Library/Kernels/kernel'),
            libprocLogicalImage='/usr/lib/libproc.dylib', libprocStandaloneFilePresent=Path('/usr/lib/libproc.dylib').is_file(),
            qualification='libproc is supplied by the system dyld cache; no image extraction or native helper qualification performed'),
        qualification='Installed identities only. Native 189-frame and whole-cohort RSS/cache qualification remain pending.')
    (HERE/'runtime-bindings.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='BOUND_DISABLED_NO_NATIVE_LAUNCH', packages=len(packages), sourceBindings=len(source_rows),
                         softwareBindings=len(software_rows), processExecutables=len(process_map), nativeLaunches=0)))

if __name__ == '__main__': main()
