#!/opt/homebrew/bin/python3
import os,sys
args=sys.argv[1:]
position=args.index('-P') if '-P' in args else len(args)
args[position:position]=['-t','2']
os.execv('/Applications/Blender.app/Contents/MacOS/Blender',['/Applications/Blender.app/Contents/MacOS/Blender',*args])
