import { describe, expect, it } from "vitest";

import { projectDepth, type CameraFrame } from "./camera";
import { ROLL_ROWS } from "./horizon";
import { surfaceLevel } from "./landform-colour";
import {
  createLandformPixels,
  cutAway,
  NO_ROW,
  type LandformLight,
  type LandformPixels,
  type LandformView,
} from "./landform-frame";
import { CLOUD_FADE_ROWS, cloudPoint, cloudReach, landformFog, marchSchedule } from "./landform-march";
import { FAR_ROWS, isFarView, mergeLandforms, outlineLandforms, renderLandforms, viewsInSight } from "./landform-render";
import { landformField, planetLandforms, type Landform } from "./landforms";
import { toLocal } from "./planet";
import { rowAtFoot, TILE_DEPTH, TILE_WIDTH } from "./projection";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const WIDTH = 320;
const HEIGHT = 180;
const HORIZON_Y = FRAME.groundTop - FRAME.rollHeight;
const SEAM = (FRAME.footY - FRAME.groundTop) / TILE_DEPTH;

const LIGHT: LandformLight = {
  light: { x: -0.6, y: -0.8 },
  elevation: 0.7,
  turn: 0,
  haze: { r: 180, g: 200, b: 220 },
};

let serial = 0;

/** A landform of our own, at a local point - the pose is the origin facing north, so local is planet. */
function landform(kind: Landform["kind"], radius: number, height: number): Landform {
  serial += 1;
  return { id: `test-${kind}-${serial}`, kind, x: 0, y: 0, radius, height, seed: 1234 + serial };
}

function view(of: Landform, x: number, y: number): LandformView {
  return { field: landformField(of), centreX: x, centreY: y };
}

function render(views: readonly LandformView[], light: LandformLight = LIGHT, frame = FRAME): LandformPixels {
  const out = createLandformPixels(WIDTH, HEIGHT);
  renderLandforms(frame, views, light, out);
  return out;
}

function painted(pixels: LandformPixels): number[] {
  const at: number[] = [];
  pixels.rows.forEach((row, index) => {
    if (row !== NO_ROW) {
      at.push(index);
    }
  });
  return at;
}

const TOWER = landform("tower", 1.6, 150);

