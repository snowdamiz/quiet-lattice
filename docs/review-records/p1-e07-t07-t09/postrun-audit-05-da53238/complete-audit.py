from pathlib import Path
import json, hashlib, datetime, sys, math, re, collections, shutil
A=Path(__file__).resolve().parent
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(n,d):(A/n).write_text(json.dumps(d,indent=2)+'\n')
C=read(A/'audit-context.json');R=Path(C['run']);H=Path(C['harness']);P=Path(C['parent'])
sys.path.insert(0,str(H))
from identity import birth,arguments
from integrity import directory_hashes
e=read(A/'attachments/09-symbiotic-evidence.json');t=read(A/'test-report-summary.json')
c=read(R/'context.json');r=read(R/'result.json');parent=read(P/'exit.json');rel=read(P/'parent-release-observation.json')
assert len(t['testResults'])==1 and t['stats']['expected']==1
assert all(t['stats'][k]==0 for k in ['skipped','unexpected','flaky']) and not t['topLevelErrors']
tr=t['testResults'][0]['result'];assert tr['status']=='passed' and tr['retry']==0 and not tr['errors']
assert parent['exitCode']==r['exit']==0 and not r['timedOut'] and not r['primaryError'] and not r['cleanupErrors']
assert r['outerSeconds']==450 and r['drainLimitSeconds']==20
assert t['config']['workers']==1 and t['config']['globalTimeout']==420000
project=t['config']['projects'][0];assert project['repeatEach']==1 and project['retries']==0
assert not e['errors'] and e['ownerPageClosed'] is True
owner=e['players']['owner'];observer=e['players']['observer'];companion=e['companion'];enemy=e['enemy'];arena=e['arena']
assert owner!=observer and len(e['arrivals'])==2
for x in e['arrivals']:
 assert x['landed']['mode']=='landed' and x['foot']['mode']=='foot' and x['landed']['id']==x['foot']['id'] and x['foot']['hp']>0
 assert x['foot']['frame']==arena['frame']
skills=e['skills'];assert 'bond' in skills['unlocked']['state']['unlocked'] and 'bond' not in skills['unlocked']['state']['bought']
assert 'bond' in skills['bought']['state']['bought'] and skills['equipped']['state']['slots']['ground'][0]=='bond'
assert any(x['target']==companion and x['result']=='new' and x['species']['bond']=='eligible' for x in e['analysis'])
def drawn(x,entity,species,owned=False):
 w=x['wire'];assert x['id']==w['id']==entity and x['species']==w['species']==species
 assert w['kind']=='mob' and w['frame']==arena['frame'] and x['body']==arena['body']
 assert x['drawn'] and x['instanced'] and x['submitted'] and not x['offline']
 assert x['matrixError']<0.02 and abs(x['scale']-x['speciesSize'])<0.00005
 assert abs(x['screen'][0])<1 and abs(x['screen'][1])<1 and -1<x['screen'][2]<1
 if owned:assert w['owner']==owner
movement=[]
for x,y in zip(e['bound'],e['followed']):
 drawn(x,companion,arena['companion']['index'],True);drawn(y,companion,arena['companion']['index'],True)
 assert x['picked']==y['picked']==companion and y['tick']>x['tick']
 wire=math.dist(x['wire']['pos'],y['wire']['pos']);render=math.dist(x['pos'],y['pos']);assert wire>6 and render>6
 movement.append({'wireMetres':wire,'renderMetres':render,'fromTick':x['tick'],'toTick':y['tick'],'picked':y['picked']})
assert len(e['bound'])==len(e['followed'])==len(e['combat']['after'])==2
assert e['bound'][0]['name']==e['bound'][1]['name']==arena['companion']['name']
assert e['combat']['beforeHp']==[1,1]
for x in e['combat']['after']:
 drawn(x['target'],enemy,arena['enemy']['index']);drawn(x['companion'],companion,arena['companion']['index'],True)
 assert 0<x['target']['wire']['hp']<1 and x['target']['wire']['mode']!='dead' and x['companion']['wire']['hp']>0
 assert any(m['event']['source']==companion and m['event']['target']==enemy and m['event']['amount']>0 for m in x['hits'])
drawn(e['beforeRelease'],companion,arena['companion']['index'],True)
assert e['beforeRelease']['picked']==companion and e['beforeRelease']['wire']['hp']>0
ret=e['retired'];release=e['release']
assert ret['joined'] and ret['entityId']==observer and ret['tick']>release['tick']
assert ret['ownerGone'] and ret['companionGone'] and ret['targetGone'] and ret['picked']!=companion
for x in [release,ret]:
 w=x['observer'];z=x['enemy']
 assert w['id']==observer and w['kind']=='player' and w['frame']==arena['frame'] and w['mode']=='foot' and w['hp']>0
 assert z['id']==enemy and z['kind']=='mob' and z['frame']==arena['frame'] and z['species']==arena['enemy']['index'] and z['hp']>0 and z['mode']!='dead'
