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

## Second batch

A further 6,354 frames from 33 completed-review directories are archived at commit `634c51d2378748c6a514af2a792ee4500b912643` and local ref `refs/archive/development-screenshots/2026-11-06-before-cleanup-batch2`. [The second manifest](batch-2/manifest.jsonl) lists every path and payload; [its summary](batch-2/summary.json) maps directories to completed tasks. Every local LFS payload was verified by SHA256 before removal. Existing sibling stills, contact sheets and readouts remain.

| Completed task | Archived frames |
|---|---:|
| P2.E21.T01 event banners | 1,740 |
| P1.E07.T03 ability HUD | 732 |
| P1.E07.T02 Heat and Charge HUD | 546 |
| P1.E04.T05 login/character screens | 1,320 |
| P1.E15.T04 social motion follow-ups | 912 |
| P2.E22.T02 Edge views | 540 |
| P1.E13.T05 fabricator | 504 |
| P1.E06.T04 inventory, also used by P1.E13.T02 icon review | 60 |

Use the restoration commands above with the second commit and desired directory to recover these sequences. This batch contains 1,556,390,321 bytes of logical image payload; the parent checkout held 404,833,968 bytes because many files were LFS pointers. These figures are not physical disk-space savings.

Together the two batches remove 8,778 raw frames from the current tree. Open reviews, body/station evidence, remote-pilot motion, unresolved auxiliary captures, current development outputs and golden-test fixtures remain untouched. Other active task worktrees retain their own copies until their work can safely adopt the cleanup.
