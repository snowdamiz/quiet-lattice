import bpy, numpy as np
bo = bpy.data.objects['body']
part = np.array([a.value for a in bo.data.attributes['part'].data]); side = np.array([a.value for a in bo.data.attributes['side'].data])
zero = [v.index for v in bo.data.vertices if sum(g.weight for g in v.groups) < 0.5]
print('zero-weight verts', len(zero))
import collections
print(collections.Counter((round(part[i]), round(side[i], 2)) for i in zero).most_common(12))
R = np.array([v.co for v in bo.data.vertices])
for i in zero[:8]:
    print(i, np.round(R[i], 3), part[i], side[i])
