import { describe, expect, it } from "vitest";

import { Prefetcher } from "./prefetcher";

describe("Prefetcher", () => {
  it("queues a key's tasks once and runs at least one a frame, the rest within the budget", () => {
    const ran: string[] = [];
    const prefetcher = new Prefetcher<string>();
    const plan = (): (() => void)[] => ["a", "b", "c"].map((name) => () => ran.push(name));
    prefetcher.aim("next", plan);
    prefetcher.aim("next", plan);
    expect(prefetcher.pending()).toBe(3);
    let clock = 0;
    prefetcher.run(0, () => clock++);
    expect(ran).toEqual(["a"]);
    prefetcher.run(10, () => clock);
    expect(ran).toEqual(["a", "b", "c"]);
    expect(prefetcher.pending()).toBe(0);
  });

  it("drops what was queued for a guess that changed, and queues the new one", () => {
    const ran: string[] = [];
    const prefetcher = new Prefetcher<number>();
    prefetcher.aim(1, () => [() => ran.push("one"), () => ran.push("one again")]);
    prefetcher.run(0, () => 0);
    prefetcher.aim(2, () => [() => ran.push("two")]);
    prefetcher.run(100, () => 0);
    expect(ran).toEqual(["one", "two"]);
  });

  it("queues nothing while there is nothing to walk into", () => {
    const prefetcher = new Prefetcher<number>();
    prefetcher.aim(1, () => [() => undefined]);
    prefetcher.aim(undefined, () => [() => undefined]);
    expect(prefetcher.pending()).toBe(0);
    prefetcher.run(1);
  });
});
