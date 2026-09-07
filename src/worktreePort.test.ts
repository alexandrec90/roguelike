import { sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SLOT_SPAN, portOffset, slotFor, worktreeName } from "./worktreePort";

/**
 * The dev port has to differ between parallel worktrees without anybody configuring
 * one, because two of the three ways a worktree is cut here run no project code at
 * the time (see `worktreePort.ts`). These are the properties that has to hold.
 */

/** A path built with this platform's separator, so the assertions run on both. */
const path = (...parts: string[]) => parts.join(sep);

describe("worktreeName", () => {
  it("names the worktree for both tiers", () => {
    expect(worktreeName(path("C:", "ws", "roguelike", ".claude", "worktrees", "lark"))).toBe("lark");
    expect(worktreeName(path("C:", "ws", ".worktrees", "roguelike--task-0906"))).toBe(
      "roguelike--task-0906",
    );
  });

  it("is empty for an ordinary checkout", () => {
    expect(worktreeName(path("C:", "ws", "roguelike"))).toBe("");
    expect(worktreeName(path("home", "alex", "code", "roguelike"))).toBe("");
  });

  it("is empty for the container directory itself", () => {
    // `.claude/worktrees` holds worktrees; it is not one, and treating it as one
    // would give the checkout a second offset the moment anyone ran Vite from there.
    expect(worktreeName(path("C:", "ws", "roguelike", ".claude", "worktrees"))).toBe("");
    expect(worktreeName(path("C:", "ws", ".worktrees"))).toBe("");
  });

  it("matches path segments rather than a substring", () => {
    // The reason this is not `dir.includes(".worktrees")`: a checkout whose name
    // merely contains the word is an ordinary checkout, and giving it a derived port
    // would move a static server nobody asked to move.
    expect(worktreeName(path("C:", "ws", "worktrees-talk", "demo"))).toBe("");
    expect(worktreeName(path("C:", "ws", "my.worktrees", "demo"))).toBe("");
    expect(worktreeName(path("C:", "ws", "roguelike", "claude", "worktrees", "lark"))).toBe("");
  });
});

describe("slotFor", () => {
  it("stays inside the span and never returns the static checkout's 0", () => {
    // 0 is reserved: it is what says "this is the checkout you already know", so a
    // worktree landing on it would silently take the main server's port.
    // The shapes real names take: a word, one character, empty, a Remote Control
    // worktree (`bridge-cse_` plus a session id), and something absurd.
    const sessionish = `bridge-cse_${"a1B2".repeat(6)}`;
    for (const name of ["lark", "a", "", sessionish, "x".repeat(200)]) {
      const slot = slotFor(name);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThan(SLOT_SPAN);
    }
  });

  it("is stable for the same name", () => {
    // The property a bookmarked `localhost:4103` depends on: restarting the server,
    // or the machine, must not move it.
    expect(slotFor("composed-imagining-harp")).toBe(slotFor("composed-imagining-harp"));
  });

  it("spreads the names actually in use", () => {
    // Not a claim about the hash in general -- a claim about this workload, which is
    // Claude Code's generated worktree names. A collision is survivable (strictPort
    // reports it) but should not be the common case.
    const names = [
      "composed-imagining-harp",
      "golden-kindling-whistle",
      "shimmying-seeking-lark",
      "modular-watching-starfish",
      "velvety-swimming-zephyr",
      "zesty-beaming-heron",
    ];
    expect(new Set(names.map((n) => slotFor(n))).size).toBeGreaterThanOrEqual(names.length - 1);
  });

  it("honours a narrower span", () => {
    for (const name of ["lark", "heron", "zephyr"]) {
      expect(slotFor(name, 4)).toBeLessThan(4);
      expect(slotFor(name, 4)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("portOffset", () => {
  it("leaves the static checkout on the conventional port", () => {
    // `localhost:4100` has to keep meaning what it always meant, or every habit and
    // bookmark on the machine breaks to fix a problem the main checkout does not have.
    expect(portOffset(path("C:", "ws", "roguelike"))).toBe(0);
  });

  it("moves a worktree off it", () => {
    expect(portOffset(path("C:", "ws", "roguelike", ".claude", "worktrees", "lark"))).toBeGreaterThan(
      0,
    );
  });

  it("gives two worktrees of the same checkout different offsets", () => {
    // The whole point. These two names are real ones this repo has carried.
    const under = (name: string) =>
      portOffset(path("C:", "ws", "roguelike", ".claude", "worktrees", name));
    expect(under("glowing-sparking-swing")).not.toBe(under("velvet-sauteeing-bear"));
  });

  it("gives the same worktree name the same offset under either tier", () => {
    // The tiers are cut by different tools; a name is a name, and an offset that
    // depended on which tool cut it would move when a session was resumed elsewhere.
    expect(portOffset(path("C:", "ws", "roguelike", ".claude", "worktrees", "lark"))).toBe(
      portOffset(path("C:", "ws", ".worktrees", "lark")),
    );
  });
});
