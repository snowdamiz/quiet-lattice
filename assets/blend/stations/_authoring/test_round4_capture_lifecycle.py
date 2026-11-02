"""Compatibility entry for the strengthened station lifecycle controls.

The exact historical fourteen-control suite is preserved in round4/controller_freeze
and controller_revise01/preserved_source. Its cases are ported to the durable-boundary suite.
"""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).with_name("test_round4_job_boundary.py")), run_name="__main__")
