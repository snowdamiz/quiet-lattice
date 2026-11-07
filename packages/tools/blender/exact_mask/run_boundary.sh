#!/bin/bash
# Deferred serial validation. Run only under the parent's explicit Blender/codec assignment.
set -euo pipefail
: "${EXACT_MASK_NODE:?Set the absolute pinned Node executable (>=26)}"
: "${EXACT_MASK_DEPS:?Set an existing checkout with the pinned dependencies}"
run_dir=${1:?Supply a new exclusive scratch directory}
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
blender=/Applications/Blender.app/Contents/MacOS/Blender
mkdir -- "$run_dir"
mkdir -- "$run_dir/tmp"
run_dir=$(cd -- "$run_dir" && pwd)
export TMPDIR="$run_dir/tmp" PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
"$blender" -b -t 2 --factory-startup --python-exit-code 1 -P "$script_dir/fixture.py" -- export "$run_dir/fixture" > "$run_dir/01-export.log" 2>&1
"$EXACT_MASK_NODE" --import "$script_dir/dependencies.mjs" "$script_dir/consumer.mjs" "$run_dir/fixture" > "$run_dir/02-consumer.log" 2>&1
"$blender" -b -t 2 --factory-startup --python-exit-code 1 -P "$script_dir/fixture.py" -- validate "$run_dir/fixture" > "$run_dir/03-validate.log" 2>&1
printf '%s\n' 'PASS: saved-source export, compression, GLTFLoader/consumer and stock validation' > "$run_dir/result.txt"
