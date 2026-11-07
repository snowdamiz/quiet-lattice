TASK: P1.E05.T02 — native189 independent R4 correction, Appendix C.2

STATUS: DONE for the bounded source correction and CPU controls. Runtime remains
disabled, pending fresh independent review. **Preservation qualification:** the
full filesystem snapshot does not match exactly: three pnpm task-state entries
changed after static checks. This failed audit is retained and disclosed below;
source/assets/helpers and all 945 protected prior-manifest entries match.

SUMMARY: Replaced os.walk's permissive classification with explicit scandir and
no-follow stat traversal in the task-local inventory boundary. Enumeration and
classification failures propagate with the original error and partial facts.
Recursion follows the checked directory type and identity; no failed type query
can silently reclassify a directory as a file and omit its descendants. All 525
current CPU controls pass, including the exact R4 case and new classification
controls. Immutable helpers, playback, assets, native algorithms and budgets
remain unchanged. No actual native job was launched.

Base: `c52db738abe4e7ea9486031a83694bf23f060ce2`, tree
`394ef7e27ffae7be8e5d65151d16b15aceafad3e`; branch
`codex/task/P1-E05-T02-thalune-reel-candidate`. The delivery commit contains this
report; its final SHA/tree are supplied in the handoff. unit-provenance.json
records the combined library head/tree, donor commits, retained animation branch
and current source hashes. No source recovery or hydration was added. The
original 21 recovery rows and two earlier additional recoveries are unchanged.

FILES CHANGED:

- inventory_boundary.py: explicit scandir iteration and entry.stat with
  follow_symlinks=False replace os.walk. Each directory and entry is attached to
  observations before fallible enumeration/classification. Partial directory
  lists, pending paths, completed stat fields and original exception attributes
  remain available on failure. Directory type/device/inode are checked before
  descending. A closed partial iterator remains incomplete. Consumer pruning
  refuses acceptance. Links remain visible entries and are not recursed; existing
  consumers retain their link policies. Top-down and bottom-up traversal work.
- revision08-controls.py: focused actual-boundary CPU controls, using real scratch
  files and transparent scandir/stat fault ports. Exact retained helper bodies
  and actual dispatcher/adapter/inspection paths execute with native boundaries
  inert. This does not introduce another native framework.
- readiness.json, candidate-index.json, source-audit.json: refreshed source hashes,
  both flags still false. revision-08/: new report, commands, red/green evidence,
  provenance and preservation qualification. No other existing source file,
  helper, asset, library, playback, work inventory, plan or historical report was
  edited.

VERIFY:

- The authoritative additional.py ran **unchanged on the clean exact base**,
  exit 0: six safe controls and one asserted defect, seven cases total. The
  original DirEntry.is_dir EIO injection caused an over-budget subtree to be
  omitted and provisional success to be published. This is RED evidence, not a
  product pass. red/ retains the exact script, original report, bound-os-walk
  excerpt, results and stdout/stderr. The script/report hashes match the reviewer.
- The bound Python 3.12.14 os.py source contains the permissive OSError catch and
  has SHA256 `54c43a1fc69c979c70d8f7d097174cee163bfe59937723ee353043dd4a0211e1`.
  The actual runtime behavior was reproduced, rather than inferred only from
  that source text. This is deterministic error injection, not a naturally
  observed EIO or a native run.
- **Seven adapted R4 cases PASS**, exit 0. The old is_dir fault port is no longer
  called; actual checked stat classification discovers the extra file. The
  actual native final consumer returns HOLD and accounts for its bytes. Both
  proof and packet summaries publish HOLD. The readable-extra and scandir-open
  controls, early consumer-close control and three original unbound-executable
  primary/fallback controls remain correct. Those three observer cases still
  stop after one attempted inert job and retain structured memory when all
  sinks fail.
- **28 new controls PASS**, exit 0. Twelve permission/EIO stat controls cover
  packet inventory, budgeted writes, final budget inspection, artifact indexes,
  archive-byte accounting and source binding inventory. Eight cases reach actual
  native final dispatch/inspection: PermissionError, EIO, a real permission
  failure at entry.stat, TimeoutExpired partial non-UTF8 stdout/stderr and unknown
  fields, empty KeyboardInterrupt, real retained-helper SIGALRM, iterator-next
  failure and scandir-open failure. All refuse incomplete inventories, preserve
  original facts, omit unproved outputBytes, close real iterators and restore
  timers. Proof publication records HOLD; the packet fallback is attempted and
  refuses incomplete inventory.
