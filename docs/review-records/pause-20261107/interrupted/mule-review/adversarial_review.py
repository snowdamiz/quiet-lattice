"""Review probes only. AST executes pinned functions with fake Blender/system ports."""
import ast
import contextlib
import copy
import errno
import io
import json
import os
import signal
import subprocess
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
INSTR = Path('/Users/andreyyurlov/.t3/worktrees/space/t3-348f0295/packages/tools/blender/hulls/mule-phase-instrumentation')
MULE = Path('/Users/andreyyurlov/.t3/worktrees/space/t3-348f0295')
CALLER = MULE / 'packages/tools/blender/hulls/mule-round4'
sys.path.insert(0, str(INSTR))
import phase_log as PL
IDENTITY = dict(material='Mule_Accent.001', variant='mule', channel='baseColor', resolution=4096, object_count=1, triangle_count=2)
RESOURCES = dict(group_rss_kib=123, wall_limit_s=5400, rss_limit_kib=8388608)
SNIPPET = (INSTR/'INTEGRATION.md').read_text().split('```python\n')[1].split('```')[0]
CHANNELS = ['baseColor', 'roughness', 'metallic', 'normal', 'emissive', 'occlusion']


def ast_exec(path, env, select):
    tree = ast.parse(path.read_text(), filename=str(path))
    tree.body = [node for node in tree.body if select(node)]
    exec(compile(tree, str(path), 'exec'), env)


class RootFailure(BaseException):
    pass


class UnprintableFailure(BaseException):
    def __repr__(self):
        raise RuntimeError('repr failed')