describe("renderLandforms", () => {
  it("stands a tower on the field: its foot on its ground row, its body risen above it", () => {
    const pixels = render([view(TOWER, 0, 3)]);
    const column = FRAME.footX;
    const rows: number[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      if ((pixels.rows[y * WIDTH + column] ?? NO_ROW) !== NO_ROW) {
        rows.push(y);
      }
    }
    // Its near wall stands on the ground a radius in front of its centre.
    const foot = FRAME.footY - (3 - TOWER.radius) * TILE_DEPTH;
    expect(Math.max(...rows)).toBeLessThanOrEqual(Math.ceil(foot));
    expect(Math.max(...rows)).toBeGreaterThan(foot - 3);
    // A hundred and fifty pixels tall: it runs off the top of the screen.
    expect(Math.min(...rows)).toBe(0);
    expect(painted(pixels).every((index) => pixels.rgba[index * 4 + 3] === 255)).toBe(true);
  });

  it("records the affine row of the surface each pixel shows, nearest face lowest", () => {
    const pixels = render([view(TOWER, 0, 3)]);
    const near = pixels.rows[(Math.round(FRAME.footY - 2 * TILE_DEPTH) - 2) * WIDTH + FRAME.footX] ?? NO_ROW;
    expect(near).toBe(Math.round(rowAtFoot(FRAME.footY - (3 - TOWER.radius) * TILE_DEPTH, FRAME.groundTop)));
  });

  it("hides a farther landform behind a nearer one", () => {
    const behind = landform("tower", 1.6, 300);
    const front = render([view(TOWER, 0, 3)]);
    const both = render([view(TOWER, 0, 3), view(behind, 0, 6)]);
    // Wherever the near tower showed, it still shows - nothing farther drew over it.
    for (const index of painted(front)) {
      expect(both.rows[index]).toBe(front.rows[index]);
    }
    // And the far, taller one shows over its top.
    expect(painted(both).length).toBeGreaterThan(painted(front).length);
  });

  it("sinks a landform past the horizon foot first and cuts it at the horizon line", () => {
    const mountain = landform("mountain", 10, 360);
    const distance = SEAM + ROLL_ROWS + 25;
    const pixels = render([view(mountain, 0, distance)]);
    const shown = painted(pixels);
    expect(shown.length).toBeGreaterThan(0);
    for (const index of shown) {
      expect(Math.floor(index / WIDTH)).toBeLessThan(HORIZON_Y);
    }
    // A short one the same distance out has sunk from sight.
    expect(painted(render([view(landform("mesa", 4, 40), 0, distance)]))).toHaveLength(0);
  });

  it("leaves a window round the hero through land standing nearer than him", () => {
    const behindHero = landform("tower", 1.6, 220);
    const cutaway = { x: FRAME.footX, y: FRAME.footY - 16, radiusX: 24, radiusY: 28, row: 5 };
    const plain = render([view(behindHero, 0, -3)]);
    const windowed = render([view(behindHero, 0, -3)], { ...LIGHT, cutaway });
    const at = (FRAME.footY - 16) * WIDTH + FRAME.footX;
    expect(plain.rows[at]).not.toBe(NO_ROW);
    expect(windowed.rows[at]).toBe(NO_ROW);
    expect(painted(windowed).length).toBeGreaterThan(0);
  });

  it("darkens what a cloud shadow covers", () => {
    const lit = render([view(TOWER, 0, 3)]);
    const shaded = render([view(TOWER, 0, 3)], { ...LIGHT, shade: () => 0.5 });
    const index = painted(lit)[50] ?? 0;
    expect(shaded.rgba[index * 4] ?? 0).toBeLessThan(lit.rgba[index * 4] ?? 0);
  });

  it("fades the cloud shadow out with distance, so land up the roll is never striped by it", () => {
    // Up the roll a whole tile of depth is a scanline or less, so a shadow read
    // off the screen there raced over the land at many times its own speed.
    const red = (pixels: LandformPixels, index: number): number => pixels.rgba[index * 4] ?? 0;
    const darkened = (at: number): number => {
      const tower = view(TOWER, 0, at);
      const lit = render([tower]);
      const shaded = render([tower], { ...LIGHT, shade: () => 0.5 });
      const shown = painted(lit);
      expect(shown.length).toBeGreaterThan(0);
      return shown.filter((index) => red(shaded, index) < red(lit, index)).length / shown.length;
    };
    expect(darkened(3)).toBeGreaterThan(0.9);
    // Its near wall well past the fade, though not yet past the horizon line.
    expect(darkened(SEAM + CLOUD_FADE_ROWS + 3 + TOWER.radius)).toBe(0);
  });

  it("is deterministic, and draws nothing with nothing in view", () => {
    expect(render([view(TOWER, 2, 3)]).rgba).toEqual(render([view(TOWER, 2, 3)]).rgba);
    expect(painted(render([]))).toHaveLength(0);
  });
});

