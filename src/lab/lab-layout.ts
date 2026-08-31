/**
 * Layout arithmetic for the 320x180 lab canvas.
 *
 * Every number here is a logical pixel and every result is an integer. A
 * half-pixel offset in a pixel-art inspector is worse than useless: it makes
 * correct art look misaligned, which is exactly the judgement the lab exists to
 * support.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FilmstripOptions {
  readonly count: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly maxWidth: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * Left-to-right cells that wrap into rows once `maxWidth` is used up.
 *
 * A long clip is more useful wrapped than scrolled: every frame stays on screen
 * in one capture, which is the whole point of a contact sheet.
 */
export function filmstripCells(options: FilmstripOptions): Rect[] {
  const { count, cellWidth, cellHeight, gap, maxWidth, originX, originY } = options;
  if (count < 0) {
    throw new Error("Cell count cannot be negative");
  }
  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error("Cell size must be positive");
  }

  const stride = cellWidth + gap;
  const perRow = Math.max(1, Math.floor((maxWidth + gap) / stride));
  const cells: Rect[] = [];

  for (let index = 0; index < count; index += 1) {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    cells.push({
      x: Math.round(originX + column * stride),
      y: Math.round(originY + row * (cellHeight + gap)),
      width: cellWidth,
      height: cellHeight,
    });
  }

  return cells;
}

/** Centre `width x height` inside `box`, biasing the odd pixel left and up. */
export function centerRect(width: number, height: number, box: Rect): Rect {
  return {
    x: box.x + Math.floor((box.width - width) / 2),
    y: box.y + Math.floor((box.height - height) / 2),
    width,
    height,
  };
}

/** Split a canvas into two equal panes with a gutter between them. */
export function splitPanes(stage: Rect, gutter: number): readonly [Rect, Rect] {
  const paneWidth = Math.floor((stage.width - gutter) / 2);
  return [
    { x: stage.x, y: stage.y, width: paneWidth, height: stage.height },
    {
      x: stage.x + stage.width - paneWidth,
      y: stage.y,
      width: paneWidth,
      height: stage.height,
    },
  ];
}
