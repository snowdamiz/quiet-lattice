# Publication inputs v1

Run only after fresh production evidence is ready:

```sh
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 NUMEXPR_NUM_THREADS=2 VECLIB_MAXIMUM_THREADS=2 PYTHONDONTWRITEBYTECODE=1 python3 packages/tools/blender/cities/ixari/build_report.py --attempt revision-r1-publication-01 --inputs assets/blend/cities/ixari/revision-r1/publication-inputs.json
```

The inputs path and every referenced path are canonical repository-relative paths. Attempt names use letters, digits, `_` and `-`, start with a letter/digit, and have at most 80 characters. A name is reserved permanently, including when its invocation fails. Use a new name on every retry.

`Ref` means `{"path":"path/to/file","sha256":"64 lowercase hexadecimal characters"}`. `Receipt` means:

```json
{
  "process": {"path":"explicit/process.json","sha256":"..."},
  "log": {"path":"explicit/output.txt","sha256":"..."},
  "inputs": {"evaluated/file/path":"its SHA256 at execution"},
  "result": {"path":"explicit/result.json","sha256":"..."}
}
```

`result` is required for source/export audits, consumer and mesh validity; omit it for stock and the three command checks. `inputs` must be a nonempty map captured for that execution, not a map reconstructed to relabel old results after files changed. Existing process JSON remains supported: `exitCode:0`, `reaped:true`, `stoppedBy:null`, nonempty `command`, and nonempty `threadEnv` whose values are all `"2"`. Any `inputScriptSha256` entries are also checked. JSON references and inputs are hash-checked again immediately before publication. The publisher verifies evidence and its binding; it does not rerun or authenticate receipt producers.

Required top-level fields (no names of legacy receipt directories are hardcoded):

| Field | Value / required coverage |
|---|---|
| `schemaVersion` | `1` |
| `baseline` | Ref to parent's unchanged `revision-r1/baseline.json`, using `files[path].sha256`. The original root manifest is verified against this baseline and never written. |
| `inventory` | Eight Refs, exactly all JSON files in `assets/blend/cities/ixari/inventory`. Source hashes, 33 unique assets, and source/export audit LODs must agree. |
| `sourceAudit` | Receipt with the existing source audit schema; input map covers eight sources. Audit file hashes, all 33 variants, errors, LOD counts, and negative controls are checked. |
| `exportAudit` | Receipt with existing export audit schema; input map covers eight exports. Exact file/variant coverage and hashes are checked. |
| `consumer` | Receipt with actual Vitest JSON result: success, exactly 68 passed assertions, zero failed/pending/todo. Input map covers all eight source files, eight GLBs and eight inventory files. |
| `meshValidity` | Receipt with existing 132-row mesh audit; all unchanged, before=after, unique file/object pairs and all eight sources covered. Input map covers eight sources. |
| `commands` | Object with exactly `eslint`, `format`, `pythonSyntax`, each a Receipt. Input maps bind checked files. `pythonSyntax.inputs` must include the final `build_report.py`. |
| `stock` | List of `{reports:[Ref],receipt:Receipt,reuseBaseline:boolean}` batches. Exactly 16 distinct source/export files in total. Reports must pass with zero warnings/errors and matching modes. A fresh changed4 batch and a reused unchanged12 batch are supported. |
| `resourceControls` | Ref to the retained four passing resource-control results. |
| `localLfs` | Ref to fresh existing-schema local LFS JSON: PASS, networkUsed=false, verifiedObjects equals the object list length. Objects must cover all 16 source/export files and **every** retained PNG; per-object hashes, sizes and PASS are checked in both the worktree and the absolute `localObject` file. Additional objects allowed. |
| `attempts` | Nonempty list of Refs to JSONL command histories. Include original `attempts.jsonl` and revision history; all entries and failure tails remain in C2. Each row uses the existing runner fields (`attempt`, `command`, `exitCode`, `stoppedBy`, `reaped`, `elapsedSeconds`, `peakGroupRssKiB`, `threadEnv`, optional `last20Lines`). `fullLog` may explicitly override the legacy `receipts/<attempt>/output.txt` location. |
| `images` | Current sheets: `{group,kind,sheet:Ref,readout:Ref}`. `kind` is `source`, `materials`, or optional `export`. Require source+materials for each of anchor/civic/kit/landmarks/low/mid/props/tall. Existing readout schema, source hash and `threads:2` required. |

For `stock[].reuseBaseline:true`, each evaluated file, report, process and log must match the baseline hash. This permits reuse of the unchanged12 and rejects applying their reports to revised bytes. Limit the reused batch's `receipt.inputs` to its unchanged12 files (and any unchanged checked scripts), even if its historical command checked 16. Fresh changed4 report references must not be identical to baseline receipts.

Images have no directory naming requirement. Six unchanged source/material families can be selected from their retained paths; select `revision-r1-source-anchor`, `revision-r1-materials-anchor`, corresponding props sheets, etc. for revised files. Every PNG under `assets/renders/cities/ixari` is included and checksummed; unselected sheets are classified as `HISTORICAL_STALE_SOURCE`, `HISTORICAL_SUPERSEDED`, or `HISTORICAL_UNVERIFIED`. Four prior shape sheets remain visible. Historical sheets do not grant current qualification. Retention caps remain 48 PNGs / 512 MiB, with no `scratch.png`.

The current authority is `assets/blend/cities/ixari/reports/CURRENT.json`. For PASS it names a completed `reports/<attempt>/` directory and hashes for `manifest.json`, `APPENDIX-C2.json`, `SHA256SUMS`. Verify all three hashes before use. In-progress/failed invocations revoke prior PASS, retain historical directories, and retain failure metadata. A concurrent lock loser writes its own rejection receipt and cannot replace the active owner's pointer. Partial staging directories are never current. Readers must reject a missing/malformed pointer, any status other than PASS, or mismatched output hashes. A read-only filesystem can prevent all updates; the script exits nonzero and must not be treated as success.

Freeze/copy command-history JSONL files before publication if a runner will append to them afterward. In particular, `run_cpu.py` appends to `attempts.jsonl` on return; referencing that mutable ledger directly would immediately invalidate its published checksum. The final invocation can use an immutable history snapshot. Keep input files quiescent during publication; the publisher lock serializes publishers, not unrelated source writers.

The publication regression fixtures do not qualify new source assets or production evidence. Their reuse of baseline receipt bytes is deliberate test setup. Local fixture trees are retained but ignored by Git to avoid staging nested Git repos, absolute LFS links and copies of baseline evidence. The adjacent logs, tails and result JSON remain reviewable.

R1 production additionally supplies optional `revisionEvidence: Ref`, containing
`STATUS: "PASS_CPU_SOURCE_REVISION"` and `evidenceRefs: Ref[]`. The publisher checks
each digest and embeds the decisions, changed hashes and native inventory in C2.
New process receipts also bind any supplied `evaluatedInputsBefore` and
`evaluatedInputsAfter` hashes. Historical PNG bytes must remain unchanged;
revision additions are capped at 12 PNGs / 128 MiB. Reaping is explicitly scoped
to the owned process group, with detached descendants outside that guarantee.
