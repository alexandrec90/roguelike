import { describe, expect, it } from "vitest";

import type { CameraFrame } from "./camera";
import type { LandformView } from "./landform-frame";
import {
  columnBounds,
  FieldAtlas,
  highestReach,
  KIND_CODE,
  MAX_VIEWS,
  packField,
  scheduleTexels,
  SCHEDULE_WIDTH,
  viewUniforms,
} from "./landform-gpu-data";
import { marchSchedule } from "./landform-march";
import { landformField, type Landform } from "./landforms";

const FRAME: CameraFrame = { groundTop: 40, rollHeight: 24, footX: 160, footY: 113, phaseX: 0, phaseY: 0 };
const WIDTH = 320;

let serial = 0;

function landform(kind: Landform["kind"], radius: number, height: number): Landform {
  serial += 1;
  return { id: `gpu-test-${kind}-${serial}`, kind, x: 0, y: 0, radius, height, seed: 0xabcdef - serial };
}

function view(of: Landform, x: number, y: number): LandformView {
  return { field: landformField(of), centreX: x, centreY: y };
}

const MOUNTAIN = landform("mountain", 10, 300);
const TOWER = landform("tower", 1.6, 160);
const MESA = landform("mesa", 5, 90);

/** A scene with near, far and sunk land in it: a mountain behind the hero, a tower and a mesa ahead. */
const SCENE: readonly LandformView[] = [view(MOUNTAIN, -12, -14), view(TOWER, 3, 4), view(MESA, -20, 40)];

describe("packField", () => {
  it("lays the grid out as height, normal and material-with-detail, with the block maxima beside it", () => {
    const field = landformField(MESA);
    const packed = packField(field);
    expect(packed.width).toBe(field.size + field.blocks);
    expect(packed.height).toBe(field.size);
    for (const [i, j] of [
      [0, 0],
      [field.size >> 1, field.size >> 1],
      [field.size - 1, 3],
    ] as const) {
      const from = j * field.size + i;
      const at = (j * packed.width + i) * 4;
      expect(packed.data[at]).toBeCloseTo(field.heights[from] ?? 0, 5);
      expect(packed.data[at + 1]).toBeCloseTo(field.normalX[from] ?? 0, 5);
      expect(packed.data[at + 2]).toBeCloseTo(field.normalY[from] ?? 0, 5);
      const folded = packed.data[at + 3] ?? 0;
      const material = Math.floor(folded / 4);
      expect(material).toBe(field.materials[from]);
      expect(folded - material * 4 - 2).toBeCloseTo(field.detail[from] ?? 0, 5);
    }
    expect(packed.data[(2 * packed.width + field.size + 1) * 4]).toBeCloseTo(field.blockMax[2 * field.blocks + 1] ?? 0, 5);
  });
});

describe("FieldAtlas", () => {
  it("places a field once, where nothing else is, and says when it is new", () => {
    const atlas = new FieldAtlas(256, 256);
    const a = atlas.place(landformField(TOWER));
    const b = atlas.place(landformField(MESA));
    expect(a.fresh).toBe(true);
    expect(atlas.place(landformField(TOWER))).toEqual({ slot: a.slot, fresh: false });
    const towerWidth = landformField(TOWER).size + landformField(TOWER).blocks;
    expect(b.slot.x >= a.slot.x + towerWidth || b.slot.y > a.slot.y).toBe(true);
  });

  it("refuses rather than overlap when it is full", () => {
    const atlas = new FieldAtlas(64, 64);
    expect(() => atlas.place(landformField(MOUNTAIN))).toThrow(/full/);
  });
});

describe("viewUniforms", () => {
  it("hands the shader each view's numbers, and the seed's angle worked out in float64", () => {
    const uniforms = viewUniforms(SCENE, [{ x: 10, y: 20 }], [false, false, true]);
    expect(Array.from(uniforms.a.slice(0, 4))).toEqual([-12, -14, landformField(MOUNTAIN).half, landformField(MOUNTAIN).res]);
    expect(Array.from(uniforms.b.slice(0, 2))).toEqual([10, 20]);
    expect(uniforms.c[4]).toBe(KIND_CODE.tower);
    expect(uniforms.d[10]).toBe(1);
    expect(uniforms.e[0]).toBeCloseTo(MOUNTAIN.seed % (Math.PI * 2), 5);
    expect(uniforms.e[1]).toBe(MOUNTAIN.seed % 7);
    expect(uniforms.a).toHaveLength(MAX_VIEWS * 4);
  });
});

describe("scheduleTexels and highestReach", () => {
  it("packs each step into two texels: depth and projection, then fog, row, views and reach", () => {
    const steps = marchSchedule(FRAME, SCENE);
    const highest = highestReach(steps, SCENE);
    const texels = scheduleTexels(steps, highest);
    expect(texels.length % (SCHEDULE_WIDTH * 4)).toBe(0);
    const step = steps[7];
    expect(step).toBeDefined();
    const at = 7 * 8;
    expect(texels[at]).toBeCloseTo(step?.y ?? 0, 4);
    expect(texels[at + 1]).toBeCloseTo(step?.ground ?? 0, 3);
    expect(texels[at + 5]).toBe(step?.row);
    expect(texels[at + 6]).toBe((step?.views ?? []).reduce((bits, v) => bits | (1 << v), 0));
    expect(texels[at + 7]).toBeCloseTo(highest[7] ?? 0, 3);
  });

  it("never lets a step's reach sit below anything it or a farther step could paint", () => {
    const steps = marchSchedule(FRAME, SCENE);
    const highest = highestReach(steps, SCENE);
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      for (const viewIndex of step?.views ?? []) {
        const top = (step?.ground ?? 0) - (SCENE[viewIndex]?.field.peak ?? 0) * (step?.scale ?? 1);
        expect(highest[index]).toBeLessThan(top);
      }
    }
  });
});

describe("columnBounds", () => {
  it("covers every step a landform overlaps a column at, and names every view that does", () => {
    const steps = marchSchedule(FRAME, SCENE);
    const bounds = columnBounds(FRAME, SCENE, steps, WIDTH);
    steps.forEach((step, index) => {
      for (const viewIndex of step.views) {
        const v = SCENE[viewIndex] as LandformView;
        const across = 16 * step.scale;
        const centre = FRAME.footX + (v.centreX - FRAME.phaseX) * across;
        const dy = step.y - v.centreY;
        const outer = v.field.landform.radius + 1;
        const chord = Math.sqrt(Math.max(0, outer * outer - dy * dy));
        const left = Math.max(0, Math.floor(centre - chord * across));
        const right = Math.min(WIDTH - 1, Math.ceil(centre + chord * across));
        for (let x = left; x <= right; x += 1) {
          expect(bounds[x * 4]).toBeLessThanOrEqual(index);
          expect(bounds[x * 4 + 1]).toBeGreaterThanOrEqual(index);
          expect(((bounds[x * 4 + 3] ?? 0) >> viewIndex) & 1).toBe(1);
        }
      }
    });
  });

  it("leaves a column nothing covers empty", () => {
    const steps = marchSchedule(FRAME, [view(TOWER, 3, 4)]);
    const bounds = columnBounds(FRAME, [view(TOWER, 3, 4)], steps, WIDTH);
    expect(bounds[1]).toBe(-1);
    expect(bounds[(WIDTH - 1) * 4 + 1]).toBe(-1);
  });
});