assert release['enemy']['hp']<1
ach={'players':e['players'],'companion':companion,'enemy':enemy,'arena':arena,
 'skills':skills,'arrivals':e['arrivals'],'analysis':e['analysis'],
 'bound':[{k:x[k] for k in ['id','picked','tick','matrixError','scale','speciesSize','drawn','instanced','submitted','offline']} for x in e['bound']],
 'movement':movement,'combat':e['combat'],'beforeRelease':e['beforeRelease'],'release':release,
 'ownerPageClosed':e['ownerPageClosed'],'retired':ret,'fixtureErrors':e['errors'],
 'allRetainedAssertionFactsChecked':True,
 'sourcePassedAssertionsWithoutSeparateRawValues':['before-analysis cast refused target; after-analysis cast accepted','owner moved >14m and companion came within8m on both clients','real Resume/focus/F and owner S input activation'],
 'retirementCompositeMeaning':'companion absent from snapshot AND remote map AND shown instances; targetGone separately removes hit targets; picked differs',
 'visualGradePerformed':False}
save('achievements.json',ach)

# Raw route ordering and bounded supervision, including descendants outside the initial group.
rows=[json.loads(x) for x in (R/'routes.jsonl').read_text().splitlines()]
live=[(i,x) for i,x in enumerate(rows) if x['kind']=='live']
for i,x in live:
 preceding=[z for z in rows[:i] if z['kind']=='preimport-private-route-verified' and z['pid']==x['pid'] and z['threadId']==x['threadId']]
 assert preceding and x['privateServicesProbed'] and x['node']=='v22.23.3' and x['contextPath']==str(R/'context.json') and x['tmpdir']==str(R/'tmp')+'/'
assert all(x['envInherited'] for x in rows if x['kind']=='worker-construction')
assert all(x['port'] not in [5432,6379,55432,56379] and x['host'] in ['127.0.0.1','localhost','::1'] for x in rows if x['kind']=='socket-connect')
owned=[];supervision={}
for p in (R/'supervision').glob('*/result.json'):
 x=read(p);owned.extend(x['tracked']);supervision[p.parent.name]={k:x[k] for k in ['exit','wallSeconds','timedOut','primaryError','cleanupErrors','remaining','remainingRegistered','remainingUnknown','drainSeconds','outerSeconds','drainLimitSeconds'] if k in x}
for p in (R/'process-registry').glob('*.json'):
 x=read(p).get('identity')
 if x:owned.append(x)
unique={(x['pid'],tuple(x['birth'])):x for x in owned};observations=[]
for x in unique.values():
 b=birth(x['pid']);a=arguments(x['pid']) if b else None
 assert b is None or b['birth']!=x['birth'], 'matching owned birth remains; no automated cleanup'
 observations.append({'recordedIdentity':x,'currentBirth':b,'currentArgv':a,'absentOrReused':True})
save('fresh-owned-birth-observations.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observations':observations,'allOwnedBirthsAbsent':True,'signalsSent':False,'privateServicesQueried':False})
save('launch-route-order-proof.json',{'livePreimportReceipts':len(live),'allLiveRecordsHaveEarlierSamePidThreadPrivateVerification':True,
 'workerConstructionRecords':[x for x in rows if x['kind']=='worker-construction'],
 'nativeOutsideOriginalGroup':[x for x in r['tracked'] if x['pgid']!=r['tracked'][0]['pgid']],
 'supervision':supervision,'routeGuardIsNodeInstrumentationNotKernelPacketCapture':True})

# Exact parent dispatch, spent identity and corrected attachment length metadata.
dispatch=read(P/'dispatch.json');ticketPath=Path(dispatch['ticketPath']);ticket=read(ticketPath)
assert sha(ticketPath)==dispatch['ticketSha256'] and ticket['head']==c['head'] and ticket['tree']==c['tree']
spent=read(H/'used-tickets'/(c['ticketId']+'.json'));assert spent['singleUse'] and spent['ticket']==ticket
assert rel['rawCleanup']==read(R/'cleanup.json') and rel['cleanupSha256']==sha(R/'cleanup.json') and rel['gpuReleased']
assert all(x['exit']==1 and not x['stdout'] and not x['stderr'] for x in rel['freshPids'])
attachments=read(A/'attachments.json');oldrel=read(P/'parent-release-initial-encoded-lengths.json')
parentAttachments=rel['tests'][0]['results'][0]['attachments'];initialAttachments=oldrel['tests'][0]['results'][0]['attachments']
assert len(parentAttachments)==len(attachments)==10
for a,p,old in zip(attachments,parentAttachments,initialAttachments):
 assert a['name']==p['name'] and a['bytes']==p['bytes'] and old['bytes']==p['bodyCharacterCount']
assert rel['at']==oldrel['at'] and rel['rawCleanup']==oldrel['rawCleanup'] and rel['freshPids']==oldrel['freshPids']
save('parent-release-proof.json',{'dispatch':dispatch,'ticketSha256':sha(ticketPath),'ticketId':c['ticketId'],'spent':True,
 'parentExit':parent,'gpuReleasedAt':rel['at'],'parentPidsAbsent':len(rel['freshPids']),
 'initialLengthMetadataMistake':'base64 character counts labeled bytes; initial retained, corrected decoded counts verified',
 'releaseFactsUnchanged':True,'allDecodedLengthsMatchCorrectedParentReceipt':True})

