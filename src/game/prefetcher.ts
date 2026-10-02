/**
 * Work for the anchor the hero is walking into, done in the frames before he
 * gets there.
 *
 * Every layer that reads the world through the anchor - the ground's plan, the
 * grass's tufts, the puddles, the lip's water - does its work when the anchor
 * moves, and they all move on the same frame: walking, that was one frame in
 * eleven costing nearly twice the rest (25 ms against 13 on the HD 530), which
 * is a stutter five times a second. The next anchor is known well before then
 * (`upcomingAnchor`), so each layer's share is queued as a task and the tasks
 * are run a few at a time, within a budget, on the quiet frames between.
 *
 * A guess that does not come true - he turned, or stopped - drops whatever was
 * queued for it; work already done is simply never used. Pure: it knows
 * nothing about what the tasks do.
 */

export class Prefetcher<Key> {
  private key: Key | undefined;
  private tasks: (() => void)[] = [];

  /**
   * Aim at a new upcoming key. A key already aimed at keeps its queue; another,
   * or none, drops it and - for a key - queues `plan()`'s tasks in its place.
   */
  aim(key: Key | undefined, plan: () => readonly (() => void)[]): void {
    if (key === this.key) {
      return;
    }
    this.key = key;
    this.tasks = key === undefined ? [] : [...plan()];
  }

  /** Run queued tasks until `budgetMs` is spent - at least one, so the queue always drains. */
  run(budgetMs: number, now: () => number = () => performance.now()): void {
    const start = now();
    for (let task = this.tasks.shift(); task !== undefined; task = this.tasks.shift()) {
      task();
      if (now() - start >= budgetMs) {
        return;
      }
    }
  }

  /** Tasks still waiting - for the tests and the debug readout. */
  pending(): number {
    return this.tasks.length;
  }
}
