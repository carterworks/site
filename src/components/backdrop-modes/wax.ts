import {
  fixedStep,
  cellScale,
  pointOn,
  visibleCells,
  type CellRect,
  type Point,
  type Toy,
} from "./toy";

/**
 * The gallery tile is 48 cells across at about 8 px a cell with 6 blobs. On the
 * site a cell is the viewport width over `columns`, so sizes and speeds, which
 * the prototype tuned in cells, scale by the ratio of cell sizes at this width.
 */
const PROTOTYPE_CELL_PX = 8;
/**
 * A handful of blobs however big the glass: every blob's slow tail adds to
 * every cell, so a count that grows with the area merges into one mass.
 */
const BLOBS = 7;
/** The lamp is left on this long after the last input, then cools. */
const COOL_MS = 12_000;
const COOLING_DRAG = 0.96;
const STOPPED_SPEED = 0.002;
const FAST_SQUARED = 0.16 * 0.16;
/** The physics is tuned per 60 Hz frame, so a faster display steps it in fixed slices. */
const STEP_MS = 1000 / 60;
/** A tab returning from the background steps this much at most, not the whole gap. */
const MAX_CATCH_UP_MS = 100;

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  heat: number;
};

/** Where a blob's influence is capped; the part above it is summed per cell. */
const TAIL = 0.02;
/** Cells between samples of the capped remainder. */
const FAR_STRIDE = 4;

/** The lattice spans at most the whole grid, sampled every `FAR_STRIDE` cells plus a border. */
export const farCells = (columns: number, rows: number) =>
  (Math.ceil(columns / FAR_STRIDE) + 2) * (Math.ceil(rows / FAR_STRIDE) + 2);

/** The whole cells of `visible` that lie on the grid: the only ones the lamp draws. */
const cellsInGrid = (
  visible: CellRect,
  columns: number,
  rows: number,
): CellRect => ({
  left: Math.max(0, Math.floor(visible.left)),
  top: Math.max(0, Math.floor(visible.top)),
  right: Math.min(columns, Math.ceil(visible.right)),
  bottom: Math.min(rows, Math.ceil(visible.bottom)),
});

export type BlobScratch = { near: Float64Array; far: Float64Array };

type Grab = { blob: Blob; dx: number; dy: number };

/**
 * A lava lamp: blobs warm near the bottom, rise, cool near the top and sink.
 * Press a blob to hold and drag it, let go to fling it; tapping empty glass
 * shoves the wax away and hovering nudges it. Left alone the lamp cools to a
 * stop, so an untouched tab costs nothing, and any input warms it again.
 *
 * It draws white, each band of wax a different alpha, for the backdrop to
 * recolour.
 */