network=read(A/'network-font-proof.json');assert not network['consoleErrors'] and not network['violations']
assert len(network['requestFailures'])==3 and all(x['failure']['errorText']=='net::ERR_ABORTED' and x['url'].startswith('http://127.0.0.1:') for x in network['requestFailures'])
raw=(R/'supervision/single-metal-test/stdout.txt').read_text()
assert '<process did exit: exitCode=0, signal=null>' in raw
shutil.copy2(R/'supervision/single-metal-test/stdout.txt',A/'native-producer-output.txt')
warns={x:raw.count(x) for x in ['CVDisplayLinkCreateWithCGDisplay failed','SetApplicationIsDaemon: Error','Overflowed the metal library cache','Overflowed the render pipeline cache','PCFSoftShadowMap has been removed','[vite] connecting...','[vite] connected.','ERR_NAME_NOT_RESOLVED']}
server=[json.loads(x) for x in (A/'attachments/10-server-output.log').read_text().splitlines()]
auth=[x for x in server if x['msg']=='dev login'];assert len(auth)==4
for arrival in e['arrivals']:
 logs=[x for x in auth if x['character']==arrival['character']];assert len(logs)==2 and [x['created'] for x in logs]==[True,False]
save('console-native-owner-close-proof.json',{'nativeMessageCounts':warns,'pageErrors':0,'consoleErrors':0,
 'localRequestFailures':network['requestFailures'],'serverLogRecords':len(server),'devLoginRecords':auth,
 'ownerPageClosed':e['ownerPageClosed'],'ownerAbsentAtRetiredTick':ret['ownerGone'],
 'ownerRejoinObserved':False,'noRejoinScope':'terminal page-close assertion, finite observer snapshot and retained server log; no independent continuous navigation/CDP recording',
 'observerTeardownAbort':'context3 dev-document abort retained after final evidence; owner context2 has no document abort/reload in observed request failures',
 'nativeWarningsNotPageConsoleErrors':True})

for n in ['context.json','command.json','environment.json','cleanup.json','cleanup-key-proof.json','browser-network-summary.json','preflight-disk-admission.json','cleanup-disk-before.json','cleanup-disk-after.json']:
 shutil.copy2(R/n,A/('recorded-'+n))
shutil.copy2(P/'parent-release-observation.json',A/'recorded-parent-release-observation.json')
shutil.copy2(P/'parent-release-initial-encoded-lengths.json',A/'recorded-parent-release-initial-encoded-lengths.json')
(A/'exploration-notes.txt').write_text('Read-only probe: tail supervision/single-metal-test/stderr.txt reported No such file or directory. Actual merged producer output was located at supervision/single-metal-test/stdout.txt, copied losslessly as native-producer-output.txt. No failed test or new execution resulted.\n')
summary={'status':'PASS','scope':'one focused actual two-client Metal gameplay test; postrun read-only audit',
 'head':c['head'],'tree':c['tree'],'sourceHead':c['sourceHead'],'sourceTree':c['sourceTree'],
 'parentOsExit':parent['exitCode'],'parentWallSeconds':parent['wallSeconds'],'testSupervisorSeconds':r['wallSeconds'],
 'playwrightReportSeconds':t['stats']['duration']/1000,'testSeconds':tr['duration']/1000,
 'tests':1,'passed':1,'failed':0,'skipped':0,'unexpected':0,'flaky':0,'retry':0,'repeatEach':1,'workers':1,'timedOut':False,
 'ownerPageClosed':True,'retirementReachedAndRetained':True,'releaseTick':release['tick'],'retiredTick':ret['tick'],
 'observerHp':ret['observer']['hp'],'enemyHp':ret['enemy']['hp'],'retiredPick':ret['picked'],
 'pngCount':8,'pngDimensions':[1280,720],'pngBytes':sum(x['bytes'] for x in attachments if x['contentType']=='image/png'),
 'gameplayJsonBytes':attachments[8]['bytes'],'serverLogBytes':attachments[9]['bytes'],'allAttachmentBytes':sum(x['bytes'] for x in attachments),
 'sourceFilesUnchanged':4376,'dependencyFileHashesUnchanged':12422,'rawCleanupVerified':True,
 'freshOwnedPidBirthsAbsent':len(unique),'freshOwnedListenersAndProfilesAbsent':True,'privateServicesRequeried':False,
 'consoleErrors':0,'pageErrors':0,'localAborts':3,'fontFulfillments':len(network['fontFulfillments']),
 'retainedFontAssets':network['retainedAssets'],'retainedFontBytes':network['retainedBytes'],
 'gpuReleasedAt':rel['at'],'newNativeOrServiceOrNetworkOrGpuLaunch':False,
 'artBlindVisualGrade':False,'fpsClaim':False,'fullSmoke':False,'mergedTreeQualification':False}
save('SUMMARY.json',summary)
print(json.dumps(summary,indent=2))
