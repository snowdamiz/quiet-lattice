"""Exports assets/blend/characters/*.blend to packages/client/public/models/characters/ (the shared core is artlib/export.py).

Run: pnpm art:export -- characters
 or: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/export_characters.py -- [--only name,...]
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from artlib.export import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main("characters"))
