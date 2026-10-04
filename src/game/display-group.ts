/**
 * A set of layers that can be put away and brought back as one.
 *
 * Going into a cave puts the overworld away: the trees, the grass, the water,
 * the weather, the slimes. Each of those layers makes its own display objects -
 * some at `create`, some later, a slot or a slice at a time - and sets their
 * visibility itself every frame. Rather than teach each one to hide, the scene
 * runs their work through `track`, which notes every object made while it
 * runs, and stops running it while the group is hidden. A layer that is not
 * updated does not touch its objects, so `hide` can set them all invisible and
 * `show` can put back exactly what each one was; the layer's next update then
 * carries on from there.
 */

import type { DisplayList, GameObject } from "../engine";

export class DisplayGroup {
  private readonly members = new Set<GameObject>();
  /** What each object's visibility was when the group was hidden. */
  private stashed: Map<GameObject, boolean> | undefined;

  constructor(private readonly list: DisplayList) {}

  /** Run `work`, and count every display object it makes as this group's. */
  track<T>(work: () => T): T {
    const from = this.list.issued;
    const result = work();
    if (this.list.issued !== from) {
      for (const object of this.list.list) {
        if (object.serial >= from) {
          this.adopt(object);
        }
      }
    }
    return result;
  }

  /** A new member; one made while the group is put away (a resize rebuilding a surface) is put away with it. */
  private adopt(object: GameObject): void {
    this.members.add(object);
    if (this.stashed !== undefined && !this.stashed.has(object)) {
      this.stashed.set(object, object.visible);
      object.setVisible(false);
    }
  }

  get hidden(): boolean {
    return this.stashed !== undefined;
  }

  /** Put every member away, remembering whether each was showing. */
  hide(): void {
    if (this.stashed !== undefined) {
      return;
    }
    const present = new Set(this.list.list);
    const stashed = new Map<GameObject, boolean>();
    for (const object of this.members) {
      if (!present.has(object)) {
        this.members.delete(object);
        continue;
      }
      stashed.set(object, object.visible);
      object.setVisible(false);
    }
    this.stashed = stashed;
  }

  /** Bring every member back as it was when hidden. */
  show(): void {
    if (this.stashed === undefined) {
      return;
    }
    for (const [object, visible] of this.stashed) {
      object.setVisible(visible);
    }
    this.stashed = undefined;
  }

  /** How many objects the group holds - for a test, or a curious console. */
  get size(): number {
    return this.members.size;
  }
}
