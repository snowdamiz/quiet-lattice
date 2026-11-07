"""Historical rejected tracer, retained only for R6 red controls; never install in production.

Delete with the controls' legacy route after the parent integrates the reviewed stock fix.
"""

from artlib import materials

original_trace = materials.trace


def trace_masked_base(socket):
    if socket is not None and socket.name == "Base Color" and socket.is_linked:
        node = socket.links[0].from_node
        if (
            node.type == "MIX"
            and node.blend_type == "MULTIPLY"
            and node.data_type == "RGBA"
        ):
            factor = node.inputs[0]
            inputs = [s for s in node.inputs if s.enabled and s.type == "RGBA"]
            if not factor.is_linked and factor.default_value == 1 and len(inputs) == 2:
                for image_socket, mask_socket in (inputs, inputs[::-1]):
                    if not mask_socket.is_linked:
                        continue
                    link = mask_socket.links[0]
                    mask = link.from_node
                    if (
                        mask.type == "VERTEX_COLOR"
                        and mask.layer_name in ("", "Color")
                        and link.from_socket.name == "Color"
                    ):
                        channel = original_trace(image_socket)
                        if channel.kind == "image":
                            return channel
    return original_trace(socket)


def install():
    materials.trace = trace_masked_base
