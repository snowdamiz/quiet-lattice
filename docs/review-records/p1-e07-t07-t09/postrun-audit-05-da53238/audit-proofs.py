from pathlib import Path
import sys, json, os, subprocess, datetime, hashlib, collections, struct, zlib, math, re
A=Path(__file__).resolve().parent
C=json.loads((A/'audit-context.json').read_text());R=Path(C['run']);H=Path(C['harness']);P=Path(C['parent'])
sys.path.insert(0,str(H))
from integrity import source_snapshot,dependencies,toolchain_check,runtime_harness_check,directory_hashes
from identity import snapshot,same

def save(n,d): (A/n).write_text(json.dumps(d,indent=2)+'\n')
def read(p): return json.loads(Path(p).read_text())
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def lines(p): return [json.loads(x) for x in Path(p).read_text().splitlines()]
c=read(R/'context.json'); src=c['sourceRoot'];before=read(R/'source-before.json')
source_sets={n:read(R/n) for n in ['source-before.json','source-after.json','source-after-cleanup.json']}
source_sets['frozen-harness']=read(H/'source-before.json');current=source_snapshot(src);save('source-current.json',current)
assert all(v==before for v in source_sets.values()) and current==before
nowdeps=dependencies(src);save('dependencies-current.json',nowdeps);assert nowdeps==read(R/'dependencies-after.json')==read(H/'frozen-dependencies.json')
assert toolchain_check() and runtime_harness_check()
head=subprocess.check_output(['git','-C',src,'rev-parse','HEAD'],text=True).strip();tree=subprocess.check_output(['git','-C',src,'rev-parse','HEAD^{tree}'],text=True).strip();status=subprocess.check_output(['git','-C',src,'status','--porcelain=v1'],text=True)
assert head==c['head'] and tree==c['tree'] and not status
seal=[]
for root in [H,Path(c['sourceReviewReceipt']).parent]:
 entries=[]
 for line in (root/'SHA256SUMS').read_text().splitlines():
  digest,name=line.split('  ',1);assert sha(root/name)==digest,name;entries.append(name)
 seal.append({'root':str(root),'entriesVerified':len(entries),'manifestSha256':sha(root/'SHA256SUMS'),'additionalFiles':sorted(set(directory_hashes(root))-set(entries)-{'SHA256SUMS'})})
preserve=[]
for root,m in read(Path(C['pending'])/'preserved-inputs-before.json').items():
 observed=directory_hashes(root);assert observed==m;preserve.append({'root':root,'files':len(m),'unchanged':True})
bs=lines(R/'browser-prelaunch.jsonl');ba=read(R/'browser-after.json');assert ba['matches']
for x in bs:assert sha(x['path'])==x['sha256']
sourceproof={'head':head,'tree':tree,'status':status,'sourceFiles':len(before),'dependencies':len(nowdeps),'sourceManifestsEqual':True,'dependencyManifestsEqual':True,'toolchainUnchanged':True,'browser':bs,'browserAfter':ba,'seals':seal,'priorPackets':preserve,'protectedHashes':{name:before[name] for name in ['packages/tools/src/smoke/symbiotic-online.spec.ts','packages/tools/src/smoke/symbiotic.config.ts','packages/tools/playwright.config.ts','packages/client/index.html']}}
save('provenance-proof.json',sourceproof)
results={p.parent.name:read(p) for p in (R/'supervision').glob('*/result.json')};owned=[]
for name,x in results.items():
 assert x['remaining']==[] and x['remainingRegistered']==[] and not x['remainingUnknown'] and x['cleanupErrors']==[] and x['primaryError'] is None
 owned.extend(x['tracked'])
for p in (R/'process-registry').glob('*.json'):
 x=read(p).get('identity')
 if x:owned.append(x)
ps=snapshot();matches=[x for x in owned if x['pid'] in ps and same(x,ps[x['pid']])]
tmprefs=[x for x in ps.values() if any(str(R/'tmp') in a for a in x['argv'])]
ports=read(R/'listeners-before-drop.json')['tcpPorts'];args=['/usr/sbin/lsof','-nP','-Fpcn']+['-iTCP:'+str(p) for p in ports]+['-sTCP:LISTEN'];producers=[]
for cmd in [args]:
 try:
  q=subprocess.run(cmd,text=True,capture_output=True,timeout=5);producers.append({'args':cmd,'exit':q.returncode,'stdout':q.stdout,'stderr':q.stderr,'error':None})
 except BaseException as err:producers.append({'args':cmd,'error':repr(err),'stdout':str(getattr(err,'stdout','')),'stderr':str(getattr(err,'stderr',''))})
