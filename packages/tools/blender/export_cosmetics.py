"""Exports assets/blend/cosmetics/*.blend to packages/client/public/models/cosmetics/ (the shared core is artlib/export.py).

Run: pnpm art:export -- cosmetics
 or: Blender -b --factory-startup --python-exit-code 1 -P packages/tools/blender/export_cosmetics.py -- [--only name,...]
"""
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from artlib.export import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main("cosmetics"))
