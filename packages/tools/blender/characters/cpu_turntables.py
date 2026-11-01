"""Run the standard turntable camera/material sheet on CPU while the GPU is reserved.

Arguments are exactly turntable.py's. Only the Cycles device assignment is replaced;
resolution, sample count, lighting, framing and material handling remain unchanged.
"""
from pathlib import Path

script = Path(__file__).resolve().parents[1] / 'turntable.py'
source = script.read_text()
assignment = "scene.cycles.device = 'GPU'"
assert source.count(assignment) == 1, 'Review the turntable device setup before using this runner'
source = source.replace(assignment, "scene.cycles.device = 'CPU'; scene.cycles.denoising_use_gpu = False", 1)
print('CHARACTER_TURNTABLE_DEVICE CPU', flush=True)
exec(compile(source, str(script), 'exec'), {'__name__': '__main__', '__file__': str(script)})
