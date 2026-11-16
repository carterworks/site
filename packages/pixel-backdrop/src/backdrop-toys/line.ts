import type { Point } from "./toy";

/** Visits every cell on the line between two cells, ends included. */
export function line(
  from: Point,
  to: Point,
  visit: (x: number, y: number) => void,
) {
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let { x, y } = from;
  let error = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === to.x && y === to.y) return;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}