osproof={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'matchingOwnedIdentities':matches,'processesReferencingOwnedTmp':tmprefs,'runTmpExists':(R/'tmp').exists(),'runTmpContents':[str(p) for p in (R/'tmp').iterdir()],'ownedRecords':len(owned),'uniquePidBirth':len({(x['pid'],tuple(x['birth'])) for x in owned}),'currentListenerProducers':producers,'privateServicesRequeried':False,'signalsOrCleanupPerformed':False}
save('current-os-observation.json',osproof)
assert not matches and not tmprefs and not osproof['runTmpContents']
assert all(x['exit']==1 and not x['stdout'] and not x['stderr'] and x['error'] is None for x in producers)
service=lines(R/'service-commands.jsonl');routes=lines(R/'routes.jsonl');cleanup=read(R/'cleanup.json');outcome=read(R/'outer-outcome.json')
assert len(service)==36 and all(x['exit']==0 and not x.get('error') and not x['stderr'] for x in service)
for x in service:
 args=x['args']
 if args[0]=='redis-cli':assert args[args.index('-n')+1]=='8' and args[args.index('-p')+1]=='53058'
 if args[0]=='psql':assert args[args.index('-p')+1]=='53055' and args[args.index('-d')+1] in ['postgres',c['database']]
assert service[7]['stdout'].strip()=='1' and service[9]['stdout'].strip()=='CREATE DATABASE'
assert 'DROP DATABASE' in service[28]['args'][-1] and c['database'] in service[28]['args'][-1] and service[28]['stdout'].strip()=='DROP DATABASE'
assert service[29]['stdout'].strip()=='2' and service[29]['args'][-3:]==[c['marker'],'astra:shard:main:world',c['claim']]
assert service[30]['stdout'].strip()==service[31]['stdout'].strip()==service[33]['stdout'].strip()=='0'
lastclients=[dict(s.split('=',1) for s in line.split()) for line in service[32]['stdout'].splitlines()]
assert all(x['db']=='8' and x['cmd']=='client|list' for x in lastclients)
assert service[27]['stdout'].strip()=='0'
container_receipts=[]
for i in [0,1,34,35]:
 d=json.loads(service[i]['stdout'])[0];container_receipts.append({'commandIndex':i,'id':d['Id'],'state':d['State']['Status'],'health':d['State']['Health']['Status'],'ports':d['NetworkSettings']['Ports']})
 assert d['State']['Status']=='running' and d['State']['Health']['Status']=='healthy'
for initial,final,expected in zip(container_receipts[:2],container_receipts[2:],cleanup['containers']):assert initial['id']==final['id']==expected['id'] and initial['ports']==final['ports']==expected['ports']
sqlrows=[x for x in routes if x['kind']=='sql-startup'];redisrows=[x for x in routes if x['kind']=='redis-select'];pre=[x for x in routes if x['kind']=='preimport-private-route-verified']
assert all(x['database']==c['database'] and x['user']=='astra' for x in sqlrows)
assert all(x['db']==8 for x in redisrows)
assert all(x['sqlRoute']=={'database':c['database'],'username':'astra','port':5432} and ' db=8 ' in x['redisInfo'] and x['claim']==c['claim'] for x in pre)
listeners={n:read(R/n) for n in ['listeners-after-drain.json','listeners-before-drop.json','listeners-after-cleanup.json']}
for x in listeners.values():
 assert not x['matchingOwnedIdentities'] and not x['processesReferencingTmp']
 assert all(p['exit']==1 and not p['stdout'] and not p['stderr'] and not p['error'] for p in x['producers'])
