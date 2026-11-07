import bpy, sys
names = sys.argv[sys.argv.index('--')+1:]
for m in bpy.data.materials:
    if names and not any(n in m.name for n in names): continue
    print("=== MAT", m.name, {k: m[k] for k in m.keys()})
    if not m.node_tree: continue
    for n in m.node_tree.nodes:
        ins = []
        for i in n.inputs:
            if i.is_linked:
                ins.append(f"{i.name}<-{i.links[0].from_node.name}.{i.links[0].from_socket.name}")
            elif hasattr(i,'default_value') and i.enabled:
                try: v = tuple(round(x,3) for x in i.default_value)
                except TypeError: v = round(i.default_value,3) if isinstance(i.default_value,float) else i.default_value
                ins.append(f"{i.name}={v}")
        extra = ''
        if n.type=='GROUP': extra = ' tree='+(n.node_tree.name if n.node_tree else '-')
        if n.type=='VALTORGB': extra = ' ramp='+str([(round(e.position,2), tuple(round(c,3) for c in e.color)) for e in n.color_ramp.elements])
        for attr in ('operation','blend_type','noise_dimensions','feature','distance','voronoi_dimensions','wave_type','attribute_name'):
            if hasattr(n, attr): extra += f' {attr}={getattr(n,attr)}'
        print(f"  [{n.type}] {n.name} {n.label!r}{extra} :: " + "; ".join(ins))
for ng in bpy.data.node_groups:
    print("GROUP", ng.name, [ (s.name, s.in_out) for s in ng.interface.items_tree if hasattr(s,'in_out')])
for t in bpy.data.texts:
    print("TEXT", t.name); print(t.as_string()[:3000])
for c in bpy.data.collections:
    print("COLL", c.name, [o.name for o in c.objects])
