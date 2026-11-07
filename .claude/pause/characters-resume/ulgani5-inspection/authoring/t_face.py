import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from lib import preview
o = bpy.data.objects['TH_Head1_head1_L0']
kb = o.data.shape_keys.key_blocks
print('keys', [(k.name, round(k.value, 3), k.relative_key.name) for k in kb][:5], 'active', o.active_shape_key_index, o.show_only_shape_key, o.use_shape_key_edit_mode)
print('mods', [(m.type, m.object.name if getattr(m, 'object', None) else '') for m in o.modifiers])
rig = o.parent
print('pose jaw', tuple(rig.pose.bones['jaw'].rotation_quaternion), rig.data.pose_position)
dg = bpy.context.evaluated_depsgraph_get()
ev = o.evaluated_get(dg); me = ev.to_mesh()
P = np.array([v.co for v in me.vertices]); ev.to_mesh_clear()
B = np.array([v.co for v in o.data.vertices])
d = np.linalg.norm(P - B, axis=1)
print('eval vs basis max', d.max(), 'n>2mm', (d > 0.002).sum())
f = rig.data.bones['eye_L'].head_local
preview.render_views([o], 'renders/face.png', views=((0, 2), (30, 2)), size=(600, 600), samples=16, focus=(0, f[1], f[2] - 0.04), radius=0.12)
