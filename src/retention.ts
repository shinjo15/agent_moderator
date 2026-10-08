// Technical retention limits, not moderation policy or persistent hidden-author limits.
export const TRANSIENT_TTL_MILLIS = 60_000;
export const MAX_TRANSIENT_ENTRIES = 10_000;
export const MAX_PENDING_EVALUATIONS = 200;
export const MAX_VISIBLE_MESSAGES = 200;
export const MAX_PENDING_OPERATIONS = 200;

export function createTransientMap<T>({ now = Date.now, limit = MAX_TRANSIENT_ENTRIES,
  onDelete = () => {} }: { now?: () => number; limit?: number; onDelete?: (id: string, value: T) => void } = {}) {
  const entries = new Map<string, { value: T; expires: number }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let clock = -Infinity;
  const time = () => clock = Math.max(clock, now());
  function schedule() {
    clearTimeout(timer); timer = undefined;
    const first = entries.values().next().value;
    if (!first) return;
    timer = setTimeout(sweep, Math.max(1, first.expires - time() + 1));
    // Node tests must not stay alive solely for browser retention timers.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }
  function remove(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id); onDelete(id, entry.value);
  }
  function sweep() {
    const current = time();
    for (const [id, entry] of entries) {
      if (entry.expires >= current) break;
      remove(id);
    }
    schedule();
  }
  return {
    sweep,
    get size() { sweep(); return entries.size; },
    get(id: string) { sweep(); return entries.get(id)?.value; },
    has(id: string) { sweep(); return entries.has(id); },
    set(id: string, value: T) {
      sweep();
      // No refresh on duplicate reads/writes: activity cannot retain old data forever.
      const old = entries.get(id);
      if (old) { old.value = value; return true; }
      if (entries.size >= limit) return false;
      entries.set(id, { value, expires: time() + TRANSIENT_TTL_MILLIS }); schedule(); return true;
    },
    delete(id: string) { remove(id); schedule(); },
    clear() { for (const id of entries.keys()) remove(id); clearTimeout(timer); timer = undefined; },
    values() { sweep(); return Array.from(entries.values(), entry => entry.value); },
  };
}

// FIFO admission + expiring queued work. Only the single active operation owns its payload.
export function createBoundedQueue({ now = Date.now, limit = MAX_PENDING_OPERATIONS }: { now?: () => number; limit?: number } = {}) {
  type Job = { key: string; started: boolean; work(): Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void };
  let busy = false;
  let sequence = 0;
  const waiting = createTransientMap<Job>({ now, limit, onDelete(_id, job) {
    if (!job.started) job.reject(new Error('Transient queue retention exceeded'));
  } });
  function drain() {
    if (busy) return;
    const job = waiting.values()[0];
    if (!job) return;
    job.started = true; waiting.delete(job.key); busy = true;
    void Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { busy = false; drain(); });
  }
  return <T>(work: () => Promise<T>): Promise<T> => {
    if (waiting.size + Number(busy) >= limit) return Promise.reject(new Error('Transient queue capacity exceeded'));
    return new Promise<unknown>((resolve, reject) => {
      const key = String(++sequence);
      if (!waiting.set(key, { key, started: false, work, resolve, reject })) { reject(new Error('Transient queue capacity exceeded')); return; }
      drain();
    }) as Promise<T>;
  };
}
