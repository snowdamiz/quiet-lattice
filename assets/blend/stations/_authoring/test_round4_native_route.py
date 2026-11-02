"""Exact reviewed fake-tree native esbuild selection controls. No package executes."""
import hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
OUT=Path(os.environ['ROUND4_NATIVE_ROUTE_OUTPUT']).resolve(); OUT.mkdir(parents=True,exist_ok=False)
SOURCE=Path(__file__).with_name('resolve_round4_station_routes.mjs').resolve()
NODE='/Users/andreyyurlov/.local/share/fnm/node-versions/v26.12.1/installation/bin/node'
record={}
owner=Path(tempfile.mkdtemp(prefix='station-native-route-unit-')).resolve(); root=owner/'project'
def write(file,text,executable=False):
 file.parent.mkdir(parents=True,exist_ok=True); file.write_text(text)
 if executable: file.chmod(0o700)
def package(name,entries):
 d=root/'node_modules'/name
 write(d/'package.json',json.dumps({'name':name,'exports':entries}))
 def targets(v):
  if isinstance(v,str): yield v
  else:
   for child in v.values(): yield from targets(child)
 for t in targets(entries): write(d/t.removeprefix('./'),'throw Error("FAKE PACKAGE MUST NEVER EXECUTE");')
 return d
try:
 write(root/'package.json','{}'); write(root/'packages/tools/package.json','{}'); write(root/'packages/client/package.json','{}')
 write(root/'packages/client/vite.config.js','export default {};')
 write(root/'packages/client/src/core/Engine.js',''); write(root/'packages/tools/src/capture/capture.ts','')
 tsx=package('tsx',{'.':{'import':'./dist/loader.mjs','require':'./dist/loader.mjs'},'./cli':{'import':'./dist/cli.mjs','require':'./dist/cli.mjs'}})
 esbuild=package('esbuild',{'.':'./lib/main.js'})
 test=package('@playwright/test',{'.':{'import':'./index.mjs','require':'./index.js'}})
 playwright=package('playwright',{'.':{'import':'./index.mjs','require':'./index.js'},'./test':{'import':'./test.mjs','require':'./test.js'}})
 core=package('playwright-core',{'.':{'import':'./index.mjs','require':'./index.js'}})
 for name in ['lib/coreBundle.js','browsers.json','lib/bootstrap.js']: write(core/name,'fixture')
 vite=package('vite',{'.':'./dist/node/index.js'})
 write(vite/'dist/node/chunks/node.js','else if (pkgDir) cacheDir = path.join(pkgDir, `node_modules/.vite`);')
 package('rolldown',{'.':'./dist/index.mjs'}); package('three',{'.':{'import':'./build/three.module.js','require':'./build/three.cjs'}})
 bin=root/'node_modules/.bin'; write(bin/'tsx','#!/bin/sh\n# cmd-shim-target=../tsx/dist/cli.mjs\n',True)
 deps=owner/'deps'; pnpm=deps/'bin/fallback/pnpm'
 write(pnpm,'#!/bin/sh\nexec "${SCRIPT_DIR}/../../node/bin/node" "${SCRIPT_DIR}/../../node/node_modules/pnpm/bin/pnpm.mjs" "$@"\n',True)
 for file in ['node/bin/node','node/node_modules/pnpm/bin/pnpm.mjs','node/node_modules/pnpm/dist/pnpm.mjs']: write(deps/file,'fixture',True)
 write(owner/'path/node','fixture',True); write(owner/'path/bash','fixture',True)
 native=esbuild/'node_modules/@esbuild/darwin-arm64'; native.parent.mkdir(parents=True)
 old=owner/'native-old'; other=owner/'native-new'
 for d,label in [(old,'old'),(other,'new')]:
  write(d/'package.json',json.dumps({'name':'@esbuild/darwin-arm64'})); write(d/'bin/esbuild','fake executable '+label,True)
 native.symlink_to(old)
 config={'root':str(root),'node':NODE,'pnpm':str(pnpm),'pathEnvironment':str(owner/'path')+':'+str(pnpm.parent),'acceptedCoreBundle':str(core/'lib/coreBundle.js')}
 write(owner/'config.json',json.dumps(config))
 query=owner/'query.mjs'
 write(query,"import fs from 'node:fs'; import {createRequire} from 'node:module'; import {collect,fileRoute} from "+json.dumps(SOURCE.as_uri())+"; const c=JSON.parse(fs.readFileSync(process.argv[2])); const origin=c.root+'/node_modules/esbuild/lib/main.js'; const snapshot=collect(c); const selected=createRequire(origin).resolve('@esbuild/darwin-arm64/bin/esbuild'); console.log(JSON.stringify({snapshot,native:fileRoute(selected)}));")
 def collect():
  p=subprocess.run([NODE,'--experimental-import-meta-resolve',str(query),str(owner/'config.json')],capture_output=True,text=True,timeout=10)
  assert p.returncode==0,p.stderr
  return json.loads(p.stdout)
 before=collect(); old_bytes=(old/'bin/esbuild').read_bytes(); native.unlink(); native.symlink_to(other); after=collect()
 record={'scope':'FAKE_TREE_FRESH_NODE_ONLY_NO_PACKAGE_EXECUTION','source':str(SOURCE),'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'collector_snapshot_equal':before['snapshot']==after['snapshot'],'native_before':before['native'],'native_after':after['native'],'old_target_bytes_unchanged':(old/'bin/esbuild').read_bytes()==old_bytes,'actual_snapshot_modules':len(before['snapshot']['modules']),'actual_snapshot_paths':len(before['snapshot']['paths']),'fixture_root':str(owner)}
 assert not record['collector_snapshot_equal']; assert before['native']!=after['native']
 def native_row(value):
  rows=[r for r in value['snapshot']['modules'] if r['specifier']=='@esbuild/darwin-arm64/bin/esbuild']
  assert len(rows)==1 and rows[0]['mode']=='require'
  return rows[0]
 first=native_row(before); second=native_row(after)
 assert first['entry']['resolved']==before['native']['resolved'] and second['entry']['resolved']==after['native']['resolved']
 assert first['entry']['sha256']==before['native']['sha256'] and second['entry']['sha256']==after['native']['sha256']
 assert first['logicalPackages'][0]['links'] and first['logicalPackages']!=second['logicalPackages']
 (other/'bin/esbuild').write_text('changed fixture binary bytes')
 changed=collect()
 assert native_row(changed)['entry']['resolved']==second['entry']['resolved']
 assert native_row(changed)['entry']['sha256']!=second['entry']['sha256']
 native.unlink(); native.symlink_to(os.path.relpath(other,native.parent))
 relinked=collect()
 assert native_row(relinked)['entry']==native_row(changed)['entry']
 assert native_row(relinked)['logicalPackages']!=native_row(changed)['logicalPackages']
 native.unlink()
 missing=subprocess.run([NODE,'--experimental-import-meta-resolve',str(query),str(owner/'config.json')],capture_output=True,text=True,timeout=10)
 assert missing.returncode!=0 and 'MODULE_NOT_FOUND' in missing.stderr
 (OUT/'missing_native_stderr.txt').write_text(missing.stderr)
 record.update(controls=['native package retarget rejected with old target bytes unchanged','native target bytes rejected at identical path','native ancestor readlink retarget rejected at identical executable','missing required native selection fails closed'],
               before_native_module=first,after_native_module=second,all4_controls_pass=True,
               package_code_executed=False,real_dependency_mutation=False,launcher_job_browser_GPU=False)
 (OUT/'native_route_gap.json').write_text(json.dumps(record,indent=2)+'\n')
finally:
 shutil.rmtree(owner)
 record['fixture_root_absent']=not owner.exists(); (OUT/'native_route_gap.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'collector_snapshot_equal':record['collector_snapshot_equal'],'native_before':record['native_before']['resolved'],'native_after':record['native_after']['resolved'],'old_target_bytes_unchanged':record['old_target_bytes_unchanged'],'fixture_root_absent':record['fixture_root_absent']}))
