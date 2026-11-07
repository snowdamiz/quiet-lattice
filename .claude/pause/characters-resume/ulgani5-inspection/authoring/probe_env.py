import sys, bpy
print('PY', sys.version)
for mod in ('openvdb', 'pyopenvdb', 'numpy', 'scipy', 'skimage', 'PIL', 'cv2'):
    try:
        m = __import__(mod)
        print('HAVE', mod, getattr(m, '__version__', ''))
    except Exception as e:
        print('NO', mod, e)
print([i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items])
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    print('devices', [(d.name, d.type) for d in prefs.devices])
except Exception as e:
    print('cycles prefs', e)