export const wax: Toy = {
  id: "wax",
  label: "Lamp Wax",
  look: { ghost: 75, noise: 8 },
  start(canvas) {
    const context = canvas.getContext("2d");
    if (context === null) return () => {};
    const { width: columns, height: rows } = canvas;
    const scale = cellScale(PROTOTYPE_CELL_PX, columns);
    const reach = 18 * scale;
    const blobs: Blob[] = [];
    const scratch: BlobScratch = {
      near: new Float64Array(columns * rows),
      far: new Float64Array(farCells(columns, rows)),
    };
    const field = new Float32Array(columns * rows);
    const image = context.createImageData(columns, rows);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    }
    const pointer: Point = { x: 0, y: 0 };
    const pressAt: Point = { x: 0, y: 0 };
    let hovering = false;
    let held = false;
    let visible: CellRect = visibleCells(canvas);
    let box = cellsInGrid(visible, columns, rows);
    let grab: Grab | undefined;
    let lastInputAt = performance.now();
    let settled = false;
    let frame: number | undefined;
    const pace = fixedStep(STEP_MS, MAX_CATCH_UP_MS);
    let now = 0;

    const spawn = () => {
      const width = visible.right - visible.left;
      const height = visible.bottom - visible.top;
      for (let k = 0; k < BLOBS; k += 1) {
        const share = k / (BLOBS - 1);
        blobs.push({
          x: visible.left + width * (0.1 + 0.8 * Math.random()),
          y: visible.top + height * (0.125 + 0.75 * share),
          vx: 0,
          vy: 0,
          r: (3 + Math.random() * 2.2) * scale,
          heat: share > 0.5 ? 0.8 : 0.2,
        });
      }
    };

    const shove = (x: number, y: number, force: number) => {
      for (const blob of blobs) {
        const dx = blob.x - x;
        const dy = blob.y - y;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance < reach) {
          const push = (force * (1 - distance / reach)) / distance;
          blob.vx += dx * push;
          blob.vy += dy * push;
        }
      }
    };

    const grabNearest = (x: number, y: number) => {
      let nearest: Blob | undefined;
      let gap = 3 * scale;
      for (const blob of blobs) {
        const away = Math.hypot(blob.x - x, blob.y - y) - blob.r;
        if (away < gap) {
          gap = away;
          nearest = blob;
        }
      }
      if (nearest === undefined) return undefined;
      return { blob: nearest, dx: nearest.x - x, dy: nearest.y - y };
    };

    const advance = () => {
      const awake = grab !== undefined || now - lastInputAt < COOL_MS;
      const height = visible.bottom - visible.top;

      if (grab !== undefined) {
        const target = hovering ? pointer : pressAt;
        const { blob } = grab;
        blob.vx = (blob.vx + (target.x + grab.dx - blob.x) * 0.14) * 0.72;
        blob.vy = (blob.vy + (target.y + grab.dy - blob.y) * 0.14) * 0.72;
        blob.heat = 0.5;
      }

      let fastest = 0;
      for (let k = 0; k < blobs.length; k += 1) {
        const blob = blobs[k];
        if (blob !== grab?.blob) {
          if (!awake) {
            blob.vx *= COOLING_DRAG;
            blob.vy *= COOLING_DRAG;
          } else {
            if (hovering) {
              const dx = blob.x - pointer.x;
              const dy = blob.y - pointer.y;
              const distance = Math.hypot(dx, dy) || 1;
              if (distance < blob.r + 4 * scale) {
                blob.vx += (dx / distance) * 0.02 * scale;
                blob.vy += (dy / distance) * 0.02 * scale;
              }
            }
            if (blob.y > visible.top + height * 0.8) {
              blob.heat = Math.min(1, blob.heat + 0.004);
            } else if (blob.y < visible.top + height * 0.2) {
              blob.heat = Math.max(0, blob.heat - 0.004);
            }
            blob.vy -= (blob.heat - 0.5) * 0.003 * scale;
            blob.vx += (Math.random() - 0.5) * 0.004 * scale;
            blob.vx *= 0.985;
            blob.vy *= 0.985;
            if (
              blob.vx * blob.vx + blob.vy * blob.vy >
              FAST_SQUARED * scale * scale
            ) {
              blob.vx *= 0.95;
              blob.vy *= 0.95;
            }
          }
        }
        blob.x += blob.vx;
        blob.y += blob.vy;

        const margin = blob.r * 0.6;
        const left = visible.left + margin;
        const right = visible.right - margin;
        const top = visible.top + margin;
        const bottom = visible.bottom - margin;
        if (blob.x < left) {
          blob.x = left;
          blob.vx = Math.abs(blob.vx) * 0.4;
        }
        if (blob.x > right) {
          blob.x = right;
          blob.vx = -Math.abs(blob.vx) * 0.4;
        }
        if (blob.y < top) {
          blob.y = top;
          blob.vy = Math.abs(blob.vy) * 0.4;
        }
        if (blob.y > bottom) {
          blob.y = bottom;
          blob.vy = -Math.abs(blob.vy) * 0.4;
        }
        const vx = blob.vx < 0 ? -blob.vx : blob.vx;
        const vy = blob.vy < 0 ? -blob.vy : blob.vy;
        if (vx > fastest) fastest = vx;
        if (vy > fastest) fastest = vy;
      }

      settled = !awake && fastest < STOPPED_SPEED;
      if (settled) {
        for (const blob of blobs) {
          blob.vx = 0;
          blob.vy = 0;
        }
      }
    };

    const draw = (time: number) => {
      frame = undefined;
      now = time;
      pace.advance(now, advance);
      renderBlobs(blobs, box, columns, scratch, field);
      for (let y = box.top; y < box.bottom; y += 1) {
        for (
          let i = y * columns + box.left;
          i < y * columns + box.right;
          i += 1
        ) {
          pixels[i * 4 + 3] = field[i] * 255;
        }
      }
      context.putImageData(image, 0, 0);
      if (!settled) wake();
    };

    const wake = () => {
      if (frame !== undefined) return;
      if (settled) {
        settled = false;
        pace.restart();
      }
      frame = requestAnimationFrame(draw);
    };

    const touch = () => {
      lastInputAt = performance.now();
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !held) return;
      Object.assign(pointer, pointOn(canvas, event));
      hovering = true;
      touch();
    };

    const onDown = (event: PointerEvent) => {
      const point = pointOn(canvas, event);
      Object.assign(pressAt, point);
      Object.assign(pointer, point);
      hovering = true;
      held = true;
      grab = grabNearest(point.x, point.y);
      if (grab === undefined) shove(point.x, point.y, 0.9 * scale);
      touch();
    };

    const onLift = (event: PointerEvent) => {
      held = false;
      grab = undefined;
      if (event.pointerType === "touch") hovering = false;
      touch();
    };

    const onLeave = () => {
      hovering = false;
    };

    const onResize = () => {
      visible = visibleCells(canvas);
      box = cellsInGrid(visible, columns, rows);
      field.fill(0);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
      wake();
    };

    spawn();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onLift);
    canvas.addEventListener("pointercancel", onLift);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    wake();

    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onLift);
      canvas.removeEventListener("pointercancel", onLift);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame ?? 0);
    };
  },
};