- Four new cases execute exact immutable profile/private-TMP archive bodies and
  refuse permission/EIO classification errors before native, copy or removal
  ports. One executes actual StationAdapter.run followed by native.run_sequence:
  first-job archive classification failure retains the receipt and stops the
  validator. Two positive traversal cases verify order and visible non-followed
  links; one pruning case verifies that omitted entries cannot be called complete.
  No giant data copy is required; new archive content is a few fixture bytes.
- **All 490 prior controls PASS**, exits 0. The final current total is
  **525 = 490 prior + 7 R4 independent replays + 28 new controls**. The prior 490
  are 393 earlier controls, 47 R2 boundary controls, 39 R3 boundary controls and
  11 R3 independent replays. Existing anchored-directory, cap, admitted-read,
  FIFO, deadline, RSS, first-error, raw-observation, fallback, cancellation and
  fresh-temp-Git controls remain green. The earlier 28-case development run is
  retained but not counted twice.
- Exact argv, working directories, PATH, results and durations are in commands.json
  and final/final-commands.json, with nested ledgers under final/prior/. Main
  executions use bound Python3.12 with `-B`: final/prior/run-all.py (393),
  revision06-controls.py (47), revision07-controls.py (39),
  revision08-controls.py (28), three final/independent11 scripts (8 + 2 + 1),
  and final/independent7/additional.py (7), all exit 0. Reports use fresh paths.
- `pnpm typecheck`, scoped ESLint, scoped Prettier and all 24 root Python AST
  parses exit 0. These static checks passed but the pnpm task-state preservation
  issue below prevents a whole-snapshot preservation PASS. Subsequent report
  formatting uses the directly bound Node and local Prettier entry, without
  another package-manager run. Native source preflight exits 0 with plannedJobs=2
  and nativeJobs=0; disabled native --execute exits 1 as expected before grant or
  output allocation. Prior disabled entry/caller/worker controls remain green.
- Freeze exits 0: **38 source files, 2,354 source/data bindings, 12 software
  bindings and 42 candidate-index rows**. All hashes/sizes match; Node remains
  26.12.1 and no software pin was retargeted. Readiness differs from the exact
  base only in source binding rows. Both authorization flags are false; all 11
  prospective operational paths remain absent, including dangling links.

FAILURES AND PRESERVATION:

- The first adapted GREEN driver exited 1 after two passing cases because its new
  assertion incorrectly expected packet publication to fail for a complete
  inventory. Product behavior was HOLD with the oversized extra file recorded.
  Native's tighter final path/64 MiB check refuses it, while the existing larger
  aggregate packet allowance can still persist the HOLD summary. No production
  budget or publication semantics were changed. The failed green/ report and
  actual proof/packet results remain intact; green-final/ and final/independent7/
  contain fresh corrected passing runs. The original failing stderr is:

```text
Traceback (most recent call last):
  File "/private/tmp/t02-r8-correction-0907hb14/green/additional.py", line 46, in <module>
    assert result['terminalDelivery']['packet']['status']=='failed'
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError
```

- Before edits, **all 29,502 entries / 26,927 unique regular contents** matched the
  independent reviewer snapshot exactly. After static checks, the first full
  preservation command exited 1 at a missing pnpm completion marker. A second
  full comparison retained every remaining result and exited 1 with three
  differences: the node_modules/.pnpm-task-run-state-v1 directory metadata,
  its latest.json, and the removed old .finished marker. A new .finished marker
  is present. Full snapshot equality is **not** claimed. The first failure ended:

```text
FileNotFoundError: [Errno 2] No such file or directory: '/Users/andreyyurlov/.t3/worktrees/space/t3-11167406/node_modules/.pnpm-task-run-state-v1/44f3e59d9af66daa13e7fcb01c79a7285025ae7bf43c5566cb06bce55cc11aac.01a1b516a662-14929-1.finished'
```