describe("cloudPoint", () => {
  it("is the pixel itself on the flat field, where the ground beside a landform reads the same", () => {
    const depth = projectDepth(FRAME, 3.25);
    expect(cloudPoint(FRAME, 97, 3.25, depth.scale)).toEqual({ x: 97, y: Math.round(depth.ground) });
  });

  it("moves a whole tile's depth for a tile walked, however squeezed the roll draws it", () => {
    // The cloud tile slides TILE_DEPTH a tile walked (`trackScroll`); a surface
    // point must read it from a place that slides as far, or the shadow streams.
    for (const y of [3, SEAM + 2, SEAM + 20, SEAM + ROLL_ROWS + 10]) {
      const before = cloudPoint(FRAME, 150, y, projectDepth(FRAME, y).scale);
      const after = cloudPoint(FRAME, 150, y - 1, projectDepth(FRAME, y - 1).scale);
      expect(after.y - before.y).toBe(TILE_DEPTH);
    }
  });

  it("spreads a converged column back out to the width it has on the field", () => {
    const y = SEAM + 10;
    const { scale } = projectDepth(FRAME, y);
    expect(scale).toBeLessThan(1);
    expect(cloudPoint(FRAME, FRAME.footX + 10, y, scale).x).toBe(Math.round(FRAME.footX + 10 / scale));
  });
});

describe("cloudReach", () => {
  it("is whole on the field and gone before a view counts as far, which takes no cloud", () => {
    expect(cloudReach(0)).toBe(1);
    expect(cloudReach(CLOUD_FADE_ROWS / 2)).toBeCloseTo(0.5);
    expect(cloudReach(FAR_ROWS)).toBe(0);
    expect(cloudReach(FAR_ROWS + 30)).toBe(0);
    expect(CLOUD_FADE_ROWS).toBeLessThanOrEqual(FAR_ROWS);
  });
});

describe("marchSchedule", () => {
  it("runs near to far over the footprints only, a scanline or two of ground a step", () => {
    const steps = marchSchedule(FRAME, [view(TOWER, 0, 3), view(TOWER, 0, 20)]);
    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index];
      const before = steps[index - 1];
      expect(step?.y).toBeGreaterThan(before?.y ?? 0);
      const sameRun = (step?.y ?? 0) - (before?.y ?? 0) < 1;
      if (sameRun && (before?.scale ?? 0) === 1) {
        expect(Math.abs((step?.ground ?? 0) - (before?.ground ?? 0))).toBeLessThanOrEqual(2.01);
      }
    }
    const field = landformField(TOWER);
    const inside = (step: { y: number }, centre: number): boolean => Math.abs(step.y - centre) <= field.half + 1e-9;
    expect(steps.every((step) => inside(step, 3) || inside(step, 20))).toBe(true);
  });
});

describe("the far land", () => {
  it("is far once wholly past the field's edge, and hazier the farther it stands", () => {
    expect(isFarView(FRAME, view(TOWER, 0, 3))).toBe(false);
    expect(isFarView(FRAME, view(TOWER, 0, SEAM + 20))).toBe(true);
    expect(landformFog(0, 24)).toBe(0);
    expect(landformFog(30, 24)).toBeGreaterThan(landformFog(5, 24));
    expect(landformFog(ROLL_ROWS + 40, 24)).toBeGreaterThan(landformFog(ROLL_ROWS, 24));
    expect(landformFog(ROLL_ROWS + 400, 24)).toBeLessThan(1);
  });

  it("is found by viewsInSight only while some of it can show", () => {
    const views = viewsInSight(FRAME, { x: 128, y: 128, turn: 0 }, { width: WIDTH, height: HEIGHT });
    for (const seen of views) {
      expect(seen.centreY).toBeGreaterThan(-seen.field.half - 40);
    }
  });

  // Walking north past a landform carries it down the screen. Its foot leaves
  // the bottom long before its top does - a mesa's flat top reaches back to its
  // far edge, two radii up the screen - and the whole of it once vanished at
  // the moment the near edge fell too far below, top and all.
  it("keeps a landform in sight while any of it still shows, though its foot is off the bottom", () => {
    const kinds = new Set<Landform["kind"]>();
    const sample = planetLandforms().filter((each) => {
      const fresh = !kinds.has(each.kind) && (each.kind === "mesa" || each.kind === "mountain");
      kinds.add(each.kind);
      return fresh;
    });
    expect(sample.map((each) => each.kind).sort()).toEqual(["mesa", "mountain"]);
    for (const land of sample) {
      // Beside the hero, so he never stands inside it and it is not cut away round him.
      const x = land.x + land.radius + 2;
      for (let behind = 0; behind <= land.radius * 2 + 30; behind += 1) {
        const pose = { x, y: land.y + behind, turn: 0 };
        const local = toLocal(pose, land);
        const shown = painted(render([view(land, local.x, local.y)])).length;
        const found = viewsInSight(FRAME, pose, { width: WIDTH, height: HEIGHT }).some(
          (seen) => seen.field.landform.id === land.id,
        );
        expect({ id: land.id, behind, found: found || shown === 0 }).toEqual({ id: land.id, behind, found: true });
      }
    }
  });
});

