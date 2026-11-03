TASK: P1.E05.T02 single CPU integration admission
STATUS: FAILED before activation or integration execution. The grant is spent and no retry occurred.
SUMMARY: Root authorized one existing 132-frame integration attempt under root-20261103-t02-primary-release-accounting-01. The private receipt-and-exec launcher failed its source-binding preflight with KeyError('bytes'): some historical readiness bindings contain path and SHA but no byte count. The launcher had not reached the exclusive consumed claim, readiness activation, helper import, outer receipt or exec. The failure, exact launcher and startup stdout/stderr are preserved. Failure bookkeeping then exclusively marked the grant PREFLIGHT_FAILED_NO_RETRY.
FILES CHANGED: Only this new metadata evidence namespace. Reviewed integration/helper sources, candidate index, freeze, readiness, authored assets, prior failed packet and source PNGs remain unchanged.
VERIFY:
- Launcher exited 1 during preflight. No integration process, StationJob, FFmpeg, ffprobe, browser, encoder or decoder launched. Only the launcher and its read-only Git preflight commands ran.
- Current readiness SHA remains 2da704aba2b983718056e576492ca32be612db1d149a30cc35ec68b2f217ce69 with both execution flags false. No restoration was needed.
- Declared packet and proof roots remain absent. No owned-job/private TMP/scratch allocation occurred. No native terminal release proof is asserted. The failed launcher's exact birth was not recorded before its preflight error, so it remains explicitly UNKNOWN; the execution tool reported its process completed with exit 1.
- Source HEAD at refusal was 906721560c059fc12962e7b44cbe067303136a47. The source PASS remains the exact narrow review bc251a5ac411f85517a01c3f34c05828204f9c89086c44002d23cc167fbd39d4. This failure does not establish an integration result.
- All operator files were copied as bounded metadata only, verified byte-for-byte against their retained private originals. No PNG, observation payload, video or archive copy was made.
Failure stderr:
Traceback (most recent call last):
  File "/private/tmp/t02-primary-integration-release-accounting-72a9b614-operator-admission/launcher.py", line 36, in <module>
    require(Path(binding['path']).stat().st_size==binding['bytes'] and sha(binding['path'])==binding['sha256'],'Binding changed: '+binding['path'])
                                                  ~~~~~~~^^^^^^^^^
KeyError: 'bytes'

DECISIONS: Stop at the first launcher failure and spend the concrete authorization. Preserve the original error. Do not fix and relaunch under the consumed grant. No source or index/freeze regeneration is needed for the operator bug.
OUT OF SCOPE FOUND: A future launcher must hash every binding and check byte counts only when that field exists. That correction and any new launch require a fresh explicit root grant. Record the outer launcher identity earlier if exact preflight-failure birth evidence is needed. Native verification of 132ACKs/maps/observations/RGB/RGBA/timestamps/finalization/inspector remains unrun. The original owned-job count remains 1; this operator failure allocated 0 additional owned slots.
ARTIFACTS: grant.json; root-preflight.json; readiness.disabled.json; readiness.authorized.json; candidate-index.json; REVIEW_FREEZE.json; independent-PASS.md; exact launcher.py; operator.stdout/stderr; consumed.json; terminal-audit.json; manifest.json. All original operator files remain under /private/tmp/t02-primary-integration-release-accounting-72a9b614-operator-admission.
