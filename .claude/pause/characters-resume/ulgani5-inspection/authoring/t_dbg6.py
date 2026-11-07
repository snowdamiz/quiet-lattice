import bpy, numpy as np, collections
bo = bpy.data.objects['body']
part = np.array([a.value for a in bo.data.attributes['part'].data])
print(part[[17064, 6870, 17061]])
R = np.array([v.co for v in bo.data.vertices])
low = R[:, 2] < 0.05
print('parts among z<0.05:', collections.Counter(np.round(part[low], 2)).most_common(10))
