"""Load only the installed exporter's pure Python packing modules, without bpy or a codec.

Used by cpu_test.py; this does not exercise Blender mesh extraction or a saved source.
"""
import importlib
import sys
import types
from pathlib import Path


def load_backend(path):
    path = Path(path).resolve()
    # Skip the add-on registration entry point, which requires a running Blender.
    # All imported submodules (including Accessor/BinaryData) remain the installed code.
    package = types.ModuleType('io_scene_gltf2')
    package.__path__ = [str(path)]
    sys.modules[package.__name__] = package
    return importlib.import_module('io_scene_gltf2.blender.exp.primitive_attributes')
