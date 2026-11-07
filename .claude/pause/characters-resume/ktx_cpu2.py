#!/opt/homebrew/bin/python3
import os,sys
args=sys.argv[1:]
if '--threads' in args:
 position=args.index('--threads')+1
 args[position]=str(min(2,int(args[position])))
os.execv('/Users/andreyyurlov/Documents/dev/space/.claude/worktrees/agent-a2adce75319812d41/node_modules/.cache/ktx-software-4.4.2/bin/ktx',['ktx',*args])
