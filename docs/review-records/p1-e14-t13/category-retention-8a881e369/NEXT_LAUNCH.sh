#!/bin/sh
# Disabled proposal only. Fresh freeze was intentionally not executed.
# Parent must independently review, authorize freeze, enable readiness, and issue a one-use grant.
# This file does not enable readiness or issue a grant.
set -eu
if [ "$#" -ne 2 ]; then
  echo 'usage: NEXT_LAUNCH.sh <parent-enabled-readiness-sha256> <fresh-grant-sha256>' >&2
  exit 64
fi
if [ ! -f /private/tmp/t13-observer-frozen-8a881e369-0b3adcd9/source/packages/tools/src/capture/trace_observer_packet/launch.py ]; then
  echo 'refused: planned frozen launch.py absent; fresh freeze was disabled in the source unit' >&2
  exit 78
fi
export PYTHONDONTWRITEBYTECODE=1
exec /opt/homebrew/Cellar/python@3.14/3.14.8/Frameworks/Python.framework/Versions/3.14/bin/python3.14 /private/tmp/t13-observer-frozen-8a881e369-0b3adcd9/source/packages/tools/src/capture/trace_observer_packet/launch.py \
  --readiness /private/tmp/t13-observer-enabled-readiness-0b3adcd9.json --readiness-sha256 "$1" \
  --grant /private/tmp/t13-observer-grant-0b3adcd9.json --grant-sha256 "$2"
