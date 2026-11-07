import bpy, numpy as np
bo = bpy.data.objects['body']
dg = bpy.context.evaluated_depsgraph_get()
ev = bo.evaluated_get(dg); me = ev.to_mesh()
P = np.array([v.co for v in me.vertices]); ev.to_mesh_clear()
R = np.array([v.co for v in bo.data.vertices])
d = np.linalg.norm(P - R, axis=1)
bad = np.nonzero(d > 0.6)[0]
print('moved>0.6:', len(bad), 'of', len(d), 'max', d.max())
part = np.array([a.value for a in bo.data.attributes['part'].data]); side = np.array([a.value for a in bo.data.attributes['side'].data])
for i in bad[:15]:
    gs = [(bo.vertex_groups[g.group].name, round(g.weight, 3)) for g in bo.data.vertices[i].groups]
    print(i, np.round(R[i], 3), 'part', part[i], 'side', side[i], gs)
print(bo.parent, bo.parent_type, [m.type for m in bo.modifiers], bo.matrix_world.translation)
rig = bpy.data.objects['RIG']; print(rig.matrix_world.translation, bo.location)
