import bpy, numpy as np
bo = bpy.data.objects['body']
dg = bpy.context.evaluated_depsgraph_get()
ev = bo.evaluated_get(dg); me = ev.to_mesh()
P = np.array([v.co for v in me.vertices]); ev.to_mesh_clear()
R = np.array([v.co for v in bo.data.vertices])
d = np.linalg.norm(P - R, axis=1)
o = np.argsort(-d)[:10]
for i in o:
    gs = [(bo.vertex_groups[g.group].name, round(g.weight, 3)) for g in bo.data.vertices[i].groups]
    print(i, np.round(R[i], 3), '->', np.round(P[i], 3), gs)
rig = bpy.data.objects['RIG']
for n in ('thigh_L', 'calf_L', 'foot_L', 'upperarm_L', 'lowerarm_L', 'hand_L'):
    pb = rig.pose.bones[n]
    print(n, np.round(pb.head, 3), np.round(pb.tail, 3), 'rest', np.round(rig.data.bones[n].head_local, 3))
