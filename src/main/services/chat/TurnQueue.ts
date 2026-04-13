export class TurnQueue {
  private chains = new Map<string, Promise<void>>();
  private active = new Set<string>();

  enqueue<T>(mindId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(mindId) ?? Promise.resolve();

    const { promise, resolve, reject } = Promise.withResolvers<T>();

    const next = previous.then(async () => {
      this.active.add(mindId);
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        this.active.delete(mindId);
      }
    });

    // Chain always resolves so subsequent enqueues aren't blocked by errors
    this.chains.set(mindId, next.then(() => {}, () => {}));

    return promise;
  }

  isBusy(mindId: string): boolean {
    return this.active.has(mindId);
  }
}
