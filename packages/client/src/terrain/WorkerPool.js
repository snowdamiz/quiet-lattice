// Small priority job queue over a set of chunk workers.
export class WorkerPool {
  constructor(count) {
    this.workers = [];
    this.queue = [];
    this.jobs = new Map();
    this.nextId = 1;
    this.planets = new Map();
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
      w.inFlight = 0;
      w.onmessage = (e) => this.onResult(w, e.data);
      w.onerror = (e) => console.error('chunk worker error', e.message || e);
      this.workers.push(w);
    }
    this.maxInFlight = 2;
  }

  registerPlanet(id, params) {
    this.planets.set(id, params);
    for (const w of this.workers) w.postMessage({ type: 'planet', id, params });
  }

  forgetPlanet(id) {
    this.planets.delete(id);
    for (const w of this.workers) w.postMessage({ type: 'forget', id });
    this.queue = this.queue.filter((j) => {
      if (j.msg.planetId !== id) return true;
      this.jobs.delete(j.id);
      return false;
    });
  }

  request(msg, priority, callback) {
    const job = { id: this.nextId++, msg, priority, callback, cancelled: false };
    msg.jobId = job.id;
    msg.type = msg.type || 'chunk';
    this.jobs.set(job.id, job);
    this.queue.push(job);
    return job;
  }

  cancel(job) {
    if (!job) return;
    job.cancelled = true;
  }

  pending() {
    return this.queue.length + this.workers.reduce((a, w) => a + w.inFlight, 0);
  }

  update() {
    if (!this.queue.length) return;
    // drop cancelled and dispatch by priority (lower first)
    this.queue = this.queue.filter((j) => {
      if (j.cancelled) {
        this.jobs.delete(j.id);
        return false;
      }
      return true;
    });
    this.queue.sort((a, b) => a.priority - b.priority);
    for (const w of this.workers) {
      while (w.inFlight < this.maxInFlight && this.queue.length) {
        const job = this.queue.shift();
        w.inFlight++;
        w.postMessage(job.msg);
      }
    }
  }

  onResult(worker, data) {
    worker.inFlight--;
    const job = this.jobs.get(data.jobId);
    this.jobs.delete(data.jobId);
    if (!job || job.cancelled || data.error) return;
    job.callback(data);
  }
}