class FakeScene:
    def __init__(self, todo, failure=None, failure_at='op', linked_ao=False):
        self.events = []
        self.fail = failure
        self.failure_at = failure_at
        self.current = None
        outer = self
        def sock(name):
            return NS(name=name, is_linked=False, links=[], default_value=None)
        class Node:
            def __init__(self, kind, index):
                self.name = kind+str(index)
                self.type = {'ShaderNodeGroup':'GROUP'}.get(kind, kind)
                self.node_tree = None
                self.inputs = {n:sock(self.name+'.'+n) for n in ['Surface','Strength','Color','Normal','Occlusion',*CHANNELS]}
                self.outputs = {n:sock(self.name+'.'+n) for n in ['Emission','Color','Normal','Red']}
        class Nodes(list):
            active = None
            def new(self, kind):
                n = Node(kind, len(self)); self.append(n)
                outer.events.append(('node-new',n.name)); return n
            def remove(self,n):
                outer.events.append(('node-remove',n.name)); super().remove(n)
                if self.active is n:self.active=None
        class Links:
            def new(self,source,dest):
                outer.events.append(('link',source.name,dest.name))
                dest.links=[NS(from_socket=source)];dest.is_linked=True
        class Mat:
            def __init__(self,name):
                self.name=name;self.library=None;self.node_tree=NS(nodes=Nodes(),links=Links())
        class Obj:
            def __init__(self,name,mats,hidden=False):
                self.name=name;self.material_slots=[NS(material=m) for m in mats]
                self.hide_render=hidden;self.selected=False;self.hidden=False
            def as_pointer(self):return id(self)
            def select_set(self,v):
                self.selected=v;outer.events.append(('select',self.name,v))
            def hide_set(self,v):
                self.hidden=v;outer.events.append(('hide',self.name,v))
        self.mat=Mat('Mule_Accent.001');nt=self.mat.node_tree
        out=nt.nodes.new('OUTPUT_MATERIAL');out.is_active_output=True
        surface=sock('original-surface');out.inputs['Surface'].links=[NS(from_socket=surface)]
        bsdf=NS(inputs={ch:sock('bsdf.'+ch) for ch in CHANNELS})
        bsdf.inputs['Normal']=bsdf.inputs['normal']
        for ch,s in bsdf.inputs.items():s.is_linked=True;s.links=[NS(from_socket=sock('source.'+ch))]
        group=nt.nodes.new('ShaderNodeGroup');group.node_tree=NS(name='glTF Material Output')
        group.inputs['Occlusion'].is_linked=linked_ao
        if linked_ao:group.inputs['Occlusion'].links=[NS(from_socket=sock('source.occlusion'))]
        self.info=NS(mat=self.mat,bsdf=bsdf,procedural=lambda:list(todo),channels={'occlusion':NS(kind='constant')})
        self.other=Mat('other');self.other.node_tree.nodes.active=self.other.node_tree.nodes.new('guard-before')
        self.objects=[Obj('body',[self.mat,self.other])]
        self.occluder=Obj('occluder',[],True);self.foreign=Obj('foreign',[])
        all_objects=type('Objects',(list,),{})([*self.objects,self.occluder,self.foreign])
        all_objects.active=None
        class Images(list):
            def new(self,name,width,height,**kw):
                img=NS(name=name,width=width,height=height,colorspace_settings=NS(name=None),generated_color=None)
                self.append(img);outer.events.append(('image-new',name,width,height,kw));return img
            def remove(self,img):
                outer.events.append(('image-remove',img.name));super().remove(img)
        self.images=Images()
        def bake(**kw):
            self.current=nt.nodes.active.image.name.rsplit('_',1)[1]
            outer.events.append(('bake',self.current,kw))
            if self.current=='roughness' and failure_at=='op' and failure:raise failure
        self.bpy=NS(data=NS(images=self.images),ops=NS(object=NS(bake=bake)),context=NS(scene=NS(objects=all_objects),view_layer=NS(objects=all_objects)))
        self.M=NS(MaterialInfo=lambda mat:self.info,SOCKETS={ch:ch for ch in CHANNELS},LABELS={ch:ch for ch in CHANNELS},GLTF_GROUPS={'glTF Material Output'})
        self.mod=types.ModuleType('pinned_bake')
        self.mod.__dict__.update(bpy=self.bpy,np=None,M=self.M)
        ast_exec(MULE/'packages/tools/blender/artlib/bake.py',self.mod.__dict__,lambda n:not isinstance(n,(ast.Import,ast.ImportFrom)))
        def finish(img,mat,ch):
            outer.events.append(('finish',img.name,mat.name,ch))
            if ch=='roughness' and failure_at=='finish' and failure:raise failure
        self.mod._finish=finish  # fake pixel/native port; material/channel/select/isolate/rewire code is exact
        def check(label):
            outer.events.append(('admit',label))
            if failure_at=='admit' and failure:raise failure
        self.mod.__dict__.update(bake=self.mod,check=check)
        ast_exec(CALLER/'export_saved.py',self.mod.__dict__,lambda n:32<=n.lineno<=36)
        self.events.clear()

    def run(self,wrapped,tmp,secondary=False):
        logger=PL.PhaseLog(tmp/'phases.jsonl')
        self.resource_calls=0
        def resources():
            self.resource_calls+=1;return dict(RESOURCES)
        if wrapped:
            PL.install(self.mod,logger,resources_of=resources,counts_of=lambda objs:(len(objs),2),variant_ids=('mule','mule_damaged','mule_husked'))
        if secondary:
            finish=logger.finish
            def fail_terminal(phase,outcome,error=None):
                if outcome!='success':raise SystemExit(77)
                return finish(phase,outcome,error)
            logger.finish=fail_terminal
        output=io.StringIO();result=None;error=None
        try:
            with contextlib.redirect_stdout(output):
                result=self.mod.bake_material(self.mat,self.objects,4096,ao=True,label='mule_damaged_Accent',occluders=[self.occluder])
        except BaseException as exc:error=exc
        state=dict(events=self.events,images=[(i.name,i.width,i.height,i.colorspace_settings.name) for i in self.images],
                   nodes=[n.name for n in self.mat.node_tree.nodes],
                   surface=self.mat.node_tree.nodes[0].inputs['Surface'].links[0].from_socket.name,
                   guard_active=self.other.node_tree.nodes.active.name,
                   hidden=[self.occluder.hide_render,self.foreign.hide_render],
                   stdout=output.getvalue(),result=result)
        return state,error,PL.load(tmp/'phases.jsonl')[0]