- **29,495 other protected entries match exactly**, including mode, size,
  device/inode, mtime, links and regular-file hashes. Four candidate source/hash
  files were explicitly allowed to change; the three remaining deviations are
  recorded without exclusion or relabeling in protected-after-facts.json and
  preservation-qualification.json. All **945 protected prior-manifest entries**
  match their original bytes/sizes, as do all bound software/source/data files.
  No task-state marker was reconstructed or removed to manufacture preservation.
  The second audit's recorded status remains MISMATCH and its exit remains 1.
  preservation-failures.json retains the first traceback and the second recorded
  assertion outcome.
- The three oversized historical failed reports remain at their original paths,
  with original SHA256 and sizes 26,936,262 / 207,110,041 / 367,810,077 bytes
  verified. They were neither copied nor removed. The authoritative review,
  prior reports, protected assets and exact helper sources remain unchanged.
  evidence-provenance.json records original hashes and external dependencies.
  Raw output needing whitespace preservation is losslessly JSON encoded with
  its original hash. Generated media/cache/sparse fixtures are not copied.
- No library/Blender/three-export suite or giant full-producer comparison was
  rerun. The 28 library tests, 126 clip/people pairs, 42 actions and full historical
  CPU producer comparison remain prior evidence for their unchanged algorithms.
  No actual native, codec, browser, GPU, Blender, Vite, service, DB or grant job,
  asset hydration or manual cleanup operation occurred. The pnpm-managed state
  difference is the explicit exception to exact filesystem preservation.

DECISIONS:

- Which classification determines recursion → a checked no-follow stat result →
  os.walk's onerror does not cover its internal per-entry OSError suppression.
- What happens on an unknown classification → preserve the original error and
  current partial row, then refuse → never substitute a guessed file kind or
  claim complete bytes for an unvisited subtree.
- What to change in frozen helpers → nothing → the existing task-local
  enumeration ports now deliver the corrected traversal to their exact bodies.
- How to report the snapshot deviation → keep the failed checks and exact three
  differences → source/hash preservation does not prove the full filesystem
  snapshot unchanged. Do not reconstruct or clean managed task state.
- What constitutes readiness → fresh exact-pin source review remains next →
  CPU fixtures do not qualify codecs, inheritance, live ownership or visuals.

OUT OF SCOPE FOUND: Native process inheritance, encoder/decoder behavior, live
cache ownership, peak RSS and parent-observed OS completion remain unqualified.
The separate parent pilot is not diagnosed here. Whole-animation capture and
visual grading remain pending; gameplay integration belongs to E05.T04. No
orchestration documentation, main, push, PR, merge or screenshot cleanup changed.

ARTIFACTS: revision-08/REPORT.md, commands.json, unit-provenance.json,
evidence-provenance.json, protected-before.json, protected-after-facts.json,
preservation-qualification.json, final/checks/preservation.json, red/, green/,
green-final/, final/ and combined-hash-manifest.json. These retain exact commands,
results, failures, raw facts and hashes. No visual artifact exists. next-launch.json
binds current disabled readiness/index to the unchanged plan and executable pins.

The next command remains disabled and was not launched:

```sh
/Users/andreyyurlov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 -B packages/tools/blender/characters/animations/thalune-run-candidate/native189.py --execute --grant /private/tmp/t02-native189-r04-20261107-t3-11167406-grant.json
```

Next is fresh independent review of this correction and its preservation
qualification, then parent-scheduled native qualification under the existing
authorization. No new human permission stage is requested. Activation retains a
clean bound HEAD, fresh capacity/ownership evidence, one-use diagnostic grant,
positive encoder-cohort release before validation, and actual parent-observed OS
exit zero. Diagnostic authorization cannot enable capture. Output/job/log paths
and protocol remain revision-04/NEXT_LAUNCH.md and native189-plan.json, with current
source hashes in next-launch.json. No old capacity snapshot is fresh admission.

Unchanged limits: 189 frames, 1920×1080 opaque 60 Hz, one ACK in flight,
39,354,368 bytes per reel, 64 MiB native fixture metadata, sampled aggregate 8 GiB
owned RSS, joint 384 MiB / 4,096-entry cache admission, 1 GiB per-job archive,
22,066,626,560 bytes combined reserve, four copy slots, eleven archive allowances
and the 30-second final inspection deadline. Existing anchored cache and artifact
reads are unchanged. This traversal does not claim arbitrary-writer exclusion or
an OS quota. No native, whole-T02, T04 or visual acceptance is claimed.
