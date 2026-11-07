#!/bin/zsh
# Focused run. Do not use `pnpm test --`: pnpm inserts `--`, and Vitest then
# ignores the flags and runs every workspace project.
# `pnpm exec vitest run` is the same runner as package.json "test" (`vitest run`).
cd /Users/andreyyurlov/.t3/worktrees/space/t3-af46806b
export GIT_LFS_SKIP_SMUDGE=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
OUT=/tmp/space-e04-t06-unit-f1766f0-20261107
: > "$OUT/asserts.jsonl"
pnpm exec vitest run \
  --config "$OUT/vitest.config.mjs" \
  --root /Users/andreyyurlov/.t3/worktrees/space/t3-af46806b/packages/client \
  --maxWorkers 1 \
  --no-file-parallelism \
  --pool forks \
  --reporter=verbose \
  --reporter=json \
  --outputFile.json="$OUT/vitest.json" \
  src/remote/markers.test.js \
  src/ui/pilotMarkers.test.js \
  src/entities/poolDisplays.test.js \
  src/entities/poolCaptures.test.js \
  src/remote/RemoteShips.test.js \
  src/remote/replay.test.js
