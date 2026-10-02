/**
 * The scenery bake worker: a `BakeBench` on its own thread.
 *
 * Receives `{ ticket, job }`, answers `{ ticket, result }` with the pixel
 * buffers transferred rather than copied. Jobs run in arrival order, which is
 * the order `settleAt` needs a body's leans in; `scenery-baker.ts` routes every
 * job for one body to the same worker so that holds.
 */

import { BakeBench, transferables, type BakeJob } from "./scenery-bake-jobs";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<{ ticket: number; job: BakeJob }>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const bench = new BakeBench();

scope.addEventListener("message", (event) => {
  const { ticket, job } = event.data;
  const result = bench.run(job);
  scope.postMessage({ ticket, result }, transferables(result));
});
