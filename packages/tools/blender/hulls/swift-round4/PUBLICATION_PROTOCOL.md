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
4. The single-threaded runner blocks SIGINT and SIGTERM across its final decision,
   gate removal and `committed` assignment. Its pending-signal snapshot is the
   cancellation cutoff: a previously delivered or already pending request refuses
   publication. After that snapshot, new signals are deferred until the transition
   finishes; they cannot change `reason` between the decision and unlink. This is
   admission to a short commit transaction, not a promise to cancel until the
   physical unlink. There is no producer work or evidence serialization inside
   an admitted transition.

   The last commit operation unlinks `.publication-open`. No required I/O follows
   it. An interruption before that operation leaves refusal evidence. A crash
   that rolls back this unlink can only restore refusal; the input documents
   were already synced. The commit describes completed producer work and a
   completed evidence transaction, not a prediction based on PID disappearance.
   Once the outcome is recorded in memory, the runner restores its prior signal
   mask. Deferred requests after a successful commit are late notifications, not
   cancellations of provisional work. If unlink fails, they are cancellations of
   a refused attempt. `SWIFT_SIGNAL` diagnostics retain the signal number,
   observation (pending or delivered), phase and committed flag. Logging is
   diagnostic, not a new post-commit durability prerequisite. Standard signals
   can coalesce while blocked; the log does not claim a count of every signal sent.
   Refused runs also save `cancellation.json` when finalization reaches that step;
   failed writes/unlink retain raw traceback/diagnostics and the refusal file.
   Earlier provisional receipts remain unchanged. A SIGKILL before unlink refuses;
   a kill after the commit cannot revoke already published evidence.
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

`89-cancellation-commit/` adds the exact 2bd0ae57 race reproduction and real
SIGINT/SIGTERM probes before the critical section, pending at its decision,
inside it, after unlink and after mask restoration. The exact held-unlink probe
now defers delivery and reports a late request after success; it does not claim
to reject that request. Probes before admission refuse and preserve cancellation
facts. Real promotion checks both provisional and completed states, along with
retained I/O-failure, producer-exit-23, observation-failure and ownership controls.
