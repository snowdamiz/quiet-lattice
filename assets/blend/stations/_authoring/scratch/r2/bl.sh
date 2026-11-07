#!/bin/sh
# One Blender or capture job at a time across the agents working this worktree: bl.sh <command...>
L="$(cd "$(dirname "$0")" && pwd)/gpu.lock"
until mkdir "$L" 2>/dev/null; do sleep 3; done
trap 'rmdir "$L"' EXIT INT TERM
"$@"
