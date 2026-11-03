"""Read actual terminal resources and packet, then restore exact disabled bytes."""
import sys
sys.dont_write_bytecode=True
if sys.flags.optimize or not __debug__:raise SystemExit('Assertions required')
import datetime,hashlib,importlib.util,json,os,shutil,subprocess
from pathlib import Path
OP=Path('/private/tmp/t02-primary-integration-release-accounting-72a9b614-operator-admission02')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def load(p):return json.loads(Path(p).read_text())
def save(p,v):
    with Path(p).open('x') as f:f.write(json.dumps(v,indent=2)+'\n');f.flush();os.fsync(f.fileno())
grant=load(OP/'grant.json');ready=load(OP/'readiness.authorized.json');C=Path(grant['candidate']);P=Path(grant['cpuProofRoot']);packet=Path(ready['packetRoot']);outer=load(OP/'outer-identity.json')
sys.path.insert(0,ready['helperDirectory'])
from round4_job_boundary import identity,kernel_tasks,coalition_members
from round4_capture_children import process_rows
current=identity(outer['outerIdentity']['pid']);assert current is None or current['birth']!=outer['outerIdentity']['birth']
resources=[];groups={outer['outerPgid']};births=[{'recorded':outer['outerIdentity'],'current':current}]
for name in ['producer','validator']:
    receipt=load(P/(name+'-receipt.json'));boundary=load(P/name/'owned-job/boundary.json')
    assert receipt['outcome']=='completed' and receipt['primaryFailure'] is None and receipt['cleanupFailure'] is None
    assert receipt['exits']=={'capture':0,'caffeinate':0} and boundary['clean'] and boundary['drained']
    cohort=boundary['coalition_id'];kernel=kernel_tasks(cohort);members=coalition_members(cohort)
    assert kernel['live']==0 and kernel['coalition_absent'] and members==[]
    exact=[]
    for pid,old in boundary['identities'].items():
        current=identity(int(pid));assert current is None or current['birth']!=old['birth']
        row={'recorded':old,'current':current};exact.append(row);births.append(row);groups.add(old['pgid'])
    registration=subprocess.run(['/bin/launchctl','print',boundary['target']],capture_output=True,text=True,timeout=3)
    assert registration.returncode!=0
    assert not Path(boundary['scratch']).exists() and not Path(receipt['privateTmp']['path']).exists()
    cache=receipt['terminal']['privateTmpCacheRelease'];assert cache['all_bytes_preserved'] and cache['namespace_removed']
    cache_root=Path(cache['archive']);assert cache_root.is_dir()
    actual=[]
    for f in sorted(cache_root.rglob('*')):
        assert not f.is_symlink()
        row={'path':str(f.relative_to(cache_root)),'kind':'directory' if f.is_dir() else 'file','mode':oct(f.stat().st_mode&0o777)}
        if f.is_file():row.update(bytes=f.stat().st_size,sha256=sha(f))
        actual.append(row)
    assert actual==cache['nonprofile_entries']
    resources.append({'name':name,'coalition':cohort,'kernel':kernel,'members':members,'births':exact,'target':boundary['target'],'registrationExit':registration.returncode,'registrationStdout':registration.stdout,'registrationStderr':registration.stderr,'scratchAbsent':True,'privateTmpAbsent':True,'cacheArchive':str(cache_root),'cacheEntriesVerified':len(actual),'captureAndCaffeinateExits':receipt['exits'],'signals':boundary['signals'],'errors':boundary['errors']})
rows=process_rows();group_members=[row for row in rows if row['pgid'] in groups];assert group_members==[]
assert sha(C/'readiness.json')==grant['authorizedReadySha256']
for b in ready['bindings']:assert sha(b['path'])==b['sha256']
for name in ['candidate-index.json','REVIEW_FREEZE.json']:assert (C/name).read_bytes()==(OP/name).read_bytes()
sys.path.insert(0,str(C))
spec=importlib.util.spec_from_file_location('audit_caller',C/'caller.py');caller=importlib.util.module_from_spec(spec);spec.loader.exec_module(caller)
validator=load(P/'validator-receipt.json');inspection=caller.inspect_capture(ready['stages'][0],packet/'capture',ready,packet/'validation',validator)
import packet_budget
inventory=packet_budget.inspect(packet)
result=load(P/'result.json');assert result['status']=='PASS_CPU_EXISTING_132_PRIMARY_INTEGRATION' and result['terminalReleaseProved'] and result['primaryFailure'] is None and result['nativeJobs']==2
assert result['terminalAuditFailures']==[] and len(result['terminalAudit'])==2
for ref in result['jobs']:assert sha(ref['path'])==ref['sha256']
frames=load(packet/'capture/frame-map.json')['frames'];assert len(frames)==132
acks=[json.loads(line) for line in (P/'native-raw/worker.stdout').read_text().splitlines() if line];assert len(acks)==132
for index,(frame,source,ack) in enumerate(zip(frames,ready['sourceFrames'],acks)):
    assert ack['workId']==source['work']['id'] and ack['mediaFrameOrdinal']==index
    assert frame['sourcePngSha256']==source['pngSha256'] and frame['sourcePngBytes']==source['pngBytes']
    assert frame['rgbSha256']==source['rgbSha256'] and frame['rgbaSha256']==source['rgbaSha256']
    assert ack['rgbSha256']==source['rgbSha256'] and ack['rgbaSha256']==source['rgbaSha256']
    original=load(source['observationPath']);original.pop('dataUrl');assert load(packet/'capture'/frame['observation'])==original
