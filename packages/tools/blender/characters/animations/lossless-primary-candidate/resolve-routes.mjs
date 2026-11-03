// Exact character-origin routes; the accepted collector blocks package execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const support='/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/task-p1e11t01/assets/blend/stations/_authoring/';
const {collect,fileRoute,moduleRoute}=await import(support+'resolve_round4_station_routes.mjs');
const here=path.dirname(fileURLToPath(import.meta.url)),verify=process.argv[2]==='--verify';
const expected=verify?JSON.parse(fs.readFileSync(process.argv[3])):null;
const root=verify?expected.config.root:process.argv[2];
const req=createRequire(root+'/packages/tools/package.json');
const test=req.resolve('@playwright/test'),pwtest=createRequire(test).resolve('playwright/test');
const pw=createRequire(pwtest).resolve('playwright'),core=createRequire(pw).resolve('playwright-core');
const bundle=fs.realpathSync(path.join(path.dirname(core),'lib/coreBundle.js'));
const find=name=>process.env.PATH.split(path.delimiter).map(p=>path.join(p,name)).find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}});
const routes=collect({root,pathEnvironment:process.env.PATH,node:process.execPath,pnpm:find('pnpm'),acceptedCoreBundle:bundle});
const tsxImport=moduleRoute(root+'/package.json','tsx','import');
const tsxRequireEsbuild=moduleRoute(tsxImport.entry.resolved,'esbuild','require');
const tsxRequireNative=moduleRoute(tsxRequireEsbuild.entry.resolved,'@esbuild/darwin-arm64/bin/esbuild','require');
routes.pilot={
  entryOrigin:path.join(here,'entry.mjs'),callerOrigin:path.join(here,'caller.py'),
  imports:{captureModule:fileRoute(root+'/packages/tools/src/capture/capture.ts'),
    playwright:moduleRoute(root+'/packages/tools/package.json','@playwright/test','require'),
    tsxImport,tsxRequireEsbuild,tsxRequireNative},
  staticFiles:['entry.mjs','caller.py','playback.mjs','page-api.mjs','resolve-routes.mjs','resolve-browser.cjs','freeze.py'].map(n=>fileRoute(path.join(here,n))),
  browserModules:['packages/client/src/dev/review.js','packages/client/src/main.js','packages/client/src/Game.js',
    'packages/client/src/core/Engine.js','packages/client/src/characters/sharedRig.js',
    'packages/client/public/basis/basis_transcoder.js','packages/client/public/basis/basis_transcoder.wasm'].map(n=>fileRoute(path.join(root,n))),
  loaders:['three/addons/loaders/GLTFLoader.js','three/addons/loaders/KTX2Loader.js','three/addons/libs/meshopt_decoder.module.js']
    .map(n=>moduleRoute(root+'/packages/client/src/core/Engine.js',n,'import')),
  acceptedHelpers:['round4_job_boundary.py','round4_capture_children.py','run_round4_browser_proof.py',
    'run_round4_remaining8.py','resolve_round4_station_routes.mjs'].map(n=>fileRoute(support+n)),
};
if(verify){assert.deepEqual(routes,expected);console.log('Exact character pilot routes unchanged; no spawn/network/package execution.');}
else fs.writeFileSync(process.argv[3],JSON.stringify(routes,null,2)+'\n');
