/**
 * A minimal in-process async mutex: serializes `run()` callbacks so the next one only
 * starts after the previous settles. Used to serialize ALL connector/notifier writes
 * (read-modify-write of the single `app_settings.connectors` JSON blob + the live
 * `reconfigure()`), so concurrent edits never clobber each other and the live notifier
 * always reflects the committed state.
 *
 * In-process is the right level for this single-Node app. A multi-process deployment
 * would need DB-level locking (row lock / optimistic concurrency) instead — out of scope.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    // Chain onto the tail regardless of whether the prior task resolved or rejected, so
    // one failed critical section never deadlocks the queue.
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
