import { describe, expect, it } from "vitest";

import { quantizeLight } from "./scenery-bake";
import type { BakeJob } from "./scenery-bake-jobs";
import { InlineBaker, routeIndex, WorkerBaker, workerCount } from "./scenery-baker";

const LIGHT = quantizeLight({ x: -0.6, y: -0.8 }, 0.7);
const OAK_LEAN: BakeJob = { kind: "lean", species: "oak-recursive", seed: 11, light: LIGHT, lean: 3 };
const OAK_FAR: BakeJob = { kind: "scale", species: "oak-recursive", seed: 11, light: LIGHT, scale: 0.3 };

/** A stand-in worker: records what it was sent and answers when told to. */
class FakeWorker {
  readonly sent: { ticket: number; job: BakeJob }[] = [];
  private listener: ((event: MessageEvent) => void) | undefined;

  addEventListener(_type: string, listener: (event: MessageEvent) => void): void {
    this.listener = listener;
  }

  postMessage(message: { ticket: number; job: BakeJob }): void {
    this.sent.push(message);
  }

  answer(ticket: number): void {
    this.listener?.({ data: { ticket, result: null } } as MessageEvent);
  }
}

describe("the inline baker", () => {
  it("runs nothing until collected, then at least one job however small the budget", () => {
    const baker = new InlineBaker();
    const first = baker.submit(OAK_LEAN);
    baker.submit(OAK_FAR);
    expect(baker.outstanding()).toBe(2);
    const done = baker.collect(0);
    expect(done.map((entry) => entry.ticket)).toEqual([first]);
    expect(done[0]?.result?.body.buffer.width).toBeGreaterThan(0);
    expect(baker.outstanding()).toBe(1);
  });

  it("drains its queue in submission order", () => {
    const baker = new InlineBaker();
    const tickets = [baker.submit(OAK_LEAN), baker.submit(OAK_FAR)];
    expect(baker.collect(1000).map((entry) => entry.ticket)).toEqual(tickets);
    expect(baker.outstanding()).toBe(0);
  });
});

describe("the worker baker", () => {
  it("sends every job for one body to the same worker, and hands back what came home", () => {
    const workers: FakeWorker[] = [];
    const baker = new WorkerBaker(3, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const a = baker.submit(OAK_LEAN, "oak-recursive:11");
    baker.submit(OAK_FAR, "oak-recursive:11");
    const holder = workers.find((worker) => worker.sent.length > 0);
    expect(holder?.sent.map((sent) => sent.ticket)).toHaveLength(2);
    expect(baker.outstanding()).toBe(2);
    expect(baker.collect()).toEqual([]);
    holder?.answer(a);
    expect(baker.collect()).toEqual([{ ticket: a, result: null }]);
    expect(baker.outstanding()).toBe(1);
  });
});

describe("routeIndex", () => {
  it("is stable for a route and stays within the pool", () => {
    for (const route of ["oak-recursive:11", "boulder:7", ""]) {
      const index = routeIndex(route, 4);
      expect(index).toBe(routeIndex(route, 4));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
    expect(routeIndex("anything", 0)).toBe(0);
  });

  it("spreads many bodies over every worker", () => {
    const used = new Set(Array.from({ length: 48 }, (_unused, seed) => routeIndex(`sdf-crown:${seed}`, 4)));
    expect(used.size).toBe(4);
  });
});

describe("workerCount", () => {
  it("leaves the frame a core, starts at least one and at most four", () => {
    expect(workerCount(8)).toBe(4);
    expect(workerCount(4)).toBe(3);
    expect(workerCount(1)).toBe(1);
    expect(workerCount(undefined)).toBe(1);
  });
});