class Review(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=HERE);self.tmp=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_actual_material_channels_state_order_return_output_all_paths(self):
        for linked_ao in [False,True]:
            for todo in [CHANNELS,CHANNELS[:-1],['normal'],['occlusion']]:
                with self.subTest(todo=todo,linked_ao=linked_ao):
                    a=FakeScene(todo,linked_ao=linked_ao);b=FakeScene(todo,linked_ao=linked_ao)
                    x,ex,_=a.run(False,self.tmp/'stock');y,ey,phases=b.run(True,self.tmp/'wrapped')
                    self.assertIsNone(ex);self.assertIsNone(ey);self.assertEqual(x,y)
                    self.assertEqual(y['result'],todo if 'occlusion' in todo else [*todo,'occlusion'])
                    self.assertTrue(all(p['status']=='success' for p in phases))
                    self.assertEqual(b.resource_calls,len(y['result']))
    def test_actual_failure_paths_preserve_exception_and_cleanup(self):
        for failure_type in [RuntimeError,KeyboardInterrupt,SystemExit,RootFailure,UnprintableFailure]:
            for at in ['op','finish']:
                for secondary in [False,True]:
                    with self.subTest(failure=failure_type.__name__,at=at,secondary=secondary):
                        failure=failure_type('same-object')
                        a=FakeScene(CHANNELS,failure,at);b=FakeScene(CHANNELS,failure,at)
                        x,ex,_=a.run(False,self.tmp/'stock');y,ey,phases=b.run(True,self.tmp/'wrapped',secondary)
                        self.assertIs(ex,failure);self.assertIs(ey,failure);self.assertEqual(x,y)
                        expected='unfinished' if secondary or failure_type is UnprintableFailure else 'interrupt' if failure_type in [KeyboardInterrupt,SystemExit] else 'error'
                        self.assertEqual([p['status'] for p in phases[-2:]],['success',expected])
                        self.assertIsNone(PL._FRAME.get());self.assertEqual(b.resource_calls,2)
    def test_actual_bounded_material_admission_still_prevents_channel(self):
        failure=AssertionError('admission denied');scene=FakeScene(CHANNELS,failure,'admit')
        _,exc,phases=scene.run(True,self.tmp)
        self.assertIs(exc,failure);self.assertEqual(scene.events,[('admit','bake Mule_Accent.001')])
        self.assertEqual(phases,[]);self.assertEqual(scene.resource_calls,0)
    def test_start_fsync_failure_prevents_bake(self):
        log=PL.PhaseLog(self.tmp/'p');called=[]
        with patch.object(PL.os,'fsync',side_effect=OSError(errno.EIO,'start sync failure')):
            with self.assertRaises(OSError):log.invoke(IDENTITY,RESOURCES,lambda:called.append(1))
        self.assertEqual(called,[]);self.assertEqual(PL.load(log.path)[0][0]['status'],'unfinished')
    def test_partial_terminal_write_stays_unfinished(self):
        log=PL.PhaseLog(self.tmp/'p');phase=log.start(IDENTITY,RESOURCES);write=os.write
        with patch.object(PL.os,'write',side_effect=lambda fd,data:write(fd,data[:len(data)//2])):
            with self.assertRaises(PL.PhaseError):log.finish(phase,'success')
        phases,tail=PL.load(log.path);self.assertEqual(phases[0]['status'],'unfinished');self.assertIsNotNone(tail)
    def test_terminal_fsync_failure_must_not_report_success(self):
        log=PL.PhaseLog(self.tmp/'p');fsync=os.fsync;calls=0
        def fail_third(fd):
            nonlocal calls
            calls+=1
            if calls==3:raise OSError(errno.EIO,'terminal sync failure')
            return fsync(fd)
        with patch.object(PL.os,'fsync',side_effect=fail_third):
            with self.assertRaises(OSError):log.invoke(IDENTITY,RESOURCES,lambda:'image')
        status=PL.load(log.path)[0][0]['status']
        print('OBSERVED terminal fsync failed, reader status='+status)
        self.assertEqual(status,'unfinished')
    def test_exact_snippet_at_documented_insertion_must_execute(self):
        env=dict(sys=sys,ROOT=MULE,Path=Path,os=os,json=json,bake=NS(bake_material=lambda *a,**k:None,_bake_channels=lambda *a,**k:{}))
        # All referenced caller globals available at line 36. out is only bound at line 43.
        exec(compile('\n'*11+SNIPPET,str(INSTR/'INTEGRATION.md'),'exec'),env)
    def test_snippet_with_out_defined_preserves_admission_and_resource_values(self):
        events=[];mod=types.ModuleType('snippet_bake')
        def stock(mat,*a,**k):events.append('stock');return []
        mod.bake_material=stock
        mod._bake_channels=lambda *a,**k:{}
        env=dict(sys=sys,ROOT=MULE,Path=Path,os=os,json=json,bake=mod,check=lambda label:events.append('admit'),out=self.tmp)
        ast_exec(CALLER/'export_saved.py',env,lambda n:32<=n.lineno<=36)
        exec(compile('\n'*11+SNIPPET,str(INSTR/'INTEGRATION.md'),'exec'),env)
        # Exact current started.json shape; non-default limits detect hard-coding.
        (self.tmp/'started.json').write_text(json.dumps({'limits':{'wall_seconds':321,'rss_mib':123}}))
        fake_run=types.ModuleType('run')
        fake_run.resources=lambda:{'disk_free':1234,'memory_reclaimable':5678,'system_rss_kib':120,'processes':[[1,0,44,10],[2,1,44,20],[3,1,99,90]]}
        with patch.dict(sys.modules,{'run':fake_run}),patch.object(os,'getpgrp',return_value=44):state=env['resource_snapshot']()
        self.assertEqual(state,{'disk_free':1234,'memory_reclaimable':5678,'system_rss_kib':120,'group_rss_kib':30,'wall_limit_s':321,'rss_limit_kib':125952})
        mesh=NS(loop_triangles=[1,2,3],calc_loop_triangles=lambda:None)
        self.assertEqual(mod.bake_material(NS(name='Mule_Accent.001'),[NS(data=mesh)],4096,label='mule_Accent'),[])
        self.assertEqual(events,['admit','stock']);self.assertIsNone(PL._FRAME.get())
    def test_actual_run_resources_with_fake_system_ports(self):
        env=dict(subprocess=NS(check_output=lambda command,**kw:'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 2.\nPages inactive: 3.\nPages speculative: 4.\n' if command[0]=='vm_stat' else '1 0 44 10\n2 1 44 20\n3 1 99 90\n'),re=__import__('re'),shutil=NS(disk_usage=lambda root:NS(free=765)),ROOT=MULE)
        ast_exec(CALLER/'run.py',env,lambda n:isinstance(n,ast.FunctionDef) and n.name=='resources')
        self.assertEqual(env['resources'](),{'disk_free':765,'memory_reclaimable':147456,'system_rss_kib':120,'processes':[[1,0,44,10],[2,1,44,20],[3,1,99,90]]})
    def test_started_receipt_is_written_after_launch_in_actual_run(self):
        tree=ast.parse((CALLER/'run.py').read_text())
        lines={}
        for node in ast.walk(tree):
            if isinstance(node,ast.Call):
                s=ast.unparse(node.func)
                if s=='subprocess.Popen' and node.lineno<200:lines['launch']=node.lineno
                if s=="(out / 'started.json').write_text":lines['receipt']=node.lineno
        self.assertEqual(lines,{'launch':175,'receipt':178})
        print('OBSERVED started.json publication order='+json.dumps(lines,sort_keys=True))
    def test_exact_run_launch_block_child_can_observe_missing_started_json(self):
        fake_run=types.ModuleType('run')
        fake_run.resources=lambda:dict(processes=[[1,0,44,10]],disk_free=123,memory_reclaimable=456,system_rss_kib=10)
        env=dict(sys=sys,ROOT=MULE,Path=Path,os=os,json=json,out=self.tmp,
                 bake=NS(bake_material=lambda *a,**k:None,_bake_channels=lambda *a,**k:{}))
        exec(compile('\n'*11+SNIPPET,str(INSTR/'INTEGRATION.md'),'exec'),env)
        observed=[]
        def popen(*args,**kwargs):
            try:env['resource_snapshot']()
            except FileNotFoundError:observed.append('child sees missing started.json')
            return NS(pid=44,poll=lambda:0)
        tree=ast.parse((CALLER/'run.py').read_text())
        block=next(n for n in ast.walk(tree) if isinstance(n,ast.With) and n.lineno==174)
        scope=dict(out=self.tmp,subprocess=NS(Popen=popen,STDOUT=-2),command=['fake-port'],ROOT=MULE,env={},receipt={'limits':{'wall_seconds':5400,'rss_mib':8192}},json=json)
        with patch.dict(sys.modules,{'run':fake_run}),patch.object(os,'getpgrp',return_value=44):
            exec(compile(ast.Module(body=[block],type_ignores=[]),str(CALLER/'run.py'),'exec'),scope)
        self.assertEqual(observed,['child sees missing started.json'])
        self.assertEqual(json.loads((self.tmp/'started.json').read_text())['limits'],{'wall_seconds':5400,'rss_mib':8192})
        print('OBSERVED '+observed[0]+' in exact launch block with fake Popen')
    def test_sigkill_in_actual_channel_body_leaves_exact_channel_unfinished(self):
        script="""import os,signal,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from adversarial_review import FakeScene,CHANNELS
scene=FakeScene(CHANNELS)
bake=scene.bpy.ops.object.bake
def kill_second(**kw):
    if scene.mat.node_tree.nodes.active.image.name.endswith('_roughness'):
        os.kill(os.getpid(),signal.SIGKILL)
    return bake(**kw)
scene.bpy.ops.object.bake=kill_second
scene.run(True,Path(sys.argv[2]))
"""
        proc=subprocess.run([sys.executable,'-B','-c',script,str(HERE),str(self.tmp)],capture_output=True,text=True,
                            env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'),timeout=5)
        self.assertEqual(proc.returncode,-signal.SIGKILL,proc.stderr)
        phases,tail=PL.load(self.tmp/'phases.jsonl')
        self.assertIsNone(tail)
        self.assertEqual([(p['channel'],p['status']) for p in phases],[('baseColor','success'),('roughness','unfinished')])
        self.assertEqual(phases[1]['variant'],'mule_damaged')
        self.assertEqual(phases[1]['material'],'Mule_Accent.001')

    def test_terminal_close_failure_must_not_report_success(self):
        log=PL.PhaseLog(self.tmp/'p');phase=log.start(IDENTITY,RESOURCES);close=os.close
        def close_then_fail(fd):
            close(fd);raise OSError(errno.EIO,'close failed')
        with patch.object(PL.os,'close',side_effect=close_then_fail):
            with self.assertRaises(OSError):log.finish(phase,'success')
        status=PL.load(log.path)[0][0]['status'];print('OBSERVED terminal close failed, reader status='+status)
        self.assertEqual(status,'unfinished')

if __name__=='__main__':unittest.main(verbosity=2)
