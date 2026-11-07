"""Actual CLI publication regressions using retained baseline artifacts, offline.

Run: python3 packages/tools/blender/cities/ixari/test_publication.py
Each run reserves an exclusive evidence directory. Fixtures retain real base
GLBs/images through local LFS object links; no Blender or consumer is launched.
PASS here qualifies publication behavior only, never new production inputs.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[5]
TASK='assets/blend/cities/ixari'
SCRIPT='packages/tools/blender/cities/ixari/build_report.py'
EVIDENCE=ROOT/TASK/'revision-r1/publication-tests'
ENV=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',OMP_NUM_THREADS='2',OPENBLAS_NUM_THREADS='2',
         MKL_NUM_THREADS='2',NUMEXPR_NUM_THREADS='2',VECLIB_MAXIMUM_THREADS='2',
         BLIS_NUM_THREADS='2',TBB_NUM_THREADS='2',RAYON_NUM_THREADS='2',UV_THREADPOOL_SIZE='2')
SESSION=None
SNAPSHOT=None
RUNS=[]


def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def dump(p,value):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,indent=2)+'\n')


def cap():
    resource.setrlimit(resource.RLIMIT_FSIZE,(8*1024**2,8*1024**2))


def link(source,dest):
    dest.parent.mkdir(parents=True,exist_ok=True);dest.symlink_to(source)


def snapshot():
    data=SESSION/'baseline';data.mkdir()
    baseline=json.loads((ROOT/TASK/'revision-r1/baseline.json').read_text())
    lfs=json.loads((ROOT/TASK/'receipts/local-lfs-final.json').read_text())
    objects={o['path']:Path(o['localObject']) for o in lfs['objects']}
    # Base JSON/logs are copied from Git, not mutable parent inventory paths.
    for name,meta in baseline['files'].items():
        if name==SCRIPT:continue
        p=data/name;p.parent.mkdir(parents=True,exist_ok=True)
        if name in objects:link(objects[name],p)
        elif name.endswith(('.blend','.glb','.png')):
            link(ROOT/name,p)
        else:
            result=subprocess.run(['git','show',baseline['head']+':'+name],cwd=ROOT,
                                  capture_output=True,timeout=30,check=True,env=ENV)
            if result.stdout.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
                oid=meta['sha256'];lfs_root=next(iter(objects.values())).parents[2]
                link(lfs_root/oid[:2]/oid[2:4]/oid,p)
            else:p.write_bytes(result.stdout)
        if sha(p)!=meta['sha256']:raise AssertionError('baseline drift: '+name)
    provenance=json.loads((data/TASK/'provenance-start.json').read_text())
    for name,h in provenance['protected'].items():
        p=data/name
        if not p.exists():link(ROOT/name,p)
        if sha(p)!=h:raise AssertionError('protected drift: '+name)
    for name in ('stock-validate-final','consumer-final-r2','audit-source-final','audit-export-final',
                 'mesh-validity-final','eslint-final','format-final','python-syntax-final'):
        process=json.loads((data/TASK/'receipts'/name/'process.json').read_text())
        for name,h in process.get('inputScriptSha256',{}).items():
            p=data/name
            if not p.exists():link(ROOT/name,p)
            if sha(p)!=h:raise AssertionError('receipt input drift: '+name)
    # Read-only reviewer result is an actual base 68-test result. It is fixture
    # evidence, not a claim that this run executes consumers or new geometry.
    result=Path('/tmp/p1-e10-t06-r1-2d23ecb3/vitest.json')
    shutil.copyfile(result,data/TASK/'consumer-result.json')
    dump(data/TASK/'baseline.json',baseline)
    return data


class Publication(unittest.TestCase):
    def setUp(self):
        self.root=SESSION/self._testMethodName;self.root.mkdir()
        for p in SNAPSHOT.rglob('*'):
            if p.is_dir():continue
            link(p,self.root/p.relative_to(SNAPSHOT))
        script=self.root/SCRIPT;script.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/SCRIPT,script)
        subprocess.run(['git','init','-q',self.root],check=True,timeout=30,env=ENV)
        self.task=self.root/TASK;self.reports=self.task/'reports';self.reports.mkdir()
        self.config_path=self.task/'inputs.json'
        self.config=self.inputs()
        self.save()
        dump(self.reports/'CURRENT.json',{'status':'PASS','directory':'stale','sentinel':'PREVIOUS_PASS'})

    def ref(self,path):
        p=Path(path)
        if not p.is_absolute():p=self.root/p
        return {'path':str(p.relative_to(self.root)),'sha256':sha(p)}

    def binding(self,paths):return {str(p):sha(self.root/p) for p in paths}

    def entry(self,name,paths,result=None):
        base=self.task/'receipts'/name
        entry={'process':self.ref(base/'process.json'),'log':self.ref(base/'output.txt'),'inputs':self.binding(paths)}
        if result:entry['result']=self.ref(base/result)
        return entry

    def inputs(self):
        inventories=sorted((self.task/'inventory').glob('*.json'))
        rows=[json.loads(p.read_text())[0] for p in inventories]
        sources=[r['source'] for r in rows];exports=[r['glb'] for r in rows]
        consumer=self.entry('consumer-final-r2',sources+exports+[str(p.relative_to(self.root)) for p in inventories])
        consumer['result']=self.ref(self.task/'consumer-result.json')
        images=[]
        for p in inventories:
            for kind in ('source','materials'):
                folder=self.root/f'assets/renders/cities/ixari/{kind}-{p.stem}-final'
                images.append(dict(group=p.stem,kind=kind,sheet=self.ref(folder/'sheet.png'),readout=self.ref(folder/'readout.json')))
        for p in sorted((self.root/'assets/renders/cities/ixari').glob('export-*-final/readout.json')):
            images.append(dict(group=p.parent.name[7:-6],kind='export',sheet=self.ref(p.parent/'sheet.png'),readout=self.ref(p)))
        checked_js=['packages/tools/blender/cities/ixari/consumer.test.js','packages/tools/blender/cities/ixari/consumer.config.mjs']
        return dict(schemaVersion=1,baseline=self.ref(self.task/'baseline.json'),inventory=[self.ref(p) for p in inventories],
                    sourceAudit=self.entry('audit-source-final',sources,'audit.json'),
                    exportAudit=self.entry('audit-export-final',exports,'audit.json'),consumer=consumer,
                    meshValidity=self.entry('mesh-validity-final',sources,'audit.json'),
                    stock=[dict(reports=[self.ref(p) for p in sorted((self.task/'receipts/stock-validate-final/validators').glob('*.json'))],
                                receipt=self.entry('stock-validate-final',sources+exports),reuseBaseline=True)],
                    commands=dict(eslint=self.entry('eslint-final',checked_js),format=self.entry('format-final',checked_js),
                                  pythonSyntax=self.entry('python-syntax-final',[SCRIPT])),
                    resourceControls=self.ref(self.task/'receipts/resource-controls.json'),
                    localLfs=self.ref(self.task/'receipts/local-lfs-final.json'),attempts=[self.ref(self.task/'attempts.jsonl')],images=images)

    def save(self):dump(self.config_path,self.config)

    def replace_json(self,ref,change):
        p=self.root/ref['path'];value=json.loads(p.read_text());change(value)
        if p.is_symlink():p.unlink()
        dump(p,value);ref['sha256']=sha(p)

    def run_cli(self,attempt='run1',extra=None,limit=None):
        command=[sys.executable,str(self.root/SCRIPT),'--attempt',attempt,'--inputs',str(self.config_path.relative_to(self.root))]
        if extra is not None:command=[sys.executable,str(self.root/SCRIPT),*extra]
        log=SESSION/f'{self._testMethodName}-{len(RUNS)}.log'
        with log.open('xb') as f:
            if limit:
                def limited():
                    resource.setrlimit(resource.RLIMIT_FSIZE,(limit,limit))
                preexec=limited
            else:preexec=cap
            result=subprocess.run(command,cwd=self.root,env=ENV,stdout=f,stderr=subprocess.STDOUT,
                                  timeout=120,preexec_fn=preexec)
        tail=log.read_text().splitlines()[-20:]
        (log.with_suffix('.last20.txt')).write_text('\n'.join(tail)+'\n')
        RUNS.append(dict(test=self._testMethodName,command=command,exitCode=result.returncode,fullLog=str(log),
                         last20Lines=tail,scriptSha256=sha(self.root/SCRIPT),timeoutSeconds=120,
                         outputLimitBytes=limit or 8*1024**2,threadEnv={k:v for k,v in ENV.items() if k.endswith('THREADS')}))
        return result.returncode,log.read_text()

    def failed(self,code):
        self.assertNotEqual(code,0)
        current=json.loads((self.reports/'CURRENT.json').read_text())
        self.assertIn(current['status'],('FAILED','IN_PROGRESS'))
        self.assertNotIn('directory',current)
        self.assertNotIn('sha256',current)
        self.assertFalse((self.reports/'run1').exists())

    def test_early_source_hash(self):
        ref=self.config['inventory'][0]
        self.replace_json(ref,lambda value:value[0].update(sourceSha256='0'*64))
        self.save();code,log=self.run_cli();self.failed(code)
        self.assertIn('sourceSha256 mismatch',log)

    def test_late_eslint(self):
        self.replace_json(self.config['commands']['eslint']['process'],lambda value:value.update(exitCode=1))
        self.save();code,log=self.run_cli();self.failed(code)
        self.assertIn('failed process receipt',log)
        self.assertIn('eslint-final',log)

    def test_complete_publication_and_duplicate(self):
        old={p:sha(self.task/p) for p in ('manifest.json','APPENDIX-C2.json','SHA256SUMS')}
        code,log=self.run_cli();self.assertEqual(code,0,log)
        current=json.loads((self.reports/'CURRENT.json').read_text());self.assertEqual(current['status'],'PASS')
        dest=self.root/current['directory']
        self.assertEqual(set(current['sha256']),{'manifest.json','APPENDIX-C2.json','SHA256SUMS'})
        for name,h in current['sha256'].items():self.assertEqual(sha(dest/name),h)
        sums=(dest/'SHA256SUMS').read_text()
        for line in sums.splitlines():
            h,path=line.split('  ',1);self.assertEqual(sha(self.root/path),h,path)
        manifest=json.loads((dest/'manifest.json').read_text());self.assertEqual(len(manifest['allCpuImages']),23)
        for name in ('anchor-shape-r2','landmarks-shape-r2','low-shape-r1','low-shape-r2'):
            self.assertIn(name+'/sheet.png',sums)
            row=next(i for i in manifest['allCpuImages'] if name+'/sheet.png' in i['path'])
            self.assertTrue(row['classification'].startswith('HISTORICAL_'))
        before={p.name:sha(p) for p in dest.iterdir()}
        code,log=self.run_cli();self.assertNotEqual(code,0);self.assertIn('already exists',log)
        self.assertEqual(before,{p.name:sha(p) for p in dest.iterdir()})
        self.assertEqual(json.loads((self.reports/'CURRENT.json').read_text())['status'],'FAILED')
        self.assertEqual(old,{p:sha(self.task/p) for p in old})

    def test_missing_and_malformed_inputs(self):
        for index,extra in enumerate(([],['--attempt','bad'],['--attempt','bad','--inputs','missing.json'])):
            code,log=self.run_cli(extra=extra);self.failed(code)
        self.config_path.write_text('{')
        code,log=self.run_cli();self.failed(code);self.assertIn('JSONDecodeError',log)

    def test_stale_export_receipt(self):
        self.replace_json(self.config['exportAudit']['result'],lambda value:value['files'][0].update(sha256='0'*64))
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('hash mismatch',log)

    def test_consumer_false_pass(self):
        self.replace_json(self.config['consumer']['result'],lambda value:value.update(numPassedTests=67,numFailedTests=1))
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('consumer must pass all 68',log)

    def test_execution_input_binding_mismatch(self):
        inputs=self.config['consumer']['inputs'];name=next(iter(inputs))
        self.replace_json(self.config['consumer']['process'],lambda value:value.update(
            evaluatedInputsBefore={name:'0'*64},evaluatedInputsAfter={name:inputs[name]}))
        self.save();code,log=self.run_cli();self.failed(code)
        self.assertIn('receipt input changed during or after execution',log)

    def test_historical_sheet_bytes_preserved(self):
        sheet=self.root/'assets/renders/cities/ixari/anchor-shape-r2/sheet.png'
        data=sheet.read_bytes();sheet.unlink();sheet.write_bytes(data+b'changed')
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('hash mismatch',log)

    def test_revision_image_cap(self):
        folder=self.root/'assets/renders/cities/ixari/over-budget';folder.mkdir()
        original=self.root/'assets/renders/cities/ixari/anchor-shape-r2/sheet.png'
        for index in range(13):shutil.copyfile(original,folder/f'{index}.png')
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('revision image cap',log)

    def test_missing_local_lfs_object(self):
        self.replace_json(self.config['localLfs'],lambda value:value['objects'][0].update(localObject=str(self.root/'missing-lfs-object')))
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('local LFS storage object mismatch',log)

    def test_missing_audit_coverage(self):
        self.replace_json(self.config['sourceAudit']['result'],lambda value:value['files'].pop())
        self.save();code,log=self.run_cli();self.failed(code);self.assertIn('audit file coverage',log)

    def test_changed_source_cannot_publish_old_glb(self):
        ref=self.config['inventory'][0];rows=json.loads((self.root/ref['path']).read_text())
        source=self.root/rows[0]['source'];raw=source.read_bytes();source.unlink();source.write_bytes(raw+b'fixture revision')
        self.replace_json(ref,lambda value:[row.update(sourceSha256=sha(source)) for row in value])
        self.save();code,log=self.run_cli();self.failed(code)
        self.assertIn('changed source still has baseline GLB',log)

    def test_fresh4_reused12_and_revised_image_paths(self):
        changed={}
        for ref in self.config['inventory']:
            group=Path(ref['path']).stem
            if group not in ('anchor','props'):continue
            rows=json.loads((self.root/ref['path']).read_text())
            source=self.root/rows[0]['source'];raw=source.read_bytes();source.unlink();source.write_bytes(raw+b'fixture revision')
            export=self.root/rows[0]['glb'];raw=bytearray(export.read_bytes());export.unlink()
            # A legal ignored GLB chunk changes fixture bytes without pretending
            # this test regenerated or validated geometry in Blender.
            raw.extend(struct.pack('<II',4,0x54534554)+b'test');struct.pack_into('<I',raw,8,len(raw));export.write_bytes(raw)
            changed.update(self.binding([rows[0]['source'],rows[0]['glb']]))
            self.replace_json(ref,lambda value:[row.update(sourceSha256=sha(source)) for row in value])
        for role in ('sourceAudit','exportAudit'):
            self.replace_json(self.config[role]['result'],lambda value:[f.update(sha256=changed[f['path']]) for f in value['files'] if f['path'] in changed])
        for role in ('sourceAudit','exportAudit','consumer','meshValidity'):
            self.config[role]['inputs']={p:sha(self.root/p) for p in self.config[role]['inputs']}
        stock=self.config['stock'][0];fresh=[];retained=[]
        for ref in stock['reports']:
            report=json.loads((self.root/ref['path']).read_text())
            if report['file'] not in changed:retained.append(ref);continue
            p=self.task/'fixture-fresh4'/Path(ref['path']).name;dump(p,report);fresh.append(self.ref(p))
        stock['reports']=retained;stock['receipt']['inputs']={p:h for p,h in stock['receipt']['inputs'].items() if p not in changed}
        receipt={k:v for k,v in stock['receipt'].items() if k!='inputs'};receipt['inputs']=changed
        self.config['stock'].append(dict(reports=fresh,receipt=receipt,reuseBaseline=False))
        for image in self.config['images']:
            if image['group'] not in ('anchor','props'):continue
            readout=json.loads((self.root/image['readout']['path']).read_text())
            readout['sourceSha256']=changed[readout['source']]
            folder=self.root/f"assets/renders/cities/ixari/revision-r1-{image['kind']}-{image['group']}"
            folder.mkdir();shutil.copyfile(self.root/image['sheet']['path'],folder/'sheet.png')
            dump(folder/'readout.json',readout)
            image['sheet']=self.ref(folder/'sheet.png');image['readout']=self.ref(folder/'readout.json')
        def lfs_update(value):
            known={o['path'] for o in value['objects']}
            for o in value['objects']:
                p=self.root/o['path'];o.update(sha256=sha(p),bytes=p.stat().st_size,localObject=str(p))
            for image in self.config['images']:
                if image['sheet']['path'] in known:continue
                p=self.root/image['sheet']['path']
                value['objects'].append(dict(path=image['sheet']['path'],sha256=sha(p),bytes=p.stat().st_size,status='PASS',localObject=str(p)))
            value['verifiedObjects']=len(value['objects'])
        self.replace_json(self.config['localLfs'],lfs_update)
        self.save();code,log=self.run_cli();self.assertEqual(code,0,log)
        manifest=json.loads((self.reports/'run1/manifest.json').read_text())
        for group in ('anchor','props'):
            row=next(i for i in manifest['allCpuImages'] if i['path'].endswith(f'source-{group}-final/sheet.png'))
            self.assertEqual(row['classification'],'HISTORICAL_STALE_SOURCE')
            row=next(i for i in manifest['finalCpuImages'] if i['group']==group and i['kind']=='source')
            self.assertIn('revision-r1-source-',row['path'])

    def test_write_failure_partial_pair(self):
        # Real OS file-size failure: manifest fits, larger C2 does not. No
        # collector mocking or publication failure hook exists in production.
        self.replace_json(self.config['consumer']['result'],lambda value:value.update(publicationFixturePadding='x'*400000))
        self.save()
        code,log=self.run_cli(limit=300000);self.failed(code)
        stages=list(self.reports.glob('*.staging'))
        self.assertEqual(len(stages),1)
        self.assertTrue((stages[0]/'manifest.json').is_file())
        self.assertIn('File too large',log)
        self.assertFalse((stages[0]/'SHA256SUMS').exists())

    def test_concurrent_loser_preserves_owner(self):
        sentinel={'status':'IN_PROGRESS','invocation':'active-owner'}
        dump(self.reports/'CURRENT.json',sentinel)
        with (self.reports/'.publisher.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            code,log=self.run_cli()
            self.assertNotEqual(code,0);self.assertIn('REJECTED_BUSY',log)
            self.assertEqual(json.loads((self.reports/'CURRENT.json').read_text()),sentinel)
            self.assertFalse((self.reports/'run1').exists())
        self.assertEqual(len(list(self.reports.glob('.rejected-*.json'))),1)


if __name__=='__main__':
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    SESSION=Path(tempfile.mkdtemp(prefix='suite-',dir=EVIDENCE))
    SNAPSHOT=snapshot()
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Publication))
    dump(SESSION/'results.json',dict(status='PASS' if result.wasSuccessful() else 'FAIL',tests=result.testsRun,
                                   failures=len(result.failures),errors=len(result.errors),runs=RUNS,
                                   limitation='Publication fixtures only; no new production input qualification.'))
    print('EVIDENCE',SESSION)
    sys.exit(0 if result.wasSuccessful() else 1)
