import json,hashlib,subprocess,os
from pathlib import Path
R=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-9af55c13');S=Path(__file__).resolve().parent;P=R/'packages/tools/blender/e08t08/reports';B='5731dc4c92954dd995c4a8ed5975bdbd2f7fdb45'
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(p.read_text())
def git(*a):return subprocess.check_output(['git',*a],cwd=R,text=True).strip()
source=read(P/'source-contract.json');consumer=read(P/'consumer-contract.json');result={'retainedStages':{},'validations':[],'retainedHashes':{},'protectedAssetHashes':{},'toolPins':{},'pngHistory':{},'otherFamilyTrees':{}}
for name in ['source-contract-08','consumer-08','validate-sources-creatures-02','validate-sources-constructs-02','validate-glbs-creatures-02','validate-glbs-constructs-02','export-creatures-03','export-constructs-01']:
 r=read(P/(name+'.json'));assert r['exit']==0 and not r['remainingProcesses'] and not r['stopReason']
 assert r['beforeSources']==r['afterSources']
 scope={p:h for p,h in r['afterSources'].items() if name!='export-constructs-01' or p.startswith('assets/blend/constructs/')}
 for p,h in scope.items():assert sha(R/p)==h,(name,p)
 if name.startswith('export-'):
  fam='constructs' if name=='export-constructs-01' else 'creatures'
  for p,h in r.get('afterExports',{}).items():
   if p.startswith('packages/client/public/models/'+fam+'/'):assert sha(R/p)==h,(name,p)
 if name.startswith('validate-'):
  assert r['beforeExports']==r['afterExports']
  for p,h in r['afterExports'].items():assert sha(R/p)==h
 result['retainedStages'][name]={k:r[k] for k in ['command','exit','remainingProcesses','stopReason','sampling']}
 result['retainedStages'][name]['sourceHashCoverage']=list(scope)
 result['retainedStages'][name]['hasExportHashes']='afterExports' in r
 result['retainedStages'][name]['nonSubjectHistoricalDrift']=[p for p,h in r['afterSources'].items() if sha(R/p)!=h]
 for p in [P/(name+'.json'),P/(name+'.log')]:result['retainedHashes'][str(p.relative_to(R))]=sha(p)
for p in (P/'validate-final').glob('*.json'):
 d=read(p);assert d['status']=='PASS' and d['summary']['fail']==0 and d['summary']['warn']==0
 result['validations'].append({'file':d['file'],'status':d['status'],'sha256':sha(p),'classes':sorted({v['class'] for a in d['assets'] for v in a['variants']})})
assert len(result['validations'])==14
for name in ['source-contract.json','consumer-contract.json','asset-hash-inventory.json','export-mask-limit.json','native-pending.json','lod-attribute-snap.json','saved-lods.json','portable-paths.json','bytecode-restoration.json']:
 result['retainedHashes'][str((P/name).relative_to(R))]=sha(P/name)
for f in source['files']:assert sha(R/f['source'])==f['sha256']
for f in consumer['files']:
 family='constructs' if f['stem'].startswith('outpost_') else 'creatures';assert sha(R/f'packages/client/public/models/{family}/{f["stem"]}.glb')==f['sha256']
assert consumer['malformedControls']==23
newassets={a['path'] for a in read(P/'asset-hash-inventory.json')['assets']}
for p in git('ls-files','assets/blend','packages/client/public/models').splitlines():
 if p in newassets:continue
 result['protectedAssetHashes'][p]={'bytes':(R/p).stat().st_size,'sha256':sha(R/p),'baseBlob':git('rev-parse',B+':'+p),'headBlob':git('rev-parse','HEAD:'+p)}
 assert result['protectedAssetHashes'][p]['baseBlob']==result['protectedAssetHashes'][p]['headBlob']
for p in git('ls-files','assets/renders/creatures/e08t08','assets/renders/constructs/e08t08').splitlines():
 if not p.endswith('.png'):continue
 result['pngHistory'][p]={'bytes':(R/p).stat().st_size,'sha256':sha(R/p)}
assert len(result['pngHistory'])==79
for family in ['characters','bosses','props','sites','cities','hulls','flora','stations']:
 for prefix in ['assets/blend/','packages/client/public/models/']:
  p=prefix+family
  try:a=git('rev-parse',B+':'+p);b=git('rev-parse','HEAD:'+p)
  except subprocess.CalledProcessError:continue
  assert a==b;result['otherFamilyTrees'][p]=a
for p in ['/Users/andreyyurlov/.local/share/fnm/node-versions/v22.23.3/installation/bin/node','/Applications/Blender.app/Contents/MacOS/Blender','/Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py','/Applications/Blender.app/Contents/Resources/5.2/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_attributes.py','/Users/andreyyurlov/Documents/dev/space/node_modules/.cache/ktx-software-4.4.2/bin/ktx']:
 result['toolPins'][p]=sha(p)
result['toolPins'].update(read(S/'imports-used-direct.json'))
result['sourceDataLimitation']='source-contract.json hash-bound retained Blender measurement; no fresh Blender invoked'
result['consumerControlLimitation']='23 retained controls are assertion-helper rejections on decoded scene mutations, not 23 production consumer rejection paths'
result['nativePending']=read(P/'native-pending.json')['status']
(S/'evidence-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'retainedStages':len(result['retainedStages']),'validations':len(result['validations']),'protectedAssets':len(result['protectedAssetHashes']),'protectedAssetBytes':sum(x['bytes'] for x in result['protectedAssetHashes'].values()),'pngs':len(result['pngHistory']),'protectedTrees':len(result['otherFamilyTrees']),'toolAndModulePins':len(result['toolPins'])}))
