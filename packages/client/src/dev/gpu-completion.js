const now = () => new Date().toISOString();
const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 5));

// An observed signal is required. Flush/finish return and query availability are not substituted for it.
export async function gpuCompletion(gl, label, out) {
  const start = performance.now();
  const rec = { label, startedAt: now(), finishedAt: null, elapsedMs: null, status: 'pending', polls: [], deletedAt: null, failure: null };
  out.push(rec);
  let sync = null;
  try {
    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      rec.status = 'unavailable';
      throw new Error('GPU completion sync allocation failed');
    }
    gl.flush();
    for (let poll = 0; poll < 100; poll++) {
      if (gl.isContextLost()) {
        rec.status = 'context-lost';
        throw new Error('Context lost while observing GPU completion');
      }
      const value = gl.clientWaitSync(sync, 0, 0);
      const status = value === gl.ALREADY_SIGNALED ? 'already-signaled' : value === gl.CONDITION_SATISFIED ? 'condition-satisfied'
        : value === gl.TIMEOUT_EXPIRED ? 'timeout-expired' : value === gl.WAIT_FAILED ? 'wait-failed' : 'unexpected';
      rec.polls.push({ at: now(), elapsedMs: performance.now() - start, value, status, yieldedBeforePoll: poll > 0 });
      if (status === 'already-signaled' || status === 'condition-satisfied') {
        rec.status = 'signaled';
        return rec;
      }
      if (status !== 'timeout-expired') {
        rec.status = status;
        throw new Error(`GPU completion failed: ${status}`);
      }
      // WebGL exposes a new sync's signaled state only after yielding to the browser event loop.
      await yieldTask();
    }
    rec.status = 'timeout';
    throw new Error('GPU completion did not signal within 100 bounded polls');
  } catch (error) {
    rec.failure = String(error);
    if (rec.status === 'pending') rec.status = 'failed';
    throw error;
  } finally {
    if (sync) {
      gl.deleteSync(sync);
      rec.deletedAt = now();
    }
    rec.finishedAt = now();
    rec.elapsedMs = performance.now() - start;
  }
}