encoder=load(packet/'capture/encoder-result.json');entry=load(packet/'capture/entry-result.json');validation=load(packet/'validation/validation.json')
assert encoder['accepted'] and encoder['frames']==132 and encoder['videoSha256']==sha(packet/'capture/primary.mp4')
assert entry['accepted'] and entry['encoderFinalization'] and entry['primaryFailure'] is None and not entry['cleanupFailures']
assert validation['accepted'] and validation['everyRgbAndRgbaHash'] and validation['ordered60Hz'] and validation['frames']==132 and validation['rawRgbSpoolBytes']==0
probe=load(packet/'validation/probe.stdout');assert probe['streams'][0]['time_base']=='1/60000'
audit={'status':'PASS_DIRECT_TERMINAL_AND_132_FRAME_PACKET_AUDIT','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorizationId':grant['authorizationId'],'outer':{'recorded':outer['outerIdentity'],'current':identity(outer['outerIdentity']['pid'])},'jobs':resources,'birthCount':len(births),'groupIds':sorted(groups),'groupMembers':group_members,'newOwnedJobs':2,'cumulativeOwnedJobs':3,'originalCeiling':4,'inspection':inspection,'packetInventory':inventory,'packetLogicalBytes':sum(x.stat().st_size for x in packet.rglob('*') if x.is_file()),'sourceObservationsComparedComplete':132,'encoderAcks':len(acks),'frameMapRows':len(frames),'rgbAndRgbaFrames':132,'probeTimebase':probe['streams'][0]['time_base'],'rawRgbSpoolBytes':0,'resultSha256':sha(P/'result.json'),'packetResultSha256':sha(packet/'integration-result.json'),'mediaSha256':sha(packet/'capture/primary.mp4'),'mediaBytes':(packet/'capture/primary.mp4').stat().st_size,'authorizedReadySha256':sha(C/'readiness.json'),'operatorStdoutSha256':sha(OP/'operator.stdout'),'operatorStderrSha256':sha(OP/'operator.stderr'),'freeBytesAfter':shutil.disk_usage(C).free,'performanceQualified':False}
save(OP/'terminal-audit.json',audit)
disabled=(OP/'readiness.disabled.json').read_bytes();assert hashlib.sha256(disabled).hexdigest()==grant['disabledReadySha256']
temporary=C/'readiness.operator-restore.tmp'
with temporary.open('xb') as f:f.write(disabled);f.flush();os.fsync(f.fileno())
os.replace(temporary,C/'readiness.json');assert sha(C/'readiness.json')==grant['disabledReadySha256']
save(OP/'readiness-restoration.json',{'status':'EXACT_DISABLED_BYTES_RESTORED_AFTER_TERMINAL_AUDIT','utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'terminalAuditSha256':sha(OP/'terminal-audit.json'),'disabledReadySha256':sha(C/'readiness.json'),'authorizedSnapshotSha256':sha(OP/'readiness.authorized.json'),'indexUnchanged':(C/'candidate-index.json').read_bytes()==(OP/'candidate-index.json').read_bytes(),'freezeUnchanged':(C/'REVIEW_FREEZE.json').read_bytes()==(OP/'REVIEW_FREEZE.json').read_bytes()})
print(json.dumps({k:audit[k] for k in ['status','birthCount','groupIds','newOwnedJobs','encoderAcks','frameMapRows','mediaBytes','mediaSha256','packetLogicalBytes','freeBytesAfter']},indent=2))
print(json.dumps({'readyDisabled':True,'auditSha256':sha(OP/'terminal-audit.json'),'restorationSha256':sha(OP/'readiness-restoration.json')}))
