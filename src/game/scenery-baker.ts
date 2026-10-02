/**
 * Where scenery bakes run: on worker threads, or inline where there are none.
 *
 * A bake is milliseconds (a chestnut lean is ~11 ms in the browser), and the
 * game used to run them on the frame, inside a budget, a few a frame — so the
 * frame paid for them and the world filled in one body at a time. Workers move
 * that cost off the frame entirely: the main thread only submits jobs and
 * later collects finished buffers to upload.
 *
 * `InlineBaker` is the same interface run on the calling thread. It is the
 * fallback where `Worker` does not exist (the tests, under Node) and runs its
 * queue inside `collect`'s budget, which is how the game behaved before.
 */

import { BakeBench, type BakeJob, type BakeResult } from "./scenery-bake-jobs";

/** A finished job, matched to the ticket `submit` returned for it. */
export interface BakeDone {
  readonly ticket: number;
  readonly result: BakeResult | null;
}

export interface Baker {
  /**
   * Queue a job. `route` names the body: every job with the same route runs
   * on the same bench, in submission order.
   */
  submit(job: BakeJob, route: string): number;
  /** Whatever has finished since the last call; an inline baker runs jobs here, within `budgetMs`. */
  collect(budgetMs: number): BakeDone[];
  /** Jobs submitted and not yet collected. */
  outstanding(): number;
}

/** Runs jobs on the calling thread, at least one per `collect` so a queue always drains. */
export class InlineBaker implements Baker {
  private readonly bench = new BakeBench();
  private readonly queue: { ticket: number; job: BakeJob }[] = [];
  private ticket = 0;

  submit(job: BakeJob): number {
    this.ticket += 1;
    this.queue.push({ ticket: this.ticket, job });
    return this.ticket;
  }

  collect(budgetMs: number): BakeDone[] {
    const done: BakeDone[] = [];
    const start = performance.now();
    for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
      done.push({ ticket: next.ticket, result: this.bench.run(next.job) });
      if (performance.now() - start >= budgetMs) {
        break;
      }
    }
    return done;
  }

  outstanding(): number {
    return this.queue.length;
  }
}

/** Runs jobs on a pool of workers; `collect` only hands back what they finished. */
export class WorkerBaker implements Baker {
  private readonly workers: Worker[];
  private readonly finished: BakeDone[] = [];
  private ticket = 0;
  private inFlight = 0;

  constructor(count: number, spawn: () => Worker) {
    this.workers = Array.from({ length: Math.max(1, count) }, () => {
      const worker = spawn();
      worker.addEventListener("message", (event: MessageEvent<BakeDone>) => {
        this.inFlight -= 1;
        this.finished.push(event.data);
      });
      return worker;
    });
  }

  submit(job: BakeJob, route: string): number {
    this.ticket += 1;
    this.inFlight += 1;
    const worker = this.workers[routeIndex(route, this.workers.length)];
    worker?.postMessage({ ticket: this.ticket, job });
    return this.ticket;
  }

  collect(): BakeDone[] {
    return this.finished.splice(0, this.finished.length);
  }

  outstanding(): number {
    return this.inFlight + this.finished.length;
  }
}

/** Which of `count` benches a route always lands on. */
export function routeIndex(route: string, count: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < route.length; index += 1) {
    hash = Math.imul(hash ^ route.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % Math.max(1, count);
}

/** Bake workers to start: one fewer than the cores, so the frame keeps one, and at most four. */
export function workerCount(cores: number | undefined): number {
  return Math.min(4, Math.max(1, (cores ?? 2) - 1));
}

/** Workers when the platform has them, inline otherwise. */
export function createBaker(): Baker {
  if (typeof Worker === "undefined") {
    return new InlineBaker();
  }
  return new WorkerBaker(
    workerCount(globalThis.navigator?.hardwareConcurrency),
    () => new Worker(new URL("./scenery-bake-worker.ts", import.meta.url), { type: "module" }),
  );
}
