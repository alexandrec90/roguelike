import { describe, expect, it } from "vitest";

import { DisplayList, GameObject } from "../engine";
import type { Stage } from "../engine/display";
import { DisplayGroup } from "./display-group";

class Thing extends GameObject {
  render(): void {}
}

function setup(): { list: DisplayList; make: () => Thing } {
  const list = new DisplayList();
  const stage = { list, textures: undefined, batcher: undefined } as unknown as Stage;
  return { list, make: () => new Thing(stage) };
}

describe("DisplayGroup", () => {
  it("counts only what is made inside track", () => {
    const { list, make } = setup();
    const group = new DisplayGroup(list);
    make();
    const made = group.track(() => [make(), make()]);
    make();
    expect(made).toHaveLength(2);
    expect(group.size).toBe(2);
  });

  it("hides its members and brings each back as it was", () => {
    const { list, make } = setup();
    const group = new DisplayGroup(list);
    const outsider = make();
    const [shown, already] = group.track(() => [make(), make().setVisible(false)]);
    group.hide();
    expect(group.hidden).toBe(true);
    expect(shown!.visible).toBe(false);
    expect(already!.visible).toBe(false);
    expect(outsider.visible).toBe(true);
    group.show();
    expect(shown!.visible).toBe(true);
    expect(already!.visible).toBe(false);
  });

  it("puts away something made while it is hidden, and brings it back with the rest", () => {
    const { list, make } = setup();
    const group = new DisplayGroup(list);
    group.hide();
    const late = group.track(() => make());
    expect(late.visible).toBe(false);
    group.show();
    expect(late.visible).toBe(true);
  });

  it("forgets what was destroyed", () => {
    const { list, make } = setup();
    const group = new DisplayGroup(list);
    const gone = group.track(() => make());
    gone.destroy();
    group.hide();
    group.show();
    expect(group.size).toBe(0);
  });

  it("is idempotent: hiding twice does not lose what was showing", () => {
    const { list, make } = setup();
    const group = new DisplayGroup(list);
    const thing = group.track(() => make());
    group.hide();
    group.hide();
    group.show();
    expect(thing.visible).toBe(true);
  });
});