assert not outcome['errors'] and outcome['cleanupCompleted'] and outcome['gpuReleased']
assert all(cleanup[k] for k in ['databaseAbsent','redis8Empty','noOwnedProcesses','listenersAbsentBeforeDrop','noPrivateApplicationClients','profilesAndTempAbsent','gpuReleased'])
routeproof={'routeKinds':dict(collections.Counter(x['kind'] for x in routes)),'socketDestinations':sorted({(x['host'],x['port']) for x in routes if x['kind']=='socket-connect'}),'sqlStartups':len(sqlrows),'redisSelects':len(redisrows),'preimportVerifications':len(pre),'allObservedPrivateRoutesMatch':True,'containerIdentityReceipts':container_receipts,'rawServiceCommandCount':len(service),'allServiceCommandsExitZero':True,'cleanupCommandIndices':{'noPrivateSqlClients':27,'dropFreshDb':28,'atomicMarkerKeysetDel':29,'db8Empty':30,'markerAbsent':31,'noRedis8ApplicationClients':32,'freshDbAbsent':33},'cleanupKeyProof':read(R/'cleanup-key-proof.json'),'listeners':{k:{n:v for n,v in row.items() if n!='observedListeners'} for k,row in listeners.items()},'cleanup':cleanup,'supervision':{name:{k:v for k,v in x.items() if k in ['exit','timedOut','wallSeconds','drainSeconds','primaryError','cleanupErrors','remaining','remainingRegistered','remainingUnknown']} for name,x in results.items()},'privateServiceFactsFromRunReceiptsNotFreshQueries':True}
save('route-cleanup-proof.json',routeproof)
fonts=read(R/'font-assets-manifest.json');assert fonts['complete'] and not fonts['qualificationOnly'] and not fonts['errors']
for f in fonts['assets']:assert sha(R/f['body'])==f['sha256'] and (R/f['body']).stat().st_size==f['bytes'] and f['status']==200
network=lines(R/'browser-network.jsonl');assets={x['url']:x for x in fonts['assets']};fulfill=[x for x in network if x['kind']=='font-fulfilled'];responses=[x for x in network if x['kind']=='external-response']
assert all(x['sha256']==assets[x['url']]['sha256'] and x['bytes']==assets[x['url']]['bytes'] for x in fulfill)
assert all(x['status']==200 for x in responses)
networkproof={'eventCounts':dict(collections.Counter(x['kind'] for x in network)),'consoleErrors':[x for x in network if x['kind'] in ['console-error','pageerror']],'requestFailures':[x for x in network if x['kind']=='requestfailed'],'violations':[x for x in network if x['kind'] in ['policy-refused','font-delivery-failed','observation-limit']],'retainedAssets':len(fonts['assets']),'retainedBytes':sum(x['bytes'] for x in fonts['assets']),'allAssetsAndFulfillmentsHashVerified':True,'fontFulfillments':fulfill,'externalResponses':responses,'uniqueServedFontUrls':len({x['url'] for x in fulfill}),'contexts':[x for x in network if x['kind']=='context-observed']}
save('network-font-proof.json',networkproof)
attach=read(A/'attachments.json');pngs=[]
for x in attach:
 if x['contentType']!='image/png':continue
 p=Path(x['extractedPath']);b=p.read_bytes();assert sha(p)==x['sha256'];pos=8;chunks=[];data=b''
 while pos<len(b):
  n=struct.unpack('>I',b[pos:pos+4])[0];typ=b[pos+4:pos+8];body=b[pos+8:pos+8+n];crc=struct.unpack('>I',b[pos+8+n:pos+12+n])[0];assert zlib.crc32(typ+body)&0xffffffff==crc
  chunks.append(typ.decode());pos+=n+12
  if typ==b'IDAT':data+=body
 assert pos==len(b) and chunks[-1]=='IEND';decoded=zlib.decompress(data)
 pngs.append(dict(x,crcVerified=True,inflateBytes=len(decoded)))
save('png-byte-validation.json',pngs)

save('proof-stage-summary.json',{'sourceFiles':len(before),'dependencies':len(nowdeps),'ownedIdentities':osproof['uniquePidBirth'],'pngs':len(pngs),'pngBytes':sum(x['bytes'] for x in pngs),'eventCounts':networkproof['eventCounts'],'privateServicesRequeried':False})
print(json.dumps(read(A/'proof-stage-summary.json'),indent=2))
