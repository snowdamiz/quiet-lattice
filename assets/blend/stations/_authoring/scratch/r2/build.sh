#!/bin/sh
# build.sh waystation|scrapyard [modules] : rebuilds the .blend from the authoring scripts
A="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$A/scratch/r2/bl.sh" /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P "$A/build_$1.py" -- "$A/../$1.blend" $2
