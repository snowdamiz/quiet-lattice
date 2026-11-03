"""Refuse assertion-disabled Python before task imports or side effects."""
import sys

def require_assertions(caller_debug):
    if sys.flags.optimize or not __debug__ or caller_debug is not True:
        raise SystemExit('T02_ASSERTIONS_REQUIRED: optimized/assertion-disabled Python is refused')

require_assertions(__debug__)
