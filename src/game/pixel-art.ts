export type Palette = Readonly<Record<string, string | null>>;

export interface PixelSpriteSource {
  readonly palette: Palette;
  readonly rows: readonly string[];
}

export interface RasterizedSprite {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

function parseColor(value: string): readonly [number, number, number, number] {
  if (!HEX_COLOR.test(value)) {
    throw new Error(`Invalid palette color: ${value}`);
  }

  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255,
  ];
}

export function rasterizeSprite(source: PixelSpriteSource): RasterizedSprite {
  const firstRow = source.rows[0];
  if (firstRow === undefined || firstRow.length === 0) {
    throw new Error("A pixel sprite must contain at least one pixel");
  }

  const width = firstRow.length;
  const height = source.rows.length;
  const rgba = new Uint8ClampedArray(width * height * 4);

  source.rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`Pixel sprite row ${y} has width ${row.length}; expected ${width}`);
    }

    Array.from(row).forEach((token, x) => {
      if (!(token in source.palette)) {
        throw new Error(`Unknown palette token '${token}' at ${x},${y}`);
      }

      const color = source.palette[token];
      if (color === null) {
        return;
      }
      if (color === undefined) {
        throw new Error(`Unknown palette token '${token}' at ${x},${y}`);
      }

      const [red, green, blue, alpha] = parseColor(color);
      const index = (y * width + x) * 4;
      rgba[index] = red;
      rgba[index + 1] = green;
      rgba[index + 2] = blue;
      rgba[index + 3] = alpha;
    });
  });

  return { width, height, rgba };
}

export function quantizedWave(
  elapsedMs: number,
  periodMs: number,
  amplitude: number,
  phase = 0,
): number {
  if (periodMs <= 0) {
    throw new Error("Animation period must be greater than zero");
  }
  return Math.round(Math.sin((elapsedMs / periodMs) * Math.PI * 2 + phase) * amplitude);
}
