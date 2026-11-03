"""One root-granted readiness transition and receipt-before-exec. No supervisor."""
import sys
sys.dont_write_bytecode = True
if sys.flags.optimize or not __debug__:
    raise SystemExit('Assertions must remain enabled')
import datetime, hashlib, json, os, shutil, subprocess, time
from pathlib import Path
OP = Path('/private/tmp/t02-primary-integration-release-accounting-72a9b614-operator-admission02')
GRANT_SHA = '79314b746784e3c49d6e267cce28849a4bc79bff04fc56a5669a6426361689e6'
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def require(condition, message):
    if not condition: raise RuntimeError(message)
def store(name, value):
    with (OP/name).open('x') as stream:
        stream.write(json.dumps(value, indent=2)+'\n'); stream.flush(); os.fsync(stream.fileno())
with (OP/'operator.stdout').open('xb') as stdout, (OP/'operator.stderr').open('xb') as stderr:
    os.dup2(stdout.fileno(),1); os.dup2(stderr.fileno(),2)
    require(sha(OP/'grant.json')==GRANT_SHA,'Grant changed')
    grant=json.loads((OP/'grant.json').read_text()); candidate=Path(grant['candidate']); ready_path=candidate/'readiness.json'
    require(grant['enabled'] and grant['oneUse'] and grant['maximumNewOwnedJobs']==2 and grant['automaticRetry'] is False,'Grant scope')
    require(grant['authorizationId']=='root-20261103-t02-primary-release-accounting-02','Authorization id')
    require(sha(OP/'root-preflight.json')==grant['parentPreflightSha256'],'Root preflight changed')
    require(sha(grant['reviewPath'])==grant['reviewSha256'] and sha(OP/'independent-PASS.md')==grant['reviewSha256'],'Review changed')
    require(subprocess.check_output(['/usr/bin/git','rev-parse','HEAD'],cwd=grant['cwd'],text=True).strip()==grant['authorizedHead'],'Source HEAD changed')
    require(not subprocess.check_output(['/usr/bin/git','status','--porcelain'],cwd=grant['cwd'],text=True).strip(),'Worktree changed')
    disabled=(OP/'readiness.disabled.json').read_bytes(); authorized=(OP/'readiness.authorized.json').read_bytes()
    require(sha(ready_path)==grant['disabledReadySha256']==hashlib.sha256(disabled).hexdigest(),'Disabled readiness changed')
    require(hashlib.sha256(authorized).hexdigest()==grant['authorizedReadySha256'],'Authorized readiness changed')
    ready=json.loads(disabled); active=json.loads(authorized)
    require(active=={**ready,'nativeFixtureAuthorization':True} and ready['nativeFixtureAuthorization'] is False and ready['runtimeAuthorization'] is False,'More than one readiness flag changed')
    require(ready['purpose']=='CPU_LOSSLESS_PRIMARY_132_EXISTING_FRAMES' and len(ready['sourceFrames'])==132,'Wrong fixture')
    require(hashlib.sha256(json.dumps(ready['sourceFrames'],sort_keys=True,separators=(',',':')).encode()).hexdigest()==grant['sourceFramesSha256'],'Frame set changed')
    for name in ['candidate-index.json','REVIEW_FREEZE.json']:
        require((candidate/name).read_bytes()==(OP/name).read_bytes(),'Frozen '+name+' changed')
    for binding in ready['bindings']:
        require(sha(binding['path'])==binding['sha256'],'Binding changed: '+binding['path'])
        if 'bytes' in binding:
            require(Path(binding['path']).stat().st_size==binding['bytes'],'Binding size changed: '+binding['path'])
    for frame in ready['sourceFrames']:
        require(Path(frame['pngPath']).stat().st_size==frame['pngBytes'] and sha(frame['pngPath'])==frame['pngSha256'],'PNG changed')
        require(sha(frame['observationPath'])==frame['observationSha256'],'Observation changed')
    require(grant['argv']==[ready['rgbPrimary']['python'],'-B',str(candidate/'integration.py')] and grant['PATH']==ready['pathEnvironment'],'Command changed')
    require(grant['packetRoot']==ready['packetRoot'] and grant['cpuProofRoot']==ready['cpuProofRoot'] and grant['nativeRawDirectory']==ready['nativeRawDirectory'],'Output paths changed')
    require(not Path(ready['packetRoot']).exists() and not Path(ready['cpuProofRoot']).exists(),'Attempt output already exists')
    free=shutil.disk_usage(candidate).free
    require(free>=grant['requiredFreeBytes']==ready['fixtureDiskAdmission']['totalRequiredBytes'],'Disk admission failed')
    sys.path.insert(0,ready['helperDirectory'])
    from round4_job_boundary import identity
    outer=identity(os.getpid());require(outer and outer['uid']==os.getuid(),'Outer identity unproved')
    record={'authorizationId':grant['authorizationId'],'grantSha256':GRANT_SHA,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'monotonic':time.monotonic(),'outerIdentity':outer,'outerPgid':os.getpgid(0),'argv':grant['argv'],'cwd':grant['cwd'],'head':grant['authorizedHead'],'freeBytes':free,'requiredBytes':grant['requiredFreeBytes'],'disabledReadySha256':grant['disabledReadySha256'],'authorizedReadySha256':grant['authorizedReadySha256'],'status':'CONSUMED_NO_RETRY'}
    store('consumed.json',record) # Exclusive, durable consumption precedes the first activation write.
    temporary=ready_path.with_name('readiness.operator-activation.tmp')
    with temporary.open('xb') as stream:
        stream.write(authorized);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,ready_path)
    require(sha(ready_path)==grant['authorizedReadySha256'],'Activation bytes differ')
    store('outer-identity.json',{**record,'launcherSha256':sha(__file__),'actualInterpreter':str(Path(sys.executable).resolve()),'actualInterpreterSha256':sha(Path(sys.executable).resolve()),'activatedReadinessSha256':sha(ready_path)})
    env={**os.environ,'PATH':grant['PATH'],'PYTHONDONTWRITEBYTECODE':'1'};env.pop('PYTHONOPTIMIZE',None)
    os.chdir(grant['cwd'])
    os.execve(grant['argv'][0],grant['argv'],env)