describe("mergeLandforms", () => {
  it("is a depth test: the nearer row wins each pixel, whichever render it came from", () => {
    const near = createLandformPixels(4, 1);
    const far = createLandformPixels(4, 1);
    near.rows.set([5, NO_ROW, -3, 2]);
    near.rgba.fill(10);
    far.rows.set([1, 7, 0, 2]);
    far.rgba.fill(20);
    const out = createLandformPixels(4, 1);
    mergeLandforms(near, far, out);
    expect(Array.from(out.rows)).toEqual([5, 7, 0, 2]);
    expect([out.rgba[0], out.rgba[4], out.rgba[8], out.rgba[12]]).toEqual([10, 20, 20, 10]);
    expect(out.extent).toEqual({ top: 0, bottom: 1, farthest: 0 });
  });
});

describe("outlineLandforms", () => {
  it("lines a silhouette against the sky and against land well behind it, not its foot", () => {
    const pixels = createLandformPixels(3, 3);
    // A column of near land (row 5) beside far land (row 0), sky above.
    pixels.rows.set([NO_ROW, NO_ROW, NO_ROW, 5, 5, 0, 5, 5, 0]);
    pixels.rgba.fill(200);
    mergeLandforms(createLandformPixels(3, 3), pixels, pixels);
    outlineLandforms(pixels);
    const value = (x: number, y: number): number => pixels.rgba[(y * 3 + x) * 4] ?? 0;
    // Against the sky above, and against the far land to its right: lined.
    expect(value(0, 1)).toBeLessThan(200);
    expect(value(1, 2)).toBeLessThan(200);
    // Inside the near land, and the far land beside it: not.
    expect(value(0, 2)).toBe(200);
    expect(value(2, 2)).toBe(200);
  });
});

describe("surfaceLevel and cutAway", () => {
  it("lights a face turned to the light more than one turned away, and never to black", () => {
    const toward = surfaceLevel({ x: -0.6, y: 0.8, z: 0 }, LIGHT);
    const away = surfaceLevel({ x: 0.6, y: -0.8, z: 0 }, LIGHT);
    expect(toward).toBeGreaterThan(away);
    expect(away).toBeGreaterThan(0.05);
  });

  it("cuts only what stands nearer than the hero, inside the oval", () => {
    const cutaway = { x: 10, y: 10, radiusX: 5, radiusY: 5, row: 3 };
    expect(cutAway(cutaway, 10, 10, 4)).toBe(true);
    expect(cutAway(cutaway, 10, 10, 3)).toBe(false);
    expect(cutAway(cutaway, 20, 10, 4)).toBe(false);
  });
});

describe("the projection it shares", () => {
  it("puts a landform's column at the field's own x on the field", () => {
    const pixels = render([view(TOWER, 2, 3)]);
    const centreX = FRAME.footX + 2 * TILE_WIDTH;
    expect(pixels.rows[(FRAME.footY - 30) * WIDTH + centreX]).not.toBe(NO_ROW);
    expect(pixels.rows[(FRAME.footY - 30) * WIDTH + centreX - Math.ceil(TOWER.radius * TILE_WIDTH) - 2]).toBe(NO_ROW);
  });
});
