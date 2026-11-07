"""Task-local transport limits; all stock codec settings remain unchanged."""
from concurrent.futures import ThreadPoolExecutor


class SingleCodecPool(ThreadPoolExecutor):
    def __init__(self, max_workers=None, **kwargs):
        super().__init__(max_workers=1, **kwargs)


def configure(ktx):
    ktx.ThreadPoolExecutor = SingleCodecPool
    original = ktx.encode_args
    ktx.encode_args = lambda tool, src, dst, codec, srgb, normal, channels, settings, threads: original(
        tool, src, dst, codec, srgb, normal, channels, settings, 1)
