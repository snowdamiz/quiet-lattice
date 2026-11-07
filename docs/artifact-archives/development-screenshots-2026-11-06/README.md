# Archived development motion frames

The owner requested cleanup of old development screenshots on 2026-11-06. This batch removes 2,424 individual motion frames from the current tree after their reviews completed. Final stills, contact sheets and review verdicts remain in place.

| Capture | Completed task | Archived frames |
|---|---|---:|
| `ui/account-flow` | P1.E04.T05 | 780 |
| `ui/social` | P1.E15.T03; follow-ups completed in T04 | 840 |
| `ui/cutscene-test` | P1.E09.T04 | 804 |

The full original tree is retained at commit `45c172a102f1944ff00be0b6e5006eef13fd793b` and local ref `refs/archive/development-screenshots/2026-11-06-before-cleanup`. [manifest.jsonl](manifest.jsonl) records every path, Git blob and LFS payload identity. All 2,421 unique LFS objects were verified by SHA256 before cleanup and remain in the shared local LFS store. No LFS object or historical Git commit was removed.

The removed working files total 359,257,939 bytes; this is not a measured increase in free disk space. Other worktrees and active jobs were unchanged. The open-file check found no users of these three frame directories immediately before removal.

To recover a sequence in a checkout with no conflicting work, restore its tracked LFS pointers from the archived commit, then hydrate them from the retained local objects:

```sh
GIT_LFS_SKIP_SMUDGE=1 git restore --source=45c172a102f1944ff00be0b6e5006eef13fd793b --worktree -- assets/renders/ui/account-flow/_frames
git lfs checkout 'assets/renders/ui/account-flow/_frames/*'
```

Use `social` or `cutscene-test` in place of `account-flow` for the other sequences. Restoration changes working-tree state; use an isolated checkout when reviewing historical motion. The archive is local and has not been pushed.
