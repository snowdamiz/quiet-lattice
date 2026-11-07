# Swift task-local termination and publication

This correction is light tooling only. Density remains REVISE and the heavy hold
is unchanged. Canonical source/export and previous evidence are not rewritten.

The supervisor owns `Popen(command, start_new_session=True)` before the producer
can run. It uses `waitid(..., WNOWAIT)` on that actual direct child, retaining its
PID until cleanup signals are finished. Process-table rows never select a signal
target. Cleanup attempts TERM and KILL on the owned group even when enumeration
fails; each signal, wait error, raw primary observation failure and secondary
`/bin/ps` result is retained separately. Reaping the leader alone does not prove
the group empty. If both observers fail, `remaining` stays null, cleanup remains
unproven, the stage fails and ownership stays charged. A successful secondary
empty-group observation can prove drain but cannot turn an observation-failed job
into successful work. No signals are sent after the direct child is reaped.

A child already known to have exited needs no signal only if a bounded real
snapshot positively shows that no other group member remains. This avoids a
macOS EPERM on a zombie-only group without waiving any actual signal denial or
observer error. A new observation is not started at the end of a grace window
when its minimum budget no longer fits; cleanup proceeds to escalation.

`durable-stage-v2` is a transaction over evidence, separate from process liveness:

1. Before dispatch, create and sync a regular `.publication-open` file. It is a
   persistent refusal marker and survives a Git/file-only handoff of failed
   evidence. Partial writes are kept under exclusive `.writing` names.
2. Each JSON document is written privately, flushed, fsynced and closed before
   its final name is published with exclusive `link`. Directory sync follows.
   A failure at any step leaves the refusal marker in place; a readable JSON
   document is still provisional. Final names never overwrite prior attempts.
3. The runner actually waits for the supervisor. A successful receipt binds its
   observed zero exit, the supervisor's real producer wait/reap result, source
   inputs, normal cleanup and durable dispatch ownership. A publication manifest
   hashes every required receipt. All manifest/file/directory syncs, status
   output and ownership release must succeed before publication can commit.
4. The last commit operation unlinks `.publication-open`. No required I/O follows
   it. An interruption before that operation leaves refusal evidence. A crash
   that rolls back this unlink can only restore refusal; the input documents
   were already synced. The commit describes completed producer work and a
   completed evidence transaction, not a prediction based on PID disappearance.
5. `promote.py` requires protocol v2, absence of the refusal marker, exact
   publication bindings, real successful producer/supervisor outcomes, empty
   group/reaped-child proof, source identities and matching stock/identity GLB
   pins. It does not create a destination copy until these gates pass.

Historical receipts, including the earlier experimental v1 protocol, remain
unchanged evidence. They are not retroactively sealed or eligible for new
promotion. In particular, loss of an old empty-directory marker during checkout
cannot make an experimental failed attempt eligible under v2. Future asset
promotion needs fresh successfully published stages after the parent releases
the relevant writer lane. The original canonical asset bytes are preserved.

Evidence under `88-observation-publication/` records exact f4fd0ea RED cases, all
bounded implementation attempts, final real producer/consumer tests, original
failure tails, and independent protection/process-empty checks. These results do
not qualify density, native behavior, scene performance or a visual grade.
