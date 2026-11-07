"""Replace the slate's broad soft colour clouds with fine grain; keep painted contact wear and decals downstream."""
import bpy,json,os
from pathlib import Path
p=Path('assets/blend/hulls/swift.blend').resolve();bpy.ops.wm.open_mainfile(filepath=str(p));bpy.context.preferences.filepaths.save_version=0
assert not bpy.context.scene.get('SwiftR4SlateFinished');changed=[]
for m in bpy.data.materials:
 if m.name not in ['Swift_Hull','SwiftDmg_Hull']:continue
 nt=m.node_tree;target=nt.nodes.get('LiveryMul');assert target
 grain=nt.nodes.new('ShaderNodeTexNoise');grain.label='R4 fine slate grain';grain.inputs['Scale'].default_value=42;grain.inputs['Detail'].default_value=2
 nt.links.new(nt.nodes['Texture Coordinate'].outputs['Object'],grain.inputs['Vector'])
 ramp=nt.nodes.new('ShaderNodeMapRange');ramp.label='R4 restrained stone albedo';ramp.inputs['To Min'].default_value=.72;ramp.inputs['To Max'].default_value=.94
 nt.links.new(grain.outputs['Fac'],ramp.inputs['Value']);nt.links.new(ramp.outputs[0],target.inputs[6]);changed.append(m.name)
bpy.context.scene['SwiftR4SlateFinished']=True;bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
Path(os.environ['SWIFT_JOB'],'slate.json').write_text(json.dumps({'materials':changed},indent=2));print(changed)