/**
 * Bands the summed influence of the blobs over the visible cells. A blob's
 * `r² / (d² + 0.5)` falls off slowly, so it is split at `TAIL`: the part above
 * it is added exactly within the box where it exists, and the capped remainder,
 * which is smooth, is sampled on a coarse lattice and interpolated. The cost
 * follows the blobs' size, not their count times the whole grid.
 */
export function renderBlobs(
  blobs: readonly Pick<Blob, "x" | "y" | "r">[],
  visible: CellRect,
  columns: number,
  { near, far }: BlobScratch,
  field: Float32Array,
) {
  const left = Math.max(0, Math.floor(visible.left));
  const right = Math.min(columns, Math.ceil(visible.right));
  const top = Math.max(0, Math.floor(visible.top));
  const bottom = Math.ceil(visible.bottom);
  const lw = Math.ceil((right - left) / FAR_STRIDE) + 2;
  const lh = Math.ceil((bottom - top) / FAR_STRIDE) + 2;
  for (let y = top; y < bottom; y += 1) {
    near.fill(0, y * columns + left, y * columns + right);
  }
  far.fill(0, 0, lw * lh);

  for (const blob of blobs) {
    const strength = blob.r * blob.r;
    const radius = blob.r * Math.sqrt(1 / TAIL);
    const x0 = Math.max(left, Math.floor(blob.x - radius));
    const x1 = Math.min(right, Math.ceil(blob.x + radius));
    const y0 = Math.max(top, Math.floor(blob.y - radius));
    const y1 = Math.min(bottom, Math.ceil(blob.y + radius));
    for (let y = y0; y < y1; y += 1) {
      const dy = y + 0.5 - blob.y;
      for (let x = x0; x < x1; x += 1) {
        const dx = x + 0.5 - blob.x;
        const reach = strength / (dx * dx + dy * dy + 0.5);
        if (reach > TAIL) near[y * columns + x] += reach - TAIL;
      }
    }
    for (let j = 0; j < lh; j += 1) {
      const dy = top + j * FAR_STRIDE + 0.5 - blob.y;
      for (let i = 0; i < lw; i += 1) {
        const dx = left + i * FAR_STRIDE + 0.5 - blob.x;
        const reach = strength / (dx * dx + dy * dy + 0.5);
        far[j * lw + i] += reach > TAIL ? TAIL : reach;
      }
    }
  }

  for (let y = top; y < bottom; y += 1) {
    const v = (y - top) / FAR_STRIDE;
    const j = v | 0;
    const fy = v - j;
    for (let x = left; x < right; x += 1) {
      const u = (x - left) / FAR_STRIDE;
      const i = u | 0;
      const fx = u - i;
      const at = j * lw + i;
      const sum =
        near[y * columns + x] +
        (far[at] * (1 - fx) + far[at + 1] * fx) * (1 - fy) +
        (far[at + lw] * (1 - fx) + far[at + lw + 1] * fx) * fy;
      field[y * columns + x] =
        sum >= 1 ? 1 : sum > 0.72 ? 0.55 : sum > 0.5 ? 0.22 : 0;
    }
  }
}
